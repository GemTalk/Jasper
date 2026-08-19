import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', async (orig) => ({
  ...(await orig()),
  getClassesWithCategory: vi.fn(() => []),
  getClassEnvironments: vi.fn(() => []),
  getDictionaryNames: vi.fn(() => ['Globals']),
  getAllClassNames: vi.fn(() => []),
  getDefinedIvarCounts: vi.fn(() => []),
  getClassHierarchy: vi.fn(() => []),
}));

import { ExplorerController } from '../gemstoneExplorer';
import { getClassesWithCategory, getClassEnvironments } from '../browserQueries';
import type { SessionManager, ActiveSession } from '../sessionManager';

/**
 * Revealing a class must not narrow the Classes pane to that class's own category (#434, found in
 * F5 testing).
 *
 * Reported after a class rename: the renamed class was revealed correctly and every OTHER class in
 * the dictionary disappeared — because the reveal pinned the Class Categories pane to the renamed
 * class's category, which then filtered the Classes pane down to a single class.
 *
 * The rule: never IMPOSE a category, but do not yank away one the user chose either. These drive
 * the real `revealClass` and read the resulting `state.classCategory`.
 */

const classesInDict = getClassesWithCategory as ReturnType<typeof vi.fn>;
const envs = getClassEnvironments as ReturnType<typeof vi.fn>;

function makeController(startCategory?: string, startDictIndex = 1): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'Globals';
  ctl.state.dictIndex = startDictIndex;
  ctl.state.classCategory = startCategory;
  return ctl;
}

/** Drive the private reveal, as the rename/reshape paths do. */
const reveal = (ctl: ExplorerController, dictIndex: number, className: string): Promise<void> =>
  (
    ctl as unknown as {
      revealClass: (d: string, i: number, c: string) => Promise<void>;
    }
  ).revealClass('Globals', dictIndex, className);

beforeEach(() => {
  vi.clearAllMocks();
  envs.mockReturnValue([]);
  classesInDict.mockReturnValue([
    { className: 'DemoCatB', category: 'Demo-Cat-Sub' },
    { className: 'DemoOther', category: 'Other' },
    { className: 'DemoPlain', category: '' },
  ]);
});

describe('revealing a class leaves the dictionary view intact', () => {
  it('does not impose the class own category when the user had none selected', async () => {
    // The reported bug: this used to become 'Demo-Cat-Sub', hiding DemoOther and DemoPlain.
    const ctl = makeController(undefined);
    await reveal(ctl, 1, 'DemoCatB');
    expect(ctl.state.classCategory).toBeUndefined();
    expect(ctl.state.className).toBe('DemoCatB');
  });

  it('keeps a category the user had chosen when the class is in it', async () => {
    const ctl = makeController('Demo-Cat-Sub');
    await reveal(ctl, 1, 'DemoCatB');
    expect(ctl.state.classCategory).toBe('Demo-Cat-Sub');
  });

  it('clears a chosen category that would hide the revealed class', async () => {
    const ctl = makeController('Other');
    await reveal(ctl, 1, 'DemoCatB');
    expect(ctl.state.classCategory).toBeUndefined();
  });

  it('clears the category when the reveal crosses dictionaries', async () => {
    // A category selection belongs to the dictionary it was made in.
    const ctl = makeController('Demo-Cat-Sub', 2);
    await reveal(ctl, 1, 'DemoCatB');
    expect(ctl.state.classCategory).toBeUndefined();
  });

  it('imposes nothing for a class that has no category', async () => {
    const ctl = makeController(undefined);
    await reveal(ctl, 1, 'DemoPlain');
    expect(ctl.state.classCategory).toBeUndefined();
  });
});
