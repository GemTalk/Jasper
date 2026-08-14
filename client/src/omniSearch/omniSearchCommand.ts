/**
 * Command entry point for Omni Search (`gemstone.omniSearch`).
 *
 * This is the thin wiring layer: resolve the active session, build the session-bound providers +
 * result-activation handlers (the only place that touches `vscode`, the SystemBrowser and the
 * `gemstone:` uri builders), and hand them to the controller. All the logic lives in the
 * unit-tested pieces (matcher, providers, controller, action dispatcher).
 */
import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from '../sessionManager';
import {
  defaultQueryExecutorUsing,
  sendersOf,
  referencesToObject,
  getMethodSource,
  getClassDefinition,
} from '../browserQueries';
import { getAllClassNames } from '../queries/getAllClassNames';
import { getAllGlobalNames } from '../queries/getAllGlobalNames';
import { getAllClassCategories } from '../queries/getAllClassCategories';
import { getDictionaryNames } from '../queries/getDictionaryNames';
import { searchSelectors } from '../queries/searchSelectors';
import {
  searchMethodSource,
  literalSymbolReferences,
  stringLiteralReferences,
} from '../queries/methodSearch';
import { SystemBrowser } from '../systemBrowser';
import { buildMethodUri } from '../gemstoneFileSystemProvider';
import { readOmniConfig } from './omniConfig';
import { OMNI_OPEN_KEY_HINT } from './omniSearchShared';
import { OmniProvider, OmniResult } from './omniTypes';
import { runOmniAction, OmniActionHandlers } from './omniActions';
import { createClassesProvider } from './providers/classesProvider';
import { createDictionariesProvider } from './providers/dictionariesProvider';
import { createMethodsProvider } from './providers/methodsProvider';
import { createGlobalsProvider } from './providers/globalsProvider';
import { createSourceProvider } from './providers/sourceProvider';
import { createLiteralsProvider } from './providers/literalsProvider';
import { createCategoriesProvider } from './providers/categoriesProvider';
import {
  createOmniController,
  OmniController,
  OmniQuickItem,
  ReferenceView,
} from './omniSearchController';
import { referenceRequestFor, methodRowsToResults } from './references';
import { OmniSearchPanel } from './omniSearchPanel';
import { OmniSearchViewProvider, OmniViewContext, OMNI_VIEW_ID } from './omniSearchViewProvider';

/** Context key that's true only while the Omni Search picker is open, so the Alt+Enter keybinding
 *  for references fires there and nowhere else. */
const OMNI_ACTIVE_CONTEXT = 'gemstone.omniSearchActive';

/** Context key that's true only while the reference view is showing, so the Left-arrow "back"
 *  keybinding fires only in the pivot (elsewhere Left is normal cursor movement). */
const OMNI_IN_PIVOT_CONTEXT = 'gemstone.omniSearchInPivot';

/** The controller for the currently-open picker, so the (global) references command can act on its
 *  highlighted row. Cleared when the picker hides. */
let activeController: OmniController | undefined;

/** Where a result should open. The QuickPick passes nothing (open in the active group, the prior
 *  behavior); the Spotter passes `Beside` + a `preserveFocus` flag so a result opens beside the
 *  panel — optionally without stealing focus from the search field. */
export interface OmniOpenOptions {
  viewColumn?: vscode.ViewColumn;
  preserveFocus?: boolean;
  /** false → open a regular, persistent editor (not a throwaway preview tab). */
  preview?: boolean;
}

/** The vscode/SystemBrowser side of activating a result. `openOptions` is threaded to the document
 *  open so the Spotter can open beside itself; omitted → the classic active-group open. */
