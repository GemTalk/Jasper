import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', async (orig) => ({
  ...(await orig()),
  getClassesWithCategory: vi.fn(() => []),
  getClassEnvironments: vi.fn(() => []),
  getDictionaryNames: vi.fn(() => ['Globals', 'UserGlobals']),
  getAllClassNames: vi.fn(() => []),
  getDefinedIvarCounts: vi.fn(() => []),
  getClassHierarchy: vi.fn(() => []),
}));

import { ExplorerController } from '../../gemstoneExplorer';
import { getClassesWithCategory } from '../../browserQueries';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * Saving a class made from the New Class template selects the new class's own category,
 * so the class shows up where the user filed it. Any other class save keeps the rule in
 * explorerRevealKeepsDictionaryView.test.ts: never impose a category. A New Class save
 * carries the dictionary's name but no SymbolList position, as these calls do.
 * https://github.com/GemTalk/Jasper/issues/744
 */

const classesInDict = getClassesWithCategory as ReturnType<typeof vi.fn>;

function makeController(startCategory?: string): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 2;
  ctl.state.classCategory = startCategory;
  return ctl;
}

beforeEach(() => {
  vi.clearAllMocks();
  classesInDict.mockReturnValue([
    { className: 'Issue744Probe', category: 'Logical & Bits' },
    { className: 'Other', category: 'Other' },
  ]);
});

describe('saving a new class selects its class category', () => {
  it('selects the category when no category was selected before', () => {
    const ctl = makeController(undefined);
    ctl.onExternalClassCompiled(1, 'Issue744Probe', 'UserGlobals', undefined, true);
    expect(ctl.state.className).toBe('Issue744Probe');
    expect(ctl.state.classCategory).toBe('Logical & Bits');
  });

  it('replaces a different category that was selected before', () => {
    const ctl = makeController('Other');
    ctl.onExternalClassCompiled(1, 'Issue744Probe', 'UserGlobals', undefined, true);
    expect(ctl.state.classCategory).toBe('Logical & Bits');
  });

  it('selects the category when the class went into another dictionary', () => {
    const ctl = makeController(undefined);
    ctl.state.dictName = 'Globals';
    ctl.state.dictIndex = 1;
    classesInDict.mockImplementation((_s: unknown, dictIndex: number) =>
      dictIndex === 2 ? [{ className: 'Issue744Probe', category: 'Logical & Bits' }] : [],
    );
    ctl.onExternalClassCompiled(1, 'Issue744Probe', 'UserGlobals', undefined, true);
    expect(ctl.state.dictName).toBe('UserGlobals');
    expect(ctl.state.classCategory).toBe('Logical & Bits');
  });

  it('goes to the dictionary it was saved in, when the selected one has a class of that name', () => {
    const ctl = makeController(undefined);
    ctl.state.dictName = 'Globals';
    ctl.state.dictIndex = 1;
    classesInDict.mockImplementation((_s: unknown, dictIndex: number) =>
      dictIndex === 1
        ? [{ className: 'Issue744Probe', category: 'Other' }]
        : [{ className: 'Issue744Probe', category: 'Logical & Bits' }],
    );
    ctl.onExternalClassCompiled(1, 'Issue744Probe', 'UserGlobals', undefined, true);
    expect(ctl.state.dictName).toBe('UserGlobals');
    expect(ctl.state.classCategory).toBe('Logical & Bits');
  });

  it('leaves the category unselected when an existing class is redefined', () => {
    const ctl = makeController(undefined);
    ctl.onExternalClassCompiled(1, 'Issue744Probe', 'UserGlobals', 2, false);
    expect(ctl.state.className).toBe('Issue744Probe');
    expect(ctl.state.classCategory).toBeUndefined();
  });

  it('selects no category for a new class that has none', () => {
    classesInDict.mockReturnValue([{ className: 'Uncategorized', category: '' }]);
    const ctl = makeController(undefined);
    ctl.onExternalClassCompiled(1, 'Uncategorized', 'UserGlobals', undefined, true);
    expect(ctl.state.className).toBe('Uncategorized');
    expect(ctl.state.classCategory).toBeUndefined();
  });
});
