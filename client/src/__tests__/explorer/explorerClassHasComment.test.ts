import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals']),
}));

import { ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import type { ClassCategoryEntry } from '../../browserQueries';

// #387 item 11 / PR #442 review. `classHasComment` is asked once per class ROW, so it
// is backed by a set derived from the class list rather than a scan of it. The set is
// rebuilt by the `classCategoryEntries` setter — these pin that it answers correctly
// AND that it cannot outlive the entries it came from, which is the only way a set can
// be wrong where a scan could not be.
function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'Globals';
  ctl.state.dictIndex = 2;
  return ctl;
}

function setEntries(ctl: ExplorerController, entries: ClassCategoryEntry[]): void {
  (ctl as unknown as { classCategoryEntries: ClassCategoryEntry[] }).classCategoryEntries = entries;
}

describe('whether a class row offers the comment button', () => {
  it('answers from the entries loaded for the dictionary', () => {
    const ctl = makeController();
    setEntries(ctl, [
      { category: 'Collections', className: 'Array', hasComment: true },
      { category: 'Kernel', className: 'Object', hasComment: false },
    ]);

    expect(ctl.classHasComment('Array')).toBe(true);
    expect(ctl.classHasComment('Object')).toBe(false);
  });

  it('treats a class it has no entry for as uncommented', () => {
    const ctl = makeController();
    setEntries(ctl, [{ category: 'Collections', className: 'Array', hasComment: true }]);

    expect(ctl.classHasComment('NotHere')).toBe(false);
  });

  it('follows a reload that adds a comment', () => {
    const ctl = makeController();
    setEntries(ctl, [{ category: 'Kernel', className: 'Object', hasComment: false }]);
    expect(ctl.classHasComment('Object')).toBe(false);

    // What a comment edit + refetch looks like from here.
    setEntries(ctl, [{ category: 'Kernel', className: 'Object', hasComment: true }]);

    expect(ctl.classHasComment('Object')).toBe(true);
  });

  it('drops classes the new entries no longer carry', () => {
    const ctl = makeController();
    setEntries(ctl, [{ category: 'Collections', className: 'Array', hasComment: true }]);

    // Switching dictionaries replaces the whole list.
    setEntries(ctl, [{ category: 'Kernel', className: 'Object', hasComment: true }]);

    expect(ctl.classHasComment('Array')).toBe(false);
    expect(ctl.classHasComment('Object')).toBe(true);
  });

  it('is empty again once the entries are cleared', () => {
    const ctl = makeController();
    setEntries(ctl, [{ category: 'Collections', className: 'Array', hasComment: true }]);

    setEntries(ctl, []);

    expect(ctl.classHasComment('Array')).toBe(false);
  });
});