export function buildOmniHandlers(openOptions?: OmniOpenOptions): OmniActionHandlers {
  return {
    openClass(a) {
      if (!SystemBrowser.navigateToClass(a.sessionId, a.dictName, a.className, a.dictIndex)) {
        const uri = vscode.Uri.parse(
          `gemstone://${a.sessionId}` +
            `/${encodeURIComponent(a.dictName)}` +
            `/${encodeURIComponent(a.className)}` +
            `/definition?dict=${a.dictIndex}`,
        );
        void vscode.commands.executeCommand('gemstone.openDocument', uri, openOptions);
      }
    },
    openMethod(a) {
      const uri = buildMethodUri({
        kind: 'method',
        sessionId: a.sessionId,
        dictName: a.dictName,
        className: a.className,
        isMeta: a.isMeta,
        category: a.category,
        selector: a.selector,
        environmentId: a.environmentId,
        // The selector search yields a dict NAME, not an index; omit the index so the fs provider
        // resolves by name (0 would be an invalid 1-based SymbolList index).
        dictIndex: a.dictIndex > 0 ? a.dictIndex : undefined,
      });
      void vscode.commands.executeCommand('gemstone.openDocument', uri, openOptions);
    },
    revealDictionary(a) {
      // Cascade the Explorer to the named dictionary and select its row (the command resolves the
      // symbol-list index and reveals it — a bare pane `.focus` would not select the dictionary).
      void vscode.commands.executeCommand('gemstone.explorer.revealDictionary', a.dictName);
    },
    revealGlobal(a) {
      // Jump to the class of the global's value (e.g. Transcript → its stream class) — more useful
      // than landing in the whole dictionary. findClass resolves the class's home dict + reveals it.
      void vscode.commands.executeCommand('gemstone.explorer.findClass', a.className);
    },
    revealCategory(a) {
      // Select the category's home dictionary, then select + reveal the category node (and filter the
      // classes pane to it) — not just land in the dictionary.
      void vscode.commands.executeCommand(
        'gemstone.explorer.revealCategory',
        a.dictName,
        a.category,
      );
    },
  };
}

/** Load the references/senders of a result: senders of a method's selector, or references to a
 *  class. Returns null for a non-referenceable result (e.g. a dictionary). */
export function resolveReferencesUsing(
  session: ActiveSession,
): (result: OmniResult) => ReferenceView | null {
  return (result) => {
    const req = referenceRequestFor(result);
    if (!req) return null;
    const rows =
      req.kind === 'senders'
        ? sendersOf(session, req.selector, req.environmentId)
        : referencesToObject(session, req.className, req.environmentId);
    const target = req.kind === 'senders' ? req.selector : req.className;
    return { title: req.title, target, results: methodRowsToResults(rows, session.id) };
  };
}

/** Build the enabled providers for a session, in canonical category order. */
export function buildProviders(session: ActiveSession, enabled: readonly string[]): OmniProvider[] {
  const exec = defaultQueryExecutorUsing(session);
  const all: OmniProvider[] = [
    createClassesProvider(session.id, () => getAllClassNames(exec)),
    createMethodsProvider(session.id, (term, limit, ignoreCase) =>
      searchSelectors(exec, term, { limit, ignoreCase }),
    ),
    createDictionariesProvider(session.id, () => getDictionaryNames(exec)),
    createGlobalsProvider(session.id, () => getAllGlobalNames(exec)),
    createSourceProvider(session.id, (term, ignoreCase) =>
      searchMethodSource(exec, term, ignoreCase),
    ),
    createLiteralsProvider(
      session.id,
      (symbolExpr) => literalSymbolReferences(exec, symbolExpr),
      (text, ignoreCase) => stringLiteralReferences(exec, text, ignoreCase),
    ),
    createCategoriesProvider(session.id, () => getAllClassCategories(exec)),
  ];
  return all.filter((p) => enabled.includes(p.category.id));
}

/** Source text to preview for a result in the preview pane: a method's source, a class (or global's
 *  class) definition. Reveal-only actions (dictionary / category) have no source → ''. Runs
 *  synchronously against the session; the host wraps the call so a failure just shows no preview. */
export function buildPreviewSource(session: ActiveSession): (result: OmniResult) => string {
  return (result) => {
    const a = result.action;
    if (a.kind === 'openMethod') {
      return getMethodSource(
        session,
        a.className,
        a.isMeta,
        a.selector,
        a.environmentId,
        a.dictIndex > 0 ? a.dictIndex : a.dictName,
      );
    }
    if (a.kind === 'openClass') {
      return getClassDefinition(session, a.className, a.dictIndex);
    }
    if (a.kind === 'revealGlobal') {
      // Preview the class of the global's value (e.g. Transcript → its stream class definition).
      return getClassDefinition(session, a.className);
    }
    return '';
  };
}

