// GemStone Manager — a single, consolidated editor-tab webview that manages the
// GemStone environment: OS prerequisites, installed/available versions, and
// databases. It is a *read/coordinate* surface: it renders live state pulled
// directly from the sysadmin managers, and every mutating action is delegated
// to the existing `gemstone.*` commands (so it inherits their confirmation
// modals, progress notifications, and sidebar-tree refreshes for free).
//
// The one exception is Configuration (issue #232): the stone and gem
// configuration reports are read from the *selected session* over its GCI, and
// a runtime-settable value is written back through that same session — there is
// no `gemstone.*` command for either, so this module talks to the session
// directly. That read is on demand (a `loadConfiguration` message), never part
// of the state rebuild, so an admin action never pays for a GCI round-trip.
//
// Follows the webview conventions established in enhancedInspector.ts /
// debuggerPanel.ts: createWebviewPanel with a strict CSP, all styles inline in
// the host HTML, all behavior in a companion gemstoneManagerView.js read at module
// load and injected as a nonce'd <script>. It takes a dependency bag rather
// than importing extension.ts, to avoid a circular import (same pattern as
// stonEditor.ts).

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

import { SysadminStorage } from './sysadminStorage';
import { VersionManager, CatalogEntry } from './versionManager';
import { ProcessManager, versionsMatch } from './processManager';
import {
  getSharedMemory,
  getSharedMemoryInUse,
  sharedMemoryStatus,
  getRemoveIpcConfigured,
  wslServicesHasGs64ldi,
  windowsServicesHasGs64ldi,
} from './sharedMemoryTreeProvider';
import {
  needsWsl,
  getWslInfo,
  getWslInfoAsync,
  getWslNetworkInfoCached,
  invalidateWslCache,
  invalidateWslNetworkCache,
} from './wslBridge';
import { wslListFilesSync } from './wslFs';
import { GemStoneVersion, GemStoneDatabase, GemStoneProcess } from './sysadminTypes';
import { GemStoneLogin, loginLabel } from './loginTypes';
import { SessionManager } from './sessionManager';
import { readWebviewScript } from './webviewAssets';
import { appendSysadmin } from './sysadminChannel';
import { defaultQueryExecutorUsing } from './browserQueries';
import {
  stoneConfiguration,
  gemConfiguration,
  setConfiguration as setSessionConfiguration,
  sessionIsSystemUser,
  configValuesMatch,
  isEditable,
  ConfigScope,
  ConfigValueType,
  ConfigEntry,
} from './queries/configurationReport';
import { ActiveSession } from './sessionManager';
import { parseConfigDescriptions, descriptionFor } from './gemstoneConfigDescriptions';

const gemstoneManagerJs = readWebviewScript('gemstoneManagerView.js');

/**
 * The managers this panel reads from. Environment actions are dispatched
 * through the existing `gemstone.*` commands, so no action methods are needed
 * for them here — the exception is Configuration, which reads and writes the
 * selected session's config directly through `sessionManager` (see the module
 * header).
 */
