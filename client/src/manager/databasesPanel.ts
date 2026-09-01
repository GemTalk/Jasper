// Databases & Versions — an editor-tab webview holding the two halves of setting
// GemStone up: the releases installed on this machine, and the databases made
// from them. It is mostly a *read/coordinate* surface: it renders live state
// pulled straight from the sysadmin managers, and most mutating actions are
// delegated to the existing `gemstone.*` commands, so it inherits their
// confirmation modals, progress notifications and admin-view refreshes for free.
//
// The exception is creating a database. That used to be four Quick Picks in a
// row, which lost everything the moment focus left VS Code — so looking up a
// free NetLDI name cost you the other three answers (#257). Here it is a form:
// the panel holds the answers, and calls DatabaseManager.createDatabaseDirect
// once, when Create is pressed.
//
// Sections deliberately NOT here: a session's configuration has its own panel
// (see client/src/configuration/), and connections live in Logins & Sessions.
//
// Follows the webview conventions established in enhancedInspector.ts /
// debuggerPanel.ts: createWebviewPanel with a strict CSP, all styles inline in
// the host HTML, all behavior in a companion databasesView.js read at module
// load and injected as a nonce'd <script>. It takes a dependency bag rather
// than importing extension.ts, to avoid a circular import (same pattern as
// stonEditor.ts).

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';

import { SysadminStorage } from '../sysadminStorage';
import { DatabaseManager } from '../databaseManager';
import { VersionManager, CatalogEntry } from '../versionManager';
import { ProcessManager, versionsMatch } from '../processManager';
import {
  needsWsl,
  getWslInfoAsync,
  invalidateWslCache,
  invalidateWslNetworkCache,
} from '../wslBridge';
import { wslStatFilesSync } from '../wslFs';
import { GemStoneVersion, GemStoneDatabase, GemStoneProcess } from '../sysadminTypes';
import { GemStoneLogin, loginLabel, dataCuratorLoginToCreate } from '../loginTypes';
import { SessionManager } from '../sessionManager';
import { readWebviewScript } from '../webviewAssets';
import { appendSysadmin } from '../sysadminChannel';

const databasesViewJs = readWebviewScript('databasesView.js', 'manager');

/**
 * The managers this panel reads from. Environment actions are dispatched
 * through the existing `gemstone.*` commands, so no action methods are needed
 * for them here — the exception is Configuration, which reads and writes the
 * selected session's config directly through `sessionManager` (see the module
 * header).
 */
export interface DatabasesPanelDeps {
  storage: SysadminStorage;
  versionManager: VersionManager;
  processManager: ProcessManager;
  /** Creating a database, and the shared rule for when NFS is worth warning about. */
  databaseManager: DatabaseManager;
  /** Saves the DataCurator login that a newly created database gets. */
  saveLogin: (login: GemStoneLogin) => Promise<void>;
  /** Redraws the sidebar after the panel changes something it also shows. */
  refreshAdminViews: () => void;
  getLogins: () => GemStoneLogin[];
  /** Live sessions — lets Connect show what is already connected, and which is current. */
  sessionManager: SessionManager;
  /**
   * The admin views' change events. Every `gemstone.*` command that mutates the
   * environment refreshes those views, so listening here is what keeps the panel
   * current — without a poll, and without each command having to know the panel
   * exists. Composed by the caller so this module never imports a tree provider.
   */
  onAdminChange: readonly vscode.Event<unknown>[];
  /** Extension root — resolves the bundled codicon font for the webview. */
  extensionUri: vscode.Uri;
}

// ── Wire types shared with databasesView.js ───────────────────────────

/** Where a render's version rows come from: the disk alone, or the download catalog. */
type VersionSource = 'local' | 'remote';

interface VersionRow {
  version: string;
  fileName: string;
  size: number;
  date: string;
  downloaded: boolean;
  extracted: boolean;
  local?: boolean;
  bundled?: boolean;
  /** A Windows client for this release is extracted — it can be opened or removed. */
  clientExtracted?: boolean;
}

interface ProcInfo {
  type: 'stone' | 'netldi';
  name: string;
  pid: number;
  port?: number;
  status: string;
  responding: boolean;
}

/** A stone or NetLDI alive on the host but started outside Jasper's environment,
 *  so Jasper can see it exists but cannot stop it. The row offers the one thing
 *  that helps: restarting it under Jasper. */
interface ExternalProc {
  type: 'stone' | 'netldi';
  pid: number;
}

interface SessionInfo {
  id: number;
  /** The one the rest of Jasper works in — where Display It and friends run. */
  current: boolean;
}

interface LoginInfo {
  label: string;
  user: string;
  stone: string;
  host: string;
  /**
   * The sessions open for this login. A login can be logged in more than once,
   * so this is a list rather than a flag — the sidebar shows them as rows under
   * their login, and the panel has to agree with it.
   */
  sessions: SessionInfo[];
}

interface DatabaseRow {
  dirName: string;
  version: string;
  stoneName: string;
  ldiName: string;
  baseExtent: string;
  path: string;
  stoneRunning: boolean;
  netldiRunning: boolean;
  processes: ProcInfo[];
  logins: LoginInfo[];
  /** Extents this database's version ships, for the header's extent chooser. */
  availableExtents: string[];
  /** Servers running outside Jasper's environment, if any. */
  external: ExternalProc[];
  /** When the stone started, epoch ms — for "running 12 minutes". */
  startedAtMs?: number;
  /** The database's own files, mirroring what the sidebar tree lists. */
  logFiles: FileEntry[];
  confFiles: FileEntry[];
  /** Logical backups — restored through a running stone. */
  backupFiles: FileEntry[];
  /** Offline extent copies — put back in place with the stone down. A different
   *  kind of file needing a different restore, so a different list. */
  extentBackupFiles: FileEntry[];
}

/** A login as the Connect band sees it: who, where, and whether it can be used. */
interface LoginTarget {
  label: string;
  user: string;
  stone: string;
  version: string;
  /** The local database this login targets, when there is one. */
  dirName?: string;
  /** Whether that database's stone is up — a login to a stopped stone will fail. */
  running: boolean;
  /** A session is already open for this login; its id, so it can be selected. */
  connected: boolean;
  sessionId?: number;
  /** ...and it is the selected one, the session Display It and friends act on. */
  current: boolean;
}

interface FileEntry {
  name: string;
  path: string;
  /** Last written, epoch ms — 0 when it could not be read. */
  modifiedMs: number;
}

/**
 * The selected session, as the Configuration section needs it: enough to label
 * the panel and know whether there is anything to show, carried in every state
 * so the section can appear the moment a session is selected — without the
 * state rebuild ever touching the GCI (the config values themselves load on
 * demand).
 */
/** Everything the New Database form needs, so it can be drawn and checked
 *  without a round-trip per keystroke. */
interface CreateOptions {
  /** Installed releases, each with the base extents that release ships. */
  versions: { version: string; extents: string[] }[];
  /** Stone names already in use, so a clash is caught before Create is pressed. */
  stoneNames: string[];
  ldiNames: string[];
  /** Set only when the next database would be the first one AND the root is on
   *  NFS — the case the old flow raised a modal for. */
  nfsWarning: boolean;
  rootPath: string;
}

interface PanelState {
  platform: string;
  /** Windows with WSL — where the client install and Copy Host actions mean anything. */
  windows: boolean;
  rootPath: string;
  versions: VersionRow[];
  databases: DatabaseRow[];
  /** Only used to mark which database the current session is working in. */
  logins: LoginTarget[];
  /** What the New Database form needs to offer, and to check answers against. */
  create: CreateOptions;
}

type Inbound =
  | { command: 'ready' }
  | { command: 'refresh' }
  | { command: 'extractVersion'; version: string }
  | { command: 'deleteDownload'; version: string }
  | { command: 'uninstallVersion'; version: string }
  | { command: 'unregisterLocalVersion'; version: string }
  | { command: 'openVersionFolder'; version: string }
  | { command: 'openVersionTerminal'; version: string }
  | { command: 'installWindowsClient'; version: string }
  | { command: 'openWindowsClientFolder'; version: string }
  | { command: 'deleteWindowsClient'; version: string }
  | { command: 'registerLocalVersion' }
  | { command: 'installNewVersion' }
  | {
      command: 'createDatabase';
      version: string;
      extent: string;
      stoneName: string;
      ldiName: string;
      allowNfs: boolean;
    }
  | { command: 'chooseRoot' }
  | { command: 'deleteDatabase'; dirName: string }
  | { command: 'startDatabase'; dirName: string }
  | { command: 'stopDatabase'; dirName: string }
  | { command: 'startStone'; dirName: string }
  | { command: 'stopStone'; dirName: string }
  | { command: 'startNetldi'; dirName: string }
  | { command: 'stopNetldi'; dirName: string }
  | { command: 'replaceExtent'; dirName: string; extent?: string }
  | { command: 'backupDatabase'; dirName: string }
  | { command: 'restartExternalServers'; dirName: string }
  | { command: 'offlineExtentBackup'; dirName: string }
  | { command: 'restoreBackup'; dirName: string; path: string }
  | { command: 'openDbTerminal'; dirName: string }
  | { command: 'openDbInFinder'; dirName: string }
  | { command: 'openDbSubfolder'; dirName: string; folder: string }
  | { command: 'openDbFile'; dirName: string; path: string }
  | { command: 'revealDbFile'; dirName: string; path: string }
  | { command: 'createLoginFromDb'; dirName: string }
  | { command: 'connectLogin'; login: string }
  | { command: 'logoutSession'; sessionId: number }
  | { command: 'sessionAction'; sessionId: number; action: string }
  | { command: 'pingSession'; sessionId: number }
  | { command: 'copyText'; text: string }
  | { command: 'showSessionConfiguration'; sessionId: number }
  | { command: 'editLogin'; login: string }
  | { command: 'copyNetldiHost'; dirName: string; name: string }
  | { command: 'deleteStaleLock'; dirName: string; name: string }
  | { command: 'closePanel' };

