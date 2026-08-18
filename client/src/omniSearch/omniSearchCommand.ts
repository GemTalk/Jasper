/**
 * Command entry point for Omni Search (`gemstone.omniSearch`).
 *
 * This is the thin wiring layer: resolve the active session, build the session-bound providers +
 * result-activation handlers (the only place that touches `vscode`, the SystemBrowser and the
 * `gemstone:` uri builders), and hand them to the chosen UI (the docked panel view or the editor-tab
 * Spotter). All the logic lives in the unit-tested pieces (matcher, providers, engine, action
 * dispatcher).
 */
import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from '../sessionManager';
import { logWarning } from '../gciLog';
import {
  defaultQueryExecutorUsing,
  sendersOf,
  referencesToObject,
  getMethodSource,
  getClassDefinition,
} from '../browserQueries';
import { getAllClassNames, getClassNameEntriesFor } from '../queries/getAllClassNames';
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
import { ReferenceView } from './omniEngine';
import { referenceRequestFor, methodRowsToResults } from './references';
import { OmniSearchPanel } from './omniSearchPanel';
import { OmniSearchViewProvider, OmniViewContext, OMNI_VIEW_ID } from './omniSearchViewProvider';

/** Where a result should open. The docked panel view passes nothing (open in the active group — the
 *  editor area sits above the panel, so there is nothing to open beside); the Spotter passes `Beside`
 *  + a `preserveFocus` flag so a result opens beside the panel — optionally without stealing focus
 *  from the search field. */
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
    createClassesProvider(
      session.id,
      () => getAllClassNames(exec),
      (name) => getClassNameEntriesFor(exec, name),
    ),
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
      // Surface a real runner failure (GCI drop / aborted transaction) to the durable log instead of
      // letting it masquerade as "no results". A bare string, so the thunk is all we need.
      (msg) => logWarning(msg),
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
        sessionId: session.id,
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
  // Which GemStone Search UI to open: the bottom-PANEL view (default) or the editor-tab Spotter. The
  // Spotter needs an eagerly-resolved session; the panel view resolves its own session lazily.
  const ui = vscode.workspace.getConfiguration('gemstone.omniSearch').get<string>('ui', 'panel');
  if (ui === 'spotter') {
    const session = await sessionManager.resolveSession();
    if (!session) return;

    const config = readOmniConfig(vscode.workspace.getConfiguration('gemstone.omniSearch'));
    const providers = buildProviders(session, config.enabledCategories);

    OmniSearchPanel.show({
      sessionId: session.id,
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

  // Default (and only other) UI: the docked bottom-panel view.
  if (viewProvider) await viewProvider.focus();
}

/** globalState flag: the one-time "Ctrl/Cmd+Shift+A opens GemStone Search" tip has been shown. */
const SEARCH_TIP_SHOWN_KEY = 'gemstone.gemstoneSearchTipShown';

/** Bounded retry budget for the post-login reveal (see `revealPanelAfterLogin`): the first attempt is
 *  immediate, so this only costs anything on a window slow enough to actually lose the race. */
const REVEAL_ATTEMPTS = 5;
const REVEAL_RETRY_MS = 60;

/**
 * Reveal the search panel after a login, waiting on the signal the view really depends on instead of
 * guessing how long the workbench needs.
 *
 * `SessionManager.selectSession` fires `onDidChangeSelection` BEFORE it sets the
 * `gemstone.hasActiveSession` context key, and that key is the view's `when` clause — so a reveal
 * driven straight off the event finds no view to show and does nothing at all. The previous code slept
 * a flat 400 ms and hoped: on a slow or busy window (remote, WSL, a crowded activation) that lost the
 * race with no retry and no warning, and on a fast one it made the panel arrive a visible beat late.
 *
 * Instead: assert the context key ourselves and AWAIT it — idempotent, since the session manager sets
 * the same value a tick later, but awaiting means it has actually landed — then reveal and use
 * `focus()`'s report of whether the view resolved, retrying briefly if the workbench hasn't caught up.
 * A reveal that never lands is logged instead of swallowed; the shortcut and status-bar button still
 * work, so this is a warning, not an error.
 */
export async function revealPanelAfterLogin(
  viewProvider: Pick<OmniSearchViewProvider, 'focus'>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  await vscode.commands.executeCommand('setContext', 'gemstone.hasActiveSession', true);
  for (let attempt = 1; attempt <= REVEAL_ATTEMPTS; attempt++) {
    if (await viewProvider.focus()) return true;
    if (attempt < REVEAL_ATTEMPTS) await sleep(REVEAL_RETRY_MS);
  }
  logWarning(
    'GemStone Search: the search panel did not appear after login — the view never resolved. ' +
      `Open it with ${OMNI_OPEN_KEY_HINT} or the GemStone Search button in the status bar.`,
  );
  return false;
}

/** The disposable for the Omni Search registration, plus hooks the extension calls when the image
 *  changes so an open search stays current: a local class compile, a class REMOVAL, and a session sync
 *  (commit/abort/file-in). All forward to whichever host is live (the docked panel view and/or the
 *  Spotter). */
export interface OmniSearchRegistration extends vscode.Disposable {
  notifyClassCompiled(sessionId: number, className: string, dictName?: string): void;
  /** A class was removed from the image (Explorer → Remove Class). Folded per class, not per delete
   *  command: removing a class takes its whole subtree with it, and each member has to leave the
   *  cached corpus. No `dictName` — the class is gone, so there is no dictionary left to name. */
  notifyClassRemoved(sessionId: number, className: string): void;
  notifySessionSynced(sessionId: number): void;
}

export function registerOmniSearch(
  sessionManager: SessionManager,
  context?: vscode.ExtensionContext,
): OmniSearchRegistration {
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
      // `selectSession` fires THIS event BEFORE it sets the `gemstone.hasActiveSession` context that
      // gates the view's `when` clause, so revealing right here finds no view. `revealPanelAfterLogin`
      // waits on that context key rather than on a timer (and reports a reveal that never lands).
      if (ui === 'panel') void revealPanelAfterLogin(viewProvider);
    }
    hadSession = nowActive;
  };

  syncStatus();
  maybeTip();

  const disposable = vscode.Disposable.from(
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
  );

  // Both class hooks fold the same way — re-fetch just that class name and reconcile the corpus.
  const foldClassChange = (sessionId: number, className: string, dictName?: string): void => {
    void viewProvider.onClassCompiled(sessionId, className, dictName);
    OmniSearchPanel.onClassCompiled(sessionId, className, dictName);
  };

  return {
    dispose: () => disposable.dispose(),
    notifyClassCompiled: foldClassChange,
    // A removal reuses the compile fold: the provider re-looks-up the name, the lookup comes back
    // empty, and the entry drops out — no full corpus re-enumeration for a delete.
    notifyClassRemoved: (sessionId, className) => foldClassChange(sessionId, className),
    notifySessionSynced: (sessionId) => {
      void viewProvider.onSessionSynced(sessionId);
      OmniSearchPanel.onSessionSynced(sessionId);
    },
  };
}
