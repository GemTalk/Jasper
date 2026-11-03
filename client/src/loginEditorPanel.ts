import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { GemStoneLogin, DEFAULT_LOGIN, loginLabel } from './loginTypes';
import { LoginStorage } from './loginStorage';
import { LoginTreeProvider } from './loginTreeProvider';
import { SysadminStorage } from './sysadminStorage';
import { bundledWindowsClientVersions, bundledGciArchSupported } from './bundledGci';
import { readLoginPasswords } from './loginCredentials';
import { loginEditorHtml } from './loginEditorHtml';

/**
 * What the login page knows about versions beyond this machine: every version
 * Jasper supports, and how big a version's download is.
 */
export interface LoginVersionCatalog {
  supportedVersions(): Promise<string[]>;
  /** Bytes; null when nothing is published for this machine, undefined when unknown. */
  downloadSize(version: string): Promise<number | null | undefined>;
}

export class LoginEditorPanel {
  private static currentPanel: LoginEditorPanel | undefined;
  private static catalog: LoginVersionCatalog | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  /** Supported versions from the download site, once asked; empty until then or offline. */
  private supported: string[] = [];

  /** Where the panel learns of versions not on this machine. Set once at activation. */
  static setVersionCatalog(catalog: LoginVersionCatalog | undefined): void {
    LoginEditorPanel.catalog = catalog;
  }

  /** Versions a login can use right now: their library is on this machine. */
  private static getAvailableVersions(
    storage: LoginStorage,
    sysadminStorage: SysadminStorage,
  ): string[] {
    const versionSet = new Set<string>();
    // Extracted versions have GCI libraries in their lib/ directory. Not on
    // Windows: those are Linux builds in WSL, which a Windows login cannot load.
    if (process.platform !== 'win32') {
      for (const v of sysadminStorage.getExtractedVersions()) {
        versionSet.add(v);
      }
    }
    // Client files downloaded for a login: the Windows client, or GemStoneClientLibs
    for (const v of sysadminStorage.getExtractedClientVersions()) {
      versionSet.add(v);
    }
    // GCI libraries bundled with the extension (secure/air-gapped installs).
    // These are x64 Windows DLLs, so only offer them on a compatible arch —
    // an ARM64 VS Code can't load them (run the x64 build instead).
    if (process.platform === 'win32' && bundledGciArchSupported()) {
      for (const v of bundledWindowsClientVersions()) {
        versionSet.add(v);
      }
    }
    // Versions with manually configured GCI library paths
    const config = vscode.workspace.getConfiguration('gemstone');
    const gciLibraries = config.get<Record<string, string>>('gciLibraries', {});
    for (const v of Object.keys(gciLibraries)) {
      versionSet.add(v);
    }
    return sortNewestFirst([...versionSet]);
  }

  /** Panel title for a login: "New…", or "View:/Edit: <label>" per readOnly. */
  private static titleFor(existingLogin: GemStoneLogin | undefined, readOnly: boolean): string {
    if (!existingLogin) return 'New GemStone Login';
    return `${readOnly ? 'View' : 'Edit'}: ${loginLabel(existingLogin)}`;
  }