/**
 * gslist reports a start time as "Aug 06 17:40" — to the minute, with no year
 * (3.6.2 and friends include seconds; both parse). The year is
 * therefore inferred as the current one, and rolled back when that would place
 * the start in the future, which is what happens across a New Year boundary.
 * Returns undefined when the field is absent; anything present is left to
 * Date.parse, which is lenient enough to answer for almost any text once a year
 * has been appended to it.
 */
export function parseGslistStart(
  startTime: string | undefined,
  now = new Date(),
): number | undefined {
  if (!startTime) return undefined;
  const parsed = Date.parse(`${startTime} ${now.getFullYear()}`);
  if (Number.isNaN(parsed)) return undefined;
  const ONE_DAY = 86_400_000;
  return parsed > now.getTime() + ONE_DAY
    ? Date.parse(`${startTime} ${now.getFullYear() - 1}`)
    : parsed;
}

export class DatabasesPanel {
  static readonly viewType = 'gemstoneDatabasesPanel';
  private static current: DatabasesPanel | undefined;

  /** How long to gather change notifications before rebuilding once. */
  private static readonly COALESCE_MS = 200;

  private readonly disposables: vscode.Disposable[] = [];
  private lastVersions: GemStoneVersion[] = [];
  private lastDatabases: GemStoneDatabase[] = [];
  /**
   * The downloads page, held for as long as the panel is open. The panel rebuilds
   * on every admin change, and asking the site again each time would put a network
   * round trip behind starting a stone — a ten-second wait before the panel
   * redraws, on a machine that is offline. What actually changes between rebuilds
   * is on disk, and that is read fresh every time; Refresh drops this so a release
   * published while the panel sits open is one click away.
   */
  private catalog: CatalogEntry[] | undefined;
  // The in-flight catalog fetch, so two concurrent readers (a postState and a
  // coalesced rebuild that overlap on first open) await one network round-trip
  // rather than each starting their own.
  private catalogFetch: Promise<CatalogEntry[]> | undefined;
  private coalesceTimer: ReturnType<typeof setTimeout> | undefined;
  /** Open straight into the New Database form, once the webview is listening. */
  private openOnCreateForm = false;
  private rebuilding = false;
  private rebuildAgain = false;
  private staleWhileHidden = false;
  // Parsed system.conf descriptions, one map per version — the file does not
  // change under a running stone, so it is read and parsed once per version and
  // kept (an unreadable file caches as an empty map, so a remote stone whose
  // product tree is not on this machine is not re-probed on every load).

  /**
   * Publishes whether a panel is open, so the Dictionaries title bar can offer
   * Open or Close rather than one button that means both.
   */
  private static setOpenContext(open: boolean): void {
    void vscode.commands.executeCommand('setContext', 'gemstone.managerOpen', open);
  }

  /** Close the manager if one is open; a no-op otherwise. */
  static close(): void {
    DatabasesPanel.current?.dispose();
  }

