import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller pulls in browserQueries (→ native GCI). Stub it; these tests
// only exercise revealHierarchySelf, which never reaches a query.
vi.mock('../browserQueries', () => ({}));

import { ExplorerController } from '../gemstoneExplorer';
import type { ClassHierarchyEntry } from '../queries/getClassHierarchy';
import type { SessionManager, ActiveSession } from '../sessionManager';

const SESSION = { id: 1 } as ActiveSession;

// revealHierarchySelf reads the private hierarchy chain the load step fills in;
// seed it directly so the test doesn't need a live query.
type HierAccess = { hierChain: ClassHierarchyEntry[]; hierSubs: ClassHierarchyEntry[] };

function makeController(): ExplorerController {
  const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const access = ctl as unknown as HierAccess;
  access.hierChain = [{ className: 'Array', dictName: 'UserGlobals', kind: 'self' }];
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

  it('does not force the Hierarchy pane open when it is collapsed', async () => {
    const ctl = makeController();
    const hierarchy = withHierarchyView(ctl, false);

    await ctl.revealHierarchySelf();

    expect(hierarchy.reveal).not.toHaveBeenCalled();
  });
});

describe('ExplorerController re-reveals when the Hierarchy pane reappears', () => {
  it('catches up on a class navigated to while the pane was hidden', async () => {
    const ctl = makeController();
    const hierarchy = withHierarchyView(ctl, false);
    await ctl.revealHierarchySelf();
    expect(hierarchy.reveal).not.toHaveBeenCalled();

    hierarchy.visible = true;
    ctl.onHierarchyVisibilityChanged(true);

    await vi.waitFor(() => expect(hierarchy.reveal).toHaveBeenCalledTimes(1));
  });

  it('does not re-reveal when the pane is being hidden', async () => {
    const ctl = makeController();
    const hierarchy = withHierarchyView(ctl, true);

    ctl.onHierarchyVisibilityChanged(false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hierarchy.reveal).not.toHaveBeenCalled();
  });
});