/** A non-prompting resolver of the current session's Omni deps for the bottom-panel view — used when
 *  the view lazily (re)builds its engine. Prefers the selected session; falls back to the sole
 *  session; returns null (→ "log in" notice) when there's nothing to search. The view's activation
 *  opens results normally (in the editor area above the docked panel), so it needs no beside/close. */
export function buildViewContextResolver(
  sessionManager: SessionManager,
): () => Promise<OmniViewContext | null> {
  return async () => {
    const sessions = sessionManager.getSessions();
    const session =
      sessionManager.getSelectedSession() ?? (sessions.length === 1 ? sessions[0] : undefined);
    if (!session) return null;
    const config = readOmniConfig(vscode.workspace.getConfiguration('gemstone.omniSearch'));
    return {
      sessionId: session.id,
      deps: {
        providers: buildProviders(session, config.enabledCategories),
        config,
        resolveReferences: resolveReferencesUsing(session),
        // The docked panel opens results in the editor area above it (no beside/close). Normally that
        // takes focus (you want to land in what you opened); when opening from the sticky references
        // list we pass preserveFocus so the keyboard stays in the list — honor it here.
        activate: (result, opts) =>
          runOmniAction(
            result.action,
            buildOmniHandlers(
              opts?.preserveFocus ? { preserveFocus: true, preview: false } : undefined,
            ),
          ),
        previewSource: buildPreviewSource(session),
        onError: (message) => vscode.window.showErrorMessage(`Omni Search: ${message}`),
      },
    };
  };
}

export async function runOmniSearch(
  sessionManager: SessionManager,
  viewProvider?: OmniSearchViewProvider,
): Promise<void> {
  // Which GemStone Search UI to open: the bottom-PANEL view (default), the editor-tab Spotter, or the
  // Phase-1 QuickPick. The panel view resolves its own session lazily, so branch before resolveSession.
  const ui = vscode.workspace.getConfiguration('gemstone.omniSearch').get<string>('ui', 'panel');
  if (ui === 'panel' && viewProvider) {
    await viewProvider.focus();
    return;
  }

  const session = await sessionManager.resolveSession();
  if (!session) return;

  const config = readOmniConfig(vscode.workspace.getConfiguration('gemstone.omniSearch'));
  const providers = buildProviders(session, config.enabledCategories);

  if (ui === 'spotter') {
    OmniSearchPanel.show({
      providers,
      config,
      resolveReferences: resolveReferencesUsing(session),
      // When pinned the Spotter stays open, so results open BESIDE it as a regular (non-preview)
      // source editor (preserveFocus keeps you in the field for Ctrl+Enter); unpinned it behaves like
      // the dialog and opens in the active group (a preview tab is fine — the dialog dismisses).
      activate: (result, opts) =>
        runOmniAction(
          result.action,
          buildOmniHandlers(
            opts.beside
              ? {
                  viewColumn: vscode.ViewColumn.Beside,
                  preserveFocus: opts.preserveFocus,
                  preview: false,
                }
              : undefined,
          ),
        ),
      previewSource: buildPreviewSource(session),
      onError: (message) => vscode.window.showErrorMessage(`Omni Search: ${message}`),
    });
    return;
  }

  const qp = vscode.window.createQuickPick<OmniQuickItem>();
  qp.ignoreFocusOut = false;

  const handlers = buildOmniHandlers();
  const activate = (result: OmniResult) => runOmniAction(result.action, handlers);

  const controller = createOmniController({
    quickPick: qp,
    providers,
    config,
    activate,
    resolveReferences: resolveReferencesUsing(session),
    onPivotChange: (inPivot) =>
      void vscode.commands.executeCommand('setContext', OMNI_IN_PIVOT_CONTEXT, inPivot),
    onError: (message) => vscode.window.showErrorMessage(`Omni Search: ${message}`),
  });

  // Make Alt+Enter (references of the highlighted row) reachable only while this picker is open.
  activeController = controller;
  void vscode.commands.executeCommand('setContext', OMNI_ACTIVE_CONTEXT, true);
  qp.onDidHide(() => {
    void vscode.commands.executeCommand('setContext', OMNI_ACTIVE_CONTEXT, false);
    void vscode.commands.executeCommand('setContext', OMNI_IN_PIVOT_CONTEXT, false);
    if (activeController === controller) activeController = undefined;
  });

  await controller.start();
}