  /**
   * Open the manager, revealing the existing panel if one is already open.
   *
   * `preserveFocus` is for the times the panel opens because the environment
   * said so rather than because the user asked — at startup with nothing
   * connected, or when the last session goes away. Taking focus there would pull
   * the user out of whatever editor they were in.
   */
  /**
   * Open the panel, or bring the open one forward.
   *
   * `startCreating` is how the sidebar's New Database button lands straight in
   * the form. It is posted rather than passed into the first render because the
   * form is the webview's own state — the host does not hold the half-typed
   * answers, which is exactly what keeps them safe from a refresh.
   */
  static show(deps: DatabasesPanelDeps, preserveFocus = false, startCreating = false): void {
    if (DatabasesPanel.current) {
      DatabasesPanel.current.panel.reveal(undefined, preserveFocus);
      void DatabasesPanel.current.postState();
      if (startCreating)
        DatabasesPanel.current.panel.webview.postMessage({ command: 'beginCreate' });
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      DatabasesPanel.viewType,
      'Databases & Versions',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // Exactly one readable directory: the codicon font this panel draws with.
        localResourceRoots: [
          vscode.Uri.joinPath(deps.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
        ],
      },
    );
    DatabasesPanel.current = new DatabasesPanel(panel, deps);
    DatabasesPanel.setOpenContext(true);
    // Held until the webview says `ready`. Posting it here would be shouting at a
    // frame that has not loaded its script yet — and init() resets the form state
    // when it does, so the message would be lost twice over.
    DatabasesPanel.current.openOnCreateForm = startCreating;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly deps: DatabasesPanelDeps,
  ) {
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: Inbound) => void this.handleMessage(msg).catch((e) => this.failed(msg.command, e)),
      null,
      this.disposables,
    );
    // A database's login rows say which are connected and which session is
    // current, so it has to
    // follow the selection rather than only refreshing on demand.
    this.deps.sessionManager.onDidChangeSelection(() => this.markStale(), null, this.disposables);
    this.deps.sessionManager.onDidRemoveSession(() => this.markStale(), null, this.disposables);
    // A second session changes no selection — only the first is auto-selected —
    // so without this the row for a login that just connected kept offering
    // "Log in" until something else happened to redraw the panel.
    this.deps.sessionManager.onDidAddSession(() => this.markStale(), null, this.disposables);
    for (const onChange of this.deps.onAdminChange) {
      onChange(() => this.markStale(), null, this.disposables);
    }
    // A change that arrives for a panel nobody is looking at is worth nothing
    // until the tab comes back, and this one is expensive to answer.
    this.panel.onDidChangeViewState(
      () => {
        if (this.panel.visible && this.staleWhileHidden) {
          this.staleWhileHidden = false;
          void this.rebuild().catch((e) => this.failed('refresh', e));
        } else if (!this.panel.visible && this.coalesceTimer) {
          // A coalesce timer armed while visible must not fire a full scan at a
          // panel nobody is looking at — defer it until the tab comes back.
          clearTimeout(this.coalesceTimer);
          this.coalesceTimer = undefined;
          this.staleWhileHidden = true;
        }
      },
      null,
      this.disposables,
    );
    // Logins live in the `gemstone.logins` setting, and the editor that writes
    // them saves long after the command which opened it returned — so a refresh
    // at dispatch time shows the list as it was before the user typed anything.
    // Watching the setting is what keeps Connect current, and it covers a login
    // added, edited or deleted anywhere else too: the sidebar, or settings.json
    // by hand.
    // `gemstone.rootPath` is the folder every database and installed version is
    // found under, so changing it changes almost everything here — and the panel
    // offers the button that changes it, which would otherwise leave the screen
    // describing the folder the user just moved away from.
    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (
          e.affectsConfiguration('gemstone.logins') ||
          e.affectsConfiguration('gemstone.rootPath')
        )
          this.markStale();
      },
      null,
      this.disposables,
    );
  }

  /**
   * Something the panel shows has changed. One admin command refreshes several
   * views, so notifications arrive in bursts and are collapsed into a single
   * rebuild rather than one scan each.
   */
  private markStale(): void {
    if (!this.panel.visible) {
      this.staleWhileHidden = true;
      return;
    }
    if (this.coalesceTimer) clearTimeout(this.coalesceTimer);
    this.coalesceTimer = setTimeout(() => {
      this.coalesceTimer = undefined;
      void this.rebuild().catch((e) => this.failed('refresh', e));
    }, DatabasesPanel.COALESCE_MS);
  }

  /**
   * Something the panel was asked to do did not happen. Every button here
   * dispatches an existing command, and a command that rejects would otherwise
   * leave the click looking like it never registered — no message, nothing in
   * the log, and a panel still showing the state from before.
   */
  private failed(what: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    appendSysadmin(`Databases & Versions: ${what} failed: ${detail}`);
    void vscode.window.showErrorMessage(`Databases & Versions: ${detail}`);
    this.actionFailed(error);
  }

  /**
   * Tell the panel an action it asked for did not work. The guided steps must not
   * advance on the strength of a command that failed, and a notification is
   * truncated well before a `startstone` error has finished explaining itself —
   * so the text goes into the panel, where it can wrap and be read.
   */
  private actionFailed(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    appendSysadmin(`Databases & Versions: ${message}`);
    void this.panel.webview.postMessage({ command: 'actionFailed', message });
  }

  /**
   * One rebuild at a time. A scan outlives its coalescing window, so a
   * notification arriving mid-scan queues exactly one more pass — which keeps
   * two rebuilds from posting their states out of order.
   */
  private async rebuild(): Promise<void> {
    if (this.rebuilding) {
      this.rebuildAgain = true;
      return;
    }
    this.rebuilding = true;
    try {
      // One complete pass, not postState's local-then-catalog pair: the local
      // pass carries no catalog rows, so replaying it here would shrink the
      // version list and re-grow it on every admin action. And no `loading`
      // ping — the panel is refreshing itself under someone who is reading it,
      // so it must not flash busy. A notification arriving mid-scan sets
      // rebuildAgain and is drained by this loop, so exactly one more pass runs.
      do {
        this.rebuildAgain = false;
        const state = await this.buildState('remote');
        this.panel.webview.postMessage({ command: 'state', state });
      } while (this.rebuildAgain);
    } finally {
      // Clear both here so a pass that throws does not leave rebuildAgain set to
      // leak into — and force a spurious extra run of — the next rebuild.
      this.rebuilding = false;
      this.rebuildAgain = false;
    }
  }

  private dispose(): void {
    if (DatabasesPanel.current === this) {
      DatabasesPanel.current = undefined;
      DatabasesPanel.setOpenContext(false);
    }
    if (this.coalesceTimer) clearTimeout(this.coalesceTimer);
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  // ── Message handling ──────────────────────────────────────────────────────

  private async handleMessage(msg: Inbound): Promise<void> {
    switch (msg.command) {
      case 'ready':
        await this.postState();
        // Now the view is listening and has a state to draw the form over.
        if (this.openOnCreateForm) {
          this.openOnCreateForm = false;
          void this.panel.webview.postMessage({ command: 'beginCreate' });
        }
        return;
      case 'refresh':
        // Refresh is the one place that asks the network again: everything the
        // panel caches is dropped here, so the button means what it says.
        this.catalog = undefined;
        this.catalogFetch = undefined;
        // Drop the per-version system.conf descriptions too, so a version whose
        // product tree was not present at first read (an as-yet-uninstalled
        // version) picks up its tooltips once it is installed and refreshed.
        // The WSL answers are cached, and the OS checklist reads them — so a
        // refresh has to forget them, or a machine stays "WSL not reachable"
        // after the user has made it reachable.
        if (needsWsl()) {
          invalidateWslCache();
          invalidateWslNetworkCache();
          await getWslInfoAsync();
        }
        await this.postState();
        return;

      // Versions — reuse the existing commands, passing a synthetic VersionItem
      // ({ version }) since those handlers only read `item.version`.
      case 'extractVersion':
        await this.runVersionCommand('gemstone.extractVersion', msg.version);
        return;
      case 'deleteDownload':
        await this.runVersionCommand('gemstone.deleteDownload', msg.version);
        return;
      case 'uninstallVersion':
        await this.uninstallVersion(msg.version);
        return;
      case 'unregisterLocalVersion':
        await this.runVersionCommand('gemstone.unregisterLocalVersion', msg.version);
        return;
      case 'openVersionTerminal':
        await this.versionCommand('gemstone.openVersionTerminal', msg.version);
        return;
      case 'installWindowsClient':
        await this.versionCommand('gemstone.downloadWindowsClient', msg.version);
        return;
      case 'openWindowsClientFolder':
        await this.versionCommand('gemstone.openWindowsClientFolder', msg.version);
        return;
      case 'deleteWindowsClient':
        await this.versionCommand('gemstone.deleteWindowsClientExtracted', msg.version);
        return;
      case 'copyNetldiHost':
        await this.processCommand('gemstone.copyNetldiHost', msg.dirName, msg.name);
        return;
      case 'deleteStaleLock':
        await this.processCommand('gemstone.deleteStaleLock', msg.dirName, msg.name);
        return;
      case 'openVersionFolder':
        await this.runVersionCommand('gemstone.openVersionFolder', msg.version);
        return;
      case 'installNewVersion':
        await this.installNewVersion();
        return;
      case 'registerLocalVersion':
        await vscode.commands.executeCommand('gemstone.registerLocalVersion');
        await this.postState();
        return;

      // Databases — reuse the existing commands with a synthetic DatabaseNode.
      // Creating a database also opens a matching login (prefilled), so a new
      // database is immediately connectable.
      case 'createDatabase':
        await this.createDatabase(msg);
        return;
      case 'deleteDatabase':
        await this.runDbCommand('gemstone.deleteDatabase', msg.dirName, 'database');
        return;

      // Whole-database start/stop: brings the Stone and NetLDI up/down together.
      case 'startDatabase':
        await this.startStopDatabase(msg.dirName, true);
        return;
      case 'stopDatabase':
        await this.startStopDatabase(msg.dirName, false);
        return;
      case 'openDbSubfolder':
        await this.openDbSubfolder(msg.dirName, msg.folder);
        return;
      case 'openDbFile':
        await this.revealOrOpenFile(msg.dirName, msg.path, 'vscode.open');
        return;
      case 'revealDbFile':
        await this.revealOrOpenFile(msg.dirName, msg.path, 'revealFileInOS');
        return;

      case 'startStone':
        await this.runDbCommand('gemstone.startStone', msg.dirName, 'stone');
        return;
      case 'stopStone':
        await this.runDbCommand('gemstone.stopStone', msg.dirName, 'stone');
        return;
      case 'startNetldi':
        await this.runDbCommand('gemstone.startNetldi', msg.dirName, 'netldi');
        return;
      case 'stopNetldi':
        await this.runDbCommand('gemstone.stopNetldi', msg.dirName, 'netldi');
        return;
      case 'replaceExtent':
        // The dropdown is the way in, not the answer: gemstone.replaceExtent runs
        // its own guarded pick (which also offers browsing for an extent from
        // elsewhere) and confirms destructively before touching anything. The
        // chosen value is deliberately not carried over — the command pre-picks
        // the database's current extent, and quietly re-pointing that at a value
        // this panel supplied would make the confirmation describe something the
        // user had not seen in the command's own list.
        await this.runDbCommand('gemstone.replaceExtent', msg.dirName, 'stone');
        return;
      case 'backupDatabase':
        // The command resolves the live session itself and says so when there
        // isn't one, so the panel does not second-guess it.
        await this.runDbCommand('gemstone.onlineExtentBackup', msg.dirName, 'stone');
        return;
      case 'restartExternalServers':
        // Adopting a server someone started by hand. The command re-reads before
        // acting, so a stone that has since been stopped is not restarted behind
        // the user's back.
        await this.runDbCommand('gemstone.restartExternalServers', msg.dirName, 'database');
        return;
      case 'offlineExtentBackup':
        // Guarded in the command: it refuses a stone that is alive anywhere on
        // the host, not just one this panel last drew as stopped.
        await this.runDbCommand('gemstone.offlineExtentBackup', msg.dirName, 'database');
        return;
      case 'restoreBackup':
        await this.restoreBackup(msg.dirName, msg.path);
        return;
      case 'openDbTerminal':
        await this.runDbCommand('gemstone.openDbTerminal', msg.dirName, 'database', false);
        return;
      case 'openDbInFinder':
        await this.runDbCommand('gemstone.openDbInFinder', msg.dirName, 'database', false);
        return;
      case 'createLoginFromDb':
        await this.runDbCommand('gemstone.createLoginFromDb', msg.dirName, 'database', false);
        return;
      case 'connectLogin':
        await this.connectLogin(msg.login);
        return;
      case 'editLogin':
        await this.loginCommand('gemstone.editLogin', msg.login);
        return;
      case 'chooseRoot':
        await this.chooseRootPath();
        return;
      case 'logoutSession': {
        // The command reads only `activeSession`, so the live record is what it
        // gets — not the row the panel last drew, which may name a session that
        // has since gone.
        const session = this.deps.sessionManager.getSession(msg.sessionId);
        if (session)
          await vscode.commands.executeCommand('gemstone.sessionLogout', {
            activeSession: session,
          });
        await this.postState();
        return;
      }
      case 'pingSession':
        this.pingSession(msg.sessionId);
        return;
      case 'copyText':
        // Through the host: the webview clipboard is not reliably available under
        // this panel's CSP, but vscode.env.clipboard always is.
        void vscode.env.clipboard.writeText(msg.text);
        return;
      case 'sessionAction':
        await this.sessionCommand(msg.action, msg.sessionId);
        return;
      case 'showSessionConfiguration':
        // Named by id rather than by a tree item, which the panel has none of.
        await vscode.commands.executeCommand('gemstone.showSessionConfiguration', {
          sessionId: msg.sessionId,
        });
        return;
      case 'closePanel':
        // Cancelling a form the panel was opened *for* leaves nothing behind:
        // the user asked for a database, said never mind, and should be back
        // where they started rather than looking at a panel they never opened.
        DatabasesPanel.close();
        return;
    }
  }

  /** Run one of the allowed session commands against a live session. */
  private async bringUp(db: GemStoneDatabase): Promise<void> {
    const cfg = db.config;
    if (!this.deps.processManager.isStoneRunning(cfg.stoneName, cfg.version)) {
      await vscode.commands.executeCommand('gemstone.startStone', { kind: 'stone', db });
    }
    if (!this.deps.processManager.isNetldiRunning(cfg.ldiName, cfg.version)) {
      await vscode.commands.executeCommand('gemstone.startNetldi', { kind: 'netldi', db });
    }
  }

  /** Stop whichever of a database's processes is up, for the same reason. */
  private async takeDown(db: GemStoneDatabase): Promise<void> {
    const cfg = db.config;
    if (this.deps.processManager.isStoneRunning(cfg.stoneName, cfg.version)) {
      await vscode.commands.executeCommand('gemstone.stopStone', { kind: 'stone', db });
    }
    if (this.deps.processManager.isNetldiRunning(cfg.ldiName, cfg.version)) {
      await vscode.commands.executeCommand('gemstone.stopNetldi', { kind: 'netldi', db });
    }
  }

  /**
   * Connect as a specific login. Rows are identified by their display label, the
   * same string `buildDatabases` puts on the wire, so the panel never has to ship
   * credentials to the webview. Delegates to `gemstone.login`, inheriting its
   * keychain lookup, password prompt and session wiring.
   */
  private async connectLogin(label: string): Promise<void> {
    const login = this.deps.getLogins().find((l) => loginLabel(l) === label);
    if (!login) return;
    await vscode.commands.executeCommand('gemstone.login', { login });
  }

  /**
   * Run a login command on the login with this label. Each of them reads nothing
   * off the tree item it is handed but its `login`, so that is the shape the
   * panel supplies — and it inherits their own rules, like refusing to delete a
   * login that has a session open.
   */
  private async loginCommand(command: string, label: string): Promise<void> {
    const login = this.deps.getLogins().find((l) => loginLabel(l) === label);
    if (!login) return;
    await vscode.commands.executeCommand(command, { login });
    await this.postState();
  }

  /**
   * Adding a release the machine does not have yet. The published catalogue runs
   * to dozens of entries, so it is offered as a quick pick — the editor's own
   * answer to choosing from a long list — rather than rendered into the panel.
   */
  private async installNewVersion(): Promise<void> {
    await this.buildVersions('remote');
    const candidates = this.lastVersions.filter((v) => !v.extracted && !v.downloaded && !v.local);
    if (!candidates.length) {
      vscode.window.showInformationMessage(
        'Every available GemStone release is already installed.',
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      candidates.map((v) => ({
        label: v.version,
        description: v.date,
        detail: v.size ? `${(v.size / 1024 ** 3).toFixed(1)} GB download` : undefined,
      })),
      {
        title: 'Install a GemStone release',
        placeHolder: 'Select a version to download and install',
      },
    );
    if (!picked) return;
    await this.installVersion(picked.label);
  }

  /**
   * Installing a chosen release is a single action: fetch the archive, then
   * extract it. The extract only runs once the download has actually landed, so a
   * cancelled or failed fetch never tries to unpack a file that isn't there.
   */
  private async installVersion(version: string): Promise<void> {
    const target = this.lastVersions.find((v) => v.version === version);
    if (!target) return;

    await vscode.commands.executeCommand('gemstone.downloadVersion', { version: target });

    await this.buildVersions('remote');
    const fetched = this.lastVersions.find((v) => v.version === version);
    if (!fetched?.downloaded) {
      await this.postState();
      return;
    }

    await vscode.commands.executeCommand('gemstone.extractVersion', { version: fetched });

    // Install is one action, so it does not leave the archive behind for the user
    // to find and wonder about — and Remove can then take away everything Install
    // put there. Deleted only once the unpack has actually landed: a failed or
    // cancelled unpack keeps the download, so retrying does not mean fetching two
    // gigabytes a second time.
    await this.buildVersions('local');
    if (this.lastVersions.find((v) => v.version === version)?.extracted) {
      await this.deps.versionManager.deleteDownload(fetched);
    }
    await this.postState();
  }

  /**
   * Remove is the inverse of Install. Install downloads *and* unpacks, so Remove
   * takes away both the unpacked product and any archive it came from. Deleting
   * only the product left the archive on disk, and the release came straight back
   * as a row offering to Install it again — which reads as the removal having
   * silently failed.
   *
   * The confirmation lives in the command, so the archive goes only if the user
   * said yes: it is deleted after checking that the product actually went.
   */
  private async uninstallVersion(version: string): Promise<void> {
    const target = this.lastVersions.find((v) => v.version === version);
    if (!target) return;
    await vscode.commands.executeCommand('gemstone.deleteExtracted', { version: target });
    await this.buildVersions('local');
    if (!this.lastVersions.find((v) => v.version === version)?.extracted) {
      await this.deps.versionManager.deleteDownload(target);
    }
    await this.postState();
  }

  private async runVersionCommand(command: string, version: string): Promise<void> {
    const v = this.lastVersions.find((x) => x.version === version);
    if (!v) return;
    await vscode.commands.executeCommand(command, { version: v });
    await this.postState();
  }

  /**
   * Run a version command on the release with this number. They take a tree item
   * and read only its `version`, so that is what the panel hands them.
   */
  private async versionCommand(command: string, version: string): Promise<void> {
    const target = this.lastVersions.find((v) => v.version === version);
    if (!target) return;
    await vscode.commands.executeCommand(command, { version: target });
    await this.postState();
  }

  /**
   * Run a process command on one of a database's processes. They take a tree item
   * and read only its `process`, and the stale-lock one refuses a process that is
   * still responding — so the panel passes the live record rather than the row it
   * last rendered.
   */
  private async processCommand(command: string, dirName: string, name: string): Promise<void> {
    const db = this.lastDatabases.find((d) => d.dirName === dirName);
    if (!db) return;
    const process = this.deps.processManager
      .getProcesses()
      .find((p) => p.name === name && versionsMatch(p.version, db.config.version));
    if (!process) return;
    await vscode.commands.executeCommand(command, { process });
    await this.postState();
  }

  private async runDbCommand(
    command: string,
    dirName: string,
    kind: 'database' | 'stone' | 'netldi',
    refresh = true,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const db = this.lastDatabases.find((d) => d.dirName === dirName);
    if (!db) return;
    await vscode.commands.executeCommand(command, { kind, db, ...extra });
    if (refresh) await this.postState();
  }

  private async startStopDatabase(dirName: string, start: boolean): Promise<void> {
    const db = this.lastDatabases.find((d) => d.dirName === dirName);
    if (!db) return;
    if (start) await this.bringUp(db);
    else await this.takeDown(db);
    await this.postState();
  }

  /** Files in a database subfolder, sorted by name — as the sidebar tree lists them. */
  /**
   * A database's files, newest first. Log and backup directories accumulate, and
   * the file anyone is looking for is nearly always the most recent one — an
   * alphabetical list buries it among its own history.
   */
  private listFiles(dir: string): FileEntry[] {
    return wslStatFilesSync(dir)
      .map((e) => ({ name: e.name, path: path.join(dir, e.name), modifiedMs: e.modifiedMs }))
      .sort((a, b) => b.modifiedMs - a.modifiedMs || a.name.localeCompare(b.name));
  }

  /** Backups are the .dbf files at the top of backups/, newest first (the names
   *  carry a sortable timestamp) — the same rule the sidebar tree applies. */
  private listBackups(dbPath: string): FileEntry[] {
    // Already newest-first from listFiles; nothing to reverse.
    return this.listFiles(path.join(dbPath, 'backups')).filter((f) =>
      f.name.toLowerCase().endsWith('.dbf'),
    );
  }

  /**
   * Open or reveal one of a database's own files. The path is re-checked against
   * the database directory before it is used: the webview may only reach files
   * inside the database it was given, never an arbitrary path off the disk.
   */
  private async revealOrOpenFile(
    dirName: string,
    filePath: string,
    command: string,
  ): Promise<void> {
    const db = this.ownedFile(dirName, filePath);
    if (!db) return;
    await vscode.commands.executeCommand(command, vscode.Uri.file(filePath));
  }

  /**
   * The named database, but only if `filePath` is inside it. The webview names
   * files by path, and one of the things it can ask for is a restore — the most
   * destructive action here — so both the opening and the restoring path resolve
   * ownership the same way, through here.
   */
  private ownedFile(dirName: string, filePath: string): GemStoneDatabase | undefined {
    const db = this.lastDatabases.find((d) => d.dirName === dirName);
    if (!db) return undefined;
    const root = path.resolve(db.path) + path.sep;
    return path.resolve(filePath).startsWith(root) ? db : undefined;
  }

  /**
   * Restore a database from one of its own backups. The path is re-checked
   * against the database directory before it is used, exactly as opening a file
   * is: a restore is the most destructive thing here, and the webview must not
   * be able to name an arbitrary file for it.
   */
  private async restoreBackup(dirName: string, filePath: string): Promise<void> {
    const db = this.ownedFile(dirName, filePath);
    if (!db) return;
    await vscode.commands.executeCommand('gemstone.fullLogicalRestore', {
      kind: 'backupFile',
      filePath,
      db,
    });
    await this.postState();
  }

  /**
   * The session commands the Logins & Sessions tree offers on a session row.
   *
   * Allow-listed rather than passed straight through: the message arrives from a
   * webview, and `executeCommand` with an arbitrary string would let anything
   * reachable by name be run with a session handed to it.
   *
   * Each reads `activeSession` off whatever it is given, so the live record is
   * what they get — not the row the panel last drew, which may name a session
   * that has since been logged out.
   */
  private static readonly SESSION_COMMANDS = new Set([
    'gemstone.selectSession',
    'gemstone.sessionCommit',
    'gemstone.sessionAbort',
    'gemstone.fullLogicalBackup',
    'gemstone.fullLogicalRestore',
  ]);

  /**
   * Check a session is alive and responsive, answering beside the row that asked
   * rather than as a toast — this is where a session's live maintenance happens
   * now, and a toast would not say *which* session answered.
   *
   * A ping changes nothing, so it deliberately does not rebuild the state.
   */
  private pingSession(sessionId: number): void {
    const session = this.deps.sessionManager.getSession(sessionId);
    if (!session) {
      void this.panel.webview.postMessage({
        command: 'pingResult',
        sessionId,
        tone: 'warn',
        message: `Session ${sessionId} is no longer open.`,
      });
      return;
    }
    const { success, err } = this.deps.sessionManager.ping(session.id);
    void this.panel.webview.postMessage({
      command: 'pingResult',
      sessionId,
      tone: success ? 'ok' : 'warn',
      message: success
        ? `Session ${session.id} is active and responsive.`
        : `Session ${session.id} did not respond — ${err.message || `error ${err.number}`}.`,
    });
  }

  private async sessionCommand(command: string, sessionId: number): Promise<void> {
    if (!DatabasesPanel.SESSION_COMMANDS.has(command)) return;
    const session = this.deps.sessionManager.getSession(sessionId);
    if (!session) return;
    await vscode.commands.executeCommand(command, { activeSession: session });
    await this.postState();
  }

  /**
   * Create a database from the form's answers.
   *
   * The four Quick Picks this replaces asked one question at a time and threw
   * the lot away the moment focus left VS Code (#257). The answers arrive here
   * together instead, so nothing is lost by going to look something up.
   *
   * What follows the create is deliberately the same as the command path: the
   * stone's DataCurator login is added unless one already targets it, so a
   * database made here is not subtly different from one made anywhere else.
   */
  private async createDatabase(msg: {
    version: string;
    extent: string;
    stoneName: string;
    ldiName: string;
    allowNfs: boolean;
  }): Promise<void> {
    // A create message with a field missing is not a user mistake — it is a bug
    // in whatever sent it. Refused outright rather than half-honoured, because
    // this path writes a database directory and a database.yaml describing it.
    for (const [field, value] of Object.entries({
      version: msg.version,
      extent: msg.extent,
      stoneName: msg.stoneName,
      ldiName: msg.ldiName,
    })) {
      if (typeof value !== 'string' || value.length === 0) {
        this.failed('create the database', new Error(`No ${field} was given.`));
        return;
      }
    }

    // The form disables Create while an answer is unusable, but a refresh can
    // land between that check and the click — so the names are checked again
    // here, where the answer is acted on.
    const taken = this.deps.storage.getDatabases().map((d) => d.config);
    if (taken.some((c) => c.stoneName === msg.stoneName)) {
      this.failed(
        'create the database',
        new Error(`A stone called "${msg.stoneName}" already exists.`),
      );
      await this.postState();
      return;
    }
    if (taken.some((c) => c.ldiName === msg.ldiName)) {
      this.failed(
        'create the database',
        new Error(`A NetLDI called "${msg.ldiName}" already exists.`),
      );
      await this.postState();
      return;
    }

    try {
      const db: GemStoneDatabase = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Creating database ${msg.stoneName}...`,
        },
        (progress) =>
          this.deps.databaseManager.createDatabaseDirect(
            msg.version,
            msg.extent,
            msg.stoneName,
            msg.ldiName,
            progress,
            undefined,
            msg.allowNfs,
          ),
      );
      const newLogin = dataCuratorLoginToCreate(this.deps.getLogins(), db.config);
      if (newLogin) await this.deps.saveLogin(newLogin);
      appendSysadmin(`Created database ${db.config.stoneName} in ${db.path}`);
      vscode.window.showInformationMessage(`Database "${path.basename(db.path)}" created.`);
      this.deps.refreshAdminViews();
    } catch (e) {
      this.actionFailed(e);
    }
    await this.postState();
  }

  /**
   * Pick a different folder for databases to live in. Offered beside the NFS
   * warning, because "somewhere else" is the answer to it that does not need
   * the override — and it is saved, so the next database starts there too.
   */
  private async chooseRootPath(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Use This Folder',
      title: 'Where GemStone databases are created',
    });
    if (!picked || !picked.length) return;
    await vscode.workspace
      .getConfiguration('gemstone')
      .update('rootPath', picked[0].fsPath, vscode.ConfigurationTarget.Global);
    appendSysadmin(`Root path set to ${picked[0].fsPath}`);
    this.deps.refreshAdminViews();
    await this.postState();
  }

  /**
   * What the form can offer. Read from disk on every state build rather than
   * cached, because a release installed — or a database created — while the
   * panel is open has to show up in the next redraw.
   */
  private buildCreateOptions(databases: DatabaseRow[]): CreateOptions {
    const versions = this.deps.storage
      .getExtractedVersions()
      .map((version) => ({ version, extents: this.deps.storage.getAvailableExtents(version) }));
    const risk = this.deps.databaseManager.nfsRiskForNextDatabase();
    return {
      versions,
      stoneNames: databases.map((d) => d.stoneName),
      // Every NetLDI Jasper knows of, not only the ones it made: the name has to
      // be free on the machine, and a hand-started NetLDI holds it just as well.
      ldiNames: Array.from(
        new Set([
          ...databases.map((d) => d.ldiName),
          ...this.deps.processManager
            .getProcesses()
            .filter((proc) => proc.type === 'netldi')
            .map((proc) => proc.name),
        ]),
      ).sort(),
      nfsWarning: !!risk,
      rootPath: risk ? risk.rootPath : this.deps.storage.getRootPath(),
    };
  }

  private async openDbSubfolder(dirName: string, folder: string): Promise<void> {
    const db = this.lastDatabases.find((d) => d.dirName === dirName);
    if (!db) return;
    // Whitelisted rather than joined blindly: `folder` arrives from the webview.
    const ALLOWED = ['conf', 'backups', 'backups/extents', 'log'];
    const sub = ALLOWED.includes(folder) ? folder : 'log';
    await vscode.commands.executeCommand(
      'revealFileInOS',
      vscode.Uri.file(path.join(db.path, sub)),
    );
  }

  // ── State ─────────────────────────────────────────────────────────────────

  /**
   * Render twice: first from what is already on disk, then again once the
   * download catalog answers. Only the version list differs between the two, so
   * the second post reuses the first state rather than re-running the OS,
   * process and database scans — and an unreachable catalog costs the panel
   * nothing but its available-versions rows.
   */
  private async postState(): Promise<void> {
    this.panel.webview.postMessage({ command: 'loading' });
    const state = await this.buildState('local');
    this.panel.webview.postMessage({ command: 'state', state });

    const versions = await this.buildVersions('remote');
    this.panel.webview.postMessage({ command: 'state', state: { ...state, versions } });
  }

  private async buildState(versionSource: VersionSource): Promise<PanelState> {
    const versions = await this.buildVersions(versionSource);

    this.deps.processManager.refreshProcesses();
    const procs = this.deps.processManager.getProcesses();
    const logins = this.deps.getLogins();
    const openSessions = this.deps.sessionManager.getSessions();
    const selectedSessionId = this.deps.sessionManager.getSelectedSession()?.id;
    const dbs = this.deps.storage.getDatabases();
    this.lastDatabases = dbs;
    const databases: DatabaseRow[] = dbs.map((db) => {
      const cfg = db.config;
      // gslist and database.yaml spell a version differently, which is what
      // versionsMatch is for — so pairing a process with its database is one rule,
      // not one per place that needs it.
      const belongsTo = (p: GemStoneProcess): boolean =>
        versionsMatch(p.version, cfg.version) &&
        p.name === (p.type === 'stone' ? cfg.stoneName : cfg.ldiName);
      const dbProcs: ProcInfo[] = procs.filter(belongsTo).map((p) => ({
        type: p.type,
        name: p.name,
        pid: p.pid,
        port: p.port,
        status: p.status,
        responding: p.responding,
      }));
      const dbLogins: LoginInfo[] = logins
        .filter((l) => l.stone === cfg.stoneName && versionsMatch(l.version, cfg.version))
        .map((l) => {
          const label = loginLabel(l);
          // Matched by label, the same rule the Logins & Sessions tree uses — so
          // the panel and the sidebar cannot disagree about what is connected.
          return {
            label,
            user: l.gs_user,
            stone: l.stone,
            host: l.gem_host,
            sessions: openSessions
              .filter((sess) => loginLabel(sess.login) === label)
              .map((sess) => ({ id: sess.id, current: sess.id === selectedSessionId })),
          };
        });
      return {
        dirName: db.dirName,
        version: cfg.version,
        stoneName: cfg.stoneName,
        ldiName: cfg.ldiName,
        baseExtent: cfg.baseExtent,
        path: db.path,
        stoneRunning: this.deps.processManager.isStoneRunning(cfg.stoneName, cfg.version),
        netldiRunning: this.deps.processManager.isNetldiRunning(cfg.ldiName, cfg.version),
        processes: dbProcs,
        logins: dbLogins,
        availableExtents: this.deps.storage.getAvailableExtents(cfg.version),
        external: (['stone', 'netldi'] as const).flatMap((type) => {
          const found = this.deps.processManager.getExternalServers(db)[type];
          return found ? [{ type, pid: found.process.pid }] : [];
        }),
        startedAtMs: parseGslistStart(
          procs.find((p) => p.type === 'stone' && belongsTo(p))?.startTime,
        ),
        logFiles: this.listFiles(path.join(db.path, 'log')),
        confFiles: this.listFiles(path.join(db.path, 'conf')),
        backupFiles: this.listBackups(db.path),
        extentBackupFiles: this.listFiles(DatabaseManager.extentBackupDir(db.path)),
      };
    });

    return {
      platform: this.deps.storage.getPlatformKey() ?? process.platform,
      windows: needsWsl(),
      rootPath: this.deps.storage.getRootPath(),
      versions,
      databases,
      logins: this.buildLoginTargets(databases),
      create: this.buildCreateOptions(databases),
    };
  }

  /**
   * The selected session, without touching the GCI. This rides along with every
   * state so the Configuration section can appear the instant a session is
   * selected; the values it shows are fetched separately, on demand.
   */
  private buildLoginTargets(databases: DatabaseRow[]): LoginTarget[] {
    const open = this.deps.sessionManager.getSessions();
    const selected = this.deps.sessionManager.getSelectedSession();
    const selectedLabel = selected ? loginLabel(selected.login) : undefined;

    const targets = this.deps.getLogins().map((l) => {
      const label = loginLabel(l);
      // Only a local login (localhost) pairs to a database this machine made; a
      // remote login that shares the stone name must not inherit the local db's
      // dirName (and its db-scoped actions) or its running state.
      const db =
        l.gem_host === 'localhost'
          ? databases.find((d) => d.stoneName === l.stone && versionsMatch(d.version, l.version))
          : undefined;
      return {
        label,
        user: l.gs_user,
        stone: l.stone,
        version: l.version,
        dirName: db?.dirName,
        // A login can name a stone this machine did not make here — one built by
        // hand, or the stone a container brought up. Whether it is up is the
        // process list's business, not this folder's, so fall back to asking it:
        // otherwise a running stone is offered "Start & log in", which reads as
        // a stone that is down.
        running: db ? db.stoneRunning : this.deps.processManager.isStoneRunning(l.stone, l.version),
        connected: open.some((sess) => loginLabel(sess.login) === label),
        sessionId: open.find((sess) => loginLabel(sess.login) === label)?.id,
        current: label === selectedLabel,
      };
    });
    // What you can act on soonest comes first: the live session, then anything
    // else connected, then logins whose stone is already up.
    return targets.sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        Number(b.connected) - Number(a.connected) ||
        Number(b.running) - Number(a.running),
    );
  }

  private async buildVersions(source: VersionSource): Promise<VersionRow[]> {
    let list: GemStoneVersion[];
    if (source === 'local') {
      list = this.deps.versionManager.getInstalledVersions();
    } else {
      try {
        if (this.catalog === undefined) {
          this.catalogFetch ??= this.deps.versionManager.fetchCatalog();
          this.catalog = await this.catalogFetch;
        }
        list = this.deps.versionManager.versionsFrom(this.catalog);
      } catch (e) {
        // Usually offline — but this catch also covers versionsFrom, which is
        // pure disk work, so a scrape whose regex stopped matching or a malformed
        // install would otherwise shrink the list to what's on disk with nothing
        // said. Log the real reason before falling back, so "my versions
        // disappeared" has something to go on.
        appendSysadmin(
          `Databases & Versions: could not read the version catalog, showing installed versions only — ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        // Fall back to what's installed / downloaded on disk, and drop the failed
        // fetch so a later pass can retry it.
        this.catalogFetch = undefined;
        list = this.deps.versionManager.getInstalledVersions();
      }
    }
    this.lastVersions = list;
    return list.map((v) => ({
      version: v.version,
      fileName: v.fileName,
      size: v.size,
      date: v.date,
      downloaded: v.downloaded,
      extracted: v.extracted,
      local: v.local,
      bundled: v.bundled,
      clientExtracted: v.clientExtracted,
    }));
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const codiconUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.deps.extensionUri,
        'node_modules',
        '@vscode',
        'codicons',
        'dist',
        'codicon.css',
      ),
    );
    const csp = this.panel.webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${csp} 'unsafe-inline'; font-src ${csp}; script-src 'nonce-${nonce}';">
  <title>Databases & Versions</title>
  <!-- Registers the codicon @font-face and .codicon glyph classes at the document
       level; every icon in the panel is a plain <i class="codicon codicon-…">. -->
  <link rel="stylesheet" href="${codiconUri}">
  <style>${CSS}</style>
