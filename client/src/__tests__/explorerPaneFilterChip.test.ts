import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals']),
}));

import { ExplorerController, FilterChipItem } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';
import type { ClassCategoryEntry } from '../browserQueries';

const VIEW_DICTS = 'gemstoneExplorerDicts';
const VIEW_CATEGORIES = 'gemstoneExplorerCategories';
const VIEW_CLASSES = 'gemstoneExplorerClasses';

function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'Globals';
  ctl.state.dictIndex = 2;
  (ctl as unknown as { classCategoryEntries: ClassCategoryEntry[] }).classCategoryEntries = [
    { category: 'Collections', className: 'Array' },
    { category: 'Kernel', className: 'Object' },
  ];
  return ctl;
}

function setFilter(ctl: ExplorerController, viewId: string, pattern: string): void {
  (ctl as unknown as { filters: Map<string, string> }).filters.set(viewId, pattern);
}

const isChip = (r: unknown): r is FilterChipItem => r instanceof FilterChipItem;

beforeEach(() => {
  vi.clearAllMocks();
});

// The chip prepend is shared by all four filterable panes; the Methods pane is
// covered in explorerIvarFilter — these pin the Dictionaries / Class Categories /
// Classes rollout so each pane leads with the chip while filtering, hides it
// otherwise, and never treats it as a navigable parent.
describe.each([
  { name: 'Dictionaries', view: VIEW_DICTS, provider: 'dictProvider' as const },
  { name: 'Class Categories', view: VIEW_CATEGORIES, provider: 'categoryProvider' as const },
  { name: 'Classes', view: VIEW_CLASSES, provider: 'classProvider' as const },
])('$name pane filter chip', ({ view, provider }) => {
  it('leads the root with a filter chip carrying the pane view id while filtering', () => {
    const ctl = makeController();
    setFilter(ctl, view, 'a');

    const rows = ctl[provider].getChildren();

    expect(isChip(rows[0])).toBe(true);
    expect((rows[0] as FilterChipItem).viewId).toBe(view);
  });

  it('shows no chip when the pane has no filter', () => {
    const ctl = makeController();

    expect(ctl[provider].getChildren().some(isChip)).toBe(false);
  });

  it('treats the chip as a root, so reveal never targets it', () => {
    const ctl = makeController();

    expect(ctl[provider].getParent(new FilterChipItem(view, 'a'))).toBeUndefined();
  });
});
