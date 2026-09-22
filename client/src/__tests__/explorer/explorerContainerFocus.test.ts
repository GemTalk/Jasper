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
 * The container focus is asserted loosely, and the stub that models VS Code
 * reacts to the same set of commands the matcher accepts, so a future change
 * really is free to swap `workbench.view.extension.gemstoneExplorer` for a
 * pane's own `<viewId>.focus` without rewriting these — see
 * __tests__/helpers/explorerContainerFocus.ts, shared with the GemStone Search
 * suite that makes the same claim.
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
import {
  focusedTheExplorerContainer as sawContainerFocus,
  fakeViews,
  flipVisibleOnContainerShow,
} from '../helpers/explorerContainerFocus';
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

function focusedTheExplorerContainer(): boolean {
  return sawContainerFocus(executeCommand);
}

/** Views on the controller, plus the stub that makes showing the container flip
 *  them visible a tick later — the way VS Code really resolves them. `visible`
 *  is where they START; pass false for a container that is not showing yet. */
function withViews(ctl: ExplorerController, visible = true) {
  const views = fakeViews(visible);
  ctl.setViews(views as never);
  flipVisibleOnContainerShow(executeCommand, views);
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
    //
    // The stub flips `visible` on a timer, not synchronously, so this also
    // guards the wait: VS Code resolves the views after the container command
    // has returned, and without waiting for them the reveal here is skipped and
    // reapplyPaneHighlight catches the pane up only as a plain select — which
    // does not scroll, leaving a Browse landing on a row that can be off-screen.
    const ctl = makeController();
    const views = withViews(ctl, false);

    await ctl.findClass('Account', SESSION_ID);

    expect(views.klass.reveal).toHaveBeenCalled();
  });

  it('reveals the method row too, for the debugger frame Browse', async () => {
    // Browse from a debugger frame passes a method, so the cascade runs class
    // THEN method. Both are cascade reveals and both were skipped while the
    // container had not rendered.
    const ctl = makeController();
    const views = withViews(ctl, false);

    await ctl.findClass('Account', SESSION_ID, undefined, { selector: 'balance', isMeta: false });

    expect(views.klass.reveal).toHaveBeenCalled();
    expect(views.method.reveal).toHaveBeenCalled();
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

  it('waits for the container to render before cascading, so the reveal is not skipped', async () => {
    // VS Code resolves the tree views inside a container AFTER the container
    // command has returned, so the panes still report visible:false for a tick or
    // two, and a cascade reveal into a view that is not visible is skipped. The
    // highlight is re-applied when the pane appears, but only as a plain select,
    // so without this wait the row the user asked to be taken to arrives without
    // focus. The shared stub flips visible on a timer, the way the editor really
    // behaves; one that flipped it synchronously would pass whether or not the
    // wait exists.
    const ctl = controllerWithSunit();
    const views = withViews(ctl, false);

    await ctl.revealDocument(Uri.parse(TEST_URI));

    expect(views.method.reveal).toHaveBeenCalled();
  });

  it('returns promptly with the Methods pane collapsed, and leaves it collapsed', async () => {
    // The regression case for the collapsed-pane rule: a pane the user has closed
    // never becomes visible, so the wait can only end on its deadline — and the
    // gesture must not hang there. What is waited for is the CONTAINER rendering,
    // which one visible pane is enough to prove, so a collapsed Methods pane costs
    // the jump nothing and its reveal is skipped exactly as intended.
    vi.useFakeTimers();
    try {
      const ctl = controllerWithSunit();
      const views = fakeViews(false);
      ctl.setViews(views as never);
      // The container comes up and its OTHER panes resolve; the Methods pane stays
      // collapsed, which is what the user asked for by collapsing it.
      executeCommand.mockImplementation((command: unknown) => {
        if (String(command) === 'workbench.view.extension.gemstoneExplorer') {
          setTimeout(() => {
            views.dict.visible = true;
            views.category.visible = true;
            views.klass.visible = true;
            views.hierarchy.visible = true;
          }, 40);
        }
        return Promise.resolve(undefined);
      });

      const done = vi.fn();
      void ctl.revealDocument(Uri.parse(TEST_URI)).then(done);
      // Well inside the deadline: the jump ends when the container renders, not
      // when the collapsed pane does (it never will).
      await vi.advanceTimersByTimeAsync(100);

      expect(done).toHaveBeenCalled();
      expect(views.method.reveal).not.toHaveBeenCalled();
      expect(views.method.visible).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a deadline when every pane is collapsed, rather than hanging', async () => {
    // Nothing in the container ever reports visible, so there is no event to wait
    // for and only the deadline ends it. Bounded is the whole requirement here:
    // the reveal is skipped, and the gesture still returns.
    vi.useFakeTimers();
    try {
      const ctl = controllerWithSunit();
      const views = fakeViews(false);
      ctl.setViews(views as never);
      executeCommand.mockImplementation(() => Promise.resolve(undefined));

      const done = vi.fn();
      void ctl.revealDocument(Uri.parse(TEST_URI)).then(done);
      await vi.advanceTimersByTimeAsync(5000);

      expect(done).toHaveBeenCalled();
      expect(views.method.reveal).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still hands focus back on an ordinary editor-driven sync', async () => {
    // keepTreeFocus is passed only by the explicit reveal. Typing in an editor
    // must not end with the cursor stranded in the tree.
    const ctl = controllerWithSunit();
    withViews(ctl);
    ctl.markAttributedOpen(Uri.parse(TEST_URI));

    await ctl.syncToEditor(Uri.parse(TEST_URI));

    expect(executedCommands()).toContain('workbench.action.focusActiveEditorGroup');
  });
});
