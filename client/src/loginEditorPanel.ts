import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { GemStoneLogin, DEFAULT_LOGIN, loginLabel } from './loginTypes';
import { LoginStorage } from './loginStorage';
import { LoginTreeProvider } from './loginTreeProvider';
import { SysadminStorage } from './sysadminStorage';
import { bundledWindowsClientVersions, bundledGciArchSupported } from './bundledGci';
import { setLoginPassword, getLoginPassword, deleteLoginPassword } from './loginCredentials';

export class LoginEditorPanel {
  private static currentPanel: LoginEditorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  /** Collect versions that have a GCI library available */
  private static getAvailableVersions(
    storage: LoginStorage,
    sysadminStorage: SysadminStorage,
  ): string[] {
    const versionSet = new Set<string>();
    // Extracted versions have GCI libraries in their lib/ directory
    for (const v of sysadminStorage.getExtractedVersions()) {
      versionSet.add(v);
    }
    // Windows client distributions
    if (process.platform === 'win32') {
      for (const v of sysadminStorage.getExtractedWindowsClientVersions()) {
        versionSet.add(v);
      }
      // GCI libraries bundled with the extension (secure/air-gapped installs).
      // These are x64 Windows DLLs, so only offer them on a compatible arch —
      // an ARM64 VS Code can't load them (run the x64 build instead).
      if (bundledGciArchSupported()) {
        for (const v of bundledWindowsClientVersions()) {
          versionSet.add(v);
        }
      }
    }
    // Versions with manually configured GCI library paths
    const config = vscode.workspace.getConfiguration('gemstone');
    const gciLibraries = config.get<Record<string, string>>('gciLibraries', {});
    for (const v of Object.keys(gciLibraries)) {
      versionSet.add(v);
    }
    const versions = [...versionSet];
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions;
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

    // If the login has its password in SecretStorage, load it so the user can
    // view or change it in the editor.
    if (existingLogin?.password_in_keychain) {
      const pw = await getLoginPassword(secrets, existingLogin);
      if (pw !== undefined) {
        login = { ...login, gs_password: pw };
      }
    }

    if (LoginEditorPanel.currentPanel) {
      LoginEditorPanel.currentPanel.panel.reveal(column);
      LoginEditorPanel.currentPanel.versions = versions;
      LoginEditorPanel.currentPanel.readOnly = readOnly;
      LoginEditorPanel.currentPanel.panel.title = LoginEditorPanel.titleFor(
        existingLogin,
        readOnly,
      );
      LoginEditorPanel.currentPanel.update(login);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gemstoneLoginEditor',
      LoginEditorPanel.titleFor(existingLogin, readOnly),
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
      secrets,
      treeProvider,
      login,
      versions,
      readOnly,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private storage: LoginStorage,
    private secrets: vscode.SecretStorage,
    private treeProvider: LoginTreeProvider,
    private login: GemStoneLogin,
    private versions: string[],
    private readOnly: boolean,
  ) {
    this.panel = panel;
    this.update(login);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'save':
            await this.handleSave(message.data, message.originalLabel);
            break;
          case 'requestData':
            this.panel.webview.postMessage({
              command: 'loadData',
              data: this.login,
              versions: this.versions,
              readOnly: this.readOnly,
            });
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

    if (data.password_in_keychain) {
      // Store the password in SecretStorage and strip it from the settings
      // object before we persist.
      if (data.gs_password) {
        await setLoginPassword(this.secrets, data);
      }
      data = { ...data, gs_password: '' };
    } else {
      // If SecretStorage was previously enabled and the user unchecked it,
      // clean up the stored entry so we don't leave stale secrets behind.
      if (this.login.password_in_keychain) {
        await deleteLoginPassword(this.secrets, this.login);
      }
    }

    await this.storage.saveLogin(data, originalLabel);
    this.treeProvider.refresh();
    this.login = data;
    // Retitled and re-pointed before closing, not instead of it: `show` reveals
    // and reloads an already-open panel when a different login is opened for
    // editing, and that branch reads both.
    this.panel.title = `Edit: ${data.label}`;
    vscode.window.showInformationMessage(`Login "${data.label}" saved.`);
    // A Save/Cancel form ends its editing session on Save. Leaving the panel up
    // said nothing about whether the work had landed — the toast was the only
    // signal, and the form still had to be closed by hand.
    this.dispose();
  }

  private update(login: GemStoneLogin): void {
    this.login = login;
    this.panel.webview.html = this.getHtml();
    this.panel.webview.postMessage({
      command: 'loadData',
      data: login,
      versions: this.versions,
      readOnly: this.readOnly,
    });
  }

  private dispose(): void {
    LoginEditorPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>GemStone Login</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      max-width: 500px;
    }
    h2 {
      margin-top: 0;
      font-weight: 400;
    }
    label {
      display: block;
      margin-top: 12px;
      margin-bottom: 4px;
      font-weight: 600;
    }
    select, input[type="text"], input[type="password"] {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    select:focus, input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }
    .field-group {
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
      padding-bottom: 12px;
      margin-bottom: 4px;
    }
    .button-row {
      margin-top: 20px;
      display: flex;
      gap: 8px;
    }
    button {
      padding: 6px 14px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }
    .checkbox-row input[type="checkbox"] {
      margin: 0;
    }
    label.inline-label {
      display: inline;
      margin: 0;
      font-weight: 400;
      cursor: pointer;
    }
    .hint {
      font-size: 0.9em;
      opacity: 0.7;
      margin-top: 4px;
    }
    a.doc-link {
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      text-decoration: none;
    }
    a.doc-link:hover {
      color: var(--vscode-textLink-activeForeground);
      text-decoration: underline;
    }
    .help-row {
      margin: 4px 0 8px;
    }
    /* Per-field help, revealed by the "Help me login" toggle. The left accent bar
       visually ties each note to the field above it. */
    .field-help {
      display: none;
      font-size: 0.9em;
      opacity: 0.85;
      margin-top: 4px;
      padding-left: 8px;
      border-left: 2px solid var(--vscode-focusBorder);
    }
    body.help-on .field-help {
      display: block;
    }
    .help-intro {
      display: none;
      padding: 8px 12px;
      margin-bottom: 12px;
      border-radius: 2px;
      background: var(--vscode-inputValidation-infoBackground, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-inputValidation-infoBorder, var(--vscode-focusBorder));
    }
    body.help-on .help-intro {
      display: block;
    }
    .banner {
      display: none;
      padding: 8px 12px;
      margin-bottom: 12px;
      border-radius: 2px;
      background: var(--vscode-inputValidation-infoBackground, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-inputValidation-infoBorder, var(--vscode-focusBorder));
    }
  </style>
</head>
<body>
  <h2>GemStone Login Parameters</h2>

  <div class="help-row">
    <button id="helpToggle" class="secondary" type="button" aria-expanded="false">Help me login</button>
  </div>

  <div id="helpIntro" class="help-intro">
    Fill in the fields below to connect to a stone; each field's help explains what to
    enter. Host User/Password are needed only for a remote stone whose NetLDI requires
    host authentication. For a full explanation of how GemStone logins work — NRS
    syntax, linked vs. RPC logins, and how the NetLDI starts your Gem — see GemStone's
    <a class="doc-link" id="docsLink">Logging in Gem Sessions</a> guide.
  </div>

  <div id="readOnlyBanner" class="banner">
    This login has an active session, so its configuration is read-only. Log out to edit it.
  </div>

  <div class="field-group">
    <label for="version">GemStone Version</label>
    <select id="version"></select>
    <div class="field-help">The GemStone version whose GCI client library Jasper uses. It must match the version of the stone you are connecting to.</div>

    <label for="gem_host">Gem Host</label>
    <input type="text" id="gem_host" placeholder="localhost">
    <div class="field-help">The machine where your Gem process runs. Use <code>localhost</code> for a stone on this computer, or the remote host's name or IP address for a remote stone.</div>

    <label for="stone">Stone</label>
    <input type="text" id="stone" placeholder="gs64stone">
    <div class="field-help">The name of the running stone (repository monitor) to log in to — for example, <code>gs64stone</code>.</div>

    <label for="netldi">NetLDI (name or port)</label>
    <input type="text" id="netldi" placeholder="gs64ldi or 50377">
    <div class="field-help">The NetLDI network server that launches your Gem. Enter its service name (e.g. <code>gs64ldi</code>) or its port number (e.g. <code>50377</code>). A port number is often easiest for a remote stone.</div>
  </div>

  <div class="field-group">
    <label for="gs_user">GemStone User</label>
    <input type="text" id="gs_user" placeholder="DataCurator">
    <div class="field-help">Your GemStone user — a UserProfile inside the repository, such as <code>DataCurator</code>. This is a GemStone account, not your operating-system login.</div>

    <label for="gs_password">GemStone Password</label>
    <input type="password" id="gs_password">
    <div class="checkbox-row">
      <input type="checkbox" id="password_in_keychain">
      <label for="password_in_keychain" class="inline-label">Store password in OS keychain</label>
    </div>
    <div class="field-help">The password for the GemStone user. Leave it blank to be prompted on each login, or check the box above to store it securely in your OS keychain.</div>
  </div>

  <div class="field-group">
    <label for="host_user">Host User (optional)</label>
    <input type="text" id="host_user">

    <label for="host_password">Host Password (optional)</label>
    <input type="password" id="host_password">
    <div class="field-help">The operating-system account on the Gem's host machine. Fill these in only when the remote NetLDI requires host authentication; leave them blank for a local stone or a guest-mode NetLDI. If left blank, your own OS user is used.</div>
  </div>

  <div class="field-group">
    <div class="checkbox-row">
      <input type="checkbox" id="sync_classes" checked>
      <label for="sync_classes" class="inline-label">Sync classes to local files (Find in Files, Go to Definition)</label>
    </div>
    <div class="field-help">Keeps a read-only .gemstone mirror in sync on login/commit. Turn off for slow or remote connections where the initial sync isn't worth it — server-side search still works.</div>
  </div>

  <div class="button-row">
    <button id="saveBtn">Save</button>
    <button id="cancelBtn" class="secondary">Cancel</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const fields = ['version','gem_host','stone','gs_user','gs_password','netldi','host_user','host_password'];
    let originalLabel = null;

    let helpOn = false;
    function setHelp(on) {
      helpOn = on;
      document.body.classList.toggle('help-on', on);
      const btn = document.getElementById('helpToggle');
      btn.textContent = on ? 'Hide help' : 'Help me login';
      btn.setAttribute('aria-expanded', String(on));
    }
    document.getElementById('helpToggle').addEventListener('click', () => setHelp(!helpOn));
    document.getElementById('docsLink').addEventListener('click', () => {
      vscode.postMessage({ command: 'openDocs' });
    });

    vscode.postMessage({ command: 'requestData' });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'loadData') {
        originalLabel = msg.data.label || null;
        // Populate version dropdown
        const versionSelect = document.getElementById('version');
        const currentVersion = msg.data.version || '';
        const versions = msg.versions || [];
        versionSelect.innerHTML = '';
        const versionSet = new Set(versions);
        if (currentVersion && !versionSet.has(currentVersion)) {
          versions.unshift(currentVersion);
        }
        for (const v of versions) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v;
          versionSelect.appendChild(opt);
        }
        versionSelect.value = currentVersion;
        // Populate other fields
        for (const f of fields) {
          if (f === 'version') continue;
          const el = document.getElementById(f);
          if (el) el.value = msg.data[f] || '';
        }
        document.getElementById('password_in_keychain').checked =
          Boolean(msg.data.password_in_keychain);
        // Default on when unset, so existing logins keep syncing.
        document.getElementById('sync_classes').checked =
          msg.data.sync_classes !== false;

        // Read-only view (login has an active session): show fields but disable
        // every control, hide the Save/Cancel row, and surface the banner.
        const readOnly = Boolean(msg.readOnly);
        for (const el of document.querySelectorAll('input, select')) {
          el.disabled = readOnly;
        }
        document.getElementById('readOnlyBanner').style.display = readOnly ? 'block' : 'none';
        document.querySelector('.button-row').style.display = readOnly ? 'none' : 'flex';

        // Default the help open for a brand-new login (the first-use case this is
        // for); keep it closed when editing/viewing an existing one so it stays
        // out of the way. The user can toggle it either way.
        setHelp(!readOnly && !originalLabel);
      }
    });

    document.getElementById('saveBtn').addEventListener('click', () => {
      const data = {};
      for (const f of fields) {
        data[f] = document.getElementById(f).value;
      }
      data.password_in_keychain = document.getElementById('password_in_keychain').checked;
      data.sync_classes = document.getElementById('sync_classes').checked;
      vscode.postMessage({ command: 'save', data, originalLabel });
    });

    document.getElementById('cancelBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'requestData' });
    });
  </script>
</body>
</html>`;
  }
}
