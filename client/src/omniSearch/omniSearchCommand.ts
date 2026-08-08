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
import { defaultQueryExecutorUsing } from '../browserQueries';
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
import { createOpenEditorsProvider, OpenTab } from './providers/openEditorsProvider';
import { createOmniController, OmniQuickItem } from './omniSearchController';

const EXPLORER_DICTS_VIEW = 'gemstoneExplorerDicts';

/** Currently open `gemstone:` editor tabs, as provider input. */
export function listGemstoneTabs(): OpenTab[] {
  const tabs: OpenTab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText && input.uri.scheme === 'gemstone') {
        tabs.push({ label: tab.label, uri: input.uri.toString() });
      }
    }
  }
  return tabs;
}

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
    revealDictionary() {
      // No `gemstone:` document exists for a dictionary; focus the Explorer's Dictionaries pane so
      // the user lands on the list. A precise reveal-and-select is a follow-up.
      void vscode.commands.executeCommand(`${EXPLORER_DICTS_VIEW}.focus`);
    },
    focusEditor(a) {
      void vscode.window.showTextDocument(vscode.Uri.parse(a.uri), { preview: false });
    },
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
    createOpenEditorsProvider(listGemstoneTabs),
  ];
  return all.filter((p) => enabled.includes(p.category.id));
}

export async function runOmniSearch(sessionManager: SessionManager): Promise<void> {
  const session = await sessionManager.resolveSession();
  if (!session) return;

  const config = readOmniConfig(vscode.workspace.getConfiguration('gemstone.omniSearch'));
  const providers = buildProviders(session, config.enabledCategories);

  const qp = vscode.window.createQuickPick<OmniQuickItem>();
  qp.title = 'Omni Search';
  qp.ignoreFocusOut = false;

  const handlers = buildOmniHandlers();
  const activate = (result: OmniResult) => runOmniAction(result.action, handlers);

  const controller = createOmniController({
    quickPick: qp,
    providers,
    config,
    activate,
    onError: (message) => vscode.window.showErrorMessage(`Omni Search: ${message}`),
  });
  await controller.start();
}

export function registerOmniSearch(sessionManager: SessionManager): vscode.Disposable {
  return vscode.commands.registerCommand('gemstone.omniSearch', () =>
    runOmniSearch(sessionManager),
  );
}
