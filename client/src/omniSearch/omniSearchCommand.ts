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
import { defaultQueryExecutorUsing, sendersOf, referencesToObject } from '../browserQueries';
import { getAllClassNames } from '../queries/getAllClassNames';
import { getDictionaryNames } from '../queries/getDictionaryNames';
import { searchSelectors } from '../queries/searchSelectors';
import { SystemBrowser } from '../systemBrowser';
import { buildMethodUri } from '../gemstoneFileSystemProvider';
import { readOmniConfig } from './omniConfig';
import { OmniProvider, OmniResult } from './omniTypes';
import { runOmniAction, OmniActionHandlers } from './omniActions';
import { createClassesProvider } from './providers/classesProvider';
import { createDictionariesProvider } from './providers/dictionariesProvider';
import { createMethodsProvider } from './providers/methodsProvider';
import {
  createOmniController,
  OmniController,
  OmniQuickItem,
  ReferenceView,
} from './omniSearchController';
import { referenceRequestFor, methodRowsToResults } from './references';

/** Context key that's true only while the Omni Search picker is open, so the Alt+Enter keybinding
 *  for references fires there and nowhere else. */
const OMNI_ACTIVE_CONTEXT = 'gemstone.omniSearchActive';

/** Context key that's true only while the reference view is showing, so the Left-arrow "back"
 *  keybinding fires only in the pivot (elsewhere Left is normal cursor movement). */
const OMNI_IN_PIVOT_CONTEXT = 'gemstone.omniSearchInPivot';

/** The controller for the currently-open picker, so the (global) references command can act on its
 *  highlighted row. Cleared when the picker hides. */
let activeController: OmniController | undefined;

/** The vscode/SystemBrowser side of activating a result. */
export function buildOmniHandlers(): OmniActionHandlers {
  return {
    openClass(a) {
      if (!SystemBrowser.navigateToClass(a.sessionId, a.dictName, a.className, a.dictIndex)) {
        const uri = vscode.Uri.parse(
          `gemstone://${a.sessionId}` +
            `/${encodeURIComponent(a.dictName)}` +
            `/${encodeURIComponent(a.className)}` +
            `/definition?dict=${a.dictIndex}`,
        );
        void vscode.commands.executeCommand('gemstone.openDocument', uri);
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
      void vscode.commands.executeCommand('gemstone.openDocument', uri);
    },
    revealDictionary(a) {
      // Cascade the Explorer to the named dictionary and select its row (the command resolves the
      // symbol-list index and reveals it — a bare pane `.focus` would not select the dictionary).
      void vscode.commands.executeCommand('gemstone.explorer.revealDictionary', a.dictName);
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
    return { title: req.title, results: methodRowsToResults(rows, session.id) };
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
  ];
  return all.filter((p) => enabled.includes(p.category.id));
}

export async function runOmniSearch(sessionManager: SessionManager): Promise<void> {
  const session = await sessionManager.resolveSession();
  if (!session) return;

  const config = readOmniConfig(vscode.workspace.getConfiguration('gemstone.omniSearch'));
  const providers = buildProviders(session, config.enabledCategories);

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

export function registerOmniSearch(sessionManager: SessionManager): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('gemstone.omniSearch', () => runOmniSearch(sessionManager)),
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
