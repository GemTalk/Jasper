import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getClassEnvironments: vi.fn(() => []),
}));

import { ExplorerController } from '../../gemstoneExplorer';
import { ALL_METHODS_CATEGORY } from '../../systemBrowser';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import type { EnvCategoryLine } from '../../browserQueries';

function controllerShowing(lines: EnvCategoryLine[]): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.className = 'Probe';
  ctl.state.dictIndex = 1;
  (ctl as unknown as { envLines: EnvCategoryLine[] }).envLines = lines;
  return ctl;
}

const line = (category: string, selectors: string[]): EnvCategoryLine => ({
  isMeta: false,
  envId: 0,
  category,
  selectors,
});

// The same methods in the order GemStone answers them: case folded to capitals, so \\, _ and ~
// land after Z, and test10 before test2.
const STONE_LINES = [
  line('arithmetic', ['/', 'abs', '\\\\', '~=']),
  line('private', ['_bottomBit']),
  line('testing', ['Zed', 'test10', 'test2']),
];
const JASPER_ORDER = ['_bottomBit', '/', '\\\\', '~=', 'abs', 'test2', 'test10', 'Zed'];

describe('Explorer Methods pane order', () => {
  it('lists every method by the shared rule when grouping is off', () => {
    const ctl = controllerShowing(STONE_LINES);
    expect(ctl.selectorsFor(false, ALL_METHODS_CATEGORY).map((s) => s.selector)).toEqual(
      JASPER_ORDER,
    );
  });

  it('lists one category by the same rule, so grouping cannot reorder its methods', () => {
    const ctl = controllerShowing(STONE_LINES);
    const all = ctl.selectorsFor(false, ALL_METHODS_CATEGORY).map((s) => s.selector);
    const testing = ctl.selectorsFor(false, 'testing').map((s) => s.selector);
    expect(testing).toEqual(['test2', 'test10', 'Zed']);
    expect(all.filter((s) => testing.includes(s))).toEqual(testing);
  });

  it('lists method categories by the shared rule', () => {
    const ctl = controllerShowing([
      line('version10', ['a']),
      line('version2', ['b']),
      line('Accessing', ['c']),
      line('*extension', ['d']),
    ]);
    const names = ctl
      .methodCategories(false)
      .map((c) => c.category)
      .filter((c) => c !== ALL_METHODS_CATEGORY);
    expect(names).toEqual(['*extension', 'Accessing', 'version2', 'version10']);
  });
});