  static async show(
    storage: LoginStorage,
    secrets: vscode.SecretStorage,
    treeProvider: LoginTreeProvider,
    existingLogin?: GemStoneLogin,
    sysadminStorage?: SysadminStorage,
    // Open the editor as a read-only viewer (e.g. while the login has an active
    // session). The config is only consumed at login, so it is safe to view;
    // editing is disabled so the live session's row isn't disturbed.
    readOnly = false,
  ): Promise<void> {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const versions = sysadminStorage
      ? LoginEditorPanel.getAvailableVersions(storage, sysadminStorage)
      : [];

    let login: GemStoneLogin = existingLogin ?? {
      ...DEFAULT_LOGIN,
      version: versions[0] ?? '',
    };

    // Saving writes back whatever the form holds, and an empty field clears
    // its keychain entry. A login not saved yet has an empty label and no entry
    // of its own; one left under its name by an earlier login would be stale.
    // So a keychain that can't be read opens the login read-only: its blank
    // fields, saved, would erase the passwords it still holds.
    let keychainUnreadable = false;
    if (existingLogin?.password_in_keychain && existingLogin.label !== '') {
      try {
        const stored = await readLoginPasswords(secrets, existingLogin);
        login = {
          ...login,
          gs_password: login.gs_password || stored.gs_password,
          host_password: login.host_password || stored.host_password,
        };
      } catch (e) {
        // A login with an active session stays read-only for that reason alone,
        // with no Edit anyway to lift it.
        keychainUnreadable = !readOnly;
        vscode.window.showErrorMessage(
          `Couldn't read the passwords for "${loginLabel(existingLogin)}" from the OS keychain ` +
            `(${e instanceof Error ? e.message : String(e)}).`,
        );
      }
    }
    const viewOnly = readOnly || keychainUnreadable;

    if (LoginEditorPanel.currentPanel) {
      LoginEditorPanel.currentPanel.panel.reveal(column);
      LoginEditorPanel.currentPanel.versions = versions;
      LoginEditorPanel.currentPanel.sysadminStorage = sysadminStorage;
      LoginEditorPanel.currentPanel.readOnly = viewOnly;
      LoginEditorPanel.currentPanel.keychainUnreadable = keychainUnreadable;
      LoginEditorPanel.currentPanel.panel.title = LoginEditorPanel.titleFor(
        existingLogin,
        viewOnly,
      );
      LoginEditorPanel.currentPanel.update(login);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gemstoneLoginEditor',
      LoginEditorPanel.titleFor(existingLogin, viewOnly),
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    LoginEditorPanel.currentPanel = new LoginEditorPanel(
      panel,
      storage,
      treeProvider,
      login,
      versions,
      viewOnly,
      sysadminStorage,
      keychainUnreadable,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private storage: LoginStorage,
    private treeProvider: LoginTreeProvider,
    private login: GemStoneLogin,
    private versions: string[],
    private readOnly: boolean,
    private sysadminStorage: SysadminStorage | undefined,
    private keychainUnreadable = false,
  ) {
    this.panel = panel;
    this.update(login);
    void this.loadCatalog();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'save':
            await this.handleSave(message.data, message.originalLabel);
            break;
          case 'cancel':
            // Ends the editing session, the way Save does. Cancel used to ask
            // for the stored login back, which reverted the form in place and
            // left the panel up — so the pair disagreed about what pressing
            // either one finishes, and neither closed the editor.
            this.dispose();
            break;
          case 'requestData':
            this.panel.webview.postMessage(this.loadDataMessage());
            break;
          case 'editAnyway':
            if (!this.keychainUnreadable) break;
            this.keychainUnreadable = false;
            this.readOnly = false;
            this.panel.title = LoginEditorPanel.titleFor(this.login, false);
            this.update(this.login);
            break;
          case 'checkVersion':
            this.panel.webview.postMessage({
              command: 'versionInfo',
              version: message.version,
              size: await LoginEditorPanel.catalog?.downloadSize(message.version),
            });
            break;
          case 'downloadVersion':
            // The GemStone manager's command, so both pages do one thing.
            try {
              await vscode.commands.executeCommand('gemstone.downloadClient', {
                version: { version: message.version },
              });
            } finally {
              this.postVersions(message.version);
            }
            break;
          case 'openDocs':
            // GemStone System Administration Guide — "Logging in Gem Sessions": the
            // authoritative reference for login parameters, NRS syntax, and how the
            // NetLDI starts the Gem.
            void vscode.env.openExternal(
              vscode.Uri.parse(
                'https://downloads.gemtalksystems.com/docs/GemStone64/3.4.x/GS64-SysAdminGuide-3.4/1-Introduction.htm#pgfId-1621117',
              ),
            );
            break;
        }
      },
      null,
      this.disposables,
    );
  }

  private async handleSave(data: GemStoneLogin, originalLabel?: string): Promise<void> {
    // Safety net: the webview hides Save and disables fields while read-only,
    // so a save should never arrive — but ignore it if one does, rather than
    // persisting an edit that the read-only view was meant to prevent.
    if (this.readOnly) return;

    data.label = loginLabel(data);

    // A login is identified by its user, stone and host, so one whose label
    // already exists is that same login again. `saveLogin` reads a matching label
    // as the row being edited and replaces it — which here means the other login
    // is silently overwritten, no row is added, and the panel looks exactly as it
    // did before the Save.
    //
    // Both ways in are checked. New Login on a database that already has its
    // DataCurator login hit it every time: the form is prefilled from the
    // database, so its answers match the login already there unless something is
    // changed by hand. An *edit* reaches the same replace by changing the user,
    // stone or host into another row's identity, and vanishes that row instead.
    // The row being edited is excluded, so re-saving it unchanged — or changing
    // only its password, tags or NetLDI — is not a clash with itself. Refused
    // with the reason, and the form left open on the answer that has to change.
    const clash = this.storage
      .getLogins()
      .find((l) => loginLabel(l) === data.label && loginLabel(l) !== originalLabel);
    if (clash) {
      vscode.window.showErrorMessage(
        `A login "${data.label}" already exists. Change the GemStone user, stone or host to ` +
          `${originalLabel ? 'a combination that is free' : 'add a different login'}, or edit ` +
          `the existing one.`,
      );
      return;
    }

    await this.storage.saveLogin(data, originalLabel);
    this.treeProvider.refresh();
    this.login = data;
    // Retitled and re-pointed before closing, not instead of it: `show` reveals
    // and reloads an already-open panel when a different login is opened for
    // editing, and that branch reads both.
    this.panel.title = `Edit: ${data.label}`;
    vscode.window.showInformationMessage(`Login "${data.label}" saved.`);
    // A Save/Cancel form ends its editing session on either — see the `cancel`
    // case above. Leaving the panel up said nothing about whether the work had
    // landed: the toast was the only signal, and the form still had to be
    // closed by hand.
    this.dispose();
  }

  private update(login: GemStoneLogin): void {
    this.login = login;
    this.panel.webview.html = this.getHtml();
    this.panel.webview.postMessage(this.loadDataMessage());
  }

  /** Every version to offer — on disk or supported — and which of them are not on disk. */
  private versionChoices(): { versions: string[]; notDownloaded: string[] } {
    const local = new Set(this.versions);
    return {
      versions: sortNewestFirst([...new Set([...this.versions, ...this.supported])]),
      notDownloaded: sortNewestFirst(this.supported.filter((v) => !local.has(v))),
    };
  }

  private loadDataMessage() {
    return {
      command: 'loadData',
      data: this.login,
      ...this.versionChoices(),
      readOnly: this.readOnly,
      keychainUnreadable: this.keychainUnreadable,
    };
  }

  /**
   * Ask the download site for every supported version, then send the list. The
   * form is already up by then, so it goes as its own message: rewriting the
   * page would lose what the user has typed.
   */
  private async loadCatalog(): Promise<void> {
    const catalog = LoginEditorPanel.catalog;
    if (!catalog) return;
    try {
      this.supported = await catalog.supportedVersions();
    } catch {
      // Offline: the versions on disk are all there is to offer.
    }
    this.postVersions();
  }

  /**
   * Re-read the disk and send the version list, keeping the form as it is.
   * `downloaded` names a download of the page's that just ended, either way.
   */
  private postVersions(downloaded?: string): void {
    if (LoginEditorPanel.currentPanel !== this) return;
    if (this.sysadminStorage) {
      this.versions = LoginEditorPanel.getAvailableVersions(this.storage, this.sysadminStorage);
    }
    this.panel.webview.postMessage({ command: 'versions', downloaded, ...this.versionChoices() });
  }

  private dispose(): void {
    LoginEditorPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private getHtml(): string {
    return loginEditorHtml(crypto.randomBytes(16).toString('hex'));
  }
}

function sortNewestFirst(versions: string[]): string[] {
  return versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}
