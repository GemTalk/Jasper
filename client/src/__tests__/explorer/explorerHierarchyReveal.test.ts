import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// The controller pulls in browserQueries (→ native GCI). Stub it; these tests
// only exercise revealHierarchySelf, which never reaches a query.
vi.mock('../../browserQueries', () => ({}));

import { ExplorerController, HierarchyItem } from '../../gemstoneExplorer';
import type { ClassHierarchyEntry } from '../../queries/getClassHierarchy';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const SESSION = { id: 1 } as ActiveSession;

// revealHierarchySelf reads the private hierarchy chain the load step fills in;
// seed it directly so the test doesn't need a live query.
type HierAccess = { hierChain: ClassHierarchyEntry[]; hierSubs: ClassHierarchyEntry[] };

function makeController(): ExplorerController {
  const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const access = ctl as unknown as HierAccess;
  access.hierChain = [
    { className: 'Array', dictName: 'UserGlobals', kind: 'self', binding: 'bound' },
  ];
  access.hierSubs = [];
  return ctl;
}

// A TreeView-shaped stub whose `visible` flag mirrors whether the pane section
// is expanded in the sidebar.
function fakeView(visible = true) {
  return { reveal: vi.fn(async () => {}), selection: [] as unknown[], description: '', visible };
}

function withHierarchyView(ctl: ExplorerController, visible: boolean) {
  const hierarchy = fakeView(visible);
  ctl.setViews({
    dict: fakeView(),
    category: fakeView(),
    klass: fakeView(),
    hierarchy,
    method: fakeView(),
  } as never);
  return hierarchy;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ExplorerController.revealHierarchySelf', () => {
  it('reveals the selected class when the Hierarchy pane is expanded', async () => {
    const ctl = makeController();
    const hierarchy = withHierarchyView(ctl, true);

    await ctl.revealHierarchySelf();

    expect(hierarchy.reveal).toHaveBeenCalledTimes(1);
  });

  it('opens the selected class to show its subclasses', async () => {
    // VS Code remembers a row collapsed under its id, so a class that briefly had no subclasses
    // (a refactoring re-versioning it, an undo) came back as a closed `>` row; the pane's point is
    // to show them.
    const ctl = makeController();
    (ctl as unknown as HierAccess).hierSubs = [
      { className: 'OrderedArray', dictName: 'UserGlobals', kind: 'subclass', binding: 'bound' },
    ];
    const hierarchy = withHierarchyView(ctl, true);

    await ctl.revealHierarchySelf();

    expect(hierarchy.reveal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expand: true }),
    );
  });

  describe('a class whose row the user collapsed', () => {
    const withSubclasses = (): ExplorerController => {
      const ctl = makeController();
      (ctl as unknown as HierAccess).hierSubs = [
        { className: 'OrderedArray', dictName: 'UserGlobals', kind: 'subclass', binding: 'bound' },
      ];
      return ctl;
    };
    const selfRow = (className: string): HierarchyItem =>
      new HierarchyItem(className, 'UserGlobals', 'self', 0, true, undefined, undefined, 'bound');
    const expanded = (view: ReturnType<typeof fakeView>): boolean =>
      view.reveal.mock.calls.some(
        (c) => (c as unknown[] as [unknown, { expand?: boolean }?])[1]?.expand === true,
      );

    it('stays closed when the class is shown again', async () => {
      const ctl = withSubclasses();
      const hierarchy = withHierarchyView(ctl, true);

      ctl.onHierarchyRowCollapsed(selfRow('Array'));
      await ctl.revealHierarchySelf();

      expect(expanded(hierarchy)).toBe(false);
    });

    it('opens again once the user expands it', async () => {
      const ctl = withSubclasses();
      const hierarchy = withHierarchyView(ctl, true);

      ctl.onHierarchyRowCollapsed(selfRow('Array'));
      ctl.onHierarchyRowExpanded(selfRow('Array'));
      await ctl.revealHierarchySelf();

      expect(expanded(hierarchy)).toBe(true);
    });

    it('does not keep a different class closed', async () => {
      const ctl = withSubclasses();
      const hierarchy = withHierarchyView(ctl, true);

      ctl.onHierarchyRowCollapsed(selfRow('Bag'));
      await ctl.revealHierarchySelf();

      expect(expanded(hierarchy)).toBe(true);
    });
  });

  it('asks nothing to open for a class with no subclasses', async () => {
    const ctl = makeController();
    const hierarchy = withHierarchyView(ctl, true);

    await ctl.revealHierarchySelf();

    expect(hierarchy.reveal).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expand: true }),
    );
  });

  it('does not force the Hierarchy pane open when it is collapsed', async () => {
    const ctl = makeController();
    const hierarchy = withHierarchyView(ctl, false);

    await ctl.revealHierarchySelf();

    expect(hierarchy.reveal).not.toHaveBeenCalled();
  });
});

// The catch-up is the general per-pane one (onPaneVisibilityChanged); the cases
// here are the Hierarchy pane's share of it. Its siblings are covered in
// explorerPaneRevealGuard.test.ts, alongside the cascade guard itself.
describe('ExplorerController re-reveals when the Hierarchy pane reappears', () => {
  it('catches up on a class navigated to while the pane was hidden', async () => {
    const ctl = makeController();
    const hierarchy = withHierarchyView(ctl, false);
    await ctl.revealHierarchySelf();
    expect(hierarchy.reveal).not.toHaveBeenCalled();

    hierarchy.visible = true;
    ctl.onPaneVisibilityChanged('hierarchy', true);

    await vi.waitFor(() => expect(hierarchy.reveal).toHaveBeenCalledTimes(1));
  });

  it('does not re-reveal when the pane is being hidden', async () => {
    const ctl = makeController();
    const hierarchy = withHierarchyView(ctl, true);

    ctl.onPaneVisibilityChanged('hierarchy', false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hierarchy.reveal).not.toHaveBeenCalled();
  });
});