export interface GemstoneManagerDeps {
  storage: SysadminStorage;
  versionManager: VersionManager;
  processManager: ProcessManager;
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

// ── Wire types shared with gemstoneManagerView.js ───────────────────────────

interface OsStatus {
  /** Whether this platform surfaces OS prerequisites at all. */
  supported: boolean;
  platformLabel: string;
  sharedMemoryConfigured: boolean;
  /** e.g. "2.0" or "≥ 1" or "0" — mirrors the Configure OS tree label. */
  gbLabel: string;
  shmmaxBytes?: number;
  shmallBytes?: number;
  /** True when shared memory could not be read (e.g. WSL unavailable). */
  unknown: boolean;
  /**
   * One row per prerequisite this machine actually has: shared memory
   * everywhere, RemoveIPC on Linux, the WSL set on Windows. A row that is not
   * `ok` carries the remedy for that one problem, which is how the Configure OS
   * tree read — a status and, under it, the thing that fixes it.
   */
  checks: OsCheck[];
}

interface OsCheck {
  key: string;
  label: string;
  state: 'ok' | 'warn' | 'unknown';
  /** What the machine currently says: '2.0 GB', 'mirrored', 'gs64ldi 50377/tcp'. */
  detail: string;
  remedy?: { command: string; label: string; note?: string };
}

/**
 * Bytes as a short human reading — the host builds a couple of detail strings.
 * `gemstoneManagerView.js` carries the same function for the rows it renders
 * itself: a webview script is not part of the extension bundle and cannot import
 * from it, so the two are kept deliberately identical rather than merged.
 */
function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Math.max(0, n);
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

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

interface LoginInfo {
  label: string;
  user: string;
  stone: string;
  host: string;
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
  /** When the stone started, epoch ms — for "running 12 minutes". */
  startedAtMs?: number;
  /** The database's own files, mirroring what the sidebar tree lists. */
  logFiles: FileEntry[];
  confFiles: FileEntry[];
  backupFiles: FileEntry[];
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
}

/**
 * The selected session, as the Configuration section needs it: enough to label
 * the panel and know whether there is anything to show, carried in every state
 * so the section can appear the moment a session is selected — without the
 * state rebuild ever touching the GCI (the config values themselves load on
 * demand).
 */
interface SessionInfo {
  connected: boolean;
  sessionId?: number;
  label?: string;
  user?: string;
  stone?: string;
  version?: string;
}

/** One configuration parameter as the webview draws it. */
interface ConfigParam {
  key: string;
  value: string;
  type: ConfigValueType;
  /** CamelCase runtime key (as opposed to a read-only config-file parameter). */
  settable: boolean;
  /**
   * Whether this session may actually change it: a runtime key of an editable
   * kind, and — for a stone parameter — only when the session is SystemUser.
   * A settable-but-not-editable row is a runtime key the current user lacks the
   * authority to change; the panel shows why rather than offering a doomed edit.
   */
  editable: boolean;
  /** Purpose text from system.conf, shown as a tooltip when the file named it. */
  description?: string;
}

/** The configuration of the selected session, sent in reply to loadConfiguration. */
interface ConfigurationPayload {
  sessionId: number;
  label: string;
  version: string;
  /** SystemUser may change stone parameters; other users may not. */
  isSystemUser: boolean;
  /**
   * Whether a system.conf was found and parsed for this version. When false, no
   * parameter has a description and the panel says why (the product tree is not
   * on this machine — e.g. a remote stone); when true, a parameter with no
   * description simply had no matching entry.
   */
  descriptionsAvailable: boolean;
  stoneParams: ConfigParam[];
  gemParams: ConfigParam[];
}

interface ManagerState {
  platform: string;
  /** Windows with WSL — where the client install and Copy Host actions mean anything. */
  windows: boolean;
  rootPath: string;
  os: OsStatus;
  versions: VersionRow[];
  databases: DatabaseRow[];
  logins: LoginTarget[];
  session: SessionInfo;
}

type Inbound =
  | { command: 'ready' }
  | { command: 'refresh' }
  | { command: 'downloadVersion'; version: string }
  | { command: 'installVersion'; version: string }
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
  | { command: 'createDatabase' }
  | { command: 'createDatabaseDefaults' }
  | { command: 'createDefaultLogin'; dirName: string }
  | { command: 'deleteDatabase'; dirName: string }
  | { command: 'startDatabase'; dirName: string }
  | { command: 'stopDatabase'; dirName: string }
  | { command: 'startStone'; dirName: string }
  | { command: 'stopStone'; dirName: string }
  | { command: 'startNetldi'; dirName: string }
  | { command: 'stopNetldi'; dirName: string }
  | { command: 'replaceExtent'; dirName: string }
  | { command: 'backupDatabase'; dirName: string }
  | { command: 'installServerSupport'; dirName: string }
  | { command: 'restoreBackup'; dirName: string; path: string }
  | { command: 'openDbTerminal'; dirName: string }
  | { command: 'openDbInFinder'; dirName: string }
  | { command: 'openDbSubfolder'; dirName: string; folder: string }
  | { command: 'openDbFile'; dirName: string; path: string }
  | { command: 'revealDbFile'; dirName: string; path: string }
  | { command: 'createLoginFromDb'; dirName: string }
  | { command: 'connectLogin'; login: string }
  | { command: 'editLogin'; login: string }
  | { command: 'deleteLogin'; login: string }
  | { command: 'duplicateLogin'; login: string }
  | { command: 'createLogin' }
  | { command: 'startAndConnect'; login: string }
  | { command: 'selectSession'; sessionId: number }
  | { command: 'sessionAction'; sessionId: number; action: string }
  | { command: 'openSettings' }
  | { command: 'loadConfiguration' }
  | {
      command: 'setConfiguration';
      scope: ConfigScope;
      key: string;
      valueType: ConfigValueType;
      value: string;
    }
  | { command: 'copyNetldiHost'; dirName: string; name: string }
  | { command: 'deleteStaleLock'; dirName: string; name: string }
  | { command: 'openWalkthrough' }
  | { command: 'osRemedy'; action: string }
  | { command: 'quickSetup' };

/**
 * The prerequisite remedies the panel may dispatch — every one the Configure OS
 * tree offered. As with session actions, the webview sends a command *name*, so
 * it is matched against this list rather than executed on trust.
 */
export const OS_REMEDIES: ReadonlySet<string> = new Set([
  'gemstone.runSetSharedMemory',
  'gemstone.runSetSharedMemoryLinux',
  'gemstone.runSetRemoveIPC',
  'gemstone.upgradeWsl2',
  'gemstone.updateWslCore',
  'gemstone.enableMirroredNetworking',
  'gemstone.writeWslHostsEntry',
  'gemstone.writeServicesWindows',
  'gemstone.writeServicesWsl',
]);

/**
 * The session actions the panel may dispatch — exactly the inline set the sidebar
 * offers a live session. The webview sends a command *name*, so it is matched
 * against this list rather than executed on trust.
 */
export const SESSION_ACTIONS: ReadonlySet<string> = new Set([
  'gemstone.openBrowser',
  'gemstone.sessionOpenWorkspace',
  'gemstone.sessionCommit',
  'gemstone.sessionAbort',
  'gemstone.sessionPing',
  'gemstone.sessionLogout',
  'gemstone.exportClasses',
  'gemstone.fullLogicalBackup',
  'gemstone.fullLogicalRestore',
]);

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

export class GemstoneManagerPanel {
  static readonly viewType = 'gemstoneManager';
  private static current: GemstoneManagerPanel | undefined;

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
  private coalesceTimer: ReturnType<typeof setTimeout> | undefined;
  private rebuilding = false;
  private rebuildAgain = false;
  private staleWhileHidden = false;
  // Parsed system.conf descriptions, one map per version — the file does not
  // change under a running stone, so it is read and parsed once per version and
  // kept (an unreadable file caches as an empty map, so a remote stone whose
  // product tree is not on this machine is not re-probed on every load).
  private configDescCache = new Map<string, Map<string, string>>();

  /**
   * Publishes whether a panel is open, so the Dictionaries title bar can offer
   * Open or Close rather than one button that means both.
   */
  private static setOpenContext(open: boolean): void {
    void vscode.commands.executeCommand('setContext', 'gemstone.managerOpen', open);
  }

  /** Close the manager if one is open; a no-op otherwise. */
  static close(): void {
    GemstoneManagerPanel.current?.dispose();
  }