/** globalState flag: the one-time "Ctrl/Cmd+Shift+A opens GemStone Search" tip has been shown. */
const SEARCH_TIP_SHOWN_KEY = 'gemstone.gemstoneSearchTipShown';

export function registerOmniSearch(
  sessionManager: SessionManager,
  context?: vscode.ExtensionContext,
): vscode.Disposable {
  // The bottom-panel view provider is registered up-front (before any session) and resolves its
  // session lazily; the command reveals it when `ui: "panel"` is selected.
  const viewProvider = new OmniSearchViewProvider(buildViewContextResolver(sessionManager));

  // Discoverability clue #1 (persistent): a status-bar button that opens GemStone Search and, via its
  // tooltip, teaches the shortcut that works from anywhere in a session. Shown only while a session
  // is active (the shortcut's own `when`).
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(search-fuzzy) GemStone Search';
  status.command = 'gemstone.omniSearch';
  status.tooltip = new vscode.MarkdownString(
    `Search classes, methods, globals, source, literals & categories.\n\nPress **${OMNI_OPEN_KEY_HINT}** from anywhere.`,
  );
  const syncStatus = (): void => {
    if (sessionManager.getSessions().length > 0) status.show();
    else status.hide();
  };

  // Discoverability clue #2 (one-time): the first time a session becomes active, nudge the user with
  // the shortcut in case the status bar goes unnoticed. Never repeats (globalState).
  const maybeTip = (): void => {
    if (!context || context.globalState.get<boolean>(SEARCH_TIP_SHOWN_KEY)) return;
    if (sessionManager.getSessions().length === 0) return;
    void context.globalState.update(SEARCH_TIP_SHOWN_KEY, true);
    void vscode.window
      .showInformationMessage(
        `Tip: press ${OMNI_OPEN_KEY_HINT} to open GemStone Search — find classes, methods, globals and more from anywhere.`,
        'Open now',
      )
      .then((pick) => {
        if (pick === 'Open now') void vscode.commands.executeCommand('gemstone.omniSearch');
      });
  };

  // Discoverability clue #3: switch to the GemStone Search panel the first time a session becomes
  // active (a 0 -> active transition = a login, NOT a switch between existing sessions), so the search
  // is right there ready to type. Only when the panel is the chosen UI (nothing to reveal otherwise).
  let hadSession = sessionManager.getSessions().length > 0;
  const onSelection = (): void => {
    const nowActive = sessionManager.getSessions().length > 0;
    syncStatus();
    maybeTip();
    if (nowActive && !hadSession) {
      const ui = vscode.workspace
        .getConfiguration('gemstone.omniSearch')
        .get<string>('ui', 'panel');
      // Defer the reveal: `selectSession` fires THIS event BEFORE it sets the `gemstone.hasActiveSession`
      // context that gates the view's `when` clause, so focusing synchronously finds no view to reveal.
      // A short delay lets the context propagate (and the login flow settle) before we switch tabs.
      if (ui === 'panel') setTimeout(() => void viewProvider.focus(), 400);
    }
    hadSession = nowActive;
  };

  syncStatus();
  maybeTip();

  return vscode.Disposable.from(
    status,
    sessionManager.onDidChangeSelection(onSelection),
    // The docked panel caches a session-bound engine that also baked in the settings live at build
    // time; drop it when any `gemstone.omniSearch` setting changes so the edit takes effect at once.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gemstone.omniSearch')) viewProvider.onConfigChanged();
    }),
    vscode.window.registerWebviewViewProvider(OMNI_VIEW_ID, viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('gemstone.omniSearch', () =>
      runOmniSearch(sessionManager, viewProvider),
    ),
    // Alt+Enter inside the picker: pivot to references/senders of the highlighted row.
    vscode.commands.registerCommand('gemstone.omniSearch.references', () =>
      activeController?.pivotActiveItem(),
    ),
    // Left arrow while in the reference view: go back to the search results (the ← button's key).
    vscode.commands.registerCommand('gemstone.omniSearch.back', () =>
      activeController?.exitPivot(),
    ),
  );
}
