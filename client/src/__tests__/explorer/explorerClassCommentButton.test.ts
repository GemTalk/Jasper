import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals']),
}));

import { ClassItem, HierarchyItem } from '../../gemstoneExplorer';

// The Classes pane used to show the comment (book) button only on a class that
// already HAD a comment, so writing a first comment had no way in from the row —
// while the Class Hierarchy pane offered it on every row. The gate was deliberate:
// it kept the button from promising a document that turns out to be GemStone's
// synthesised "No class-specific documentation for …" placeholder. Offering it
// everywhere accepts that placeholder as the place you type a first comment, which
// is where you would type one anyway, and makes the two panes agree.
//
// Nothing gates on comment state any more, so these pin that a row's contextValue
// cannot reintroduce a difference: the button's `when` matches the whole set of
// class rows, and the only suffix left is `.novars`.

describe('which class rows offer Open Comment', () => {
  it('gives every Classes-pane row the same contextValue shape', () => {
    const withVars = new ClassItem('Commented', true);
    const withoutVars = new ClassItem('Uncommented', false);
    expect(withVars.contextValue).toBe('explorerClass');
    expect(withoutVars.contextValue).toBe('explorerClass.novars');
  });

  // The regression this replaces: a suffix that gated the button meant a class
  // could be missed by the `when` for a reason unrelated to being a class.
  it('never carries a comment-state suffix', () => {
    for (const item of [
      new ClassItem('Foo'),
      new ClassItem('Foo', true),
      new ClassItem('Foo', false, { current: 2, total: 3 }),
      new ClassItem('Foo', true, { current: 1, total: 4 }),
    ]) {
      expect(item.contextValue).not.toContain('commented');
    }
  });

  it('matches the Hierarchy pane, which always offered the button', () => {
    const hier = new HierarchyItem('Foo', 'Globals', 'self', 0, false);
    expect(hier.contextValue).toBe('explorerHierClass');
  });
});
