import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// refreshRetainingSelection re-resolves the selected dictionary by name and, when
// present, reloads its classes. Stub just those two reads; the ivar-count reload
// swallows its own query errors, so the rest can stay unmocked.
vi.mock('../../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => [] as string[]),
  getClassesWithCategory: vi.fn(() => [] as unknown[]),
}));

import * as queries from '../../browserQueries';
import { ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const getDictionaryNames = queries.getDictionaryNames as ReturnType<typeof vi.fn>;
const getClassesWithCategory = queries.getClassesWithCategory as ReturnType<typeof vi.fn>;

function makeController() {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const state = (ctl as unknown as { state: Record<string, unknown> }).state;
  // Pretend the user is sitting on the GsRefactoring dictionary (index 6).
  state.dictName = 'GsRefactoring';
  state.dictIndex = 6;
  state.className = undefined;
  // Seed the panes so "they end up empty" is an observable change rather than the initial
  // condition — otherwise the assertions below would hold even if nothing ran.
  state.classCategory = 'accessing';
  (ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries = [
    { category: 'accessing', className: 'Demo' },
  ];
  (ctl as unknown as { envLines: unknown[] }).envLines = [
    { isMeta: false, envId: 0, category: 'accessing', selectors: ['at:'] },
  ];
  // NB `reset` is deliberately NOT stubbed: the behaviour under test is that the panes end up
  // cleared, not that a particular private method was called. Stubbing it would make this test
  // fail on a rework that cleared the panes inline while the behaviour stayed correct.
  return { ctl, state };
}

describe('ExplorerController.refreshRetainingSelection when the selected dictionary is gone', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clears the class/hierarchy/method panes when the selected dictionary no longer exists', async () => {
    const { ctl, state } = makeController();
    getDictionaryNames.mockReturnValue(['UserGlobals', 'Globals', 'Published']);

    await ctl.refreshRetainingSelection({ reveal: false });

    // The observable outcome: the stale selection is gone (reset falls back to the default
    // dictionary rather than leaving nothing selected) and the dependent panes are empty.
    expect(state.dictName).not.toBe('GsRefactoring');
    expect(state.className).toBeUndefined();
    expect(state.classCategory).toBeUndefined();
    expect((ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries).toEqual(
      [],
    );
    expect((ctl as unknown as { envLines: unknown[] }).envLines).toEqual([]);
    // The point of the guard: the stale index 6 is never used to fetch some other dictionary's
    // classes. (Classes ARE loaded — reset selects the default dictionary — so asserting "not
    // called at all" would only have held while `reset` was stubbed out.)
    expect(getClassesWithCategory).not.toHaveBeenCalledWith(expect.anything(), 6);
  });

  it('keeps the selection and reloads by the CURRENT index when the dictionary is still present but shifted', async () => {
    const { ctl, state } = makeController();
    // GsRefactoring survives but earlier dictionaries were removed, so it is now at
    // position 3 (1-based), not its stale index 6.
    getDictionaryNames.mockReturnValue(['UserGlobals', 'Globals', 'GsRefactoring']);

    await ctl.refreshRetainingSelection({ reveal: false });

    // Selection retained — the inverse of the reset case above.
    expect(state.dictName).toBe('GsRefactoring');
    expect(getClassesWithCategory).toHaveBeenCalledWith(expect.anything(), 3);
  });
});