  /**
   * Open the manager, revealing the existing panel if one is already open.
   *
   * `preserveFocus` is for the times the panel opens because the environment
   * said so rather than because the user asked — at startup with nothing
   * connected, or when the last session goes away. Taking focus there would pull
   * the user out of whatever editor they were in.
   */
  static show(deps: GemstoneManagerDeps, preserveFocus = false): void {
    if (GemstoneManagerPanel.current) {
      GemstoneManagerPanel.current.panel.reveal(undefined, preserveFocus);
      void GemstoneManagerPanel.current.postState();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      GemstoneManagerPanel.viewType,
      'GemStone Manager',
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
    GemstoneManagerPanel.current = new GemstoneManagerPanel(panel, deps);
    GemstoneManagerPanel.setOpenContext(true);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly deps: GemstoneManagerDeps,
  ) {
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: Inbound) => void this.handleMessage(msg).catch((e) => this.failed(msg.command, e)),
      null,
      this.disposables,
    );
    // Connect shows what is connected and which session is current, so it has to
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
    }, GemstoneManagerPanel.COALESCE_MS);
  }

  /**
   * Something the panel was asked to do did not happen. Every button here
   * dispatches an existing command, and a command that rejects would otherwise
   * leave the click looking like it never registered — no message, nothing in
   * the log, and a panel still showing the state from before.
   */
  private failed(what: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    appendSysadmin(`GemStone Manager: ${what} failed: ${detail}`);
    void vscode.window.showErrorMessage(`GemStone Manager: ${detail}`);
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
    appendSysadmin(`GemStone Manager: ${message}`);
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
      // so it must not flash busy.
      const state = await this.buildState('remote');
      this.panel.webview.postMessage({ command: 'state', state });
    } finally {
      this.rebuilding = false;
    }
    if (this.rebuildAgain) {
      this.rebuildAgain = false;
      await this.rebuild();
    }
  }

  private dispose(): void {
    if (GemstoneManagerPanel.current === this) {
      GemstoneManagerPanel.current = undefined;
      GemstoneManagerPanel.setOpenContext(false);
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
        return;
      case 'refresh':
        // Refresh is the one place that asks the network again: everything the
        // panel caches is dropped here, so the button means what it says.
        this.catalog = undefined;
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
      case 'downloadVersion':
        await this.runVersionCommand('gemstone.downloadVersion', msg.version);
        return;
      case 'installVersion':
        await this.installVersion(msg.version);
        return;
      case 'extractVersion':
        await this.runVersionCommand('gemstone.extractVersion', msg.version);
        return;
      case 'deleteDownload':
        await this.runVersionCommand('gemstone.deleteDownload', msg.version);
        return;
      case 'uninstallVersion':
        await this.runVersionCommand('gemstone.deleteExtracted', msg.version);
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
      case 'openWalkthrough':
        await vscode.commands.executeCommand('gemstone.openWalkthrough');
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
        // Through the command like everything else: it creates the database and
        // then adds the stone's DataCurator login unless one already targets it.
        // Doing the create here instead skipped that check and opened the login
        // editor, so a database made from the panel ended up different from one
        // made anywhere else.
        await vscode.commands.executeCommand('gemstone.createDatabase');
        await this.postState();
        return;
      case 'createDatabaseDefaults':
        try {
          await vscode.commands.executeCommand('gemstone.createDatabaseDefaults');
        } catch (e) {
          // Told before the redraw, deliberately. The panel refreshes either way
          // — the database really was created — and a coach step that ticks over
          // on a redraw would read a failed start as progress.
          this.actionFailed(e);
        }
        await this.postState();
        return;
      case 'createDefaultLogin':
        await vscode.commands.executeCommand('gemstone.createDefaultLogin', {
          dirName: msg.dirName,
        });
        await this.postState();
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
        await this.runDbCommand('gemstone.replaceExtent', msg.dirName, 'stone');
        return;
      case 'installServerSupport':
        // The command resolves the session it needs and says so when there is
        // none, so the panel offers it per database without second-guessing.
        await vscode.commands.executeCommand('gemstone.installServerSupport');
        await this.postState();
        return;
      case 'backupDatabase':
        // The command resolves the live session itself and says so when there
        // isn't one, so the panel does not second-guess it.
        await this.runDbCommand('gemstone.onlineExtentBackup', msg.dirName, 'stone');
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
      case 'deleteLogin':
        await this.loginCommand('gemstone.deleteLogin', msg.login);
        return;
      case 'duplicateLogin':
        await this.loginCommand('gemstone.duplicateLogin', msg.login);
        return;
      case 'openSettings':
        // Extensions link to Settings rather than reimplementing it.
        await vscode.commands.executeCommand('workbench.action.openSettings', 'gemstone.rootPath');
        return;
      case 'loadConfiguration':
        this.loadConfiguration();
        return;
      case 'setConfiguration':
        this.setConfiguration(msg.scope, msg.key, msg.valueType, msg.value);
        return;
      case 'createLogin':
        await vscode.commands.executeCommand('gemstone.addLogin');
        await this.postState();
        return;
      case 'startAndConnect':
        await this.startAndConnect(msg.login);
        return;
      case 'sessionAction':
        await this.runSessionAction(msg.sessionId, msg.action);
        return;
      case 'selectSession': {
        // Clicking a session that is already open means "work in this one", not
        // "log in again". Through the command rather than the manager directly,
        // so everything else showing the selection follows.
        const activeSession = this.deps.sessionManager.getSession(msg.sessionId);
        if (activeSession) {
          await vscode.commands.executeCommand('gemstone.selectSession', { activeSession });
        }
        await this.postState();
        return;
      }

      // OS prerequisites.
      case 'osRemedy':
        if (!OS_REMEDIES.has(msg.action)) return;
        await vscode.commands.executeCommand(msg.action);
        await this.postState();
        return;
      case 'quickSetup':
        await vscode.commands.executeCommand('gemstone.quickSetup');
        await this.postState();
        return;
    }
  }

  /**
   * Connect as a specific login. Rows are identified by their display label, the
   * same string `buildDatabases` puts on the wire, so the panel never has to ship
   * credentials to the webview. Delegates to `gemstone.login`, inheriting its
   * keychain lookup, password prompt and session wiring.
   */
  /**
   * Bring a stopped database up and then log in — the two steps a stopped login
   * would otherwise need, in the order that works. The stone must answer before
   * the login is attempted, so the start is awaited rather than fired alongside.
   */
  /** Run one of the allowed session commands against a live session. */
  private async runSessionAction(sessionId: number, action: string): Promise<void> {
    if (!SESSION_ACTIONS.has(action)) return;
    const activeSession = this.deps.sessionManager.getSession(sessionId);
    if (!activeSession) return;
    await vscode.commands.executeCommand(action, { activeSession });
    await this.postState();
  }

  private async startAndConnect(label: string): Promise<void> {
    const login = this.deps.getLogins().find((l) => loginLabel(l) === label);
    if (!login) return;
    const db = this.lastDatabases.find(
      (d) => d.config.stoneName === login.stone && versionsMatch(d.config.version, login.version),
    );
    if (db) await this.bringUp(db);
    await this.connectLogin(label);
    await this.postState();
  }

  /**
   * Start whichever of a database's processes is down. `startstone` and
   * `startnetldi` both exit non-zero when the server is already running — the
   * sidebar never hit that because its Start actions only appeared on a stopped
   * row, so asking unconditionally is what turned "already up" into an error
   * report on a database that was working fine.
   */
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
   * Installing a chosen release is a single action: fetch the archive, then
   * extract it. The extract only runs once the download has actually landed, so a
   * cancelled or failed fetch never tries to unpack a file that isn't there.
   */
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
  ): Promise<void> {
    const db = this.lastDatabases.find((d) => d.dirName === dirName);
    if (!db) return;
    await vscode.commands.executeCommand(command, { kind, db });
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
  private listFiles(dir: string): FileEntry[] {
    return wslListFilesSync(dir).map((e) => ({ name: e, path: path.join(dir, e) }));
  }

  /** Backups are the .dbf files at the top of backups/, newest first (the names
   *  carry a sortable timestamp) — the same rule the sidebar tree applies. */
  private listBackups(dbPath: string): FileEntry[] {
    return this.listFiles(path.join(dbPath, 'backups'))
      .filter((f) => f.name.toLowerCase().endsWith('.dbf'))
      .reverse();
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

  private async openDbSubfolder(dirName: string, folder: string): Promise<void> {
    const db = this.lastDatabases.find((d) => d.dirName === dirName);
    if (!db) return;
    const sub = folder === 'conf' || folder === 'backups' ? folder : 'log';
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

  private async buildState(versionSource: VersionSource): Promise<ManagerState> {
    const [os, versions] = await Promise.all([
      this.buildOsStatus(),
      this.buildVersions(versionSource),
    ]);

    this.deps.processManager.refreshProcesses();
    const procs = this.deps.processManager.getProcesses();
    const logins = this.deps.getLogins();
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
        .map((l) => ({ label: loginLabel(l), user: l.gs_user, stone: l.stone, host: l.gem_host }));
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
        startedAtMs: parseGslistStart(
          procs.find((p) => p.type === 'stone' && belongsTo(p))?.startTime,
        ),
        logFiles: this.listFiles(path.join(db.path, 'log')),
        confFiles: this.listFiles(path.join(db.path, 'conf')),
        backupFiles: this.listBackups(db.path),
      };
    });

    return {
      platform: this.deps.storage.getPlatformKey() ?? process.platform,
      windows: needsWsl(),
      rootPath: this.deps.storage.getRootPath(),
      os,
      versions,
      databases,
      logins: this.buildLoginTargets(databases),
      session: this.buildSessionInfo(),
    };
  }

  /**
   * The selected session, without touching the GCI. This rides along with every
   * state so the Configuration section can appear the instant a session is
   * selected; the values it shows are fetched separately, on demand.
   */
  private buildSessionInfo(): SessionInfo {
    const session = this.deps.sessionManager.getSelectedSession();
    if (!session) return { connected: false };
    return {
      connected: true,
      sessionId: session.id,
      label: loginLabel(session.login),
      user: session.login.gs_user,
      stone: session.login.stone,
      version: session.login.version,
    };
  }

  // ── Configuration (issue #232) ──────────────────────────────────────────────

  /**
   * Read the selected session's stone and gem configuration reports and post
   * them to the panel. On demand only — never part of a state rebuild — so an
   * admin action never pays for these two GCI round-trips. A busy or dropped
   * session, or a report that raises, becomes a `configurationError` the section
   * can show, rather than a thrown rejection the tour would misread.
   */
  private loadConfiguration(): void {
    const session = this.deps.sessionManager.getSelectedSession();
    if (!session) {
      this.configurationError('No GemStone session is selected. Log in and try again.');
      return;
    }
    try {
      void this.panel.webview.postMessage({
        command: 'configuration',
        config: this.readConfiguration(session),
      });
    } catch (e: unknown) {
      this.configurationError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Read both reports for a session and shape them for the panel. */
  private readConfiguration(session: ActiveSession): ConfigurationPayload {
    const execute = defaultQueryExecutorUsing(session);
    const isSystemUser = sessionIsSystemUser(execute);
    const stone = stoneConfiguration(execute);
    const gem = gemConfiguration(execute);
    const descriptions = this.configDescriptions(session.login.version);
    return {
      sessionId: session.id,
      label: loginLabel(session.login),
      version: session.login.version,
      isSystemUser,
      descriptionsAvailable: descriptions.size > 0,
      stoneParams: stone.map((e) => this.toConfigParam(e, descriptions, 'stone', isSystemUser)),
      gemParams: gem.map((e) => this.toConfigParam(e, descriptions, 'gem', isSystemUser)),
    };
  }

  /**
   * Set one runtime-settable value through the session, then re-read and report
   * the *settled* value. The stone is the authority: a refusal (a SystemUser-only
   * stone key, a gem key frozen after login) comes back as a `configurationError`
   * with the stone's own words. But some parameters are accepted without error
   * and then ignored — set at cache/gem creation, not at runtime — so a bare
   * "OK" would read as success while the value snapped back. Comparing what the
   * session now reports against what was asked turns that silent revert into a
   * plain statement of what actually happened.
   */
  private setConfiguration(
    scope: ConfigScope,
    key: string,
    valueType: ConfigValueType,
    value: string,
  ): void {
    const session = this.deps.sessionManager.getSelectedSession();
    if (!session) {
      this.configurationError('No GemStone session is selected. Log in and try again.');
      return;
    }
    try {
      const execute = defaultQueryExecutorUsing(session);
      const result = setSessionConfiguration(execute, scope, key, valueType, value);
      if (!result.ok) {
        this.configurationError(result.message ?? `Could not set ${key}.`);
        return;
      }
      appendSysadmin(`GemStone Manager: set ${scope} configuration ${key} = ${value}`);

      const config = this.readConfiguration(session);
      void this.panel.webview.postMessage({ command: 'configuration', config });

      const settled = (scope === 'stone' ? config.stoneParams : config.gemParams).find(
        (p) => p.key === key,
      );
      const now = settled ? settled.value : '(unknown)';
      const took = settled !== undefined && configValuesMatch(valueType, value, settled.value);
      void this.panel.webview.postMessage({
        command: 'configurationNotice',
        tone: took ? 'ok' : 'warn',
        message: took
          ? `Set ${key} — the session now reports ${now}.`
          : `${key} was accepted without error, but the session still reports ${now}, not ${value.trim()}. ` +
            `This parameter is likely read-only at runtime — many settings can only change in the config ` +
            `file before startup, and stone-level settings need SystemUser.`,
      });
    } catch (e: unknown) {
      this.configurationError(e instanceof Error ? e.message : String(e));
    }
  }

  private configurationError(message: string): void {
    appendSysadmin(`GemStone Manager: configuration: ${message}`);
    void this.panel.webview.postMessage({ command: 'configurationError', message });
  }

  private toConfigParam(
    entry: ConfigEntry,
    descriptions: Map<string, string>,
    scope: ConfigScope,
    isSystemUser: boolean,
  ): ConfigParam {
    const description = descriptionFor(descriptions, entry.key);
    // A stone parameter can only be changed by SystemUser; a gem parameter may be
    // attempted by any user (whether it takes is up to the stone, reported after
    // the set). So a non-SystemUser sees stone runtime keys as not-editable.
    const editable = isEditable(entry) && (scope === 'gem' || isSystemUser);
    return {
      key: entry.key,
      value: entry.value,
      type: entry.type,
      settable: entry.settable,
      editable,
      ...(description ? { description } : {}),
    };
  }

  /**
   * The parsed system.conf descriptions for a version, read from the installed
   * product tree this machine knows about. Best-effort: a version whose tree is
   * not local (a remote stone) simply yields no descriptions, cached as an empty
   * map so it is not read again.
   */
  private configDescriptions(version: string): Map<string, string> {
    const cached = this.configDescCache.get(version);
    if (cached) return cached;
    let map = new Map<string, string>();
    try {
      const gsPath = this.deps.storage.getGemstonePath(version);
      if (gsPath) {
        const confPath = path.join(gsPath, 'data', 'system.conf');
        map = parseConfigDescriptions(fs.readFileSync(confPath, 'utf8'));
      }
    } catch {
      // No readable system.conf for this version — tooltips are optional.
    }
    this.configDescCache.set(version, map);
    return map;
  }

  private async buildOsStatus(): Promise<OsStatus> {
    const supported =
      process.platform === 'linux' || process.platform === 'darwin' || process.platform === 'win32';
    const platformLabel =
      process.platform === 'darwin'
        ? 'macOS'
        : process.platform === 'win32'
          ? 'Windows (WSL)'
          : 'Linux';

    // Both probes answer undefined when the machine won't say, so there is
    // nothing here to catch: a rejection would mean the probe itself is broken,
    // and dressing that up as "could not be read" is how it would stay broken.
    const [mem, inUse] = await Promise.all([getSharedMemory(), getSharedMemoryInUse()]);
    const { configured, gbLabel } = sharedMemoryStatus(mem);
    return {
      supported,
      platformLabel,
      sharedMemoryConfigured: configured,
      gbLabel,
      shmmaxBytes: mem?.shmmax,
      shmallBytes: mem?.shmall,
      unknown: !mem,
      checks: this.buildOsChecks(mem, gbLabel, inUse),
    };
  }

  /**
   * One row per prerequisite this machine has. Every remedy the Configure OS
   * tree offered appears here against the check it fixes, so a machine that
   * cannot run a stone says which part is wrong rather than only that something
   * is — and only a failing row carries a button.
   */
  private buildOsChecks(
    mem: { shmmax: number; shmall: number } | undefined,
    gbLabel: string,
    inUse: number | undefined,
  ): OsCheck[] {
    // shmall is a ceiling for the machine, not for one stone: caches other stones
    // already hold count against it. A database Jasper creates asks for a 100 MB
    // cache (SHR_PAGE_CACHE_SIZE_KB), so less than that free means the next start
    // fails however comfortably the limit itself clears 1 GB.
    const shmallBytes = mem ? mem.shmall * 4096 : undefined;
    const free = shmallBytes !== undefined && inUse !== undefined ? shmallBytes - inUse : undefined;
    const roomForACache = free === undefined || free >= 100 * 1024 * 1024;
    const headroom = free === undefined ? '' : ` · ${formatBytes(free)} free`;
    const checks: OsCheck[] = [
      {
        key: 'sharedMemory',
        label: 'Shared memory',
        state: !mem
          ? 'unknown'
          : sharedMemoryStatus(mem).configured && roomForACache
            ? 'ok'
            : 'warn',
        detail: mem
          ? `${gbLabel} GB${headroom}${roomForACache ? '' : ' — no room for another cache'}`
          : 'could not be read',
        remedy: {
          command:
            process.platform === 'darwin'
              ? 'gemstone.runSetSharedMemory'
              : 'gemstone.runSetSharedMemoryLinux',
          label: 'Run setup script',
          note: 'requires sudo',
        },
      },
    ];

    // RemoveIPC is a systemd setting, so it is a Linux question — including the
    // Linux inside WSL, which is where a Windows install's stone actually runs.
    if (process.platform === 'linux' || needsWsl()) {
      const ok = getRemoveIpcConfigured();
      checks.push({
        key: 'removeIpc',
        label: 'RemoveIPC',
        state: ok ? 'ok' : 'warn',
        detail: ok ? 'no' : 'yes — systemd will delete the shared cache',
        remedy: {
          command: 'gemstone.runSetRemoveIPC',
          label: 'Run setup script',
          note: 'requires sudo',
        },
      });
    }

    if (!needsWsl()) return checks;

    const wsl = getWslInfo();
    checks.push({
      key: 'wslVersion',
      label: 'WSL',
      state: !wsl.available ? 'unknown' : wsl.wslVersion === 2 ? 'ok' : 'warn',
      detail: !wsl.available
        ? 'not reachable'
        : `${wsl.defaultDistro ?? 'default distro'}, WSL ${wsl.wslVersion ?? '?'}`,
      remedy:
        wsl.wslVersion === 2
          ? { command: 'gemstone.updateWslCore', label: 'Update WSL' }
          : { command: 'gemstone.upgradeWsl2', label: 'Upgrade to WSL 2' },
    });

    const net = getWslNetworkInfoCached();
    checks.push({
      key: 'wslNetworking',
      label: 'WSL networking',
      state: !net ? 'unknown' : net.mirrored ? 'ok' : 'warn',
      detail: !net
        ? 'not probed yet'
        : net.mirrored
          ? 'mirrored'
          : `NAT${net.ip ? ` (${net.ip})` : ''}`,
      remedy: { command: 'gemstone.enableMirroredNetworking', label: 'Enable mirrored networking' },
    });

    if (net && !net.mirrored) {
      checks.push({
        key: 'hostsEntry',
        label: 'Hosts entry',
        state: 'warn',
        detail: 'wsl-linux needs an entry while networking is NAT',
        remedy: {
          command: 'gemstone.writeWslHostsEntry',
          label: 'Write hosts entry',
          note: 'requires admin',
        },
      });
    }

    const winServices = windowsServicesHasGs64ldi();
    checks.push({
      key: 'windowsServices',
      label: 'Windows services entry',
      state: winServices ? 'ok' : 'warn',
      detail: winServices ? 'gs64ldi present' : 'gs64ldi missing',
      remedy: {
        command: 'gemstone.writeServicesWindows',
        label: 'Write Windows services entry',
        note: 'requires admin',
      },
    });

    const wslServices = wslServicesHasGs64ldi();
    checks.push({
      key: 'wslServices',
      label: 'WSL services entry',
      state: wslServices ? 'ok' : 'warn',
      detail: wslServices ? 'gs64ldi present' : 'gs64ldi missing',
      remedy: {
        command: 'gemstone.writeServicesWsl',
        label: 'Write WSL services entry',
        note: 'requires sudo',
      },
    });

    return checks;
  }

  /**
   * Every configured login, paired with the local database it targets so the
   * Connect band can say whether that stone is actually up. Running targets sort
   * first: they are the ones a click will succeed on.
   */
  private buildLoginTargets(databases: DatabaseRow[]): LoginTarget[] {
    const open = this.deps.sessionManager.getSessions();
    const selected = this.deps.sessionManager.getSelectedSession();
    const selectedLabel = selected ? loginLabel(selected.login) : undefined;

    const targets = this.deps.getLogins().map((l) => {
      const label = loginLabel(l);
      const db = databases.find(
        (d) => d.stoneName === l.stone && versionsMatch(d.version, l.version),
      );
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
        this.catalog ??= await this.deps.versionManager.fetchCatalog();
        list = this.deps.versionManager.versionsFrom(this.catalog);
      } catch {
        // Offline: fall back to what's installed / downloaded on disk so the
        // panel still manages local versions when the download catalog is
        // unreachable.
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
  <title>GemStone Manager</title>
  <!-- Registers the codicon @font-face and .codicon glyph classes at the document
       level; every icon in the panel is a plain <i class="codicon codicon-…">. -->
  <link rel="stylesheet" href="${codiconUri}">
  <style>${CSS}</style>
</head>
<body>
  <main id="root" class="content" aria-busy="false"></main>
  <script nonce="${nonce}">${gemstoneManagerJs}</script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    GemstoneManager.init(
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
body {
  margin: 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground, #ccc);
  background: var(--vscode-editor-background, #1e1e1e);
}
.content { padding: 16px 22px 56px; max-width: 1040px; }
.mono { font-family: var(--vscode-editor-font-family, monospace); }
.dim { color: var(--vscode-descriptionForeground, #9d9d9d); }
.codicon { font-size: 16px; line-height: 1; }

/* ── Buttons ──────────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 11px; font: inherit; font-size: 12px; line-height: 18px;
  border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px;
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.18));
  color: var(--vscode-button-secondaryForeground, inherit); cursor: pointer; white-space: nowrap;
}
.btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.28)); }
.btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn-primary:hover { background: var(--vscode-button-hoverBackground); }
.btn .codicon { font-size: 14px; }
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
  font-size: 11px; border-radius: 8px; white-space: nowrap;
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
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  background: var(--vscode-sideBarSectionHeader-background, transparent); }
.section > .section-head::-webkit-details-marker { display: none; }
.section > .section-head:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.08)); }
.section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
.section-desc { font-size: 12px; color: var(--vscode-descriptionForeground, #9d9d9d);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.section-head-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
.section-count { font-size: 11px; color: var(--vscode-descriptionForeground, #9d9d9d); font-variant-numeric: tabular-nums; }
.section-body { padding: 14px 16px 18px; }
.section-twist { flex: none; font-size: 16px; color: var(--vscode-icon-foreground, #9d9d9d);
  transition: transform .12s ease; }
details[open] > .section-head > .section-twist,
details[open] > .db-head > .section-twist,
details[open] > .db-group-head > .section-twist,
details[open] > .config-group-head > .section-twist,
details[open] > .file-root-head > .section-twist { transform: rotate(90deg); }

.col-lead { margin-bottom: 4px; }
.col-rest { display: flex; flex-direction: column; }

/* ── State marks — tinted codicons ────────────────────────────────────────── */
.mark { flex: none; font-size: 14px; }
.mark.ok { color: var(--gm-ok); }
.mark.warn { color: var(--gm-warn); }
.mark.off { color: var(--vscode-descriptionForeground, #777); opacity: .7; }

/* ── Facts (label / value pairs) ──────────────────────────────────────────── */
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 7px 18px; margin: 0; align-items: baseline; }
.facts dt { color: var(--vscode-descriptionForeground, #9d9d9d); font-size: 12px; }
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
.os-remedy-copy { margin: 6px 0 0; font-size: 12.5px; line-height: 1.55; max-width: 68ch; }

/* ── Versions table ───────────────────────────────────────────────────────── */
.versions-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.versions-table th {
  text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
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
  font: inherit; font-size: 12.5px; text-align: left;
  padding: 7px 8px; border: none; background: transparent; color: inherit; cursor: pointer;
}
.login-stone { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.login-current { flex: none; width: 16px; display: inline-flex; justify-content: center; }
.login-current .codicon { font-size: 14px; color: var(--gm-ok); }
.login-user { font-weight: 600; }
.login-stone { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; opacity: .75; }
.login-status { flex: none; display: inline-flex; align-items: center; gap: 8px; }
.login-acts { flex: none; display: inline-flex; align-items: center; gap: 1px; opacity: .45; transition: opacity .12s ease; }
.login-row:hover .login-acts, .login-acts:focus-within { opacity: 1; }
.login-act { width: 22px; height: 22px; }
.login-act .codicon { font-size: 14px; }
.login-row-live { background: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,.10)); }
.login-row-current { background: var(--vscode-list-activeSelectionBackground, rgba(14,99,156,.35)); color: var(--vscode-list-activeSelectionForeground, inherit); }
.login-row-idle .login-main { opacity: .7; }
.connect-empty { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12.5px; color: var(--vscode-descriptionForeground, #9d9d9d); }

/* ── Databases (native disclosure per row) ────────────────────────────────── */
.db-item { border-radius: 4px; }
.db-item + .db-item { margin-top: 1px; }
.db-item-current { background: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,.10)); }
.db-head { list-style: none; cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 4px; min-width: 0; }
.db-head::-webkit-details-marker { display: none; }
.db-head:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.08)); }
.db-name { font-weight: 600; flex: none; }
.db-dir { flex: 1 1 auto; min-width: 0; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-version { flex: none; font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground, #9d9d9d); }
.db-state { flex: none; font-size: 11px; color: var(--vscode-descriptionForeground, #9d9d9d); white-space: nowrap; }
.power { flex: none; }
.power-start .codicon { color: var(--gm-ok); }
.power-stop .codicon { color: var(--vscode-errorForeground, #f14c4c); }
.db-body { padding: 6px 8px 10px 24px; }
.db-toolbar { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; flex-wrap: wrap; }
.db-toolbar-tools { display: inline-flex; align-items: center; gap: 2px; }
.extent { display: inline-flex; align-items: center; gap: 6px; }
.extent-label { font-size: 11px; color: var(--vscode-descriptionForeground, #9d9d9d); text-transform: uppercase; letter-spacing: .04em; }
.extent-select {
  font: inherit; font-size: 12px; padding: 2px 6px; border-radius: 4px;
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
.db-group-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground, #9d9d9d); }
.db-group .section-twist { font-size: 14px; }
.group-desc { font-size: 11px; color: var(--vscode-descriptionForeground, #9d9d9d); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-group-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; }
.db-group-body { padding: 2px 0 4px 20px; }
.db-files { grid-column: 1 / -1; }
.db-files .db-group-body { padding-left: 20px; }
.db-footer { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0; }
.db-empty { font-size: 12px; color: var(--vscode-descriptionForeground, #9d9d9d); padding: 4px 2px; }

/* Rows shared by Logins and Processes. */
.db-line { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; padding: 5px 6px; margin: 0 -6px; border-radius: 4px; min-width: 0; }
.db-line:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.06)); }
.db-line.row-warn { background: color-mix(in srgb, var(--gm-warn) 8%, transparent); }
.db-line-name { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.db-login-user, .proc-name { font-weight: 600; }
.db-line-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; flex: none; }
.db-line-meta { font-size: 11px; color: var(--vscode-descriptionForeground, #9d9d9d); }
.svc-state { font-size: 11px; color: var(--vscode-descriptionForeground, #9d9d9d); }

/* ── Files (tree: Logs / Config / Backups as roots) ───────────────────────── */
.file-tree { display: flex; flex-direction: column; gap: 1px; }
.file-root-head { list-style: none; cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 7px; padding: 4px 4px; border-radius: 4px; }
.file-root-head::-webkit-details-marker { display: none; }
.file-root-head:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.06)); }
.file-root .section-twist { font-size: 14px; }
.file-root-icon { display: inline-flex; color: var(--vscode-icon-foreground, #9d9d9d); }
.file-root-name { font-size: 12px; font-weight: 600; }
.file-root-count { font-size: 11px; color: var(--vscode-descriptionForeground, #9d9d9d); font-variant-numeric: tabular-nums; }
.file-root-actions { margin-left: auto; display: inline-flex; align-items: center; opacity: 0; transition: opacity .12s ease; }
.file-root-head:hover .file-root-actions, .file-root-actions:focus-within { opacity: 1; }
.file-list { list-style: none; margin: 0; padding: 0 0 3px 27px; }
/* ── OS prerequisite checklist ───────────────────────────────────────────── */
.os-checks { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.os-check { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
.os-check-label { min-width: 150px; }
.os-check-detail { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.os-check-action { display: flex; align-items: center; gap: 6px; }
.os-check-note { font-size: 11px; color: var(--vscode-descriptionForeground, #9d9d9d); }
/* A file row can carry its own action (restoring a backup), which sits beside
   the name rather than inside it — a button cannot nest in a button. */
.file-line { display: flex; align-items: center; gap: 2px; }
.file-line .file-row { flex: 1; min-width: 0; }
.file-row { display: block; width: 100%; text-align: left; font: inherit; font-size: 12px;
  padding: 3px 6px; border: none; border-radius: 4px; background: transparent; color: inherit; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-row:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.14)); }
.file-empty { list-style: none; font-size: 11px; color: var(--vscode-descriptionForeground, #9d9d9d); padding: 2px 6px 4px 27px; }

/* ── Getting-set-up header ────────────────────────────────────────────────── */
.gm-head {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  margin: 0 0 16px; padding: 10px 14px; border-radius: 6px;
  border: 1px solid var(--gm-line);
  background: var(--vscode-sideBarSectionHeader-background, transparent);
}
.gm-head-text { display: flex; align-items: baseline; gap: 10px; flex: 1 1 240px; min-width: 0; font-size: 12.5px; }
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
.gm-call-meta { display: flex; align-items: center; gap: 10px; font-size: 11px; }
.gm-call-step { color: var(--vscode-descriptionForeground, #9d9d9d); font-variant-numeric: tabular-nums; }
.gm-call-mark { font-weight: 600; letter-spacing: .02em; }
.gm-call-mark.is-done { color: var(--gm-ok); }
.gm-call-mark.is-todo { color: var(--gm-warn); }
.gm-call-title { margin: 5px 0 0; font-size: 14px; font-weight: 600; }
.gm-call-body { margin: 6px 0 0; font-size: 12.5px; line-height: 1.55; }
/* What a user actually does here — including "nothing", which is the answer on a
   machine that is already configured and is worth saying rather than implying. */
.gm-call-do {
  margin: 9px 0 0; padding: 8px 10px; border-radius: 4px; font-size: 12.5px; line-height: 1.5;
  background: color-mix(in srgb, var(--vscode-focusBorder, #007fd4) 12%, transparent);
}
.gm-call-hint { margin: 9px 0 0; font-size: 11.5px; color: var(--vscode-descriptionForeground, #9d9d9d); }
.gm-call-list { margin: 7px 0 0; padding-left: 18px; font-size: 12.5px; line-height: 1.5; }
.gm-call-list li { margin: 0 0 3px; }
.gm-call-list li:last-child { margin-bottom: 0; }
.gm-call-note { margin: 8px 0 0; font-size: 12px; line-height: 1.5; color: var(--vscode-descriptionForeground, #9d9d9d); }
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
  margin: 9px 0 0; font-size: 12.5px; font-weight: 600; color: var(--gm-ok);
}
.gm-call-settled[hidden] { display: none; }
/* What went wrong, where there is room to read it: a notification truncates a
   startstone error long before it has finished explaining itself. */
.gm-call-error {
  margin: 9px 0 0; padding: 8px 10px; border-radius: 4px;
  font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; line-height: 1.5;
  color: var(--vscode-inputValidation-errorForeground, inherit);
  background: var(--vscode-inputValidation-errorBackground, rgba(241, 76, 76, .12));
  border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground, #f14c4c));
  max-height: 8.5em; overflow-y: auto; white-space: pre-wrap; word-break: break-word;
}
.gm-call-error[hidden] { display: none; }
.gm-call-acts .btn:disabled { opacity: .45; cursor: default; }

/* ── Empty / note states ──────────────────────────────────────────────────── */
.empty { text-align: center; color: var(--vscode-descriptionForeground, #9d9d9d); padding: 22px 12px; }
.empty div { margin-top: 10px; }
.note { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: var(--vscode-descriptionForeground, #9d9d9d); }
.note .codicon { color: var(--gm-warn); }
.skeleton { color: var(--vscode-descriptionForeground, #9d9d9d); padding: 30px 12px; text-align: center; }

/* ── Configuration section (issue #232) ───────────────────────────────────── */
.badge-runtime { background: color-mix(in srgb, var(--vscode-charts-blue, #4daafc) 26%, transparent); color: var(--vscode-foreground); }
.badge-readonly { background: transparent; color: var(--vscode-descriptionForeground, #9d9d9d); border: 1px solid var(--gm-line); }
.config-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
.config-filter {
  flex: 1 1 220px; min-width: 160px; padding: 3px 8px;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--gm-line)); border-radius: 4px;
}
.config-filter:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.config-legend { font-size: 11px; color: var(--vscode-descriptionForeground, #9d9d9d); display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.config-loading { color: var(--vscode-descriptionForeground, #9d9d9d); padding: 16px 4px; }
.config-error {
  margin: 0 0 10px; padding: 6px 10px; font-size: 12px; border-radius: 4px;
  background: color-mix(in srgb, var(--gm-warn) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--gm-warn) 40%, transparent);
}
/* The result of a set: a plain confirmation, or a warning that the stone
   accepted the value but did not actually apply it. */
.config-notice { margin: 0 0 10px; padding: 6px 10px; font-size: 12px; border-radius: 4px; }
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
.config-group .section-twist { font-size: 14px; }
.config-note { font-size: 11px; font-weight: 400; color: var(--vscode-descriptionForeground, #9d9d9d); }
.config-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.config-table td { padding: 3px 8px; border-bottom: 1px solid var(--gm-line); vertical-align: top; }
.config-key { white-space: nowrap; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
.config-info { font-size: 12px; color: var(--vscode-descriptionForeground, #9d9d9d); cursor: help; margin-left: 5px; vertical-align: -1px; opacity: .6; }
.config-item:hover .config-info { opacity: 1; }
.config-info:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; opacity: 1; }
.config-val { width: 100%; }
.config-value { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; word-break: break-all; }
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
  font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
}
.config-input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
`;
