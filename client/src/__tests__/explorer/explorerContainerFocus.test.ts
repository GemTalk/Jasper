/**
 * A jump from elsewhere in Jasper brings the GemStone Explorer up and lands you
 * on what you jumped to.
 *
 * Nothing used to focus the `gemstoneExplorer` view container — the client's
 * only view-container focus call was `workbench.view.testing.focus`, going the
 * other way — so these jumps cascaded the panes and left the sidebar on whatever
 * container it was already showing. That also made the cascade a no-op: a tree
 * view inside a hidden container is not `visible`, and `revealCascade` returns
 * early on exactly that. `focusGemStoneExplorer` now runs BEFORE the cascade,
 * which is the order both halves depend on.
 *
 * A PLAIN CLICK on a test row is deliberately not one of these jumps and is not
 * tested here: it navigates nothing on purpose (`syncPanesToEditor` bails out
 * for a test item's document), and clicks in the Testing view stay in the
 * Testing view. The activity bar shows one container at a time, so a click that
 * took the sidebar would have to be clicked back before the next test. Reveal in
 * GemStone Explorer is how you ask to be taken there, and it is the gesture
 * covered below; explorerOpenMethod.test.ts guards the plain click.
 *
 * The container focus is asserted loosely, by looking for any executed command
 * that opens the `gemstoneExplorer` container, because what matters is that
 * SOMETHING brings it up — not which of `workbench.view.extension.gemstoneExplorer`
 * or a pane's own `<viewId>.focus` does it. A future change is free to swap one
 * for the other without rewriting these.
 *
 * Covers https://github.com/GemTalk/Jasper/issues/629
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getAllClassNames: vi.fn(() => []),
  getClassesWithCategory: vi.fn(() => []),
  getClassEnvironments: vi.fn(() => []),
  getDictionaryNames: vi.fn(() => ['UserGlobals']),
  getDefinedInstVarCounts: vi.fn(() => new Map()),
  getDefinedClassVarCounts: vi.fn(() => new Map()),
  getClassHierarchy: vi.fn(() => []),
  getClassDescendantNames: vi.fn(() => []),
  getMethodInstVarAccess: vi.fn(() => []),
  isKernelClass: vi.fn(() => false),
}));
vi.mock('../../gciLog', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
  getGciLog: vi.fn(() => ({ show: vi.fn(), appendLine: vi.fn() })),
  _resetGciLogForTests: vi.fn(),
}));

import { ExplorerController } from '../../gemstoneExplorer';
import { Uri, commands, __resetConfig } from '../../__mocks__/vscode';
import {
  getAllClassNames,
  getClassesWithCategory,
  getClassEnvironments,
} from '../../browserQueries';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const SESSION_ID = 7;
const SESSION = { id: SESSION_ID } as ActiveSession;

const executeCommand = commands.executeCommand as ReturnType<typeof vi.fn>;

/** Every command the run executed, as plain strings. */
function executedCommands(): string[] {
  return executeCommand.mock.calls.map((c) => String(c[0]));
}

/**
 * Did anything bring the GemStone Explorer's activity-bar container up? Matches
 * either shape a fix could take: the container command VS Code generates for a
 * contributed `viewsContainers` entry, or a `.focus` on one of the six panes
 * inside it (all named `gemstoneExplorer*`).
 */
function focusedTheExplorerContainer(): boolean {
  return executedCommands().some(
    (c) =>
      c === 'workbench.view.extension.gemstoneExplorer' ||
      c === 'workbench.view.extension.gemstoneExplorer.focus' ||
      (/^gemstoneExplorer/.test(c) && c.endsWith('.focus')),
  );
}

/** A TreeView stub. `visible` is the flag `revealCascade` gates on. */
function fakeView(visible = true) {
  return { reveal: vi.fn(async () => {}), selection: [] as unknown[], description: '', visible };
}

function withViews(ctl: ExplorerController, visible = true) {
  const views = {
    dict: fakeView(visible),
    category: fakeView(visible),
    klass: fakeView(visible),
    hierarchy: fakeView(visible),
    method: fakeView(visible),
  };
  ctl.setViews(views as never);
  // Model what VS Code does when the container is shown: the views inside it
  // become visible. Without this a stub starts hidden and stays hidden, and a
  // cascade that the real editor would run looks skipped for a reason the real
  // editor does not have — which is the whole point of the hidden-container
  // test below.
  executeCommand.mockImplementation((command: unknown) => {
    if (command === 'workbench.view.extension.gemstoneExplorer') {
      for (const v of Object.values(views)) v.visible = true;
    }
    return Promise.resolve(undefined);
  });
  return views;
}

function makeController(): ExplorerController {
  const sessionManager = {
    getSelectedSession: () => SESSION,
    getSession: (id: number) => (id === SESSION_ID ? SESSION : undefined),
    resolveSession: () => Promise.resolve(SESSION),
  } as unknown as SessionManager;
  return new ExplorerController(sessionManager);
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
  vi.mocked(getAllClassNames).mockReturnValue([
    { className: 'Account', dictName: 'UserGlobals', dictIndex: 1 },
  ]);
  vi.mocked(getClassesWithCategory).mockReturnValue([
    { className: 'Account', category: 'Finance', hasComment: false },
  ]);
  vi.mocked(getClassEnvironments).mockReturnValue([
    { isMeta: false, envId: 0, category: 'accessing', selectors: ['balance'] },
  ]);
});

