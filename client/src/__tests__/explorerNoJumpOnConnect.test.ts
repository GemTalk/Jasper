/**
 * Logging in must not drag the sidebar over to the GemStone Explorer.
 *
 * A session switch resets the Explorer and auto-selects a default dictionary so
 * the class and category panes are populated rather than empty. That ended in
 * `TreeView.reveal`, and reveal makes VS Code *show* the view it belongs to —
 * which brings the whole Explorer container to the front. Someone logging in
 * from the Databases section watched the section they were working in disappear.
 *
 * Selecting the dictionary is what populates the panes; the reveal only scrolls
 * the row into sight, which is worth nothing to someone who is not looking at it.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// Only the two calls this path makes are stubbed; everything else the controller
// might reach for keeps its real (unused) export.
vi.mock('../browserQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../browserQueries')>()),
  getDictionaryNames: vi.fn(() => ['Globals', 'UserGlobals']),
  getClassesWithCategory: vi.fn(() => []),
  getClassCategories: vi.fn(() => []),
}));
vi.mock('../gciLog', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
  getGciLog: vi.fn(() => ({ show: vi.fn(), appendLine: vi.fn() })),
  _resetGciLogForTests: vi.fn(),
}));

import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';

const SESSION = { id: 1 } as ActiveSession;

function makeController(dictVisible: boolean) {
  const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const dict = {
    reveal: vi.fn(async () => {}),
    description: '',
    visible: dictVisible,
    selection: [],
  };
  ctl.setViews({
    dict,
    category: { reveal: vi.fn(), description: '' },
    klass: { reveal: vi.fn(), description: '' },
    hierarchy: { reveal: vi.fn(), description: '' },
    method: { reveal: vi.fn(), description: '', selection: [], visible: false },
  } as never);
  const autoSelect = () =>
    (ctl as unknown as { autoSelectDefaultDict: () => void }).autoSelectDefaultDict();
  return { ctl, dict, autoSelect };
}

describe('auto-selecting a dictionary on a session switch', () => {
  it('does not reveal while the Dictionaries pane is off screen', () => {
    const { dict, autoSelect } = makeController(false);
    autoSelect();
    expect(dict.reveal).not.toHaveBeenCalled();
  });

  it('still reveals for someone already looking at the Explorer', () => {
    const { dict, autoSelect } = makeController(true);
    autoSelect();
    expect(dict.reveal).toHaveBeenCalled();
  });

  it('populates the panes either way, which is what the auto-select is for', () => {
    const { ctl, autoSelect } = makeController(false);
    autoSelect();
    expect((ctl as unknown as { state: { dictName?: string } }).state.dictName).toBe('UserGlobals');
  });
});
