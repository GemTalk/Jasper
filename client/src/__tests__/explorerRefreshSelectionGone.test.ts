import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// refreshRetainingSelection re-resolves the selected dictionary by name and, when
// present, reloads its classes. Stub just those two reads; the ivar-count reload
// swallows its own query errors, so the rest can stay unmocked.
vi.mock('../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => [] as string[]),
  getClassesWithCategory: vi.fn(() => [] as unknown[]),
}));

import * as queries from '../browserQueries';
import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';

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
  const reset = vi.spyOn(ctl, 'reset').mockImplementation(() => {});
  return { ctl, reset };
}

describe('ExplorerController.refreshRetainingSelection when the selected dictionary is gone', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resets (clearing the class/hierarchy/method panes) when the selected dictionary no longer exists', async () => {
    const { ctl, reset } = makeController();
    getDictionaryNames.mockReturnValue(['UserGlobals', 'Globals', 'Published']);

    await ctl.refreshRetainingSelection({ reveal: false });

    expect(reset).toHaveBeenCalledTimes(1);
    // The stale index is never used to fetch a different dictionary's classes.
    expect(getClassesWithCategory).not.toHaveBeenCalled();
  });

  it('keeps the selection and reloads by the CURRENT index when the dictionary is still present but shifted', async () => {
    const { ctl, reset } = makeController();
    // GsRefactoring survives but earlier dictionaries were removed, so it is now at
    // position 3 (1-based), not its stale index 6.
    getDictionaryNames.mockReturnValue(['UserGlobals', 'Globals', 'GsRefactoring']);

    await ctl.refreshRetainingSelection({ reveal: false });

    expect(reset).not.toHaveBeenCalled();
    expect(getClassesWithCategory).toHaveBeenCalledWith(expect.anything(), 3);
  });
});
