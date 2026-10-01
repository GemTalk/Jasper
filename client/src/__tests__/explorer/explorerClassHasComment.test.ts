import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals']),
}));

import { ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import type { ClassCategoryEntry } from '../../browserQueries';

// `classHasComment` is asked once per class ROW, so it is backed by a set derived
// from the class list rather than a scan of it. The set is rebuilt by the
// `classCategoryEntries` setter — these pin that it answers correctly AND that it
// cannot outlive the entries it came from, which is the only way a set can be wrong
// where a scan could not be.
// ([#387](https://github.com/GemTalk/Jasper/issues/387))
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

/**
 * Saving a comment moves the button without a refetch — the button used to
 * appear only after Refresh GemStone Explorer, because nothing told the Explorer
 * the save had happened.
 */
describe('a comment saved in this session', () => {
  const commented = (ctl: ExplorerController) => ctl.classHasComment('Object');

  it('puts the button on the row straight away', () => {
    const ctl = makeController();
    setEntries(ctl, [{ category: 'Kernel', className: 'Object', hasComment: false }]);

    ctl.onClassCommentSaved(1, 'Globals', 'Object', true);

    expect(commented(ctl)).toBe(true);
  });

  it('takes it off again when the comment is emptied', () => {
    const ctl = makeController();
    setEntries(ctl, [{ category: 'Kernel', className: 'Object', hasComment: true }]);

    ctl.onClassCommentSaved(1, 'Globals', 'Object', false);

    expect(commented(ctl)).toBe(false);
  });

  it('redraws the Classes pane so the row is rebuilt', () => {
    const ctl = makeController();
    setEntries(ctl, [{ category: 'Kernel', className: 'Object', hasComment: false }]);
    const refresh = vi.spyOn(ctl.classProvider, 'refresh');

    ctl.onClassCommentSaved(1, 'Globals', 'Object', true);

    expect(refresh).toHaveBeenCalled();
  });

  it('leaves the other classes alone', () => {
    const ctl = makeController();
    setEntries(ctl, [
      { category: 'Collections', className: 'Array', hasComment: true },
      { category: 'Kernel', className: 'Object', hasComment: false },
    ]);

    ctl.onClassCommentSaved(1, 'Globals', 'Object', true);

    expect(ctl.classHasComment('Array')).toBe(true);
  });

  // The saved comment's URI carries its own dictionary and session, which may not
  // be the ones the panes are showing.
  it('ignores a save in another dictionary', () => {
    const ctl = makeController();
    setEntries(ctl, [{ category: 'Kernel', className: 'Object', hasComment: false }]);

    ctl.onClassCommentSaved(1, 'UserGlobals', 'Object', true);

    expect(commented(ctl)).toBe(false);
  });

  it('ignores a save in another session', () => {
    const ctl = makeController();
    setEntries(ctl, [{ category: 'Kernel', className: 'Object', hasComment: false }]);

    ctl.onClassCommentSaved(2, 'Globals', 'Object', true);

    expect(commented(ctl)).toBe(false);
  });

  it('ignores a class the current entries do not list', () => {
    const ctl = makeController();
    setEntries(ctl, [{ category: 'Kernel', className: 'Object', hasComment: false }]);
    const refresh = vi.spyOn(ctl.classProvider, 'refresh');

    ctl.onClassCommentSaved(1, 'Globals', 'NotHere', true);

    expect(ctl.classHasComment('NotHere')).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
