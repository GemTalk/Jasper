import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', async (orig) => ({
  ...(await orig()),
  getClassHierarchy: vi.fn(() => []),
}));

import { ExplorerController } from '../gemstoneExplorer';
import { getClassHierarchy } from '../browserQueries';
import type { SessionManager, ActiveSession } from '../sessionManager';

function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'Issue328DictB';
  ctl.state.dictIndex = 2;
  return ctl;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Regression for the shadowed-class hierarchy bug: a class of the same name exists
// in two dictionaries, so both rows share the tree id `k:<className>`. After
// switching dictionaries, selectDict clears the controller's className while VS Code
// still shows the row highlighted — so clicking it fires NO onDidChangeSelection.
// handleClassClick (fired on every click) must re-select the class so the hierarchy
// reloads for the newly-selected dictionary.
describe('handleClassClick re-selects a shadowed class after a dictionary switch', () => {
  it('selects the class when the controller has no class selected (stale highlight)', () => {
    const ctl = makeController();
    ctl.state.className = undefined; // as left by selectDict
    const selectClass = vi.spyOn(ctl, 'selectClass').mockImplementation(() => {});

    ctl.handleClassClick('Issue328Shadow');

    expect(selectClass).toHaveBeenCalledTimes(1);
    expect(selectClass.mock.calls[0][0].className).toBe('Issue328Shadow');
  });

  it('does not re-select when the class is already the selected one (no double reload)', () => {
    const ctl = makeController();
    ctl.state.className = 'Issue328Shadow';
    const selectClass = vi.spyOn(ctl, 'selectClass').mockImplementation(() => {});

    ctl.handleClassClick('Issue328Shadow');

    expect(selectClass).not.toHaveBeenCalled();
  });

  // The Hierarchy pane must scope the lookup to the SELECTED dictionary; otherwise a
  // shadowed name resolves to the global first match and shows the other class's lineage.
  it('loads the hierarchy scoped to the selected dictionary index', () => {
    const ctl = makeController(); // dictIndex = 2 (Issue328DictB)
    ctl.state.className = 'Issue328Shadow';

    (ctl as unknown as { loadHierarchy: () => void }).loadHierarchy();

    expect(getClassHierarchy).toHaveBeenCalledWith(expect.anything(), 'Issue328Shadow', 2);
  });
});