</head>
<body>
  <main id="root" class="content" aria-busy="false"></main>
  <script nonce="${nonce}">${databasesViewJs}</script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    GemstoneDatabases.init(
      { root: document.getElementById('root') },
      vscode,
    );
    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }
}

// Styles live in the host (convention: styling in the host <style>, behavior in
// the companion .js). Everything is a plain element styled through --vscode-*
// theme variables, so the panel matches VS Code's own chrome in either theme and
// never depends on a component library's shadow DOM to look right.
const CSS = `
:root {
  --gm-ok: var(--vscode-testing-iconPassed, #2ea043);
  --gm-warn: var(--vscode-editorWarning-foreground, #cca700);
  --gm-line: var(--vscode-widget-border, rgba(128,128,128,.22));
}
* { box-sizing: border-box; }
/* Anchor rem to the user's workbench font size, so every size below is expressed
   relative to it and tracks that setting instead of freezing at a fixed pixel
   size. The proportions (and the readability they give) are unchanged at the
   default size; a larger workbench font scales the whole Manager up with it,
   matching how the other Jasper webviews behave. */
html { font-size: var(--vscode-font-size, 13px); }
body {
  margin: 0;
  font-family: var(--vscode-font-family);
  font-size: 1rem;
  color: var(--vscode-foreground, #ccc);
  background: var(--vscode-editor-background, #1e1e1e);
}
.content { padding: 16px 22px 56px; max-width: 1040px; }
.mono { font-family: var(--vscode-editor-font-family, monospace); }
.dim { color: var(--vscode-descriptionForeground, #9d9d9d); }
.codicon { font-size: 1.23rem; line-height: 1; }

/* ── Buttons ──────────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 11px; font: inherit; font-size: 0.92rem; line-height: 18px;
  border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px;
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.18));
  color: var(--vscode-button-secondaryForeground, inherit); cursor: pointer; white-space: nowrap;
}
.btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.28)); }
.btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn-primary:hover { background: var(--vscode-button-hoverBackground); }
.btn .codicon { font-size: 1.08rem; }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border: none; border-radius: 4px;
  background: transparent; color: var(--vscode-icon-foreground, inherit); cursor: pointer;
}
.icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2)); }
.btn:focus-visible, .icon-btn:focus-visible, .login-main:focus-visible,
.file-row:focus-visible, .extent-select:focus-visible, summary:focus-visible {
  outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
}

/* ── Badges ───────────────────────────────────────────────────────────────── */
.badge {
  display: inline-flex; align-items: center; padding: 0 6px; height: 16px;
  font-size: 0.85rem; border-radius: 8px; white-space: nowrap;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}
.badge-state { background: transparent; padding: 0; height: auto; font-weight: 600; letter-spacing: .02em; }
.badge-state.state-installed { color: var(--gm-ok); }
.badge-state.state-local { color: var(--vscode-charts-blue, #4daafc); }
.badge-state.state-downloaded { color: var(--gm-warn); }
.badge-state.state-available { color: var(--vscode-descriptionForeground, #9d9d9d); }

/* ── Sections (native disclosure) ─────────────────────────────────────────── */
.section { margin: 0 0 18px; border: 1px solid var(--gm-line); border-radius: 6px; overflow: hidden; }
.section > .section-head { list-style: none; cursor: pointer; user-select: none;
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
  gap: 8px; padding: 10px 12px;
  background: var(--vscode-sideBarSectionHeader-background, transparent); }
.section-head-main { display: flex; align-items: center; gap: 8px; min-width: 0; }
.section > .section-head::-webkit-details-marker { display: none; }
.section > .section-head:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.08)); }
.section-title { font-size: 0.92rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
.section-desc { font-size: 0.92rem; color: var(--vscode-descriptionForeground, #9d9d9d);
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.section-head-actions { margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 8px; }
/* When the header wraps, the toolbar lands on its own line — still at the right,
   because the auto margin above still applies to it as a flex item there. */
.section-count { font-size: 0.85rem; color: var(--vscode-descriptionForeground, #9d9d9d); font-variant-numeric: tabular-nums; }
.section-body { padding: 14px 16px 18px; }
.section-twist { flex: none; font-size: 1.23rem; color: var(--vscode-icon-foreground, #9d9d9d);
  transition: transform .12s ease; }
details[open] > .section-head > .section-twist,
details[open] > .db-head > .section-twist,
details[open] > .db-group-head > .section-twist,
details[open] > .config-group-head > .section-twist,
details[open] > .file-root-head > .section-twist { transform: rotate(90deg); }

.col-lead { margin-bottom: 4px; }
.col-rest { display: flex; flex-direction: column; }

/* ── State marks — tinted codicons ────────────────────────────────────────── */
.mark { flex: none; font-size: 1.08rem; }
.mark.ok { color: var(--gm-ok); }
.mark.warn { color: var(--gm-warn); }
.mark.off { color: var(--vscode-descriptionForeground, #777); opacity: .7; }

/* ── Facts (label / value pairs) ──────────────────────────────────────────── */
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 7px 18px; margin: 0; align-items: baseline; }
.facts dt { color: var(--vscode-descriptionForeground, #9d9d9d); font-size: 0.92rem; }
.facts dd { margin: 0; display: flex; align-items: center; gap: 8px; min-width: 0; }
.facts-action { justify-content: space-between; gap: 12px; }
.facts-action .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* A warning that has to explain itself before it earns its button. */
.os-remedy {
  display: flex; align-items: flex-start; gap: 20px; flex-wrap: wrap;
  margin: 0 0 14px; padding: 12px 14px; border-radius: 4px;
  background: color-mix(in srgb, var(--gm-warn) 10%, transparent);
}
.os-remedy-body { flex: 1 1 320px; min-width: 0; }
.os-remedy-head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.os-remedy-head .codicon { color: var(--gm-warn); }
.os-remedy-copy { margin: 6px 0 0; font-size: 0.96rem; line-height: 1.55; max-width: 68ch; }

/* ── Versions table ───────────────────────────────────────────────────────── */
.versions-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
.versions-table th {
  text-align: left; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: .04em;
  color: var(--vscode-descriptionForeground, #9d9d9d); padding: 0 10px 6px; border-bottom: 1px solid var(--gm-line);
}
.versions-table td { padding: 8px 10px; border-bottom: 1px solid color-mix(in srgb, var(--gm-line) 55%, transparent); vertical-align: middle; }
.versions-table tbody tr:last-child td { border-bottom: none; }
.versions-table tbody tr:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.08)); }
.v-name { font-weight: 600; margin-right: 8px; }
.v-num { text-align: right; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground, #9d9d9d); }
th.v-num { text-align: right; }
.v-cell { text-align: right; width: 1%; white-space: nowrap; }
.v-cell .btn, .v-cell .icon-btn { margin-left: auto; }

/* ── Connect rows ─────────────────────────────────────────────────────────── */
.login-rows { display: flex; flex-direction: column; gap: 1px; }
.login-row { display: flex; align-items: center; gap: 10px; border-radius: 4px; padding-right: 6px; }
.login-main {
  flex: 1 1 auto; min-width: 0; display: grid;
  grid-template-columns: 16px minmax(90px, max-content) 1fr; align-items: center; gap: 10px;
  font: inherit; font-size: 0.96rem; text-align: left;
  padding: 7px 8px; border: none; background: transparent; color: inherit; cursor: pointer;
}
.login-stone { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.login-current { flex: none; width: 16px; display: inline-flex; justify-content: center; }
.login-current .codicon { font-size: 1.08rem; color: var(--gm-ok); }
.login-user { font-weight: 600; }
.login-stone { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85rem; opacity: .75; }
.login-status { flex: none; display: inline-flex; align-items: center; gap: 8px; }
.login-acts { flex: none; display: inline-flex; align-items: center; gap: 1px; opacity: .45; transition: opacity .12s ease; }
.login-row:hover .login-acts, .login-acts:focus-within { opacity: 1; }
.login-act { width: 22px; height: 22px; }
.login-act .codicon { font-size: 1.08rem; }
.login-row-live { background: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,.10)); }
.login-row-current { background: var(--vscode-list-activeSelectionBackground, rgba(14,99,156,.35)); color: var(--vscode-list-activeSelectionForeground, inherit); }
.login-row-idle .login-main { opacity: .7; }
.connect-empty { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 0.96rem; color: var(--vscode-descriptionForeground, #9d9d9d); }

/* ── Databases (native disclosure per row) ────────────────────────────────── */
.db-item { border-radius: 4px; }
.db-item + .db-item { margin-top: 1px; }
.db-item-current { background: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,.10)); }
.db-head { list-style: none; cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 4px; min-width: 0; }
.db-head::-webkit-details-marker { display: none; }
.db-head:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.08)); }
.db-name { font-weight: 600; flex: none; }
.db-dir { flex: 1 1 auto; min-width: 0; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-version { flex: none; font-size: 0.88rem; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground, #9d9d9d); }
.db-state { flex: none; font-size: 0.85rem; color: var(--vscode-descriptionForeground, #9d9d9d); white-space: nowrap; }
.power { flex: none; }
.power-start .codicon { color: var(--gm-ok); }
.power-stop .codicon { color: var(--vscode-errorForeground, #f14c4c); }
.db-body { padding: 6px 8px 10px 24px; }
.db-toolbar { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; flex-wrap: wrap; }
/* A connected login is the row you are actually working in, so it carries a
   little more weight than the ones you could open. */
/* A session sits under the login it was opened from, indented by the width of
   the arrow the current one carries — so the column of names lines up whether or
   not anything is marked. */
.session-mark { display: inline-flex; width: 16px; flex: none; justify-content: center; }
.session-current-mark { color: var(--vscode-testing-iconPassed, #487e02); }
.db-session .session-name { font-size: 0.95em; }
.db-session-current .session-name { font-weight: 700; }
.session-id { margin-left: 8px; font-size: 0.85em; }
/* The Ping result sits to the left of the row's buttons — a compact banner that
   clears itself after a success and lingers (with Dismiss) after a warning.
   Same shape as the Session Configuration panel's notices, which is where Ping
   used to live. */
.ping-result {
  display: inline-flex; align-items: center; gap: 6px; max-width: 520px;
  padding: 2px 8px; border-radius: 4px; font-size: 0.9rem;
}
.ping-result.ok { background: color-mix(in srgb, var(--gm-ok) 14%, transparent); }
.ping-result.warn { background: color-mix(in srgb, var(--gm-warn) 14%, transparent); }
.ping-result.ok .ico { color: var(--gm-ok); }
.ping-result.warn .ico { color: var(--gm-warn); }
.notice-msg { overflow: hidden; text-overflow: ellipsis; }
.notice-actions { display: inline-flex; gap: 4px; }
.notice-btn { font: inherit; font-size: 0.85rem; padding: 0 6px; border: none; border-radius: 3px;
  background: transparent; color: inherit; cursor: pointer; text-decoration: underline; }
.notice-btn:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.14)); }
/* Sessions sit under the login they were opened from. The rule down the left is
   what says "these belong to that", without a second level of disclosure. */
.session-block { margin: 0 0 4px 26px; padding-left: 10px;
  border-left: 1px solid var(--gm-line); }
.session-caption { font-size: 0.75rem; text-transform: uppercase; letter-spacing: .05em;
  color: var(--vscode-descriptionForeground, #9d9d9d); padding: 2px 0 1px; }
.file-name { overflow: hidden; text-overflow: ellipsis; }
/* The time is the second thing read, so it sits at the end of the row where the
   eye can run down a column of them. */
.file-when { margin-left: auto; padding-left: 12px; flex: none; font-variant-numeric: tabular-nums;
  color: var(--vscode-descriptionForeground, #9d9d9d); }
.db-toolbar-tools { display: inline-flex; align-items: center; gap: 2px; }
.extent { display: inline-flex; align-items: center; gap: 6px; }
.extent-label { font-size: 0.85rem; color: var(--vscode-descriptionForeground, #9d9d9d); text-transform: uppercase; letter-spacing: .04em; }
.extent-select {
  font: inherit; font-size: 0.92rem; padding: 2px 6px; border-radius: 4px;
  border: 1px solid var(--vscode-dropdown-border, var(--gm-line));
  background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); cursor: pointer;
}
/* A running stone cannot have its extent replaced, so the chooser reads as
   unavailable rather than accepting a change the command will refuse. */
.extent-select:disabled { opacity: .5; cursor: default; }
.db-cols { display: flex; flex-direction: column; gap: 6px; }

/* Groups inside a database body (Logins / Processes / Files). */
.db-group { margin: 0 0 6px; }
.db-group-head { list-style: none; cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 7px; padding: 4px 2px; border-radius: 4px; }
.db-group-head::-webkit-details-marker { display: none; }
.db-group-head:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.06)); }
.db-group-title { font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground, #9d9d9d); }
.db-group .section-twist { font-size: 1.08rem; }
.group-desc { font-size: 0.85rem; color: var(--vscode-descriptionForeground, #9d9d9d); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-group-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; }
.db-group-body { padding: 2px 0 4px 20px; }
.db-files { grid-column: 1 / -1; }
.db-files .db-group-body { padding-left: 20px; }
.db-footer { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0; }
.db-empty { font-size: 0.92rem; color: var(--vscode-descriptionForeground, #9d9d9d); padding: 4px 2px; }

/* Rows shared by Logins and Processes. */
.db-line { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; padding: 5px 6px; margin: 0 -6px; border-radius: 4px; min-width: 0; }
.db-line:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.06)); }
.db-line.row-warn { background: color-mix(in srgb, var(--gm-warn) 8%, transparent); }
.db-line-name { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.db-login-user, .proc-name { font-weight: 600; }
.db-line-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; flex: none; }
.db-line-meta { font-size: 0.85rem; color: var(--vscode-descriptionForeground, #9d9d9d); }
.svc-state { font-size: 0.85rem; color: var(--vscode-descriptionForeground, #9d9d9d); }

/* ── Files (tree: Logs / Config / Backups as roots) ───────────────────────── */
.file-tree { display: flex; flex-direction: column; gap: 1px; }
.file-root-head { list-style: none; cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 7px; padding: 4px 4px; border-radius: 4px; }
.file-root-head::-webkit-details-marker { display: none; }
.file-root-head:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.06)); }
.file-root .section-twist { font-size: 1.08rem; }
.file-root-icon { display: inline-flex; color: var(--vscode-icon-foreground, #9d9d9d); }
.file-root-name { font-size: 0.92rem; font-weight: 600; }
.file-root-count { font-size: 0.85rem; color: var(--vscode-descriptionForeground, #9d9d9d); font-variant-numeric: tabular-nums; }
.file-root-actions { margin-left: auto; display: inline-flex; align-items: center; opacity: 0; transition: opacity .12s ease; }
.file-root-head:hover .file-root-actions, .file-root-actions:focus-within { opacity: 1; }
.file-list { list-style: none; margin: 0; padding: 0 0 3px 27px; }
/* ── OS prerequisite checklist ───────────────────────────────────────────── */
.os-checks { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.os-check { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
.os-check-label { min-width: 150px; }
.os-check-detail { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.os-check-action { display: flex; align-items: center; gap: 6px; }
.os-check-note { font-size: 0.85rem; color: var(--vscode-descriptionForeground, #9d9d9d); }
/* A file row can carry its own action (restoring a backup), which sits beside
   the name rather than inside it — a button cannot nest in a button. */
.file-line { display: flex; align-items: center; gap: 2px; }
.file-line .file-row { flex: 1; min-width: 0; }
.file-row { display: flex; align-items: baseline; width: 100%; text-align: left; font: inherit; font-size: 0.92rem;
  padding: 3px 6px; border: none; border-radius: 4px; background: transparent; color: inherit; cursor: pointer;
  overflow: hidden; white-space: nowrap; }
.file-row:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.14)); }
.file-empty { list-style: none; font-size: 0.85rem; color: var(--vscode-descriptionForeground, #9d9d9d); padding: 2px 6px 4px 27px; }

/* ── Getting-set-up header ────────────────────────────────────────────────── */
.gm-head {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  margin: 0 0 16px; padding: 10px 14px; border-radius: 6px;
  border: 1px solid var(--gm-line);
  background: var(--vscode-sideBarSectionHeader-background, transparent);
}
.gm-head-text { display: flex; align-items: baseline; gap: 10px; flex: 1 1 240px; min-width: 0; font-size: 0.96rem; }
.gm-head-lead { font-weight: 600; }
.gm-head-acts { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }

/* ── Tour: a spotlight on one section, and a callout beside it ─────────────── */
/* Deliberately not a blocking modal — pointer events pass through the dim, so
   the control being pointed at can be used while the callout still explains it.
   Only the callout itself takes clicks. */
.gm-tour { position: fixed; inset: 0; z-index: 50; pointer-events: none; }
.gm-spot {
  position: fixed; border-radius: 6px; pointer-events: none;
  border: 2px solid var(--vscode-focusBorder, #007fd4);
  box-shadow: 0 0 0 9999px color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 68%, transparent);
  transition: top .16s ease, left .16s ease, width .16s ease, height .16s ease;
}
.gm-call {
  position: fixed; pointer-events: auto; width: min(380px, calc(100vw - 24px));
  padding: 14px 16px 12px; border-radius: 6px;
  border: 1px solid var(--vscode-widget-border, var(--gm-line));
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
  box-shadow: 0 6px 20px rgba(0, 0, 0, .34);
}
.gm-call:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
/* The arrow flips to the underside when the callout sits above its target. */
.gm-call-arrow {
  position: absolute; top: -6px; left: 22px; width: 10px; height: 10px;
  background: inherit; border-left: 1px solid var(--vscode-widget-border, var(--gm-line));
  border-top: 1px solid var(--vscode-widget-border, var(--gm-line));
  transform: rotate(45deg);
}
.gm-call-above .gm-call-arrow { top: auto; bottom: -6px; transform: rotate(225deg); }
.gm-call-meta { display: flex; align-items: center; gap: 10px; font-size: 0.85rem; }
.gm-call-step { color: var(--vscode-descriptionForeground, #9d9d9d); font-variant-numeric: tabular-nums; }
.gm-call-mark { font-weight: 600; letter-spacing: .02em; }
.gm-call-mark.is-done { color: var(--gm-ok); }
.gm-call-mark.is-todo { color: var(--gm-warn); }
.gm-call-title { margin: 5px 0 0; font-size: 1.08rem; font-weight: 600; }
.gm-call-body { margin: 6px 0 0; font-size: 0.96rem; line-height: 1.55; }
/* What a user actually does here — including "nothing", which is the answer on a
   machine that is already configured and is worth saying rather than implying. */
.gm-call-do {
  margin: 9px 0 0; padding: 8px 10px; border-radius: 4px; font-size: 0.96rem; line-height: 1.5;
  background: color-mix(in srgb, var(--vscode-focusBorder, #007fd4) 12%, transparent);
}
.gm-call-hint { margin: 9px 0 0; font-size: 0.88rem; color: var(--vscode-descriptionForeground, #9d9d9d); }
.gm-call-list { margin: 7px 0 0; padding-left: 18px; font-size: 0.96rem; line-height: 1.5; }
.gm-call-list li { margin: 0 0 3px; }
.gm-call-list li:last-child { margin-bottom: 0; }
.gm-call-note { margin: 8px 0 0; font-size: 0.92rem; line-height: 1.5; color: var(--vscode-descriptionForeground, #9d9d9d); }
.gm-call-acts { display: flex; align-items: center; gap: 8px; margin: 12px 0 0; flex-wrap: wrap; }
.gm-call-acts [data-tour="end"] { margin-left: auto; }
/* The action takes its own full-width row. Its label says what it will do, which
   runs longer than a nav button — four on one line overflowed the box, and the
   box has a fixed width, so the label wraps rather than widening it. */
.gm-call-do-btn {
  display: flex; width: 100%; justify-content: center; margin: 14px 0 0;
  padding: 6px 12px; white-space: normal; text-align: center;
}
.gm-call-do-btn[hidden] { display: none; }
/* Said out loud, because an absent button is indistinguishable from a missing one. */
.gm-call-settled {
  margin: 9px 0 0; font-size: 0.96rem; font-weight: 600; color: var(--gm-ok);
}
.gm-call-settled[hidden] { display: none; }
/* What went wrong, where there is room to read it: a notification truncates a
   startstone error long before it has finished explaining itself. */
.gm-call-error {
  margin: 9px 0 0; padding: 8px 10px; border-radius: 4px;
  font-family: var(--vscode-editor-font-family, monospace); font-size: 0.88rem; line-height: 1.5;
  color: var(--vscode-inputValidation-errorForeground, inherit);
  background: var(--vscode-inputValidation-errorBackground, rgba(241, 76, 76, .12));
  border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground, #f14c4c));
  max-height: 8.5em; overflow-y: auto; white-space: pre-wrap; word-break: break-word;
}
.gm-call-error[hidden] { display: none; }
.gm-call-acts .btn:disabled { opacity: .45; cursor: default; }

/* ── Empty / note states ──────────────────────────────────────────────────── */
/* ── The New Database form ─────────────────────────────────────────────────
   One column, generous line-height: the form is read top to bottom and every
   field carries a line of explanation, which the four Quick Picks had nowhere
   to put. Capped in width because a full-screen editor tab would otherwise
   stretch a four-field form across a metre of glass. */
.create-form { max-width: 44rem; padding: 4px 2px 8px; }
.cf-field { margin-bottom: 18px; }
.cf-label { display: block; font-weight: 600; margin-bottom: 5px; }
.cf-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  font-family: inherit;
  font-size: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--gm-line));
  border-radius: 3px;
}
.cf-input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.cf-bad .cf-input { border-color: var(--vscode-inputValidation-errorBorder, #be1100); }
.cf-help { margin-top: 5px; font-size: 0.9em; color: var(--vscode-descriptionForeground, #9d9d9d); }
.cf-problem { color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground, #f48771)); }
.cf-warn {
  margin: 0 0 18px;
  padding: 10px 12px;
  border-radius: 4px;
  border: 1px solid var(--vscode-inputValidation-warningBorder, #b89500);
  background: var(--vscode-inputValidation-warningBackground, rgba(184,149,0,.1));
}
.cf-check { display: block; margin: 8px 0 4px; }
.cf-check input { margin-right: 6px; vertical-align: middle; }
.cf-actions { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
.cf-note { margin-top: 10px; font-size: 0.9em; }
.btn[disabled] { opacity: 0.5; cursor: default; }

.empty { text-align: center; color: var(--vscode-descriptionForeground, #9d9d9d); padding: 22px 12px; }
.empty-acts { display: flex; gap: 8px; justify-content: center; margin-top: 14px; }
.empty div { margin-top: 10px; }
.note { display: flex; align-items: flex-start; gap: 8px; font-size: 0.92rem; color: var(--vscode-descriptionForeground, #9d9d9d); }
.note .codicon { color: var(--gm-warn); }
.skeleton { color: var(--vscode-descriptionForeground, #9d9d9d); padding: 30px 12px; text-align: center; }

/* ── Configuration section (issue #232) ───────────────────────────────────── */
.badge-runtime { background: color-mix(in srgb, var(--vscode-charts-blue, #4daafc) 26%, transparent); color: var(--vscode-foreground); }
.badge-readonly { background: transparent; color: var(--vscode-descriptionForeground, #9d9d9d); border: 1px solid var(--gm-line); }
.config-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
.config-filter-wrap { position: relative; display: flex; flex: 1 1 220px; min-width: 160px; align-items: center; }
.config-filter {
  flex: 1 1 auto; min-width: 0; padding: 3px 26px 3px 8px;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--gm-line)); border-radius: 4px;
}
.config-filter:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.config-filter-clear {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  display: inline-flex; align-items: center; justify-content: center;
  background: none; border: 0; padding: 2px; border-radius: 3px; line-height: 1;
  color: var(--vscode-descriptionForeground, #9d9d9d); cursor: pointer; opacity: .7;
}
.config-filter-clear:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.15)); }
.config-filter-clear:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; opacity: 1; }
.config-filter-clear[hidden] { display: none; }
.config-legend { font-size: 0.85rem; color: var(--vscode-descriptionForeground, #9d9d9d); display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.config-loading { color: var(--vscode-descriptionForeground, #9d9d9d); padding: 16px 4px; }
.config-error {
  margin: 0 0 10px; padding: 6px 10px; font-size: 0.92rem; border-radius: 4px;
  background: color-mix(in srgb, var(--gm-warn) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--gm-warn) 40%, transparent);
}
/* The result of a set: a plain confirmation, or a warning that the stone
   accepted the value but did not actually apply it. */
.config-notice { margin: 0 0 10px; padding: 6px 10px; font-size: 0.92rem; border-radius: 4px; }
.config-notice.ok {
  background: color-mix(in srgb, var(--gm-ok) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--gm-ok) 40%, transparent);
}
.config-notice.warn {
  background: color-mix(in srgb, var(--gm-warn) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--gm-warn) 40%, transparent);
}
.config-group { margin: 0 0 16px; }
.config-group-head {
  list-style: none; cursor: pointer; user-select: none;
  font-weight: 600; margin: 0 0 6px; padding: 3px 4px; border-radius: 4px;
  display: flex; align-items: center; gap: 8px;
}
.config-group-head::-webkit-details-marker { display: none; }
.config-group-head:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.08)); }
.config-group-head:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.config-group .section-twist { font-size: 1.08rem; }
.config-note { font-size: 0.85rem; font-weight: 400; color: var(--vscode-descriptionForeground, #9d9d9d); }
.config-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.config-table td { padding: 3px 8px; border-bottom: 1px solid var(--gm-line); vertical-align: top; }
.config-key { white-space: nowrap; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92rem; }
.config-info { font: inherit; font-size: 0.92rem; line-height: 1; background: none; border: 0; padding: 0; color: var(--vscode-descriptionForeground, #9d9d9d); cursor: pointer; margin-left: 5px; vertical-align: -1px; opacity: .6; }
.config-item:hover .config-info, .config-info:hover { opacity: 1; }
.config-info:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; opacity: 1; }
/* The ⓘ tooltip pinned on screen after a click, so a long description can be
   read without holding the pointer still. Positioned in the viewport by script. */
.config-info-pop {
  position: fixed; z-index: 40; max-width: 340px; white-space: pre-line;
  padding: 8px 10px; font-size: 0.92rem; line-height: 1.4;
  background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background));
  color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
  border: 1px solid var(--vscode-editorHoverWidget-border, var(--gm-line));
  border-radius: 4px; box-shadow: 0 2px 8px rgba(0, 0, 0, .35);
}
.config-val { width: 100%; }
.config-value { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92rem; word-break: break-all; }
/* An editable value is a subtle button carrying a persistent pencil, so which
   rows can be changed is visible without hovering each one. */
.config-value-btn {
  display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
  padding: 1px 6px; margin: -1px -6px; text-align: left; cursor: pointer;
  background: transparent; border: 1px solid transparent; border-radius: 4px;
  color: inherit; font: inherit;
}
.config-value-btn:hover { background: color-mix(in srgb, var(--vscode-foreground) 7%, transparent); border-color: var(--gm-line); }
.config-value-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 0; }
.config-pencil { flex: none; color: var(--vscode-descriptionForeground, #9d9d9d); opacity: .55; vertical-align: -1px; }
.config-value-btn:hover .config-pencil, .config-value-btn:focus-visible .config-pencil { opacity: 1; color: var(--vscode-charts-blue, #4daafc); }
.config-tag { text-align: right; white-space: nowrap; }
.config-edit { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.config-input {
  padding: 2px 6px; min-width: 120px;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--gm-line)); border-radius: 4px;
  font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92rem;
}
.config-input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
`;