describe('Browse Class from the Inspector or the debugger', () => {
  // Both go through `gemstone.explorer.findClass` — the Inspector's browse
  // (client/src/basicInspector/basicInspector.ts) and the debugger's frame
  // Browse (client/src/debuggerPanel.ts) — so the controller method they land
  // on is where the sidebar switch is missing.
  it('brings the GemStone Explorer up, not just the panes', async () => {
    const ctl = makeController();
    withViews(ctl);

    await ctl.findClass('Account', SESSION_ID);

    // The cascade itself works: the panes did land on the class.
    expect(ctl.state.className).toBe('Account');
    // What is missing is the sidebar switch.
    expect(focusedTheExplorerContainer()).toBe(true);
  });

  it('reveals the class row even when the container was hidden', async () => {
    // The second half of the same root cause: a tree view inside a container
    // that isn't showing reports `visible === false`, and `revealCascade`
    // returns early on exactly that — so with the container closed, every
    // cascade reveal in the jump was skipped. Showing the container first is
    // what makes the reveal land, which is why the focus has to come BEFORE the
    // cascade rather than after it.
    const ctl = makeController();
    const views = withViews(ctl, false);

    await ctl.findClass('Account', SESSION_ID);

    expect(views.klass.reveal).toHaveBeenCalled();
  });
});

describe('Reveal in GemStone Explorer, from a test row', () => {
  // The explicit gesture, not the plain click: the $(list-tree) button and the
  // context-menu item on every Testing-view row (`gemstone.revealTestInExplorer`
  // in client/src/extension.ts, contributed at package.json's
  // `testing/item/context`). It exists precisely because a plain click
  // deliberately navigates nothing — so this IS the user asking to be taken
  // there, and the doc-comment on `revealCascade` puts "a reveal that IS the
  // user's request" in the group that is expected to show its pane.
  //
  // The cascade half already works (the claim lets it past the test-item
  // guard); what is missing is the same container focus as every other jump.
  const TEST_URI = 'gemstone://7/UserGlobals/Account/instance/accessing/balance';

  function controllerWithSunit(): ExplorerController {
    const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
    const ctl = new ExplorerController(sessionManager, undefined, undefined, undefined, {
      isTestClass: () => true,
      isTestItemUri: (uri) => uri.toString() === TEST_URI,
      resultFor: () => undefined,
      onDidChangeResults: () => ({ dispose: () => {} }),
      revealInTestExplorer: () => Promise.resolve(true),
    });
    ctl.state.dictName = 'UserGlobals';
    ctl.state.dictIndex = 1;
    ctl.state.className = 'Account';
    vi.spyOn(ctl as unknown as { selectorsFor: () => unknown }, 'selectorsFor').mockReturnValue([
      { selector: 'balance', category: 'accessing', overrideBits: 0, sessionBit: 0 },
    ] as never);
    return ctl;
  }

  it('cascades the panes to the test method', async () => {
    // The half that already works — asserted so the focus failure below cannot
    // be mistaken for the reveal never having been attempted.
    const ctl = controllerWithSunit();
    const views = withViews(ctl);

    await ctl.revealDocument(Uri.parse(TEST_URI));

    expect(views.method.reveal).toHaveBeenCalled();
  });

  it('brings the GemStone Explorer up', async () => {
    const ctl = controllerWithSunit();
    withViews(ctl);

    await ctl.revealDocument(Uri.parse(TEST_URI));

    expect(focusedTheExplorerContainer()).toBe(true);
  });

  it('leaves the row drawn as the ACTIVE selection, not handed back to the editor', async () => {
    // The reveal takes the tree's focus to force the scroll, and an editor-driven
    // sync hands it straight back. Doing that here leaves the row selected in a
    // tree that has no focus, which VS Code paints in its inactive-selection
    // colour -- the method arrives looking like nothing was landed on.
    const ctl = controllerWithSunit();
    const views = withViews(ctl);

    await ctl.revealDocument(Uri.parse(TEST_URI));

    expect(views.method.reveal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ select: true, focus: true }),
    );
    expect(executedCommands()).not.toContain('workbench.action.focusActiveEditorGroup');
  });

  it('waits for the Methods pane before cascading, so the reveal is not skipped', async () => {
    // VS Code resolves the tree views inside a container AFTER the container
    // command has returned, so the panes still report visible:false for a tick or
    // two, and a cascade reveal into a view that is not visible is skipped. The
    // highlight is re-applied when the pane appears, but only as a plain select,
    // so without this wait the row the user asked to be taken to arrives without
    // focus. Modelled here the way the editor really behaves; a stub that flips
    // visible synchronously passes whether or not the wait exists.
    const ctl = controllerWithSunit();
    const views = withViews(ctl, false);
    executeCommand.mockImplementation((command: unknown) => {
      if (command === 'workbench.view.extension.gemstoneExplorer') {
        setTimeout(() => {
          for (const v of Object.values(views)) v.visible = true;
        }, 40);
      }
      return Promise.resolve(undefined);
    });

    await ctl.revealDocument(Uri.parse(TEST_URI));

    expect(views.method.reveal).toHaveBeenCalled();
  });

  it('still hands focus back on an ordinary editor-driven sync', async () => {
    // The flag is raised only for the duration of the explicit reveal. Typing in
    // an editor must not end with the cursor stranded in the tree.
    const ctl = controllerWithSunit();
    withViews(ctl);
    ctl.markAttributedOpen(Uri.parse(TEST_URI));

    await ctl.syncToEditor(Uri.parse(TEST_URI));

    expect(executedCommands()).toContain('workbench.action.focusActiveEditorGroup');
  });
});
