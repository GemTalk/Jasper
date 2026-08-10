import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { LoginStorage } from './loginStorage';
import { getLoginPassword, deleteLoginPassword } from './loginCredentials';
import { runStopStone } from './stopStoneManager';
import { LoginTreeProvider, GemStoneLoginItem, GemStoneSessionItem } from './loginTreeProvider';
import {
  DEFAULT_GS_PW,
  GemStoneLogin,
  buildDataCuratorLogin,
  dataCuratorLoginToCreate,
  loginLabel,
  loginTargetKey,
  sameLoginTarget,
} from './loginTypes';
import { InFlightGuard } from './inFlightGuard';
import { LoginEditorPanel } from './loginEditorPanel';
import { SessionManager, ActiveSession } from './sessionManager';
import {
  enhancedInspectorPerfTracker,
  buildEnhancedInspectorPerfStatusBarText,
  buildEnhancedInspectorPerfClipboardText,
  buildEnhancedInspectorPerfQuickPickItems,
  RESET_LABEL,
  COPY_LABEL,
} from './enhancedInspector/enhancedInspectorPerfTracker';
import { CodeExecutor } from './codeExecutor';
import { SystemBrowser } from './systemBrowser';
import {
  startSeasideServer,
  stopSeasideServer,
  stopAllSeasideServers,
  SEASIDE_DEFAULT_PORT,
} from './seasideServer';
import {
  findRowanLoadSpecs,
  deriveRepoName,
  cloneGitRepo,
  updateGitRepo,
  normalizeGitUrl,
} from './rowanLoad';
import { NbCancelledError } from './nbRunner';
import { RowanRepoRegistry } from './rowanRepos';
import {
  RowanTreeProvider,
  RowanRepoItem,
  RowanLoadedProjectItem,
  RowanChangesProjectItem,
} from './rowanTreeProvider';
import { isRowanProjectRoot } from './rowanProject';
import { RowanProjectTreeProvider } from './rowanProjectView';
import { createRowanProject } from './rowanCreate';
import {
  addProjectDependency,
  dependencyNameFromGitUrl,
  ProjectDependency,
} from './rowanDependency';
import { shouldLoadAfterAddingDependency } from './rowanLoadPrompt';
import { RowanDecorationProvider } from './rowanDecorations';
import { ExplorerEmptyVarDecorationProvider } from './explorerVarDecorations';
import { ActiveEditorDecorationProvider } from './activeEditorDecoration';
import { findMethodInClass } from './commands/findMethodInClass';
import { loadClassPickItems } from './commands/classPicker';
import { GlobalsBrowser } from './globalsBrowser';
import { CommentBrowser } from './commentBrowser';
import { EnhancedInspector } from './enhancedInspector/enhancedInspector';
import {
  maybeOfferServerSupport,
  runInstallServerSupport,
  runUninstallServerSupport,
} from './optionalSupportOffer';
import { refreshEnhancedInspectorAvailable } from './enhancedInspector/enhancedInspectorAvailability';
import { refreshRefactoringSupportAvailable } from './refactoring/refactoringAvailability';
import { supportsEnhancedInspector } from './enhancedInspector/enhancedInspectorInstall';
import { DebuggerPanel } from './debuggerPanel';
import { InlineValuesCodeLensProvider } from './inlineValuesCodeLens';
import {
  GemStoneFileSystemProvider,
  MethodCompiledEvent,
  ClassDefinitionCompiledEvent,
  closeGemstoneTabsForSession,
  installStaleGemstoneTabReaper,
  buildMethodUri,
  parseUri,
} from './gemstoneFileSystemProvider';
import { openWorkspace } from './workspace';
import { openTutorialNotebook } from './tutorialNotebook';
import { GemStoneDebugSession } from './gemstoneDebugSession';
import { InspectorTreeProvider, InspectorNode } from './inspectorTreeProvider';
import { registerGemStoneExplorer } from './gemstoneExplorer';
import { renameTemporaryCommand } from './refactoring/renameTemporaryCommand';
import { convertTempToInstVarCommand } from './refactoring/instVarStructureCommand';
import { extractMethodCommand } from './refactoring/extractMethodCommand';
import { inlineMethodCommand } from './refactoring/inlineMethodCommand';
import { extractTemporaryCommand } from './refactoring/extractTemporaryCommand';
import { inlineTemporaryCommand } from './refactoring/inlineTemporaryCommand';
import { RefactorCodeActionProvider } from './refactoring/renameRefactorCodeActions';
import { GemStoneWorkspaceSymbolProvider } from './gemstoneSymbolProvider';
import { GemStoneDefinitionProvider } from './gemstoneDefinitionProvider';
import { GemStoneHoverProvider } from './gemstoneHoverProvider';
import { GemStoneCompletionProvider } from './gemstoneCompletionProvider';
import { BreakpointManager } from './breakpointManager';
import { SelectorBreakpointManager } from './selectorBreakpointManager';
import { SunitTestController } from './sunitTestController';
import { GrailNotebookController } from './grailNotebookController';
import { SmalltalkNotebookController } from './smalltalkNotebookController';
import { ExportManager } from './exportManager';
import { FileInManager } from './fileInManager';
import { showTranscript, getTranscriptChannel } from './transcriptChannel';
import { getGciLog } from './gciLog';
import { GemStoneCodeLensProvider } from './gemstoneCodeLensProvider';
import * as queries from './browserQueries';
import { SysadminStorage } from './sysadminStorage';
import { GemStoneDatabase } from './sysadminTypes';
import { appendSysadmin, getSysadminChannel } from './sysadminChannel';
import { VersionManager } from './versionManager';
import { VersionTreeProvider, VersionItem } from './versionTreeProvider';
import { DatabaseManager } from './databaseManager';
import { DatabaseTreeProvider, DatabaseNode } from './databaseTreeProvider';
import { runLogicalBackup } from './backupManager';
import { runOnlineExtentBackup, resolveExtentBackupSession } from './extentBackupManager';
import { runLogicalRestore, RestoreSession } from './restoreManager';
import { hasFileControlPrivilege } from './queries/backup';
import { ProcessManager } from './processManager';
import { openMcpInspector } from './openMcpInspector';
import { McpSocketServer, writeClaudeDesktopMcpConfig } from './mcpSocketServer';
import { writeClaudeCodeUserMcpConfig } from './claudeCodeUserMcpConfig';
import { buildRefreshPromptDeps, promptClaudeCodeRefresh } from './claudeCodeRefreshPrompt';
import { McpServerTreeProvider } from './mcpServerTreeProvider';
import { DEFAULT_MCP_HTTP_PORT, McpHttpServer } from './mcpHttpServer';
import { readMcpSetting } from './mcpSettings';
import { ensureSelfSignedCert, trustCertCommand } from './tlsCert';
import { ProcessTreeProvider, ProcessItem } from './processTreeProvider';
import { OsConfigTreeProvider } from './sharedMemoryTreeProvider';
import { ensureStonePreconditions } from './stonePreconditions';
import { runQuickSetup } from './quickSetup';
import {
  isWindows,
  getWslInfoAsync,
  invalidateWslCache,
  getWslNetworkInfoCached,
  refreshWslNetworkInfo,
} from './wslBridge';
import {
  wslExistsSync,
  wslSymlinkSync,
  wslMkdirSync,
  wslImportFileSync,
  wslReaddirSync,
  wslUnlinkSync,
  wslChmodSync,
} from './wslFs';
import type { OutputChannel } from 'vscode';
import { initializeExtensionFolder } from './extensionPath';
import {
  initializeBundledGci,
  bundledWindowsClientGciPath,
  bundledGciArchSupported,
} from './bundledGci';

let client: LanguageClient;
let sessionManager: SessionManager;
let exportManager: ExportManager;
let fileInManager: FileInManager;
let jasperChannel: OutputChannel;

function logLine(level: 'ERROR', scope: string, message: string, data: unknown) {
  jasperChannel?.appendLine(
    `${new Date().toISOString()} [${level}] [${scope}] ${message} | ${data && JSON.stringify(data)}`,
  );
}

async function logJasperError(message: string, scope: string, error: unknown) {
  logLine('ERROR', scope, message, {
    error: error instanceof Error ? error.message : String(error),
  });

  await vscode.window.showErrorMessage(message, 'Show Details').then((choice) => {
    if (choice === 'Show Details') {
      jasperChannel.show(true);
    }
  });
}

/**
 * Pre-logout guard for a session that may hold uncommitted work. Given the
 * tri-state result of `sessionNeedsCommit` (true = pending, false = clean,
 * undefined = couldn't tell), returns:
 *  - `'proceed'` — nothing pending, or the user chose to log out (having
 *    optionally committed first);
 *  - `'cancel'`  — the user backed out, or a requested commit failed.
 *
 * `commit` is injected so the flow is unit-testable without a live session, and
 * `undefined` is treated like `true`: a failed probe is not evidence of a clean
 * transaction, so we prompt rather than silently discard.
 */
export async function confirmLogoutWithUncommittedChanges(
  sessionId: number,
  needsCommit: boolean | undefined,
  commit: (id: number) => { success: boolean; err: { number: number; message: string } },
): Promise<'proceed' | 'cancel'> {
  if (needsCommit === false) return 'proceed';

  const title =
    needsCommit === true
      ? `Session ${sessionId} has uncommitted changes.`
      : `Session ${sessionId} may have uncommitted changes.`;
  const detail =
    needsCommit === true
      ? 'Logging out discards them. Commit first to keep your work.'
      : 'Its commit state could not be checked; logging out may discard uncommitted work.';
  const choice = await vscode.window.showWarningMessage(
    title,
    { modal: true, detail },
    'Commit & Logout',
    'Logout Anyway',
  );

  if (choice === 'Commit & Logout') {
    try {
      const { success, err } = commit(sessionId);
      if (!success) {
        vscode.window.showErrorMessage(
          `Session ${sessionId}: Commit failed — ${err.message || `error ${err.number}`}. Not logging out.`,
        );
        return 'cancel';
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(
        `Session ${sessionId}: Commit failed — ${msg}. Not logging out.`,
      );
      return 'cancel';
    }
    return 'proceed';
  }

  return choice === 'Logout Anyway' ? 'proceed' : 'cancel';
}

/**
 * The confirmation message to show before aborting, or `null` when the abort is
 * safe to run silently — a clean transaction with no unsaved editors, where the
 * abort discards nothing. Covers two independent losses: the transaction's
 * uncommitted changes (`sessionNeedsCommit`, tri-state, where `undefined` =
 * couldn't tell is treated as pending) and unsaved edits in open `.gs`/method
 * editors that a post-abort refresh would overwrite.
 */
export function abortConfirmMessage(
  needsCommit: boolean | undefined,
  hasUnsavedEditors: boolean,
): string | null {
  const parts: string[] = [];
  if (needsCommit === true) {
    parts.push('This discards this session’s uncommitted changes.');
  } else if (needsCommit === undefined) {
    parts.push('This may discard uncommitted changes (the commit state could not be checked).');
  }
  if (hasUnsavedEditors) {
    parts.push('Exported .gs files have unsaved edits that will be overwritten.');
  }
  return parts.length ? parts.join('\n') : null;
}

export async function handleMethodCompiled(event: MethodCompiledEvent) {
  if (event.uri.toString() === event.previousUri.toString()) {
    return;
  }

  await openTextEditorOn(event.uri);

  if (event.previousUriIsTemplate) {
    await closeTextEditorOn(event.previousUri);
  }
}

export async function handleClassDefinitionCompiled(event: ClassDefinitionCompiledEvent) {
  if (event.uri.toString() !== event.previousUri.toString()) {
    await openTextEditorOn(event.uri);
  }
  if (event.previousUriIsTemplate) {
    await closeTextEditorOn(event.previousUri);
  }
}

/**
 * Open a scratch Workspace targeting a specific session (the inline action on a
 * session in the Sessions view). The Workspace is a session-agnostic buffer that
 * runs against the *selected* session, so select the clicked session first —
 * otherwise, with several sessions open, Execute It would target whichever
 * session happened to already be active.
 */
export async function openWorkspaceForSession(
  sessionManager: SessionManager,
  item?: GemStoneSessionItem,
): Promise<void> {
  if (item) sessionManager.selectSession(item.activeSession.id);
  await openWorkspace();
}

// Getting Started onboarding. The walkthrough auto-opens once per machine the
// first time the extension activates; this globalState key records that it has
// been shown. Clear it via the `gemstone.resetGettingStarted` command to make it
// auto-open again on the next startup.
const GETTING_STARTED_SEEN_KEY = 'gemstone.hasSeenGettingStarted';
const GETTING_STARTED_WALKTHROUGH_ID = 'gemtalksystems.gemstone-ide#gemstoneGettingStarted';

// Open the Getting Started walkthrough on the first activation after install.
// Keyed off activation (the extension declares onStartupFinished) rather than a
// specific view's visibility, so no sidebar-layout change — e.g. marking a view
// `"visibility": "collapsed"` — can silently disable onboarding. Gated by
// GETTING_STARTED_SEEN_KEY so it fires once per machine; the flag is set before
// opening so a re-entrant call can't double-open. Idempotent — safe to call on
// every activation.
export function maybeOpenGettingStarted(context: vscode.ExtensionContext): void {
  // The acceptance harness reveals the GemStone view every run from a throwaway
  // profile, so without this the first-run walkthrough pops over every test.
  if (process.env.GEMSTONE_SUPPRESS_WALKTHROUGH) return;
  if (context.globalState.get<boolean>(GETTING_STARTED_SEEN_KEY)) return;
  void context.globalState.update(GETTING_STARTED_SEEN_KEY, true);
  void vscode.commands.executeCommand(
    'workbench.action.openWalkthrough',
    GETTING_STARTED_WALKTHROUGH_ID,
    false,
  );
}

// How long a connect target stays reserved after a login attempt settles, so
// clicks queued behind a slow (blocking) login are dropped when they replay.
// Long enough to outlast the replay, short enough to be imperceptible on retry.
const LOGIN_GUARD_COOLDOWN_MS = 1000;

// Wrap a connect command handler so re-clicks for the same login target, while a
// connection attempt for it is in flight (or cooling down), are dropped instead
// of starting another login. See InFlightGuard. Exported for testing.
export function withLoginGuard(
  guard: InFlightGuard,
  handler: (item: GemStoneLoginItem) => Promise<void>,
): (item: GemStoneLoginItem) => Promise<void> {
  return async (item) => {
    await guard.run(loginTargetKey(item.login), () => handler(item));
  };
}

// Where a tracked Rowan repository is checked out: a folder named `name` in the
// open workspace, so the source is visible and editable in the Explorer.
// Returns undefined (and warns) when no folder is open.
//
// TODO: make the location configurable (workspace vs the extension's global
// storage vs tracking a folder in place). FOR NOW everything lands in the open
// workspace — git clones and copied-in local folders alike.
function rowanWorkspaceDest(name: string): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage(
      'Open a folder or workspace first — Rowan repositories live inside it.',
    );
    return undefined;
  }
  return path.join(folder.uri.fsPath, name);
}

// Live feedback for the "Rowan repository URL" input box: warn on input that
// isn't a git URL, and otherwise preview the normalized URL that will be cloned
// (so pasting a browser URL like `…/owner/repo/tree/main` visibly resolves to
// `…/owner/repo.git`).
function validateRowanGitUrl(value: string): vscode.InputBoxValidationMessage | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (!/^(https?:\/\/|git@|ssh:\/\/|git:\/\/|file:\/\/|\/|~|\.)/.test(v)) {
    return {
      message: 'Expected a git URL, e.g. https://github.com/owner/repo',
      severity: vscode.InputBoxValidationSeverity.Warning,
    };
  }
  const normalized = normalizeGitUrl(v);
  return normalized === v
    ? undefined
    : { message: `Will clone: ${normalized}`, severity: vscode.InputBoxValidationSeverity.Info };
}

// True when `p` is already inside one of the open workspace folders.
function isInsideWorkspace(p: string): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some(
    (f) => p === f.uri.fsPath || p.startsWith(f.uri.fsPath + path.sep),
  );
}

// Load a Rowan project from an on-disk directory: find its load spec (picking
// among several) and load it on the working session. Shared by the
// local-directory and git-clone load commands.
//
// It loads as the user who asked, because Rowan's registry is per-user:
// `System myUserProfile symbolList objectNamed: #'Rowan'` answers a different
// Rowan for SystemUser than for DataCurator. Loading over a privileged session
// therefore registers the project where the user's own session will never look
// for it — the project loads, commits, reports success, and is invisible in the
// view. No privilege is needed: the working user loads and commits this itself.
async function loadRowanFromDirectory(
  session: ActiveSession,
  dir: string,
  onLoaded: () => void,
): Promise<void> {
  const specs = findRowanLoadSpecs(dir);
  if (specs.length === 0) {
    vscode.window.showErrorMessage(`No Rowan load specification (.ston) found under ${dir}.`);
    return;
  }
  let spec = specs[0];
  if (specs.length > 1) {
    const picked = await vscode.window.showQuickPick(
      specs.map((s) => ({ label: s.name, description: path.relative(dir, s.path), spec: s })),
      { placeHolder: 'Which project spec to load?' },
    );
    if (!picked) return;
    spec = picked.spec;
  }

  // If the project declares it needs more gem temp-object cache than this stone
  // has, the load will overflow ("VM temporary object memory is full"). Warn
  // with the fix before spending minutes on a doomed load — but let the user
  // proceed, since the requirement is a conservative author estimate.
  if (spec.minTempObjCacheKB !== undefined) {
    let gemKB: number | undefined;
    try {
      gemKB = queries.getGemCacheKB(session);
    } catch {
      gemKB = undefined;
    }
    if (gemKB !== undefined && gemKB < spec.minTempObjCacheKB) {
      const needMB = Math.round(spec.minTempObjCacheKB / 1000);
      const haveMB = Math.round(gemKB / 1000);
      const choice = await vscode.window.showWarningMessage(
        `"${spec.name}" needs about ${needMB} MB of gem temp-object cache, but this stone's gems have ${haveMB} MB — the load will likely run out of memory.`,
        {
          modal: true,
          detail:
            `To fix: set GEM_TEMPOBJ_CACHE_SIZE = ${spec.minTempObjCacheKB}; in the stone's ` +
            `gem.conf and restart it (a Jasper-created stone does this automatically on its next start).`,
        },
        'Load Anyway',
      );
      if (choice !== 'Load Anyway') return;
    }
  }

  // Runs over the non-blocking execute: big projects load for minutes, and the
  // nb runner keeps the extension responsive and shows a cancellable progress
  // notification. Cancelling hard-breaks the gem, and the query aborts its own
  // transaction on error, so nothing partial is committed.
  let result;
  try {
    result = await queries.loadRowanProjectNb(session, spec.path, dir, `Loading ${spec.name}…`);
  } catch (e: unknown) {
    if (e instanceof NbCancelledError) {
      vscode.window.showInformationMessage(`Load of "${spec.name}" cancelled.`);
    } else {
      vscode.window.showErrorMessage(
        `Load of "${spec.name}" failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return;
  }

  if (!result.success) {
    vscode.window.showErrorMessage(`Load of "${spec.name}" failed: ${result.detail}`);
    return;
  }
  // Loaded and committed on this very session, so it is already visible — no
  // session to reconcile, and nothing for the user to be asked about.
  onLoaded();
  vscode.window.showInformationMessage(`Rowan project "${result.detail}" loaded.`);
}

// List a git remote's branches and tags (via `git ls-remote`), newest-looking
// first isn't attempted — Rowan just needs the ref name. Returns [] when the
// remote can't be reached (private without auth, offline, bad URL).
function listRemoteRefs(url: string): Promise<{ branches: string[]; tags: string[] }> {
  return new Promise((resolve) => {
    execFile('git', ['ls-remote', '--heads', '--tags', url], { timeout: 20_000 }, (err, stdout) => {
      if (err) {
        resolve({ branches: [], tags: [] });
        return;
      }
      const branches: string[] = [];
      const tags: string[] = [];
      for (const line of stdout.split('\n')) {
        // `<sha>\trefs/heads/<branch>` or `refs/tags/<tag>` (skip `^{}` peels).
        const m = /^[0-9a-f]+\s+refs\/(heads|tags)\/(.+?)(\^\{\})?$/.exec(line.trim());
        if (!m || m[3]) continue;
        (m[1] === 'heads' ? branches : tags).push(m[2]);
      }
      resolve({ branches, tags });
    });
  });
}

// Ask the user which revision of a git dependency to pin. Lists the remote's
// branches and tags to pick from; falls back to free text when it can't reach
// the remote. Returns undefined if the user cancels.
async function pickGitRevision(url: string): Promise<string | undefined> {
  const name = dependencyNameFromGitUrl(url);
  const { branches, tags } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Fetching refs for ${name}…` },
    () => listRemoteRefs(url),
  );
  if (branches.length === 0 && tags.length === 0) {
    return (
      await vscode.window.showInputBox({
        title: `Revision for ${name}`,
        prompt: `Couldn't list refs for ${url}. Enter a branch, tag, or commit`,
        ignoreFocusOut: true,
      })
    )?.trim();
  }
  // A branch moves, so pinning to one isn't really pinning. `git ls-remote`
  // only lists refs, never commits, so offer a way to name one: a project is
  // reproducible only when it records the exact commit it was built against.
  const ENTER_REVISION = 'Enter a commit or other revision…';
  const items: vscode.QuickPickItem[] = [
    { label: ENTER_REVISION, description: 'exact commit', alwaysShow: true },
  ];
  if (branches.length) items.push({ label: 'Branches', kind: vscode.QuickPickItemKind.Separator });
  for (const b of branches) items.push({ label: b, description: 'branch' });
  if (tags.length) items.push({ label: 'Tags', kind: vscode.QuickPickItemKind.Separator });
  for (const t of tags) items.push({ label: t, description: 'tag' });
  const picked = await vscode.window.showQuickPick(items, {
    title: `Revision for ${name}`,
    placeHolder: 'Pick a branch or tag, or name an exact commit',
  });
  if (!picked) return undefined;
  if (picked.label !== ENTER_REVISION) return picked.label;

  return (
    await vscode.window.showInputBox({
      title: `Revision for ${name}`,
      prompt: 'Enter a commit, branch, or tag',
      placeHolder: '88835be',
      ignoreFocusOut: true,
    })
  )?.trim();
}

export function activate(context: vscode.ExtensionContext) {
  // Create every output channel up front — not lazily on first use — so the
  // full set is discoverable in the Output view's channel dropdown from
  // activation. (The Class Sync channel is created just after ExportManager is
  // constructed; the LSP channel by client.start(); the Enhanced Inspector Perf
  // channel with the perf tracker.) See docs/output-channels.md.
  jasperChannel = vscode.window.createOutputChannel('Jasper');
  context.subscriptions.push(
    jasperChannel,
    getGciLog(),
    getTranscriptChannel(),
    getSysadminChannel(),
  );

  initializeBundledGci(context.extensionPath);

  // Reap any companion debugger source tab a prior session left open when its
  // window was closed with the Enhanced Debugger still up (it restores orphaned
  // and broken — no session to resolve gemstone://). See DebuggerPanel.
  DebuggerPanel.initSourceTabCleanup(context.workspaceState);

  // Inline-value overlay (#5): a source-pane CodeLens toggles it. The lens is
  // emitted only for source docs a live debugger is showing; the command it fires
  // carries that doc's URI so the right panel toggles.
  const inlineValuesLens = new InlineValuesCodeLensProvider();
  DebuggerPanel.setSourceCodeLensProvider(inlineValuesLens);
  context.subscriptions.push(
    vscode.commands.registerCommand('gemstone.toggleInlineValues', (uri?: unknown) =>
      DebuggerPanel.toggleInlineValuesForUri(typeof uri === 'string' ? uri : undefined),
    ),
    vscode.commands.registerCommand('gemstone.toggleInlineValuesPerLine', (uri?: unknown) =>
      DebuggerPanel.toggleInlineValuesPerLineForUri(typeof uri === 'string' ? uri : undefined),
    ),
    vscode.languages.registerCodeLensProvider(
      [{ scheme: 'gemstone' }, { scheme: 'gemstone-debug' }],
      inlineValuesLens,
    ),
    // The inline-value hover (#5): serves each variable's full printString for a
    // hovered line, plus a hint that editable ones are set by clicking the name.
    vscode.languages.registerHoverProvider([{ scheme: 'gemstone' }, { scheme: 'gemstone-debug' }], {
      provideHover(doc, pos) {
        const md = DebuggerPanel.provideInlineHover(doc.uri.toString(), pos.line);
        return md ? new vscode.Hover(md) : undefined;
      },
    }),
  );

  try {
    initializeExtensionFolder();
  } catch (error) {
    void logJasperError(
      `Jasper could not set up its local folder. Please check folder permissions and reload VS Code.`,
      'initialization',
      error,
    );
    throw error;
  }

  // Populated by the async cert-generation step below; read by the
  // `jasper.openMcpInspector` command so Node trusts our self-signed cert
  // (macOS keychain trust doesn't extend to Node's TLS stack).
  let certPathForTrust: string | undefined;

  // ── LSP Client ───────────────────────────────────────────
  const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'gemstone-topaz' },
      { scheme: 'file', language: 'gemstone-tonel' },
      { scheme: 'gemstone', language: 'gemstone-smalltalk' },
    ],
    synchronize: {
      configurationSection: 'gemstoneSmalltalk',
    },
  };

  client = new LanguageClient(
    'gemstone-smalltalk',
    'GemStone Smalltalk Language Server',
    serverOptions,
    clientOptions,
  );

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
  client.start();

  // ── Login Management ─────────────────────────────────────
  const storage = new LoginStorage();
  const sysadminStorage = new SysadminStorage();
  // SessionManager is created early so the Logins panel can mark the connected
  // login row (and swap its inline Login action for Logout) in single-session mode.
  sessionManager = new SessionManager();

  // De-duplicates connect clicks: the blocking GciTsLogin freezes the extension
  // host while it runs, so extra clicks during a slow login queue up and replay
  // once it returns. The cooldown keeps the target reserved briefly past the
  // call's return so those late replays are dropped too. See InFlightGuard.
  const loginGuard = new InFlightGuard(LOGIN_GUARD_COOLDOWN_MS);

  // Sessions don't survive a window reload, so any gemstone:// method/class tab
  // VS Code restored from the previous window is unservable and shows a broken
  // "could not be opened" editor. Reap such stale tabs — both those already
  // present and (winning the async-restore race) those that appear afterward.
  // Must run after sessionManager exists (the reaper checks for a live session).
  context.subscriptions.push(installStaleGemstoneTabReaper(sessionManager));

  const treeProvider = new LoginTreeProvider(storage, sessionManager);

  const treeView = vscode.window.createTreeView('gemstoneLogins', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  // Auto-open the Getting Started walkthrough on the first activation after
  // install (see maybeOpenGettingStarted). Fires once per machine; reset via the
  // gemstone.resetGettingStarted command.
  maybeOpenGettingStarted(context);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gemstone.logins')) {
        treeProvider.refresh();
      }
      if (e.affectsConfiguration('gemstone.maxEnvironment')) {
        // maxEnvironment changes are picked up on next browser refresh
      }
      if (e.affectsConfiguration('gemstone.sessionMode')) {
        applySessionModeContext();
      }
    }),
  );

  // Drive the `gemstone.multipleSessions` context key (used to show/hide the
  // Sessions panel) from the gemstone.sessionMode preference.
  const applySessionModeContext = () => {
    const mode = vscode.workspace.getConfiguration('gemstone').get<string>('sessionMode', 'single');
    vscode.commands.executeCommand('setContext', 'gemstone.multipleSessions', mode === 'multiple');
  };
  applySessionModeContext();

  // A login may not be edited or deleted while it has a live session, which also
  // guarantees every active session keeps a matching login row to nest under.
  const loginHasActiveSession = (login: GemStoneLogin): boolean =>
    sessionManager.getSessions().some((s) => sameLoginTarget(s.login, login));

  // ── Session Management ───────────────────────────────────
  // Active sessions are shown as children of their login in the Logins &
  // Sessions tree (treeProvider above); there is no separate Sessions view.
  exportManager = new ExportManager();
  // Create the Class Sync channel now so it joins the others in the dropdown.
  const classSyncChannel = exportManager.ensureLogChannel();
  if (classSyncChannel) context.subscriptions.push(classSyncChannel);
  SystemBrowser.setExportManager(exportManager);
  fileInManager = new FileInManager(sessionManager, exportManager);
  fileInManager.register(context);

  // ── Object Inspector ──────────────────────────────────────
  const inspectorProvider = new InspectorTreeProvider(sessionManager);
  // The debugger's "Inspect" falls back to this tree view when the session has
  // no enhanced inspector; give the panel a handle to it (it isn't constructed
  // with one — its factory is called from deep in codeExecutor).
  DebuggerPanel.inspectorProvider = inspectorProvider;

  const inspectorView = vscode.window.createTreeView('gemstoneInspector', {
    treeDataProvider: inspectorProvider,
    showCollapseAll: true,
  });
  inspectorProvider.setView(inspectorView);
  context.subscriptions.push(inspectorView, inspectorProvider);

  // ── GemStone Explorer (cascading navigation panes) ───────────
  // The selector-at-position resolver lets the editor-triggered Rename Method
  // target a SENT selector under the cursor (LSP AST-based, so multi-part keyword
  // selectors resolve whole). Reads `client` lazily — it is created above but
  // starts asynchronously; until it answers, the rename falls back to the edited
  // method.
  const explorer = registerGemStoneExplorer(context, sessionManager, async (document, position) => {
    // Distinguish "no selector at this position" (LSP answers null → rename the
    // edited method) from "lookup unavailable" (throw → the command aborts rather
    // than guess): a not-yet-started client or a request failure THROWS; only a
    // live "no selector here" answers null.
    if (!client) throw new Error('language server not started');
    return client.sendRequest<string | null>('gemstone/selectorAtPosition', {
      textDocument: { uri: document.uri.toString() },
      position,
    });
  });

  // ── GemStone FileSystem Provider ─────────────────────────
  const gemstoneFs = new GemStoneFileSystemProvider(sessionManager, exportManager);
  context.subscriptions.push(
    gemstoneFs,
    vscode.workspace.registerFileSystemProvider('gemstone', gemstoneFs, {
      isCaseSensitive: true,
    }),
  );

  // ── Workspace Symbol Provider (Cmd+T class search) ──────
  const symbolProvider = new GemStoneWorkspaceSymbolProvider(sessionManager);
  context.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(symbolProvider));

  // Set language mode for gemstone:// documents
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme !== 'gemstone') return;
      // A class comment is prose, not code: give it its own language so it word-
      // wraps (see configurationDefaults) and isn't syntax-highlighted as Smalltalk.
      // Everything else gemstone:// is source.
      let isComment = false;
      try {
        isComment = parseUri(doc.uri).kind === 'comment';
      } catch {
        /* unrecognized URI — treat as source */
      }
      vscode.languages.setTextDocumentLanguage(
        doc,
        isComment ? 'gemstone-class-comment' : 'gemstone-smalltalk',
      );
    }),
  );

  // Lock editors for read-only .gs files (e.g. Globals for non-SystemUser)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;
      const { uri } = editor.document;
      if (uri.scheme !== 'file' || !uri.fsPath.endsWith('.gs')) return;
      try {
        const stat = fs.statSync(uri.fsPath);
        if ((stat.mode & 0o200) === 0) {
          vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
        }
      } catch {
        /* ignore */
      }
    }),
  );

  // ── GCI-backed providers (Definition + Hover + Completion) ─
  const providerSelectors: vscode.DocumentFilter[] = [
    { scheme: 'gemstone', language: 'gemstone-smalltalk' },
    { scheme: 'untitled', language: 'gemstone-smalltalk' },
    { scheme: 'file', language: 'gemstone-smalltalk' },
    { scheme: 'file', language: 'gemstone-topaz' },
    { scheme: 'file', language: 'gemstone-tonel' },
  ];
  const selectorResolver = {
    getSelector: (uri: string, position: vscode.Position) =>
      client.sendRequest<string | null>('gemstone/selectorAtPosition', {
        textDocument: { uri },
        position,
      }),
  };
  const definitionProvider = new GemStoneDefinitionProvider(sessionManager, selectorResolver);
  const hoverProvider = new GemStoneHoverProvider(sessionManager, selectorResolver);
  const completionProvider = new GemStoneCompletionProvider(sessionManager);
  const codeLensProvider = new GemStoneCodeLensProvider(sessionManager);
  // The senders/implementors CodeLens must attach on a gemstone:// method the
  // instant it opens. A gemstone doc's language is assigned asynchronously
  // (onDidOpenTextDocument → setTextDocumentLanguage), so gating the lens on
  // `language: gemstone-smalltalk` (as providerSelectors does) delays it past the
  // first paint on a document's first open — the lens then pops in and shoves the
  // code down. Match on scheme alone so it's present from the first render;
  // provideCodeLenses returns nothing for non-method gemstone docs anyway.
  const codeLensSelectors: vscode.DocumentFilter[] = [
    { scheme: 'gemstone' },
    { scheme: 'untitled', language: 'gemstone-smalltalk' },
    { scheme: 'file', language: 'gemstone-smalltalk' },
    { scheme: 'file', language: 'gemstone-topaz' },
    { scheme: 'file', language: 'gemstone-tonel' },
  ];
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(providerSelectors, definitionProvider),
    vscode.languages.registerHoverProvider(providerSelectors, hoverProvider),
    vscode.languages.registerCompletionItemProvider(providerSelectors, completionProvider),
    vscode.languages.registerCodeLensProvider(codeLensSelectors, codeLensProvider),
    codeLensProvider, // dispose() cancels pending count lookups + releases the emitter
    // Hosts "Rename Temporary/Argument…" under the native "Refactor…" menu in a
    // saved (scheme:gemstone) method editor.
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'gemstone', language: 'gemstone-smalltalk' },
      new RefactorCodeActionProvider(
        () => sessionManager.getSelectedSession()?.rbSupportAvailable === true,
      ),
      { providedCodeActionKinds: RefactorCodeActionProvider.providedCodeActionKinds },
    ),
  );

  // ── Breakpoints + Debugger ───────────────────────────────
  const breakpointManager = new BreakpointManager(sessionManager);
  breakpointManager.register(context);

  const selectorBreakpointManager = new SelectorBreakpointManager(sessionManager);
  selectorBreakpointManager.register(context);

  // Re-apply breakpoints and refresh browser method list after method recompilation
  context.subscriptions.push(
    gemstoneFs.onDidChangeFile((events) => {
      for (const event of events) {
        if (event.type === vscode.FileChangeType.Changed) {
          breakpointManager.invalidateForUri(event.uri);
          selectorBreakpointManager.invalidateForUri(event.uri);

          const uri = event.uri;
          if (uri.scheme === 'gemstone') {
            const parts = uri.path.split('/').map(decodeURIComponent);
            // parts: ['', dictName, className, side, category, selector]
            if (parts.length >= 3) {
              const sessionId = parseInt(uri.authority, 10);
              const className = parts[2];
              SystemBrowser.methodCompiled(sessionId, className);
              // Keep the GemStone Explorer's method list in sync too (new-class URIs
              // carry no real class name, so skip those — the class-definition
              // event below handles class creation).
              if (className !== 'new-class') {
                explorer.onMethodCompiled(sessionId, className);
              }
            }
          }
        }
      }
    }),
  );

  context.subscriptions.push(
    gemstoneFs.onMethodCompiled(handleMethodCompiled),
    gemstoneFs.onClassDefinitionCompiled(handleClassDefinitionCompiled),
    // Refresh the GemStone Explorer's class list when a class is created/redefined
    // (the definition event carries the real class name; the new-class URI
    // doesn't). parts: ['', dictName, className, 'definition'].
    gemstoneFs.onClassDefinitionCompiled((e) => {
      const parts = e.uri.path.split('/').map(decodeURIComponent);
      if (parts.length >= 3) {
        // parts: ['', dictName, className, 'definition'] — pass the dictName so the
        // explorer can jump to the dictionary the class was actually created in
        // (which may differ from the selected one for a new-class inDictionary:).
        explorer.onClassCompiled(parseInt(e.uri.authority, 10), parts[2], parts[1]);
      }
    }),
  );

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('gemstone', {
      createDebugAdapterDescriptor() {
        return new vscode.DebugAdapterInlineImplementation(
          new GemStoneDebugSession(sessionManager, breakpointManager),
        );
      },
    }),
    vscode.debug.registerDebugConfigurationProvider('gemstone', {
      resolveDebugConfiguration(_folder, config) {
        if (!config.type) config.type = 'gemstone';
        if (!config.request) config.request = 'attach';
        if (!config.name) config.name = 'GemStone Debug';
        return config;
      },
    }),
  );

  // ── SUnit Test Controller ────────────────────────────────
  const sunitTestController = new SunitTestController(sessionManager);
  context.subscriptions.push(sunitTestController);

  // ── Jupyter Notebook Kernels (Grail Python + Smalltalk) ─
  const grailNotebookController = new GrailNotebookController(sessionManager);
  context.subscriptions.push(grailNotebookController);
  const smalltalkNotebookController = new SmalltalkNotebookController(sessionManager);
  context.subscriptions.push(smalltalkNotebookController);

  // ── Code Execution ─────────────────────────────────────
  const codeExecutor = new CodeExecutor(sessionManager);
  context.subscriptions.push(codeExecutor);

  // ── Status Bar: Active Session ─────────────────────────
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'gemstone.selectSession';
  context.subscriptions.push(statusBarItem);

  const browserBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  browserBarItem.text = '$(book)';
  browserBarItem.tooltip = 'Open System Browser';
  browserBarItem.command = 'gemstone.openBrowser';
  context.subscriptions.push(browserBarItem);

  function updateStatusBar() {
    const session = sessionManager.getSelectedSession();
    if (session) {
      statusBarItem.text = `$(database) ${loginLabel(session.login)}`;
      statusBarItem.tooltip = 'GemStone: click to change session';
      statusBarItem.show();
      browserBarItem.show();
    } else if (sessionManager.getSessions().length > 0) {
      statusBarItem.text = '$(database) No session selected';
      statusBarItem.tooltip = 'Click to select a GemStone session';
      statusBarItem.show();
      browserBarItem.hide();
    } else {
      statusBarItem.hide();
      browserBarItem.hide();
    }
  }

  context.subscriptions.push(sessionManager.onDidChangeSelection(() => updateStatusBar()));
  updateStatusBar();

  // Drive the `gemstone.enhancedInspectorSupported` context key off the selected
  // session's version, so the "Install Enhanced Inspector Support" command is
  // only offered where it can actually work (see package.json commandPalette
  // when-clause). Recomputed on every selection change.
  function updateEnhancedInspectorSupportedContext(): void {
    const selected = sessionManager.getSelectedSession();
    vscode.commands.executeCommand(
      'setContext',
      'gemstone.enhancedInspectorSupported',
      !!selected && supportsEnhancedInspector(selected.stoneVersion),
    );
  }
  context.subscriptions.push(
    sessionManager.onDidChangeSelection(() => updateEnhancedInspectorSupportedContext()),
  );
  updateEnhancedInspectorSupportedContext();

  // Drive the `gemstone.rbSupportAvailable` context key off the selected
  // session's latched refactoring-engine probe, so refactoring commands (e.g.
  // the Explorer's rename-instance-variable pencil) can gate on it. Recomputed
  // on selection change and refreshed after login (and any future engine
  // install). Unlike the Enhanced Inspector, this is not version-gated.
  function updateRefactoringSupportContext(): void {
    const selected = sessionManager.getSelectedSession();
    vscode.commands.executeCommand(
      'setContext',
      'gemstone.rbSupportAvailable',
      !!selected && selected.rbSupportAvailable === true,
    );
    // Drives the "Uninstall Server Support" menu visibility: it appears only when
    // at least one optional support (either feature) is actually installed on the
    // selected stone. The install/uninstall commands refresh this via
    // `optionalSupportOffer` after they change the latches.
    vscode.commands.executeCommand(
      'setContext',
      'gemstone.serverSupportInstalled',
      !!selected &&
        (selected.rbSupportAvailable === true || selected.enhancedInspectorAvailable === true),
    );
  }
  context.subscriptions.push(
    sessionManager.onDidChangeSelection(() => updateRefactoringSupportContext()),
  );
  updateRefactoringSupportContext();

  // ── Enhanced Inspector Perf Tracking ───────────────────────────────────
  const enhancedInspectorPerfChannel = vscode.window.createOutputChannel(
    'GemStone Enhanced Inspector Perf',
  );
  context.subscriptions.push(enhancedInspectorPerfChannel);

  const enhancedInspectorPerfCountItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    98,
  );
  enhancedInspectorPerfCountItem.tooltip = 'Enhanced Inspector Perf: click to see breakdown';
  enhancedInspectorPerfCountItem.command = 'gemstone.showEnhancedInspectorPerfDetails';
  context.subscriptions.push(enhancedInspectorPerfCountItem);

  const enhancedInspectorPerfResetItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    97,
  );
  enhancedInspectorPerfResetItem.text = '$(debug-restart)';
  enhancedInspectorPerfResetItem.tooltip = 'Reset Enhanced Inspector Perf Counter';
  enhancedInspectorPerfResetItem.command = 'gemstone.resetEnhancedInspectorPerfCounter';
  context.subscriptions.push(enhancedInspectorPerfResetItem);

  function updateEnhancedInspectorPerfStatusBar() {
    if (enhancedInspectorPerfTracker.enabled) {
      enhancedInspectorPerfCountItem.text = buildEnhancedInspectorPerfStatusBarText(
        enhancedInspectorPerfTracker.count,
      );
      enhancedInspectorPerfCountItem.show();
      enhancedInspectorPerfResetItem.show();
    } else {
      enhancedInspectorPerfCountItem.hide();
      enhancedInspectorPerfResetItem.hide();
    }
  }

  enhancedInspectorPerfTracker.onCountChanged = updateEnhancedInspectorPerfStatusBar;

  const applyEnhancedInspectorPerfSetting = () => {
    const enabled = vscode.workspace
      .getConfiguration('gemstone')
      .get<boolean>('enhancedInspectorPerfTracking', false);
    enhancedInspectorPerfTracker.setEnabled(enabled);
    vscode.commands.executeCommand('setContext', 'gemstone.enhancedInspectorPerfTracking', enabled);
    updateEnhancedInspectorPerfStatusBar();
  };
  applyEnhancedInspectorPerfSetting();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gemstone.enhancedInspectorPerfTracking')) {
        applyEnhancedInspectorPerfSetting();
      }
    }),
    vscode.commands.registerCommand('gemstone.enableEnhancedInspectorPerfTracking', async () => {
      await vscode.workspace
        .getConfiguration('gemstone')
        .update('enhancedInspectorPerfTracking', true, vscode.ConfigurationTarget.Workspace);
    }),
    vscode.commands.registerCommand('gemstone.disableEnhancedInspectorPerfTracking', async () => {
      await vscode.workspace
        .getConfiguration('gemstone')
        .update('enhancedInspectorPerfTracking', false, vscode.ConfigurationTarget.Workspace);
    }),
    vscode.commands.registerCommand('gemstone.resetEnhancedInspectorPerfCounter', () => {
      const sorted = [...enhancedInspectorPerfTracker.methodCounts.entries()].sort(
        (a, b) => b[1] - a[1],
      );
      enhancedInspectorPerfChannel.appendLine(
        `[reset] ${enhancedInspectorPerfTracker.count} total GCI calls`,
      );
      for (const [method, count] of sorted) {
        enhancedInspectorPerfChannel.appendLine(`  ${method}: ${count}`);
      }
      enhancedInspectorPerfTracker.reset();
    }),
    vscode.commands.registerCommand('gemstone.showEnhancedInspectorPerfDetails', async () => {
      const clipboardText = buildEnhancedInspectorPerfClipboardText(enhancedInspectorPerfTracker);
      const items: vscode.QuickPickItem[] = buildEnhancedInspectorPerfQuickPickItems(
        enhancedInspectorPerfTracker,
      ).map((item) =>
        item.isSeparator
          ? { label: '', kind: vscode.QuickPickItemKind.Separator }
          : { label: item.label, description: item.description },
      );
      const selected = await vscode.window.showQuickPick(items, {
        title: `Enhanced Inspector Perf: ${enhancedInspectorPerfTracker.count} total GCI calls`,
        placeHolder: 'Choose an action, or press Escape to dismiss',
      });
      if (selected?.label === RESET_LABEL) {
        vscode.commands.executeCommand('gemstone.resetEnhancedInspectorPerfCounter');
      } else if (selected?.label === COPY_LABEL) {
        await vscode.env.clipboard.writeText(clipboardText);
        vscode.window.showInformationMessage(
          'Enhanced Inspector Perf breakdown copied to clipboard.',
        );
      }
    }),
  );

  // ── Shared Helpers ─────────────────────────────────────

  async function resolveSelector(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      if (!editor.selection.isEmpty) {
        return editor.document.getText(editor.selection).trim();
      }
      // Ask LSP for selector at cursor position
      if (client) {
        try {
          const selector = await client.sendRequest<string | null>('gemstone/selectorAtPosition', {
            textDocument: { uri: editor.document.uri.toString() },
            position: editor.selection.active,
          });
          if (selector) return selector;
        } catch {
          // LSP not ready or request not supported
        }
      }
    }

    return vscode.window.showInputBox({
      prompt: 'Enter selector',
      placeHolder: 'e.g. at:put:',
    });
  }

  async function showMethodResults(
    session: { id: number },
    results: queries.MethodSearchResult[],
    title: string,
  ): Promise<void> {
    if (results.length === 0) {
      vscode.window.showInformationMessage(`${title}: no results found.`);
      return;
    }

    const items = results.map((r) => ({
      label: `${r.className}${r.isMeta ? ' class' : ''} >> #${r.selector}`,
      description: r.category,
      detail: r.dictName,
      result: r,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `${results.length} method${results.length === 1 ? '' : 's'} found`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) return;

    const r = picked.result;
    // If a System Browser is open for this session, navigate it to the selected
    // method (updates all 5 columns) and open the method editor from there.
    // Otherwise fall back to opening the document directly.
    if (!SystemBrowser.navigateTo(session.id, r)) {
      const uri = buildMethodUri({ kind: 'method', sessionId: session.id, ...r, environmentId: 0 });
      vscode.commands.executeCommand('gemstone.openDocument', uri);
    }
  }

  // Commit / Abort a session, with the same confirmations and post-action
  // refreshes whether invoked from the Sessions tree (a session item) or the
  // GemStone Explorer toolbar (the currently selected session).
  const commitSession = async (session: ActiveSession): Promise<void> => {
    if (fileInManager.hasUnsavedChanges(session)) {
      const choice = await vscode.window.showWarningMessage(
        'Exported .gs files have unsaved edits that will be overwritten.',
        { modal: true },
        'Commit Anyway',
      );
      if (choice !== 'Commit Anyway') return;
    }
    try {
      const { success, err } = sessionManager.commit(session.id);
      if (success) {
        vscode.window.showInformationMessage(`Session ${session.id}: Commit succeeded.`);
        await exportManager.refreshSession(session);
        SystemBrowser.refresh(session.id);
      } else {
        vscode.window.showErrorMessage(
          `Session ${session.id}: Commit failed — ${err.message || `error ${err.number}`}`,
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Commit failed: ${msg}`);
    }
  };

  const abortSession = async (session: ActiveSession): Promise<void> => {
    const message = abortConfirmMessage(
      queries.sessionNeedsCommit(session),
      fileInManager.hasUnsavedChanges(session),
    );
    if (message) {
      const choice = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        'Abort Anyway',
      );
      if (choice !== 'Abort Anyway') return;
    }
    try {
      const { success, err } = sessionManager.abort(session.id);
      if (success) {
        vscode.window.showInformationMessage(`Session ${session.id}: Abort succeeded.`);
        await exportManager.refreshSession(session);
        SystemBrowser.refresh(session.id);
        explorer.onSessionAborted(session.id);
      } else {
        vscode.window.showErrorMessage(
          `Session ${session.id}: Abort failed — ${err.message || `error ${err.number}`}`,
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Abort failed: ${msg}`);
    }
  };

  // ── Commands ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('gemstone.openDocument', async (uri: vscode.Uri) => {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true });
    }),

    vscode.commands.registerCommand('gemstone.addLogin', () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      LoginEditorPanel.show(storage, context.secrets, treeProvider, undefined, sysadminStorage);
    }),

    vscode.commands.registerCommand('gemstone.editLogin', (item: GemStoneLoginItem) => {
      // A connected login opens read-only so its config can still be viewed;
      // the settings are only consumed at login, so editing a live one is
      // disabled (log out first) to avoid disturbing the session's tree row.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      LoginEditorPanel.show(
        storage,
        context.secrets,
        treeProvider,
        item.login,
        sysadminStorage,
        loginHasActiveSession(item.login),
      );
    }),

    vscode.commands.registerCommand('gemstone.deleteLogin', async (item: GemStoneLoginItem) => {
      if (loginHasActiveSession(item.login)) {
        vscode.window.showWarningMessage(
          `"${loginLabel(item.login)}" has an active session. Log out before deleting it.`,
        );
        return;
      }
      const confirmed = await vscode.window.showWarningMessage(
        `Delete login "${loginLabel(item.login)}"?`,
        { modal: true },
        'Delete',
      );
      if (confirmed === 'Delete') {
        if (item.login.password_in_keychain) {
          await deleteLoginPassword(context.secrets, item.login);
        }
        await storage.deleteLogin(loginLabel(item.login));
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('gemstone.duplicateLogin', (item: GemStoneLoginItem) => {
      const copy = { ...item.login, label: '' };
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      LoginEditorPanel.show(storage, context.secrets, treeProvider, copy, sysadminStorage);
    }),

    vscode.commands.registerCommand('gemstone.openWalkthrough', () => {
      void vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        GETTING_STARTED_WALKTHROUGH_ID,
        false,
      );
    }),

    vscode.commands.registerCommand('gemstone.openWorkspace', async () => {
      await openWorkspace();
    }),

    vscode.commands.registerCommand('gemstone.openTutorial', async () => {
      await openTutorialNotebook();
    }),

    vscode.commands.registerCommand('gemstone.installServerSupport', async () => {
      await runInstallServerSupport(sessionManager, context.extensionPath);
    }),

    vscode.commands.registerCommand('gemstone.uninstallServerSupport', async () => {
      await runUninstallServerSupport(sessionManager);
    }),

    vscode.commands.registerCommand('gemstone.renameTemporary', async (position?: unknown) => {
      await renameTemporaryCommand(
        sessionManager,
        position instanceof vscode.Position ? position : undefined,
      );
    }),

    // Convert the temporary at the cursor into an instance variable (V5).
    vscode.commands.registerCommand('gemstone.convertTempToInstVar', async (position?: unknown) => {
      await convertTempToInstVarCommand(
        sessionManager,
        position instanceof vscode.Position ? position : undefined,
      );
    }),

    vscode.commands.registerCommand('gemstone.explorer.extractMethod', async () => {
      await extractMethodCommand(sessionManager);
    }),

    vscode.commands.registerCommand(
      'gemstone.explorer.inlineMethod',
      async (position?: unknown) => {
        await inlineMethodCommand(
          sessionManager,
          position instanceof vscode.Position ? position : undefined,
        );
      },
    ),

    vscode.commands.registerCommand('gemstone.explorer.extractTemporary', async () => {
      await extractTemporaryCommand(sessionManager);
    }),

    vscode.commands.registerCommand(
      'gemstone.explorer.inlineTemporary',
      async (position?: unknown) => {
        await inlineTemporaryCommand(
          sessionManager,
          position instanceof vscode.Position ? position : undefined,
        );
      },
    ),

    vscode.commands.registerCommand('gemstone.resetGettingStarted', async () => {
      await context.globalState.update(GETTING_STARTED_SEEN_KEY, undefined);
      const openNow = 'Open Walkthrough Now';
      const choice = await vscode.window.showInformationMessage(
        'Getting Started reset — the walkthrough will open automatically the next time VS Code starts.',
        openNow,
      );
      if (choice === openNow) {
        void vscode.commands.executeCommand(
          'workbench.action.openWalkthrough',
          GETTING_STARTED_WALKTHROUGH_ID,
          false,
        );
      }
    }),

    vscode.commands.registerCommand(
      'gemstone.login',
      withLoginGuard(loginGuard, async (item: GemStoneLoginItem) => {
        if (!vscode.workspace.workspaceFolders?.length) {
          vscode.window.showErrorMessage(
            'Please open a folder in the workspace before logging in to GemStone.',
          );
          return;
        }

        const login = { ...item.login };

        // If the login is configured to use the OS keychain, fetch the password
        // from there. Fall through to the prompt if the keychain entry is missing.
        if (login.password_in_keychain && !login.gs_password) {
          const stored = await getLoginPassword(context.secrets, login);
          if (stored) {
            login.gs_password = stored;
          }
        }

        if (!login.gs_password) {
          const password = await vscode.window.showInputBox({
            prompt: `GemStone password for ${login.gs_user || 'user'}@${login.gem_host || 'host'}`,
            password: true,
          });
          if (password === undefined) return;
          login.gs_password = password;
        }

        if (!login.host_password && login.host_user) {
          const password = await vscode.window.showInputBox({
            prompt: `Host password for ${login.host_user}@${login.gem_host || 'host'}`,
            password: true,
          });
          if (password === undefined) return;
          login.host_password = password;
        }

        // Ensure GCI library is configured for this version
        let gciPath = storage.getGciLibraryPath(login.version);

        // Prefer a GCI library bundled with the extension (for secure /
        // air-gapped installs that cannot download from gemtalksystems.com).
        // This must win over the download/file-picker prompts below.
        if (!gciPath && process.platform === 'win32') {
          const bundled = bundledWindowsClientGciPath(login.version);
          if (bundled) {
            if (bundledGciArchSupported()) {
              gciPath = bundled;
            } else {
              // The bundled DLLs are x64; an ARM64 VS Code process cannot load
              // them. Guide the user to the x64 build instead of letting the
              // native loader fail with a cryptic architecture-mismatch error.
              vscode.window.showErrorMessage(
                `The GemStone ${login.version} client library bundled with Jasper is x64, but VS Code is ` +
                  `running as ${process.arch}. Install and run the x64 build of VS Code (it runs under ` +
                  `emulation on Windows on ARM) to use the bundled library.`,
              );
              return;
            }
          }
        }

        // Auto-detect from extracted version's lib/ directory.
        // Skipped on Windows: the product dir is a Linux build (only .so), so
        // the GCI for a Windows host has to come from the Windows client below.
        if (!gciPath && process.platform !== 'win32') {
          const gsPath = sysadminStorage.getGemstonePath(login.version);
          if (gsPath) {
            const ext = process.platform === 'darwin' ? 'dylib' : 'so';
            const candidate = path.join(gsPath, 'lib', `libgcits-${login.version}-64.${ext}`);
            if (fs.existsSync(candidate)) {
              gciPath = candidate;
            }
          }
        }

        // Auto-detect from extracted Windows client distribution
        if (!gciPath && process.platform === 'win32') {
          const clientGci = sysadminStorage.getWindowsClientGciPath(login.version);
          if (clientGci) {
            gciPath = clientGci;
          }
        }

        // On Windows, offer to download the client distribution before falling
        // back to the manual file picker.
        if (!gciPath && process.platform === 'win32') {
          if (!login.version || !login.version.trim()) {
            vscode.window.showErrorMessage(
              'Cannot download a Windows client: the login has no GemStone version set. Edit the login to choose a version first.',
            );
            return;
          }
          const choice = await vscode.window.showInformationMessage(
            `Windows client library not found for GemStone ${login.version}. Download it?`,
            'Download',
            'Browse...',
          );
          if (choice === 'Download') {
            try {
              await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: `Installing Windows client ${login.version}...`,
                  cancellable: true,
                },
                (progress, token) =>
                  versionManager.downloadAndExtractWindowsClient(login.version, progress, token),
              );
              gciPath = sysadminStorage.getWindowsClientGciPath(login.version);
              if (gciPath) {
                await storage.setGciLibraryPath(login.version, gciPath);
              }
              // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
              versionProvider.loadVersions();
            } catch (e) {
              vscode.window.showErrorMessage(
                `Windows client install failed: ${e instanceof Error ? e.message : e}`,
              );
              return;
            }
          } else if (choice !== 'Browse...') {
            return; // cancelled
          }
        }

        if (!gciPath) {
          const filters: Record<string, string[]> =
            process.platform === 'win32'
              ? { 'DLL files': ['dll'] }
              : process.platform === 'darwin'
                ? { 'Dynamic libraries': ['dylib'] }
                : { 'Shared libraries': ['so'] };

          const ext =
            process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so';
          const expectedName = `libgcits-${login.version}-64.${ext}`;

          const result = await vscode.window.showOpenDialog({
            title: `Select GCI library (${expectedName}) for GemStone ${login.version}`,
            canSelectMany: false,
            filters,
          });
          if (!result || result.length === 0) return;
          gciPath = result[0].fsPath;

          const selectedName = gciPath.split(/[\\/]/).pop();
          const libPattern = /^libgcits-[\d.]+.*-64\.\w+$/;
          if (!libPattern.test(selectedName || '')) {
            const pick = await vscode.window.showWarningMessage(
              `Selected file "${selectedName}" does not match expected pattern "${expectedName}". Use it anyway?`,
              'Yes',
              'No',
            );
            if (pick !== 'Yes') return;
          }
          await storage.setGciLibraryPath(login.version, gciPath);
        }

        // The in-process GCI library reads GEMSTONE_GLOBAL_DIR to find the
        // NetLDI lock file (which encodes the port it is listening on).
        // Set both variables from sysadminStorage so the login can succeed
        // even though the VSCode/Electron process doesn't inherit them.
        process.env.GEMSTONE_GLOBAL_DIR = sysadminStorage.getRootPath();
        const gsInstallPath =
          sysadminStorage.getGemstonePath(login.version) ?? path.dirname(path.dirname(gciPath));
        process.env.GEMSTONE = gsInstallPath;

        let session;
        try {
          session = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Connecting to ${login.stone} on ${login.gem_host} as ${login.gs_user}…`,
              cancellable: false,
            },
            // loginAsync uses the non-blocking GciTsNbLogin path (yielding between
            // polls) so the notification animates and the window stays responsive
            // during a slow connect; it falls back to the blocking login on
            // Windows / older libraries.
            () => sessionManager.loginAsync(login, gciPath),
          );
          refreshEnhancedInspectorAvailable(session);
          refreshRefactoringSupportAvailable(session);
          updateRefactoringSupportContext();
          treeProvider.refresh();
          vscode.window.showInformationMessage(
            `Connected to ${login.stone} (${session.stoneVersion}) on ${login.gem_host} as ${login.gs_user}`,
          );
          // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
          exportManager.exportSession(session, true);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          vscode.window.showErrorMessage(`Login failed: ${msg}`);
          return;
        }
        // We no longer auto-open a workspace on every connect (it left a dirty,
        // hot-exit-restored buffer behind), nor the Getting Started walkthrough —
        // that now opens on the first activation after install (see
        // maybeOpenGettingStarted), so its "how to connect" step arrives before the
        // user connects rather than after. The workspace stays available via the
        // gemstone.openWorkspace command and the Logins & Sessions welcome view.

        // Offer the optional server-side supports this stone lacks (Enhanced
        // Inspector + refactoring engine) as one bundle, per
        // gemstone.serverSupport.autoInstall: `always` installs silently, `ask`
        // shows one Install/Always/Never modal, `never` does nothing.
        // Fire-and-forget; no-ops when the stone already has everything applicable.
        void maybeOfferServerSupport(session, sessionManager, context.extensionPath);
      }),
    ),

    vscode.commands.registerCommand('gemstone.serveSeaside', async () => {
      const session = sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showErrorMessage('Connect to a GemStone session before serving Seaside.');
        return;
      }
      const host = session.login.gem_host;
      if (host !== 'localhost' && host !== '127.0.0.1') {
        vscode.window.showErrorMessage(
          'Serve Seaside currently supports a local stone (the server runs where the stone does).',
        );
        return;
      }
      const version = session.login.version;
      const gciPath = storage.getGciLibraryPath(version);
      const gemstonePath =
        sysadminStorage.getGemstonePath(version) ??
        (gciPath ? path.dirname(path.dirname(gciPath)) : undefined);
      if (!gemstonePath) {
        vscode.window.showErrorMessage(
          `Could not locate the GemStone ${version} install for this session.`,
        );
        return;
      }
      const globalDir = sysadminStorage.getRootPath();
      try {
        const url = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Starting Seaside server…' },
          () => startSeasideServer({ session, gemstonePath, globalDir }),
        );
        // Prefer the integrated browser; fall back to the external one if this
        // editor build has no Simple Browser.
        try {
          await vscode.commands.executeCommand('simpleBrowser.show', url);
        } catch {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
        vscode.window.showInformationMessage(`Seaside is serving at ${url}`);
      } catch (e) {
        vscode.window.showErrorMessage(
          `Serve Seaside failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }),

    vscode.commands.registerCommand('gemstone.stopSeaside', async () => {
      if (stopSeasideServer(SEASIDE_DEFAULT_PORT)) {
        vscode.window.showInformationMessage(
          `Stopped the Seaside server on port ${SEASIDE_DEFAULT_PORT}.`,
        );
      } else {
        vscode.window.showInformationMessage(
          `No Seaside server is running on port ${SEASIDE_DEFAULT_PORT}.`,
        );
      }
    }),

    vscode.commands.registerCommand('gemstone.sessionCommit', (item: GemStoneSessionItem) =>
      commitSession(item.activeSession),
    ),

    vscode.commands.registerCommand('gemstone.sessionAbort', (item: GemStoneSessionItem) =>
      abortSession(item.activeSession),
    ),

    // Explorer toolbar variants: act on the currently selected session so Commit /
    // Abort are reachable without switching to the Sessions view.
    vscode.commands.registerCommand('gemstone.explorer.commit', () => {
      const session = sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showErrorMessage('No active GemStone session to commit.');
        return;
      }
      return commitSession(session);
    }),

    vscode.commands.registerCommand('gemstone.explorer.abort', () => {
      const session = sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showErrorMessage('No active GemStone session to abort.');
        return;
      }
      return abortSession(session);
    }),

    vscode.commands.registerCommand('gemstone.openBrowser', async (item?: GemStoneSessionItem) => {
      const session = item ? item.activeSession : await sessionManager.resolveSession();
      if (!session) return;
      SystemBrowser.show(session, exportManager);
    }),

    vscode.commands.registerCommand('gemstone.sessionOpenWorkspace', (item?: GemStoneSessionItem) =>
      openWorkspaceForSession(sessionManager, item),
    ),

    vscode.commands.registerCommand('gemstone.rowanFindClassPackage', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const editor = vscode.window.activeTextEditor;
      const selected =
        editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection).trim() : '';
      const className =
        selected ||
        (await vscode.window.showInputBox({
          prompt: 'Class name to locate in Rowan',
          placeHolder: 'e.g. STONReader',
        }));
      if (!className) return;

      const owners = queries.findRowanClassOwners(session, className);
      const parts = [
        ...owners.defined.map((o) => `defined in ${o.project} / ${o.package}`),
        ...owners.extended.map((o) => `extended by ${o.project} / ${o.package}`),
      ];
      if (parts.length === 0) {
        vscode.window.showInformationMessage(`"${className}" is not in any loaded Rowan package.`);
      } else {
        vscode.window.showInformationMessage(`${className}: ${parts.join('; ')}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.searchRowanClasses', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      let classes: queries.RowanClassLocation[];
      try {
        classes = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Loading Rowan classes…',
            cancellable: false,
          },
          () => Promise.resolve(queries.listAllRowanClasses(session)),
        );
      } catch (e: unknown) {
        vscode.window.showErrorMessage(
          `Failed to load Rowan classes: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
      if (classes.length === 0) {
        vscode.window.showInformationMessage('No Rowan classes found (is Rowan installed?).');
        return;
      }

      const picked = await vscode.window.showQuickPick(
        classes.map((c) => ({ label: c.name, description: `${c.project} / ${c.package}`, cls: c })),
        { placeHolder: 'Search Rowan classes…', matchOnDescription: true },
      );
      if (!picked) return;

      // Reveal the class's source in the System Browser (opens one if needed).
      SystemBrowser.navigateBeside(session, {
        dictName: picked.cls.symbolDict,
        className: picked.cls.name,
        isMeta: false,
        selector: '',
        category: '',
      });
    }),

    vscode.commands.registerCommand('gemstone.loadRowanProject', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const folder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Load Project',
        title: 'Select a Rowan project directory to load',
      });
      if (!folder || folder.length === 0) return;

      await loadRowanFromDirectory(session, folder[0].fsPath, () => {
        rowanProvider.refresh();
        refreshRowanProjectView();
      });
      void vscode.commands.executeCommand('gemstone.rowanRefreshView');
    }),

    vscode.commands.registerCommand('gemstone.loadRowanProjectFromGit', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const raw = (
        await vscode.window.showInputBox({
          prompt: 'Git repository URL of the Rowan project',
          placeHolder: 'https://github.com/owner/repo.git',
          ignoreFocusOut: true,
          validateInput: validateRowanGitUrl,
        })
      )?.trim();
      if (!raw) return;
      const url = normalizeGitUrl(raw);

      // Clone into the open workspace folder.
      const dest = rowanWorkspaceDest(deriveRepoName(url));
      if (!dest) return;
      if (!fs.existsSync(dest)) {
        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Cloning ${url}…`,
              cancellable: false,
            },
            () => cloneGitRepo(url, dest),
          );
        } catch (e: unknown) {
          vscode.window.showErrorMessage(
            `git clone failed: ${e instanceof Error ? e.message : String(e)}`,
          );
          return;
        }
      }

      await loadRowanFromDirectory(session, dest, () => {
        rowanProvider.refresh();
        refreshRowanProjectView();
      });
      void vscode.commands.executeCommand('gemstone.rowanRefreshView');
    }),

    vscode.commands.registerCommand(
      'gemstone.unloadRowanProject',
      async (nameArg?: string | RowanLoadedProjectItem) => {
        const session = await sessionManager.resolveSession();
        if (!session) return;

        // Invoked from the palette (no arg → pick), programmatically (string), or
        // the Rowan view's context menu (tree item).
        let projectName = typeof nameArg === 'string' ? nameArg : nameArg?.project.name;
        if (!projectName) {
          const projects = queries.listRowanProjects(session).projects;
          projectName = await vscode.window.showQuickPick(
            projects.map((p) => p.name),
            { placeHolder: 'Unload which Rowan project?' },
          );
        }
        if (!projectName) return;

        const confirm = await vscode.window.showWarningMessage(
          `Unload Rowan project "${projectName}"?`,
          {
            modal: true,
            detail:
              'This removes its classes and methods from the image. The on-disk source is left untouched.',
          },
          'Unload',
        );
        if (confirm !== 'Unload') return;

        // Unloads as the user who asked, for the same reason loading does:
        // Rowan's registry is per-user, so a privileged session would be
        // unloading from a registry this project was never in.
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Unloading ${projectName}…`,
            cancellable: false,
          },
          () => Promise.resolve(queries.unloadRowanProject(session, projectName)),
        );

        if (!result.success) {
          vscode.window.showErrorMessage(`Unload of "${projectName}" failed: ${result.detail}`);
          return;
        }
        vscode.window.showInformationMessage(`Rowan project "${projectName}" unloaded.`);
        void vscode.commands.executeCommand('gemstone.rowanRefreshView');
      },
    ),

    vscode.commands.registerCommand(
      'gemstone.sessionLogout',
      async (item?: GemStoneSessionItem) => {
        const session = item ? item.activeSession : sessionManager.getSelectedSession();
        if (!session) {
          vscode.window.showInformationMessage('No GemStone session to log out of.');
          return;
        }
        const decision = await confirmLogoutWithUncommittedChanges(
          session.id,
          queries.sessionNeedsCommit(session),
          (id) => sessionManager.commit(id),
        );
        if (decision === 'cancel') return;
        // Keep the class mirror on disk: it's keyed by connection target and is
        // re-synced incrementally on the next login, which is far cheaper than
        // rebuilding it from scratch (especially for large, remote images).
        SystemBrowser.disposeForSession(session.id);
        GlobalsBrowser.disposeForSession(session.id);
        CommentBrowser.disposeForSession(session.id);
        // Close any lingering class-definition / method-source editor tabs for this
        // session (e.g. opened via go-to-definition without a browser). Browser-owned
        // tabs are already closed when the browser is disposed above.
        void closeGemstoneTabsForSession(session.id);
        EnhancedInspector.disposeForSession(session.id);
        // Dispose before logout so each panel's dispose() can still release its
        // suspended GsProcess against a live handle.
        DebuggerPanel.disposeForSession(session.id);
        sessionManager.logout(session.id);
        treeProvider.refresh();
        inspectorProvider.removeSessionItems(session.id);
        breakpointManager.clearAllForSession(session.id);
        selectorBreakpointManager.clearAllForSession(session.id);
        vscode.window.showInformationMessage(`Session ${session.id}: Logged out.`);
      },
    ),

    vscode.commands.registerCommand('gemstone.sessionPing', async (item?: GemStoneSessionItem) => {
      const session = item ? item.activeSession : sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showInformationMessage('No GemStone session to ping.');
        return;
      }
      try {
        const { success, err } = sessionManager.ping(session.id);
        if (success) {
          vscode.window.showInformationMessage(`Session ${session.id} is active and responsive.`);
        } else {
          vscode.window.showErrorMessage(
            `Session ${session.id}: Ping failed — ${err.message || `error ${err.number}`}`,
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Ping failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand(
      'gemstone.selectSession',
      async (item?: GemStoneSessionItem) => {
        if (item) {
          sessionManager.selectSession(item.activeSession.id);
        } else {
          await sessionManager.resolveSession();
        }
        treeProvider.refresh();
      },
    ),

    vscode.commands.registerCommand(
      'gemstone.exportClasses',
      async (item?: GemStoneSessionItem) => {
        const session = item ? item.activeSession : await sessionManager.resolveSession();
        if (!session) return;
        await exportManager.exportSession(session);
      },
    ),

    vscode.commands.registerCommand('gemstone.refreshBrowser', async () => {
      symbolProvider.invalidateCache();
      completionProvider.invalidateCache();
      const session = sessionManager.getSelectedSession();
      if (session) {
        await exportManager.refreshSession(session);
      }
    }),

    vscode.commands.registerCommand('gemstone.refreshTests', () => {
      sunitTestController.refresh();
    }),

    vscode.commands.registerCommand('gemstone.displayIt', async () => {
      await codeExecutor.displayIt();
    }),

    vscode.commands.registerCommand('gemstone.executeIt', async () => {
      await codeExecutor.executeIt();
    }),

    vscode.commands.registerCommand('gemstone.debugIt', async () => {
      await codeExecutor.debugIt();
    }),

    // Some expressions never return — a web server's listen loop, say — so they
    // can't run on this session without wedging it. Give them a gem of their own.
    vscode.commands.registerCommand('gemstone.runInNewGem', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active text editor.');
        return;
      }
      const selection = editor.selection.isEmpty
        ? editor.document.lineAt(editor.selection.active.line).range
        : editor.selection;
      const code = editor.document.getText(selection).trim();
      if (!code) {
        vscode.window.showWarningMessage('No code to run.');
        return;
      }

      try {
        if (!queries.canForkGem(session)) {
          vscode.window.showErrorMessage(
            `This database (GemStone ${session.stoneVersion}) cannot start a gem this way — ` +
              'it needs one-time password logins, which arrived in a later release.',
          );
          return;
        }
        const gemSession = queries.forkGemRunning(session, code);
        // Say plainly that it is now unmanaged: nothing lists or stops a gem
        // started this way, so the id is all the user has to go on.
        vscode.window.showInformationMessage(
          `Running in gem session ${gemSession}. It keeps running until the database stops — Jasper cannot stop it for you yet.`,
        );
      } catch (e: unknown) {
        vscode.window.showErrorMessage(
          `Could not start a gem: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }),

    vscode.commands.registerCommand('gemstone.copyDisplayItResult', () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      codeExecutor.copyLastResult();
    }),

    vscode.commands.registerCommand('gemstone.outputDisplayItResult', () => {
      codeExecutor.outputLastResult();
    }),

    vscode.commands.registerCommand('gemstone.dismissDisplayResult', () => {
      codeExecutor.dismissDisplayResult();
    }),

    vscode.commands.registerCommand('gemstone.expandDisplayResultInPlace', () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      codeExecutor.expandResultInPlace();
    }),

    vscode.commands.registerCommand('gemstone.inspectIt', async () => {
      await codeExecutor.inspectIt(inspectorProvider);
    }),

    vscode.commands.registerCommand('gemstone.showTranscript', () => {
      showTranscript();
    }),

    vscode.commands.registerCommand(
      'gemstone.runSunitClass',
      async (args: { dictName: string; className: string }) => {
        await sunitTestController.runClassByName(args.dictName, args.className);
      },
    ),

    vscode.commands.registerCommand(
      'gemstone.runSunitClasses',
      async (dictName: string, classNames: string[]) => {
        await sunitTestController.runClassesByName(dictName, classNames);
      },
    ),

    vscode.commands.registerCommand(
      'gemstone.runSunitMethods',
      async (dictName: string, className: string, selectors: string[]) => {
        await sunitTestController.runTestsByName(dictName, className, selectors);
      },
    ),

    vscode.commands.registerCommand(
      'gemstone.runSunitMethodCategory',
      async (dictName: string, className: string, category: string) => {
        await sunitTestController.runMethodCategoryByName(dictName, className, category);
      },
    ),

    vscode.commands.registerCommand(
      'gemstone.inspectGlobal',
      async (args: { className: string }) => {
        // The reveal-existing dedup only applies to the classic Inspector tree: when
        // the session has the Enhanced Inspector, inspectExpression opens a webview
        // (not a tree root), so findRootByLabel could never match — skip the lookup
        // and just inspect (a fresh panel, like editor Inspect It).
        const selected = sessionManager.getSelectedSession();
        if (!selected?.enhancedInspectorAvailable) {
          const existing = inspectorProvider.findRootByLabel(args.className);
          if (existing) {
            await inspectorView.reveal(existing, { select: true, focus: true });
            return;
          }
        }
        await codeExecutor.inspectExpression(inspectorProvider, args.className, args.className);
      },
    ),

    vscode.commands.registerCommand(
      'gemstone.sendersOfSelector',
      async (args: { selector: string; sessionId: number }) => {
        const session = sessionManager.getSession(args.sessionId);
        if (!session) return;
        const maxEnv = vscode.workspace
          .getConfiguration('gemstone')
          .get<number>('maxEnvironment', 0);
        const all: queries.MethodSearchResult[] = [];
        for (let env = 0; env <= maxEnv; env++) {
          all.push(...queries.sendersOf(session, args.selector, env));
        }
        const seen = new Set<string>();
        const results = all.filter((r) => {
          const key = `${r.className}|${r.isMeta}|${r.selector}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        await showMethodResults(session, results, `Senders of #${args.selector}`);
      },
    ),

    vscode.commands.registerCommand(
      'gemstone.implementorsOfSelector',
      async (args: { selector: string; sessionId: number }) => {
        const session = sessionManager.getSession(args.sessionId);
        if (!session) return;
        const maxEnv = vscode.workspace
          .getConfiguration('gemstone')
          .get<number>('maxEnvironment', 0);
        const all: queries.MethodSearchResult[] = [];
        for (let env = 0; env <= maxEnv; env++) {
          all.push(...queries.implementorsOf(session, args.selector, env));
        }
        const seen = new Set<string>();
        const results = all.filter((r) => {
          const key = `${r.className}|${r.isMeta}|${r.selector}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        await showMethodResults(session, results, `Implementors of #${args.selector}`);
      },
    ),

    vscode.commands.registerCommand(
      'gemstone.hierarchyImplementorsOf',
      async (args: {
        selector: string;
        className: string;
        dictIndex: number;
        isMeta: boolean;
        direction: 'up' | 'down';
        sessionId: number;
      }) => {
        const session = sessionManager.getSession(args.sessionId);
        if (!session) return;
        const maxEnv = vscode.workspace
          .getConfiguration('gemstone')
          .get<number>('maxEnvironment', 0);
        const all: queries.MethodSearchResult[] = [];
        for (let env = 0; env <= maxEnv; env++) {
          all.push(
            ...queries.hierarchyImplementorsOf(
              session,
              args.dictIndex,
              args.className,
              args.selector,
              args.isMeta,
              args.direction,
              env,
            ),
          );
        }
        const seen = new Set<string>();
        const results = all.filter((r) => {
          const key = `${r.className}|${r.isMeta}|${r.selector}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const side = args.isMeta ? ' class' : '';
        const title =
          args.direction === 'up'
            ? `${args.className}${side} >> #${args.selector} — superclass implementors`
            : `${args.className}${side} >> #${args.selector} — subclass overrides`;
        await showMethodResults(session, results, title);
      },
    ),

    vscode.commands.registerCommand(
      'gemstone.browseReferences',
      async (args: { objectName: string; sessionId: number }) => {
        const session = sessionManager.getSession(args.sessionId);
        if (!session) return;
        const maxEnv = vscode.workspace
          .getConfiguration('gemstone')
          .get<number>('maxEnvironment', 0);
        const all: queries.MethodSearchResult[] = [];
        for (let env = 0; env <= maxEnv; env++) {
          all.push(...queries.referencesToObject(session, args.objectName, env));
        }
        const seen = new Set<string>();
        const results = all.filter((r) => {
          const key = `${r.className}|${r.isMeta}|${r.selector}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        await showMethodResults(session, results, `References to ${args.objectName}`);
      },
    ),

    vscode.commands.registerCommand('gemstone.removeInspectorItem', (node?: InspectorNode) => {
      if (node) inspectorProvider.removeRoot(node);
    }),

    vscode.commands.registerCommand('gemstone.clearInspector', () => {
      inspectorProvider.clearAll();
    }),

    vscode.commands.registerCommand('gemstone.searchMethods', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const term = await vscode.window.showInputBox({
        prompt: 'Search method source code',
        placeHolder: 'Enter search term',
      });
      if (!term) return;

      await vscode.commands.executeCommand('gemstone.searchMethodsFor', {
        term,
        sessionId: session.id,
      });
    }),

    // Search method source for a term in a specific session (no prompt). Used by
    // the browser's "Browse Methods Containing…" context command, which supplies
    // the term; gemstone.searchMethods prompts and then delegates here.
    vscode.commands.registerCommand(
      'gemstone.searchMethodsFor',
      async (args: { term: string; sessionId: number }) => {
        const session = sessionManager.getSession(args.sessionId);
        if (!session) return;

        let results: queries.MethodSearchResult[];
        try {
          results = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Searching methods for "${args.term}"...`,
              cancellable: false,
            },
            () => Promise.resolve(queries.searchMethodSource(session, args.term, true)),
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          vscode.window.showErrorMessage(`Search failed: ${msg}`);
          return;
        }

        await showMethodResults(session, results, `Methods containing "${args.term}"`);
      },
    ),

    vscode.commands.registerCommand('gemstone.sendersOf', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const selector = await resolveSelector();
      if (!selector) return;

      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);

      let results: queries.MethodSearchResult[];
      try {
        results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Finding senders of #${selector}...`,
            cancellable: false,
          },
          () => {
            const all: queries.MethodSearchResult[] = [];
            for (let env = 0; env <= maxEnv; env++) {
              all.push(...queries.sendersOf(session, selector, env));
            }
            // Deduplicate by class+meta+selector
            const seen = new Set<string>();
            return Promise.resolve(
              all.filter((r) => {
                const key = `${r.className}|${r.isMeta}|${r.selector}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              }),
            );
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Senders search failed: ${msg}`);
        return;
      }

      await showMethodResults(session, results, `Senders of #${selector}`);
    }),

    vscode.commands.registerCommand('gemstone.implementorsOf', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const selector = await resolveSelector();
      if (!selector) return;

      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);

      let results: queries.MethodSearchResult[];
      try {
        results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Finding implementors of #${selector}...`,
            cancellable: false,
          },
          () => {
            const all: queries.MethodSearchResult[] = [];
            for (let env = 0; env <= maxEnv; env++) {
              all.push(...queries.implementorsOf(session, selector, env));
            }
            const seen = new Set<string>();
            return Promise.resolve(
              all.filter((r) => {
                const key = `${r.className}|${r.isMeta}|${r.selector}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              }),
            );
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Implementors search failed: ${msg}`);
        return;
      }

      await showMethodResults(session, results, `Implementors of #${selector}`);
    }),

    vscode.commands.registerCommand('gemstone.classHierarchy', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const className = await vscode.window.showInputBox({
        prompt: 'Enter class name',
        placeHolder: 'e.g. Array',
      });
      if (!className) return;

      let results: queries.ClassHierarchyEntry[];
      try {
        results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Fetching hierarchy for ${className}...`,
            cancellable: false,
          },
          () => Promise.resolve(queries.getClassHierarchy(session, className)),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Hierarchy query failed: ${msg}`);
        return;
      }

      if (results.length === 0) {
        vscode.window.showInformationMessage(`No hierarchy found for ${className}.`);
        return;
      }

      const superCount = results.filter((r) => r.kind === 'superclass').length;

      const items = results.map((r) => {
        let indent: string;
        if (r.kind === 'superclass') {
          const idx = results.indexOf(r);
          indent = '  '.repeat(idx);
        } else if (r.kind === 'self') {
          indent = '  '.repeat(superCount);
        } else {
          indent = '  '.repeat(superCount + 1);
        }
        const marker = r.kind === 'self' ? ' \u25C0' : '';
        return {
          label: `${indent}${r.className}${marker}`,
          description: r.dictName,
          detail: r.kind === 'self' ? '(target class)' : undefined,
          entry: r,
        };
      });

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Hierarchy for ${className}`,
        matchOnDescription: true,
      });
      if (!picked) return;

      const uri = vscode.Uri.parse(
        `gemstone://${session.id}` +
          `/${encodeURIComponent(picked.entry.dictName)}` +
          `/${encodeURIComponent(picked.entry.className)}` +
          `/definition`,
      );
      vscode.commands.executeCommand('gemstone.openDocument', uri);
    }),

    vscode.commands.registerCommand('gemstone.toggleSelectorBreakpoint', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      selectorBreakpointManager.toggleBreakpointAtCursor(editor);
    }),

    vscode.commands.registerCommand('gemstone.findClass', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const items = await loadClassPickItems(session);
      if (!items) return;

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Type to find a class…',
        matchOnDescription: true,
      });
      if (!picked) return;

      if (
        !SystemBrowser.navigateToClass(
          session.id,
          picked.entry.dictName,
          picked.entry.className,
          picked.entry.dictIndex,
        )
      ) {
        // ?dict=<index> scopes the definition to the exact dictionary the entry
        // came from, so aliases sharing a key (or dictionaries sharing a name)
        // resolve to the class the user picked.
        const uri = vscode.Uri.parse(
          `gemstone://${session.id}` +
            `/${encodeURIComponent(picked.entry.dictName)}` +
            `/${encodeURIComponent(picked.entry.className)}` +
            `/definition?dict=${picked.entry.dictIndex}`,
        );
        vscode.commands.executeCommand('gemstone.openDocument', uri);
      }
    }),

    vscode.commands.registerCommand('gemstone.findMethodInClass', () =>
      findMethodInClass(sessionManager),
    ),
  );

  // ── SysAdmin ──────────────────────────────────────────────
  // WSL detection runs asynchronously so it never blocks activation and so a
  // cold-start WSL2 VM (not yet running when VS Code launches) doesn't produce
  // a false negative that sticks for the whole session. If the first probe
  // reports unavailable, we wait briefly and retry once before concluding WSL
  // is genuinely missing. The "install WSL" warning is deferred until that
  // second probe also fails, and a subsequent refresh of the Versions view
  // will re-probe — giving the user a recovery path without reloading.
  if (isWindows()) {
    vscode.commands.executeCommand('setContext', 'gemstone.isWindows', true);
    // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
    (async () => {
      let wslInfo = await getWslInfoAsync();
      if (!wslInfo.available) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        invalidateWslCache();
        wslInfo = await getWslInfoAsync();
      }
      vscode.commands.executeCommand('setContext', 'gemstone.wslAvailable', wslInfo.available);
      if (wslInfo.available) {
        // Allow the extension host to access the WSL filesystem via \\wsl$\... UNC
        // paths. VS Code blocks unknown UNC hosts by default; the Node-side
        // allowlist is read at extension-host startup, so when we add a host we
        // must prompt the user to reload the window before any fs operation on
        // \\wsl$\... will succeed.
        const secConfig = vscode.workspace.getConfiguration('security');
        const allowedHosts = secConfig.get<string[]>('allowedUNCHosts', []);
        const toAdd = ['wsl$', 'wsl.localhost'].filter((h) => !allowedHosts.includes(h));
        if (toAdd.length > 0) {
          await secConfig.update(
            'allowedUNCHosts',
            [...allowedHosts, ...toAdd],
            vscode.ConfigurationTarget.Global,
          );
          const choice = await vscode.window.showWarningMessage(
            'GemStone added the WSL filesystem to security.allowedUNCHosts. Reload the window to enable access to \\\\wsl$\\... paths.',
            'Reload Window',
          );
          if (choice === 'Reload Window') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        }
      } else {
        const choice = await vscode.window.showWarningMessage(
          'GemStone system administration features require Windows Subsystem for Linux (WSL2). ' +
            'Install WSL with: wsl --install',
          'Learn More',
        );
        if (choice === 'Learn More') {
          vscode.env.openExternal(
            vscode.Uri.parse('https://learn.microsoft.com/en-us/windows/wsl/install'),
          );
        }
      }
    })();
  }

  const processManager = new ProcessManager(sysadminStorage);
  const inspectorTerminal: { terminal: vscode.Terminal | undefined } = { terminal: undefined };
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((closed) => {
      if (inspectorTerminal.terminal === closed) {
        inspectorTerminal.terminal = undefined;
      }
    }),
  );

  // ── Claude Code & Claude Desktop MCP integration ─────────────────────────
  // Jasper exposes a single global MCP server at a fixed socket path. The
  // server name (`gemstone`) and socket path are written into each client's
  // user-scope config on every activation — the configs always point at the
  // same well-known socket, regardless of which Jasper window owns it.
  //
  // Ownership of the live socket (and the HTTPS port) is claimed on the
  // first GemStone login in this window, not on activation. That way the
  // window MCP talks to is the one actually working with GemStone — a window
  // that opens but never logs in stays passive.
  //
  // Once claimed, the socket stays bound for the rest of this VS Code run,
  // even if the user logs out. That keeps Claude Code's MCP connection alive
  // across logout/login cycles — tools just return "no session selected"
  // during the gap and resume working when the user logs back in.
  //
  // Claude Code:    user-scope `mcpServers.jasper` in `~/.claude.json`.
  // Claude Desktop: `mcpServers.jasper` in `claude_desktop_config.json`.
  const workspaceRoots = vscode.workspace.workspaceFolders;
  if (workspaceRoots && workspaceRoots.length > 0) {
    const workspacePath = workspaceRoots[0].uri.fsPath;
    const mcpSocketServer = new McpSocketServer({
      getSession: () => sessionManager.getSelectedSession(),
      getSessionLabel: () => {
        const session = sessionManager.getSelectedSession();
        return session ? `${loginLabel(session.login)} (id ${session.id})` : undefined;
      },
      workspacePath,
    });
    const registerDesktop = readMcpSetting<boolean>('registerWithClaudeDesktop', true);

    // Write the well-known configs unconditionally — they point at the fixed
    // socket path, which is correct regardless of which window owns it.
    try {
      const result = writeClaudeCodeUserMcpConfig(
        context.extensionPath,
        mcpSocketServer.socketPath,
      );
      if (result.skipped === 'missing') {
        appendSysadmin(
          `Claude Code config not found at ${result.path}; skipping user-scope MCP registration.`,
        );
      } else if (result.skipped === 'unreadable') {
        appendSysadmin(
          `Claude Code config at ${result.path} is unreadable; skipping user-scope MCP registration.`,
        );
      } else {
        appendSysadmin(
          `Claude Code MCP config: ${result.path}${result.updated ? ' (updated)' : ' (unchanged)'}`,
        );
        if (result.updated) {
          void promptClaudeCodeRefresh(buildRefreshPromptDeps(context));
        }
      }
    } catch (err) {
      appendSysadmin(`Failed to write Claude Code MCP config: ${(err as Error).message}`);
    }
    if (registerDesktop) {
      try {
        const desktopPath = writeClaudeDesktopMcpConfig(
          context.extensionPath,
          mcpSocketServer.socketPath,
        );
        appendSysadmin(`Claude Desktop MCP config: ${desktopPath}`);
      } catch (err) {
        appendSysadmin(`Failed to write Claude Desktop MCP config: ${(err as Error).message}`);
      }
    }

    // HTTPS/SSE surface for clients whose connector UI takes a URL (e.g.
    // Claude Desktop's "Add custom connector" dialog, which rejects http URLs).
    // Tied to socket ownership: the same window owns both, so MCP behavior is
    // consistent across stdio and SSE clients. Override the port per-workspace
    // via `jasper.mcp.httpPort` to run multiple Jasper windows simultaneously.
    const httpPort = readMcpSetting<number>('httpPort', DEFAULT_MCP_HTTP_PORT);
    let httpServer: McpHttpServer | undefined;
    let httpStarted = false;

    // Tree view that exposes who owns the MCP server right now. Reads its
    // state on demand from the socket server + sidecar file, so a refresh is
    // all that's needed when ownership or session selection changes.
    const mcpTreeProvider = new McpServerTreeProvider({
      isOwner: () => mcpSocketServer.isOwner,
      socketPath: mcpSocketServer.socketPath,
      httpsUrl: () => (httpStarted && httpServer ? httpServer.url : undefined),
      getSession: () => sessionManager.getSelectedSession(),
      sidecarPath: mcpSocketServer.sidecarPath,
    });
    const mcpTreeView = vscode.window.createTreeView('jasperMcpServer', {
      treeDataProvider: mcpTreeProvider,
      showCollapseAll: false,
    });
    context.subscriptions.push(mcpTreeView);
    context.subscriptions.push(
      sessionManager.onDidChangeSelection(() => mcpTreeProvider.refresh()),
    );
    // Watch the sidecar file so passive windows pick up ownership changes
    // from elsewhere without polling.
    const sidecarWatcher = fs.watch(
      path.dirname(mcpSocketServer.sidecarPath),
      (_event, filename) => {
        if (!filename || filename === path.basename(mcpSocketServer.sidecarPath)) {
          mcpTreeProvider.refresh();
        }
      },
    );
    // The watcher target may not exist yet on first run; mkdirSync from the
    // sidecar write covers that, but guard the close in dispose anyway.
    context.subscriptions.push({ dispose: () => sidecarWatcher.close() });

    // Eager claim at activation: the first Jasper window to activate owns the
    // MCP socket regardless of whether it has a session yet. Claude Code's
    // MCP client fails the proxy on a short timeout, so the socket needs to
    // be live by the time Claude Code spawns the proxy on the same window
    // reload — deferring until first login lost that race. Tradeoff: if you
    // open a non-GemStone workspace first, that window will own the socket
    // and serve "no session selected" until you log in there or hand off
    // ownership (disable Jasper in that workspace; click "Claim MCP Server"
    // in the workspace you actually want).
    let claimAttemptInFlight = false;
    const tryClaimMcpOwnership = async () => {
      if (mcpSocketServer.isOwner || claimAttemptInFlight) return;
      claimAttemptInFlight = true;
      try {
        const claimed = await mcpSocketServer.start();
        mcpTreeProvider.refresh();
        if (!claimed) return;

        const tls = await ensureSelfSignedCert(context.globalStorageUri.fsPath);
        certPathForTrust = tls.certPath;
        if (tls.generated) {
          appendSysadmin(`Generated self-signed MCP TLS cert at ${tls.certPath}`);
          appendSysadmin(`Trust it once with: ${trustCertCommand(tls.certPath)}`);
          appendSysadmin(`Or run the "GemStone: Install MCP TLS Certificate" command.`);
        }
        httpServer = new McpHttpServer({
          getSession: () => sessionManager.getSelectedSession(),
          port: httpPort,
          tls: { cert: tls.cert, key: tls.key },
        });
        try {
          await httpServer.start();
          httpStarted = true;
          appendSysadmin(`MCP HTTPS listening at ${httpServer.url}`);
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          if (e.code === 'EADDRINUSE') {
            appendSysadmin(
              `MCP HTTPS port ${httpPort} in use; skipping (another Jasper window may own it). Override jasper.mcp.httpPort per-workspace to run two windows simultaneously.`,
            );
          } else {
            appendSysadmin(`MCP HTTPS server failed to start: ${e.message}`);
          }
        }
        mcpTreeProvider.refresh();
      } catch (err) {
        appendSysadmin(`MCP claim failed: ${(err as Error).message}`);
      } finally {
        claimAttemptInFlight = false;
      }
    };

    // Session changes have two effects when we're the owner: tools see the
    // new session immediately (via getSession), and the sidecar needs an
    // update so passive Jasper windows can show what's currently selected.
    // When we're not owner, the change still triggers a re-render of the
    // local panel (which displays "(none)") and a re-claim attempt for the
    // case where a prior owner released ownership while we were idle.
    context.subscriptions.push(
      sessionManager.onDidChangeSelection(() => {
        mcpSocketServer.refreshSidecar();
        mcpTreeProvider.refresh();
        void tryClaimMcpOwnership();
      }),
    );
    void tryClaimMcpOwnership();

    context.subscriptions.push(
      vscode.commands.registerCommand('jasper.claimMcpServer', async () => {
        if (mcpSocketServer.isOwner) {
          vscode.window.showInformationMessage('This window already owns the MCP server.');
          return;
        }
        await tryClaimMcpOwnership();
        if (!mcpSocketServer.isOwner) {
          vscode.window.showWarningMessage(
            'Could not claim the MCP server — another Jasper window still owns it. ' +
              'Close or disable Jasper in that window, then try again.',
          );
        }
      }),
      vscode.commands.registerCommand('jasper.copyMcpUrl', async () => {
        if (!httpStarted || !httpServer) {
          vscode.window.showWarningMessage(
            `Jasper MCP HTTPS surface is not running on port ${httpPort}. Check the GemStone Admin output channel for the reason.`,
          );
          return;
        }
        await vscode.env.clipboard.writeText(httpServer.url);
        vscode.window.showInformationMessage(`Copied MCP URL: ${httpServer.url}`);
      }),
      vscode.commands.registerCommand('jasper.copyMcpSocketPath', async (socketPath?: string) => {
        if (!socketPath) {
          vscode.window.showWarningMessage('No MCP socket path available.');
          return;
        }
        await vscode.env.clipboard.writeText(socketPath);
        vscode.window.showInformationMessage(`Copied MCP socket path: ${socketPath}`);
      }),
      vscode.commands.registerCommand('jasper.installMcpTlsCertificate', async () => {
        if (!certPathForTrust) {
          vscode.window.showWarningMessage(
            'MCP TLS certificate has not been generated yet. Wait for extension activation to complete and try again.',
          );
          return;
        }
        const cmd = trustCertCommand(certPathForTrust);
        const choice = await vscode.window.showInformationMessage(
          `Install the MCP TLS certificate into your system trust store so Claude clients accept https://127.0.0.1:${httpPort}/sse?\n\nCommand to run: ${cmd}`,
          { modal: true },
          'Run in Terminal',
          'Copy Command',
          'Show Cert Path',
        );
        if (choice === 'Run in Terminal') {
          const terminal = vscode.window.createTerminal({ name: 'Install MCP TLS Cert' });
          terminal.show();
          terminal.sendText(cmd);
        } else if (choice === 'Copy Command') {
          await vscode.env.clipboard.writeText(cmd);
          vscode.window.showInformationMessage('Command copied to clipboard.');
        } else if (choice === 'Show Cert Path') {
          await vscode.env.clipboard.writeText(certPathForTrust);
          vscode.window.showInformationMessage(`Cert path copied: ${certPathForTrust}`);
        }
      }),
    );

    context.subscriptions.push({
      dispose: () => {
        void mcpSocketServer.dispose();
        if (httpServer) void httpServer.dispose();
      },
    });
  }
  const versionManager = new VersionManager(sysadminStorage);
  const databaseManager = new DatabaseManager(sysadminStorage, processManager);

  // OS Configuration. The "Configure OS" view is shown only on Windows/WSL,
  // where it hosts several ongoing settings (WSL version, mirrored networking,
  // gs64ldi services, …). On macOS and Linux the only prerequisites are shared
  // memory (and RemoveIPC on Linux), which the Start Stone preflight handles
  // inline — so no view is shown there. The setup-script commands are still
  // registered on every platform because that preflight invokes them.
  if (process.platform === 'darwin' || process.platform === 'linux' || isWindows()) {
    const osConfigProvider = new OsConfigTreeProvider();
    if (isWindows()) {
      context.subscriptions.push(
        vscode.window.createTreeView('gemstoneSharedMemory', {
          treeDataProvider: osConfigProvider,
        }),
      );
    }
    osConfigProvider.registerCommands(context);
  }

  // Versions
  const versionProvider = new VersionTreeProvider(versionManager);
  context.subscriptions.push(
    vscode.window.createTreeView('gemstoneVersions', {
      treeDataProvider: versionProvider,
    }),
  );

  // Databases
  const databaseProvider = new DatabaseTreeProvider(sysadminStorage, processManager);
  context.subscriptions.push(
    vscode.window.createTreeView('gemstoneDatabases', {
      treeDataProvider: databaseProvider,
      showCollapseAll: true,
    }),
  );

  // Processes
  const processProvider = new ProcessTreeProvider(processManager);
  context.subscriptions.push(
    vscode.window.createTreeView('gemstoneProcesses', {
      treeDataProvider: processProvider,
    }),
  );

  // Rowan: tracked repositories (registry persists in globalState — stones are
  // disposable, the registry isn't) + package-manager operations.
  const rowanRegistry = new RowanRepoRegistry(context.globalState);
  const rowanProvider = new RowanTreeProvider(rowanRegistry, {
    getSession: () => sessionManager.getSelectedSession() ?? null,
  });
  // The Rowan project at the open workspace root, shown as a section in the
  // Explorer (contributed only when gemstone.workspaceIsRowanProject). Its
  // packages are read from disk — co-located with the file tree, no stone.
  // Fed by the Rowan view's own image query, so "loaded" is decided in one place
  // rather than asked of the stone twice.
  const rowanProjectProvider = new RowanProjectTreeProvider(rowanProvider);
  const rowanProjectView = vscode.window.createTreeView('gemstoneRowanProject', {
    treeDataProvider: rowanProjectProvider,
  });
  const refreshRowanProjectView = () => {
    rowanProjectProvider.refresh();
    rowanProjectView.description = rowanProjectProvider.projectName();
  };
  // Resolve a GemStone install that can run the Rowan solo scripts: prefer the
  // connected session's version, else the first extracted version that ships the
  // tooling. $GEMSTONE is the sysadmin path, or two dirs up from the GCI library
  // (…/lib/libgci → install root).
  // Open a freshly-created project's load-spec manifest with the project name
  // selected, so the user names it there (the name is metadata, not the folder).
  const openRowanManifestAtName = async (projectRoot: string, specName: string) => {
    const manifest = path.join(projectRoot, 'rowan', 'specs', `${specName}.ston`);
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(vscode.Uri.file(manifest));
    } catch {
      return;
    }
    const m = /(#projectName\s*:\s*')([^']*)'/.exec(doc.getText());
    const selection = m
      ? new vscode.Range(
          doc.positionAt(m.index + m[1].length),
          doc.positionAt(m.index + m[1].length + m[2].length),
        )
      : undefined;
    await vscode.window.showTextDocument(doc, selection ? { selection } : {});
  };
  // Recognize when the open workspace root is itself a Rowan project — gates the
  // Explorer section's visibility. Passive: no effect when it isn't one.
  const refreshRowanWorkspaceContext = () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    vscode.commands.executeCommand(
      'setContext',
      'gemstone.workspaceIsRowanProject',
      !!root && isRowanProjectRoot(root),
    );
    // Gate the "isn't a Rowan project" welcome on having actually looked. Until
    // the extension activates, workspaceIsRowanProject is undefined — which a
    // `!` clause reads as "not a project", flashing that welcome over a project
    // we simply hadn't checked yet. Set last, so it never precedes the answer.
    vscode.commands.executeCommand('setContext', 'gemstone.rowanProjectChecked', true);
  };
  refreshRowanWorkspaceContext();
  refreshRowanProjectView();
  const activeEditorDecorations = new ActiveEditorDecorationProvider();
  activeEditorDecorations.setActiveEditor(vscode.window.activeTextEditor?.document.uri);
  context.subscriptions.push(
    rowanProjectView,
    vscode.window.createTreeView('gemstoneRowan', {
      treeDataProvider: rowanProvider,
    }),
    // Git-view-style M/A/D badges + label tinting for Rowan rows.
    vscode.window.registerFileDecorationProvider(new RowanDecorationProvider()),
    // Grays the "instance/class variables" header the Explorer shows for an empty
    // variable side.
    vscode.window.registerFileDecorationProvider(new ExplorerEmptyVarDecorationProvider()),
    // Tints the Methods-pane / Open-Editors row backing the active editor, so the
    // selected method reads as connected to its source even when the tree isn't
    // focused (its selection goes muted grey then).
    vscode.window.registerFileDecorationProvider(activeEditorDecorations),
    vscode.window.onDidChangeActiveTextEditor((ed) =>
      activeEditorDecorations.setActiveEditor(ed?.document.uri),
    ),
    // Loaded-projects section tracks the connected stone; so does whether each
    // dependency is marked as being in the image.
    sessionManager.onDidChangeSelection(() => {
      rowanProvider.refresh();
      refreshRowanProjectView();
    }),
    // The workspace root defines the Rowan project — re-evaluate on folder change.
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      refreshRowanWorkspaceContext();
      rowanProvider.refresh();
      refreshRowanProjectView();
    }),

    vscode.commands.registerCommand('gemstone.rowanRefreshView', () => {
      rowanProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.rowanAddDependency', async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root || !isRowanProjectRoot(root)) {
        vscode.window.showErrorMessage(
          'Open a Rowan project first — the dependency is added to its Core component.',
        );
        return;
      }

      const input = (
        await vscode.window.showInputBox({
          title: 'Add Dependency',
          prompt: 'Paste a git URL (https or ssh) or a local directory path',
          placeHolder:
            'https://github.com/owner/repo.git · git@github.com:owner/repo.git · /path/to/project',
          ignoreFocusOut: true,
        })
      )?.trim();
      if (!input) return;

      let dep: ProjectDependency;
      if (/^(https?|ssh|git):\/\//.test(input) || /^git@/.test(input) || input.endsWith('.git')) {
        const revision = await pickGitRevision(input);
        if (!revision) return;
        dep = { kind: 'git', name: dependencyNameFromGitUrl(input), gitUrl: input, revision };
      } else {
        const dir = path.resolve(input);
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
          vscode.window.showErrorMessage(`Not a git URL or an existing directory: ${input}`);
          return;
        }
        dep = { kind: 'disk', name: path.basename(dir), diskUrl: dir };
      }

      const result = addProjectDependency(root, dep);
      if (!result.success) {
        vscode.window.showErrorMessage(`Could not add ${dep.name}: ${result.error}`);
        return;
      }
      rowanProvider.refresh();
      refreshRowanProjectView();

      // Adding a dependency only writes a file. If a database is connected,
      // offer to load so it actually has the code — the load reports its own
      // result, so it stands in for the "Added …" notification below.
      const connected = sessionManager.getSelectedSession();
      if (connected && (await shouldLoadAfterAddingDependency(dep.name))) {
        await loadRowanFromDirectory(connected, root, () => {
          rowanProvider.refresh();
          refreshRowanProjectView();
        });
        return;
      }

      const choice = await vscode.window.showInformationMessage(
        result.alreadyPresent
          ? `Updated the ${dep.name} dependency.`
          : `Added ${dep.name} as a dependency of this project.`,
        'Open Reference',
      );
      if (choice === 'Open Reference' && result.referenceFile) {
        await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument(vscode.Uri.file(result.referenceFile)),
        );
      }
    }),

    vscode.commands.registerCommand('gemstone.rowanNewProject', async () => {
      const name = (
        await vscode.window.showInputBox({
          prompt: 'New Rowan project name',
          placeHolder: 'MyProject',
          ignoreFocusOut: true,
          // The name becomes a folder, so only reject what breaks a folder name —
          // the project's own name lives in the Rowan metadata, and Rowan itself
          // accepts hyphens, dots, etc.
          validateInput: (v) => {
            const t = v.trim();
            if (!t) return 'Enter a project name.';
            if (/[\\/]/.test(t) || t === '.' || t === '..')
              return 'Avoid /, \\, ".", and ".." — this becomes a folder name.';
            return undefined;
          },
        })
      )?.trim();
      if (!name) return;

      const openFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Create Project Here',
        title: `Choose where to create "${name}"`,
        defaultUri: openFolder ? vscode.Uri.file(openFolder) : undefined,
      });
      if (!picked || picked.length === 0) return;
      const dest = path.join(picked[0].fsPath, name);
      if (fs.existsSync(dest)) {
        vscode.window.showErrorMessage(`"${dest}" already exists.`);
        return;
      }
      try {
        fs.mkdirSync(dest, { recursive: true });
      } catch (e: unknown) {
        vscode.window.showErrorMessage(
          `Could not create the folder: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }

      const result = createRowanProject(dest, name);
      if (!result.success) {
        vscode.window.showErrorMessage(`Could not create the project: ${result.error}`);
        return;
      }
      const choice = await vscode.window.showInformationMessage(
        `Created Rowan project "${name}".`,
        'Open Project',
      );
      if (choice === 'Open Project' && result.projectDir) {
        await vscode.commands.executeCommand(
          'vscode.openFolder',
          vscode.Uri.file(result.projectDir),
        );
      }
    }),

    vscode.commands.registerCommand('gemstone.rowanInitHere', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folder) {
        vscode.window.showErrorMessage(
          'Open a folder first — this turns the open folder into a Rowan project.',
        );
        return;
      }
      if (isRowanProjectRoot(folder)) {
        vscode.window.showInformationMessage('This folder is already a Rowan project.');
        return;
      }
      // The open folder IS the project's containing folder; its name becomes the
      // load spec's file name. The project's own name is metadata the user edits
      // in the manifest we open right afterward.
      const name = path.basename(folder);

      const result = createRowanProject(folder, name);
      if (!result.success) {
        vscode.window.showErrorMessage(`Could not create the project: ${result.error}`);
        return;
      }
      refreshRowanWorkspaceContext();
      rowanProvider.refresh();
      refreshRowanProjectView();
      await openRowanManifestAtName(folder, name);
    }),

    vscode.commands.registerCommand('gemstone.rowanAddRepo', async () => {
      const source = await vscode.window.showQuickPick(
        [
          { label: '$(repo-clone) Clone from Git URL…', origin: 'git' as const },
          { label: '$(folder) Add local folder…', origin: 'folder' as const },
        ],
        { placeHolder: 'How should the Rowan repository be added?' },
      );
      if (!source) return;

      let repoPath: string;
      let gitUrl: string | undefined;
      if (source.origin === 'git') {
        const raw = (
          await vscode.window.showInputBox({
            prompt: 'Git repository URL of the Rowan project',
            placeHolder: 'https://github.com/owner/repo.git',
            ignoreFocusOut: true,
            validateInput: validateRowanGitUrl,
          })
        )?.trim();
        if (!raw) return;
        const url = normalizeGitUrl(raw);
        // Clone into the open workspace folder.
        const dest = rowanWorkspaceDest(deriveRepoName(url));
        if (!dest) return;
        if (!fs.existsSync(dest)) {
          try {
            await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: `Cloning ${url}…`,
                cancellable: false,
              },
              () => cloneGitRepo(url, dest),
            );
          } catch (e: unknown) {
            vscode.window.showErrorMessage(
              `git clone failed: ${e instanceof Error ? e.message : String(e)}`,
            );
            return;
          }
        }
        repoPath = dest;
        gitUrl = url;
      } else {
        const folder = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: 'Add Repository',
          title: 'Select a Rowan project directory',
        });
        if (!folder || folder.length === 0) return;
        const src = folder[0].fsPath;
        if (isInsideWorkspace(src)) {
          // Already in the workspace — track it in place.
          repoPath = src;
        } else {
          // FOR NOW, copy it into the workspace too (so it's visible/editable
          // there, like git clones). TODO: make this configurable.
          const dest = rowanWorkspaceDest(path.basename(src));
          if (!dest) return;
          if (!fs.existsSync(dest)) {
            try {
              await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: `Copying ${path.basename(src)} into the workspace…`,
                  cancellable: false,
                },
                async () => {
                  fs.cpSync(src, dest, { recursive: true });
                },
              );
            } catch (e: unknown) {
              vscode.window.showErrorMessage(
                `Could not copy the folder into the workspace: ${e instanceof Error ? e.message : String(e)}`,
              );
              return;
            }
          }
          repoPath = dest;
        }
      }

      if (findRowanLoadSpecs(repoPath).length === 0) {
        vscode.window.showWarningMessage(
          `No Rowan load specification (.ston) found under ${repoPath} — tracking it anyway.`,
        );
      }
      await rowanRegistry.add({ name: path.basename(repoPath), path: repoPath, gitUrl });
      rowanProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.rowanRemoveRepo', async (item?: RowanRepoItem) => {
      if (!item) return;
      await rowanRegistry.remove(item.repo.path);
      rowanProvider.refresh();
    }),

    vscode.commands.registerCommand(
      'gemstone.rowanExportProject',
      async (item?: RowanLoadedProjectItem) => {
        if (!item) return;
        const session = sessionManager.getSelectedSession();
        if (!session) return;
        const folder = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: 'Export Here',
          title: `Export a copy of "${item.project.name}" to…`,
        });
        if (!folder || folder.length === 0) return;
        const result = queries.exportRowanProject(session, item.project.name, folder[0].fsPath);
        if (!result.success) {
          vscode.window.showErrorMessage(
            `Export of "${item.project.name}" failed: ${result.detail}`,
          );
          return;
        }
        const choice = await vscode.window.showInformationMessage(
          `Exported "${item.project.name}" to ${result.detail}.`,
          'Reveal',
        );
        if (choice === 'Reveal') {
          void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.detail));
        }
      },
    ),

    vscode.commands.registerCommand(
      'gemstone.rowanOpenProjectDiff',
      async (item?: RowanChangesProjectItem | RowanLoadedProjectItem) => {
        if (!item) return;
        const session = sessionManager.getSelectedSession();
        if (!session) return;
        const projectName =
          item instanceof RowanChangesProjectItem ? item.projectName : item.project.name;
        const diff = queries.diffRowanProject(session, projectName);
        if (!diff.ok) {
          vscode.window.showErrorMessage(`Diff of "${projectName}" failed: ${diff.error}`);
          return;
        }
        const doc = await vscode.workspace.openTextDocument({
          content: queries.formatRowanDiff(projectName, diff),
          language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      },
    ),

    vscode.commands.registerCommand('gemstone.rowanLoadRepo', async (item?: RowanRepoItem) => {
      if (!item) return;
      const session = await sessionManager.resolveSession();
      if (!session) return;
      await loadRowanFromDirectory(session, item.repo.path, () => {
        rowanProvider.refresh();
        refreshRowanProjectView();
      });
      rowanProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.rowanUpdateRepo', async (item?: RowanRepoItem) => {
      if (!item || !item.repo.gitUrl) return;
      let result: { updated: boolean };
      try {
        result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Updating ${item.repo.name}…`,
            cancellable: false,
          },
          () => updateGitRepo(item.repo.path),
        );
      } catch (e: unknown) {
        vscode.window.showErrorMessage(
          `Update of "${item.repo.name}" failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
      // Re-read the checkout (a new gemstone.ston, spec, etc. may now be present)
      // so the row's state — and any cache warning — reflects the update.
      rowanProvider.refresh();
      vscode.window.showInformationMessage(
        result.updated
          ? `Updated "${item.repo.name}" to the latest from its remote.`
          : `"${item.repo.name}" is already up to date.`,
      );
    }),
  );

  // Refresh process state on initial load
  processManager.refreshProcesses();

  // Helper to refresh databases + processes together
  function refreshAdminViews() {
    processManager.refreshProcesses();
    databaseProvider.refresh();
    processProvider.refresh();
  }

  // ── Quick Setup ──────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('gemstone.quickSetup', () =>
      runQuickSetup({
        sysadminStorage,
        versionManager,
        databaseManager,
        processManager,
        loginStorage: storage,
        refreshAdminViews,
        refreshVersions: () => versionProvider.loadVersions(),
        refreshLogins: () => treeProvider.refresh(),
      }),
    ),
  );

  // ── SysAdmin Commands ───────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('gemstone.refreshVersions', async () => {
      if (isWindows()) {
        invalidateWslCache();
        const wslInfo = await getWslInfoAsync();
        vscode.commands.executeCommand('setContext', 'gemstone.wslAvailable', wslInfo.available);
      }
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.downloadVersion', async (item: VersionItem) => {
      const version = item.version;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Downloading GemStone ${version.version}...`,
          cancellable: true,
        },
        async (progress, token) => {
          await versionManager.download(version, progress, token);
        },
      );
      vscode.window.showInformationMessage(`GemStone ${version.version} downloaded.`);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.deleteDownload', async (item: VersionItem) => {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete download of GemStone ${item.version.version}?`,
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') return;
      await versionManager.deleteDownload(item.version);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.extractVersion', async (item: VersionItem) => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Extracting GemStone ${item.version.version}...`,
        },
        async (progress) => {
          await versionManager.extract(item.version, progress);
        },
      );
      vscode.window.showInformationMessage(`GemStone ${item.version.version} extracted.`);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.deleteExtracted', async (item: VersionItem) => {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete extracted GemStone ${item.version.version}? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') return;
      await versionManager.deleteExtracted(item.version);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.registerLocalVersion', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select GemStone Product Directory',
      });
      if (!uris || uris.length === 0) return;
      const productPath = uris[0].fsPath;
      const info = SysadminStorage.readVersionTxt(productPath);
      if (!info) {
        vscode.window.showErrorMessage('No valid version.txt found in the selected directory.');
        return;
      }
      const suffix = sysadminStorage.getPlatformSuffix();
      const linkName = `GemStone64Bit${info.version}${suffix}`;
      const linkPath = path.join(sysadminStorage.getRootPath(), linkName);
      if (wslExistsSync(linkPath)) {
        // Something already occupies the target location. If it's already a
        // valid GemStone product tree — a real directory the user dropped in,
        // or a prior symlink — there's nothing to do: it's recognized on its
        // own, so report success rather than failing to create a symlink over
        // it.
        if (SysadminStorage.readVersionTxt(linkPath)) {
          sysadminStorage.invalidateExtractedCache();
          appendSysadmin(`Local version already present: ${info.version} → ${linkPath}`);
          vscode.window.showInformationMessage(
            `GemStone ${info.version} is already present in ${sysadminStorage.getRootPath()}.`,
          );
          void versionProvider.loadVersions();
          return;
        }
        vscode.window.showErrorMessage(
          `Version ${info.version} already exists in ${sysadminStorage.getRootPath()}.`,
        );
        return;
      }
      sysadminStorage.ensureRootPath();
      wslSymlinkSync(productPath, linkPath);
      sysadminStorage.invalidateExtractedCache();
      appendSysadmin(`Registered local version: ${info.version} → ${productPath}`);
      vscode.window.showInformationMessage(
        `Registered local GemStone ${info.version} (${info.description || 'local build'}).`,
      );
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand(
      'gemstone.unregisterLocalVersion',
      async (item: VersionItem) => {
        const confirmed = await vscode.window.showWarningMessage(
          `Unregister local GemStone ${item.version.version}? This only removes the symlink, not the product directory.`,
          { modal: true },
          'Unregister',
        );
        if (confirmed !== 'Unregister') return;
        await versionManager.deleteExtracted(item.version);
        // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
        versionProvider.loadVersions();
      },
    ),

    vscode.commands.registerCommand('gemstone.openVersionFolder', (item: VersionItem) => {
      const gsPath = sysadminStorage.getGemstonePath(item.version.version);
      if (gsPath) {
        vscode.env.openExternal(vscode.Uri.file(gsPath));
      }
    }),

    vscode.commands.registerCommand('gemstone.openVersionTerminal', (item: VersionItem) => {
      try {
        processManager.openVersionTerminal(item.version.version);
      } catch (e) {
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      }
    }),

    vscode.commands.registerCommand('gemstone.downloadWindowsClient', async (item: VersionItem) => {
      const version = item.version.version;
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Installing Windows client ${version}...`,
            cancellable: true,
          },
          (progress, token) =>
            versionManager.downloadAndExtractWindowsClient(version, progress, token),
        );
      } catch (e) {
        vscode.window.showErrorMessage(
          `Windows client install failed: ${e instanceof Error ? e.message : e}`,
        );
        // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
        versionProvider.loadVersions();
        return;
      }

      // Auto-register GCI library path
      const gciPath = sysadminStorage.getWindowsClientGciPath(version);
      if (gciPath) {
        await storage.setGciLibraryPath(version, gciPath);
      }
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      versionProvider.loadVersions();
      vscode.window.showInformationMessage(
        `Windows client for GemStone ${version} is ready.${gciPath ? ' GCI library registered.' : ''}`,
      );
    }),

    vscode.commands.registerCommand('gemstone.openWindowsClientFolder', (item: VersionItem) => {
      const clientPath = sysadminStorage.getWindowsClientPath(item.version.version);
      if (clientPath) {
        vscode.env.openExternal(vscode.Uri.file(clientPath));
      }
    }),

    vscode.commands.registerCommand(
      'gemstone.deleteWindowsClientExtracted',
      async (item: VersionItem) => {
        const confirmed = await vscode.window.showWarningMessage(
          `Delete the Windows client distribution for GemStone ${item.version.version}?`,
          { modal: true },
          'Delete',
        );
        if (confirmed !== 'Delete') return;
        await versionManager.deleteWindowsClientExtracted(item.version);
        // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
        versionProvider.loadVersions();
      },
    ),

    vscode.commands.registerCommand('gemstone.createDatabase', async () => {
      const db = await databaseManager.createDatabase();
      if (db) {
        // Auto-create the stone's DataCurator login (unless one already targets
        // it) so it can be connected to — and cleanly stopped — right away.
        const newLogin = dataCuratorLoginToCreate(storage.getLogins(), db.config);
        if (newLogin) {
          await storage.saveLogin(newLogin);
          treeProvider.refresh();
        }
        refreshAdminViews();
        vscode.window.showInformationMessage(`Database "${db.dirName}" created.`);
      }
    }),

    vscode.commands.registerCommand('gemstone.deleteDatabase', async (node: DatabaseNode) => {
      if (node?.kind !== 'database') return;
      const deleted = await databaseManager.deleteDatabase(node.db);
      if (deleted) {
        refreshAdminViews();
      }
    }),

    vscode.commands.registerCommand('gemstone.refreshDatabases', () => {
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.startStone', async (node: DatabaseNode) => {
      if (node?.kind !== 'stone') return;
      if (!(await ensureStonePreconditions())) return;
      try {
        await processManager.startStone(node.db);
        vscode.window.showInformationMessage(`Stone "${node.db.config.stoneName}" started.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(msg);
      }
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.stopStone', async (node: DatabaseNode) => {
      if (node?.kind !== 'stone') return;
      const db = node.db;
      const stoneName = db.config.stoneName;

      // Only DataCurator is guaranteed to have shutdown permission, and stopstone
      // needs its password. Prefer the stored DataCurator login for this stone.
      const target = {
        gem_host: 'localhost',
        stone: stoneName,
        gs_user: 'DataCurator',
        netldi: db.config.ldiName,
      };
      const adminLogin = storage.getLogins().find((l) => sameLoginTarget(l, target));

      const outcome = await runStopStone({
        stoneName,
        hasAdminLogin: adminLogin !== undefined,
        storedPassword: async () => {
          if (!adminLogin) return undefined;
          if (adminLogin.gs_password) return adminLogin.gs_password;
          if (adminLogin.password_in_keychain) {
            return (await getLoginPassword(context.secrets, adminLogin)) || undefined;
          }
          return undefined;
        },
        stopStone: async (password) => {
          try {
            await processManager.stopStone(db, password);
            return { ok: true, message: '' };
          } catch (e) {
            return { ok: false, message: e instanceof Error ? e.message : String(e) };
          }
        },
        promptPassword: async () =>
          vscode.window.showInputBox({
            prompt: `DataCurator password to stop "${stoneName}"`,
            password: true,
            ignoreFocusOut: true,
          }),
        chooseEscalation: async (reason) => {
          const pick = await vscode.window.showWarningMessage(
            `${reason}\n\nEnter the DataCurator password, or force-stop the stone (it will recover from the transaction log on next start).`,
            { modal: true },
            'Enter Password',
            'Force Stop',
          );
          return pick === 'Enter Password' ? 'password' : pick === 'Force Stop' ? 'kill' : 'cancel';
        },
        forceKill: async () => {
          const result = await processManager.forceKillStone(db);
          if (!result.killed) vscode.window.showErrorMessage(result.reason);
          return result.killed;
        },
      });

      if (outcome === 'stopped') {
        vscode.window.showInformationMessage(`Stone "${stoneName}" stopped.`);
      } else if (outcome === 'killed') {
        vscode.window.showWarningMessage(
          `Stone "${stoneName}" force-stopped; it will recover from its transaction log on next start.`,
        );
      }
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.startNetldi', async (node: DatabaseNode) => {
      if (node?.kind !== 'netldi') return;
      try {
        await processManager.startNetldi(node.db);
        vscode.window.showInformationMessage(`NetLDI "${node.db.config.ldiName}" started.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(msg);
      }
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.stopNetldi', async (node: DatabaseNode) => {
      if (node?.kind !== 'netldi') return;
      try {
        await processManager.stopNetldi(node.db);
        vscode.window.showInformationMessage(`NetLDI "${node.db.config.ldiName}" stopped.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(msg);
      }
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('jasper.openMcpInspector', () => {
      const port = readMcpSetting<number>('httpPort', DEFAULT_MCP_HTTP_PORT);
      openMcpInspector(`https://127.0.0.1:${port}/sse`, inspectorTerminal, {
        extraCaCertPath: certPathForTrust,
      });
    }),

    vscode.commands.registerCommand('gemstone.openDbInFinder', (node: DatabaseNode) => {
      if (!node || node.kind !== 'database') return;
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(node.db.path));
    }),

    vscode.commands.registerCommand('gemstone.openDbTerminal', (node: DatabaseNode) => {
      if (!node || node.kind !== 'database') return;
      processManager.openTerminal(node.db);
    }),

    vscode.commands.registerCommand('gemstone.createLoginFromDb', async (node: DatabaseNode) => {
      if (!node || node.kind !== 'database') return;
      const db = node.db;
      const login = buildDataCuratorLogin(db.config);
      // Auto-detect GCI library path
      // On Windows, the sysadmin install is Linux (in WSL) and only has .so files.
      // The Windows .dll must be provided separately via the login editor.
      if (!isWindows()) {
        const gsPath = sysadminStorage.getGemstonePath(db.config.version);
        if (gsPath) {
          const ext = process.platform === 'darwin' ? 'dylib' : 'so';
          const libPath = path.join(gsPath, 'lib', `libgcits-${db.config.version}-64.${ext}`);
          if (fs.existsSync(libPath)) {
            await storage.setGciLibraryPath(db.config.version, libPath);
          }
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      LoginEditorPanel.show(storage, context.secrets, treeProvider, login, sysadminStorage);
    }),

    vscode.commands.registerCommand('gemstone.refreshProcesses', () => {
      processProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.deleteStaleLock', async (item: ProcessItem) => {
      if (!item || item.process.responding) return;
      const report = processManager.inspectStaleLock(item.process);
      if (!report.safe) {
        vscode.window.showWarningMessage(report.reason);
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `${report.reason}\n\nDelete ${report.lockPath}?`,
        { modal: true },
        'Delete Lock',
      );
      if (confirm !== 'Delete Lock') return;
      if (processManager.deleteStaleLock(report.lockPath)) {
        vscode.window.showInformationMessage(`Removed stale lock for ${item.process.name}.`);
        processProvider.refresh();
      } else {
        vscode.window.showErrorMessage(
          `Failed to remove ${report.lockPath}. Check filesystem permissions.`,
        );
      }
    }),

    vscode.commands.registerCommand('gemstone.copyNetldiHost', async (item: ProcessItem) => {
      // Only NetLDI items surface this command (package.json menu filter),
      // but guard anyway since commands can be invoked programmatically.
      if (!item || item.process.type !== 'netldi') return;
      const net = getWslNetworkInfoCached() ?? (await refreshWslNetworkInfo());
      const host = net.netldiHost;
      if (!host) {
        vscode.window.showWarningMessage(
          'Could not determine a host for WSL — try running NetLDI and refreshing, or check WSL is reachable.',
        );
        return;
      }
      await vscode.env.clipboard.writeText(host);
      const portSuffix = item.process.port ? ` (port ${item.process.port})` : '';
      vscode.window.showInformationMessage(`Copied ${host}${portSuffix} to clipboard.`);
    }),

    vscode.commands.registerCommand('gemstone.replaceExtent', async (node: DatabaseNode) => {
      if (node?.kind !== 'stone') return;
      const replaced = await databaseManager.replaceExtent(node.db);
      if (replaced) {
        refreshAdminViews();
      }
    }),

    vscode.commands.registerCommand(
      'gemstone.fullLogicalBackup',
      async (item?: GemStoneSessionItem) => {
        // A full backup runs over GCI against the connected stone, so it operates
        // on a specific session: the one clicked in the Sessions tree, or the
        // selected session when invoked from the palette.
        const session = item ? item.activeSession : sessionManager.getSelectedSession();
        if (!session) {
          vscode.window.showInformationMessage(
            'No GemStone session to back up. Connect a session first.',
          );
          return;
        }
        // Default the destination next to the extents when this session's stone is
        // one we manage locally; otherwise the picker opens without a default dir.
        const db = sysadminStorage
          .getDatabases()
          .find((d) => d.config.stoneName === session.login.stone);
        const backedUp = await runLogicalBackup({
          execute: (code) => queries.executeFetchString(session, code),
          runBackup: (code) =>
            queries.executeFetchStringNb(
              session,
              'gemstone.fullLogicalBackup',
              code,
              undefined,
              true,
            ),
          stoneName: session.login.stone,
          dbPath: db?.path,
        });
        // Re-read the Databases tree so the new backup (and the Backups node, if
        // this was the first one) shows up without a manual refresh.
        if (backedUp) refreshAdminViews();
      },
    ),

    vscode.commands.registerCommand(
      'gemstone.onlineExtentBackup',
      async (item?: GemStoneSessionItem | DatabaseNode) => {
        // Two entry points: the Sessions view (a GemStoneSessionItem) and the
        // running Stone node in the Databases view (a 'stone' DatabaseNode).
        // Either way this runs against one live session — copying live extents
        // needs host-filesystem access to them, so it only works for a
        // Jasper-managed local stone.
        const resolved = resolveExtentBackupSession(
          item,
          sessionManager.getSessions(),
          sessionManager.getSelectedSession(),
        );
        if ('needLogin' in resolved) {
          vscode.window.showWarningMessage(
            'An online extent backup runs over a live session on the stone. ' +
              `Log in to "${resolved.needLogin}" first, then try again.`,
            { modal: true },
          );
          return;
        }
        if ('noSession' in resolved) {
          vscode.window.showInformationMessage(
            'No GemStone session to back up. Connect a session first.',
          );
          return;
        }
        const session = resolved.session;
        const db = sysadminStorage
          .getDatabases()
          .find((d) => d.config.stoneName === session.login.stone);
        if (!db) {
          vscode.window.showErrorMessage(
            `Online extent backup needs a Jasper-managed local stone (to reach its extent files). ` +
              `Stone "${session.login.stone}" isn't managed here — use Full Logical Backup instead.`,
            { modal: true },
          );
          return;
        }
        const backedUp = await runOnlineExtentBackup({
          execute: (code) => queries.executeFetchString(session, code),
          stoneName: session.login.stone,
          dbPath: db.path,
          dataDir: path.join(db.path, 'data'),
          listDataFiles: (dir) => wslReaddirSync(dir),
          ensureDir: (dir) => wslMkdirSync(dir, { recursive: true }),
          copyFile: (src, dst) => wslImportFileSync(src, dst),
          fileExists: wslExistsSync,
        });
        if (backedUp) refreshAdminViews();
      },
    ),

    vscode.commands.registerCommand(
      'gemstone.fullLogicalRestore',
      async (item?: GemStoneSessionItem | DatabaseNode) => {
        // Two entry points: the Sessions view button (a GemStoneSessionItem) and
        // a right-click on a backup-file node in the Databases tree. Either way we
        // need a LIVE session (for credentials to re-login through the restore's
        // stop/start cycle) and a locally-managed database (the restore must run
        // on the stone's own host).
        let session: ActiveSession | undefined;
        let backupFile: string | undefined;
        let db: GemStoneDatabase | undefined;

        if (item instanceof GemStoneSessionItem) {
          session = item.activeSession;
        } else if (item && 'kind' in item && item.kind === 'backupFile') {
          backupFile = item.filePath;
          db = item.db;
          session = sessionManager
            .getSessions()
            .find((s) => s.login.stone === db!.config.stoneName);
          if (!session) {
            vscode.window.showWarningMessage(
              `A full logical restore runs over a live session (it needs your login to reconnect ` +
                `through the stone restart). Log in to "${db.config.stoneName}" first, then try again.`,
              { modal: true },
            );
            return;
          }
        } else {
          session = sessionManager.getSelectedSession();
        }
        if (!session) {
          vscode.window.showInformationMessage(
            'No GemStone session to restore. Connect a session to the stone you want to restore first.',
          );
          return;
        }

        db =
          db ??
          sysadminStorage.getDatabases().find((d) => d.config.stoneName === session.login.stone);
        if (!db) {
          vscode.window.showErrorMessage(
            `Full logical restore currently requires a database created through Jasper's Databases ` +
              `panel — it needs to stop/start the stone and locate its extent, which Jasper only ` +
              `knows how to do for databases it manages. "${session.login.stone}" is not one of them ` +
              '(it was created outside Jasper), so it cannot be restored this way yet.',
            { modal: true },
          );
          return;
        }

        // Capture what we need before the session is torn down. The GciLibrary
        // outlives its session's logout, so the transient restore logins reuse it.
        const harvested = session.login;
        const gci = session.gci;
        const sessionId = session.id;
        const managed = db;
        const dataDir = path.join(managed.path, 'data');
        const gsPath = sysadminStorage.getGemstonePath(managed.config.version);

        const toRestoreSession = (t: {
          session: ActiveSession;
          logout: () => void;
        }): RestoreSession => ({
          run: (label, code) =>
            queries.executeFetchStringNb(t.session, label, code, undefined, true),
          logout: t.logout,
        });

        const restored = await runLogicalRestore({
          stoneName: managed.config.stoneName,
          dbPath: managed.path,
          backupFile,
          hasFileControl: () =>
            hasFileControlPrivilege((code) => queries.executeFetchString(session, code)),
          closeCurrentSession: async () => {
            sessionManager.logout(sessionId);
          },
          stopStone: async () => {
            // GciTsLogout returns before the stone finishes deregistering our gem,
            // so stopstone (which logs in itself to request shutdown) can still see
            // our just-closed session and refuse with "Other users logged in" (exit
            // 13). Retry briefly to ride out that deregistration lag; a genuine
            // other-user situation simply fails after the retries with that message.
            let lastErr: unknown;
            for (let attempt = 0; attempt < 6; attempt++) {
              try {
                await processManager.stopStone(managed);
                return;
              } catch (e) {
                lastErr = e;
                await new Promise((resolve) => setTimeout(resolve, 1500));
              }
            }
            throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
          },
          startStone: async () => {
            await processManager.startStone(managed);
          },
          copyCurrentExtentAside: async (destPath) => {
            wslMkdirSync(path.dirname(destPath), { recursive: true });
            wslImportFileSync(path.join(dataDir, 'extent0.dbf'), destPath);
          },
          swapInFreshExtent: async () => {
            if (!gsPath) {
              throw new Error(
                `GemStone ${managed.config.version} installation not found; cannot obtain a fresh extent.`,
              );
            }
            const pristine = path.join(gsPath, 'bin', 'extent0.dbf');
            if (!wslExistsSync(pristine)) {
              throw new Error(`Fresh extent not found at ${pristine}.`);
            }
            for (const entry of wslReaddirSync(dataDir)) {
              if (entry.toLowerCase().endsWith('.dbf')) {
                wslUnlinkSync(path.join(dataDir, entry));
              }
            }
            const dest = path.join(dataDir, 'extent0.dbf');
            wslImportFileSync(pristine, dest);
            wslChmodSync(dest, 0o644);
          },
          loginAsDefaultAdmin: async () =>
            toRestoreSession(
              sessionManager.loginTransient(
                { ...harvested, gs_user: 'DataCurator', gs_password: DEFAULT_GS_PW },
                gci,
              ),
            ),
          loginAsSessionUser: async () =>
            toRestoreSession(sessionManager.loginTransient(harvested, gci)),
        });

        if (restored) {
          // Best-effort: re-establish the user's normal interactive session (the
          // restored repo carries the real accounts again). If it fails, the
          // success toast already told the user to reconnect manually.
          const libraryPath = storage.getGciLibraryPath(harvested.version);
          if (libraryPath) {
            try {
              const s = sessionManager.login(harvested, libraryPath);
              refreshEnhancedInspectorAvailable(s);
            } catch {
              /* user reconnects manually */
            }
          }
          refreshAdminViews();
        }
      },
    ),
  );
}

export function deactivate(): Thenable<void> | undefined {
  stopAllSeasideServers();
  if (fileInManager) {
    fileInManager.dispose();
  }
  if (exportManager) {
    exportManager.dispose();
  }
  if (sessionManager) {
    sessionManager.dispose();
  }
  if (!client) return undefined;
  return client.stop();
}

export async function openTextEditorOn(uri: vscode.Uri) {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (error) {
    await logJasperError(`Failed to open text editor on ${uri.toString()}`, 'Editor', error);
  }
}

export async function closeTextEditorOn(uri: vscode.Uri) {
  const uriString = uri.toString();
  await Promise.all(
    textEditorsOn(uriString).map(async (tab) => {
      try {
        await vscode.window.tabGroups.close(tab);
      } catch (error) {
        await logJasperError(`Failed to close text editor on ${uriString}`, 'Editor', error);
      }
    }),
  );
}

function textEditorsOn(uriString: string) {
  return vscode.window.tabGroups.all.flatMap((tabGroup) =>
    tabGroup.tabs.filter((tab) => isTextEditorFor(tab, uriString)),
  );
}

function isTextEditorFor(tab: vscode.Tab, uriString: string) {
  return tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uriString;
}
