import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// The two per-class variable-NAME reads build the side rows; the two per-dictionary
// variable-COUNT reads feed the class row's chevron. Both are needed because the
// invariant under test is that they agree. The rest of a class load is stubbed away
// so the Classes-pane tree can be asked for its rows.
vi.mock('../../browserQueries', () => ({
  getDefinedInstVarNames: vi.fn(() => [] as string[]),
  getDefinedClassVarNames: vi.fn(() => [] as string[]),
  getDefinedInstVarCounts: vi.fn(() => new Map<string, number>()),
  getDefinedClassVarCounts: vi.fn(() => new Map<string, number>()),
  getClassVersions: vi.fn(() => new Map()),
  getClassesWithCategory: vi.fn(() => []),
  getClassHierarchy: vi.fn(() => ''),
}));

import * as vscode from 'vscode';
import { ExplorerController, ClassItem, VarSideItem } from '../../gemstoneExplorer';
import * as queries from '../../browserQueries';
import { variableSides } from '../../explorerTreeHelpers';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * The Classes pane's "instance variables" / "class variables" rows, and the class
 * row's expansion chevron.
 *
 * The inline "+" that adds a variable is hosted on the side rows, so a class with
 * variables of one kind but not the other must still get the empty side's row —
 * otherwise the only visible way to add the first variable of that kind disappears
 * exactly when it is needed (#499). A class with NO variables gets neither row and
 * no chevron: a row can only carry children by declaring a collapsible state, and
 * any collapsible state draws the chevron, which would advertise variables the class
 * does not have. That class reaches both adds from the "+" on the class row.
 */

const CLASS = 'Foo';

// One fixture, wired to every query the two sides of the invariant read: the NAME
// reads the side rows are built from, and the per-dictionary COUNT reads the class
// row's chevron is gated on. Feeding them from the same two lists is the point —
// a controller whose counts disagreed with its names could not catch a divergence.
function makeController(ivars: string[], classVars: string[]) {
  vi.mocked(queries.getDefinedInstVarNames).mockReturnValue(ivars);
  vi.mocked(queries.getDefinedClassVarNames).mockReturnValue(classVars);
  vi.mocked(queries.getDefinedInstVarCounts).mockReturnValue(new Map([[CLASS, ivars.length]]));
  vi.mocked(queries.getDefinedClassVarCounts).mockReturnValue(new Map([[CLASS, classVars.length]]));
  const sessionManager = {
    getSelectedSession: () => ({}) as ActiveSession,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  // Go in through selectDict so the counts are loaded the way a real dictionary
  // selection loads them, rather than by writing controller state directly.
  ctl.selectDict({ dictName: 'UserGlobals', dictIndex: 1 });
  return ctl;
}

function sidesOf(ctl: ExplorerController): VarSideItem[] {
  return ctl.classProvider.getChildren(new ClassItem(CLASS, true)) as VarSideItem[];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('variable-side rows under a class', () => {
  it('shows both sides when the class has variables of only one kind', () => {
    const sides = sidesOf(makeController(['count'], []));

    expect(sides.map((s) => s.label)).toEqual(['instance variables', 'class variables']);
  });

  it('keeps the "+" reachable on an empty side by reusing its contextValue', () => {
    // The inline "+" menu clauses match these tokens exactly (package.json), so an
    // empty row must not carry a distinct one or the button disappears with it.
    const sides = sidesOf(makeController(['count'], []));

    expect(sides.map((s) => s.contextValue)).toEqual([
      'explorerVarSide.instance',
      'explorerVarSide.class',
    ]);
  });

  it('renders the empty side with no expansion chevron and a dimmed "(none)"', () => {
    const sides = sidesOf(makeController(['count'], []));

    expect(sides[1].collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
    expect(sides[1].description).toBe('(none)');
  });

  it('leaves a populated side expanded and undecorated', () => {
    const sides = sidesOf(makeController(['count'], ['Registry']));

    for (const side of sides) {
      expect(side.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
      expect(side.description).toBeUndefined();
    }
  });

  it('marks only the side that is actually empty', () => {
    const sides = sidesOf(makeController([], ['Registry']));

    expect(sides[0].description).toBe('(none)');
    expect(sides[0].collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
    expect(sides[1].description).toBeUndefined();
    expect(sides[1].collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
  });

  it('says in the tooltip that an empty side has nothing in it', () => {
    const sides = sidesOf(makeController(['count'], []));

    expect(sides[1].tooltip).toBe('No class variables defined in Foo');
  });

  it('shows no side rows at all for a class with no variables', () => {
    expect(sidesOf(makeController([], []))).toEqual([]);
  });

  it('gives a class an expansion chevron only when it has variables to reveal', () => {
    // A chevron on a variable-less class reads as "this class has instance
    // variables" — the reason its side rows cannot simply always be there.
    expect(new ClassItem('Foo', true).collapsibleState).toBe(
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    expect(new ClassItem('Foo', false).collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
  });

  it('marks a variable-less class row so the class-row "+" can find it', () => {
    // That "+" exists for the class with no side rows to host one; on a class that
    // has them it would be a third "+" doing what those rows' own two already do.
    // The menu clause keys off this token (package.json), so the token is where the
    // "which rows?" answer lives.
    expect(new ClassItem('Foo', false).contextValue).toBe('explorerClass.novars');
    expect(new ClassItem('Foo', true).contextValue).toBe('explorerClass');
  });

  it('composes .novars with .commented without either hiding the other', () => {
    // Both suffixes only ever ADD a button, so every other class action's `when`
    // matches them as optional groups — in this order.
    expect(new ClassItem('Foo', false, undefined, true).contextValue).toBe(
      'explorerClass.novars.commented',
    );
    expect(new ClassItem('Foo', true, undefined, true).contextValue).toBe(
      'explorerClass.commented',
    );
  });

  // The two halves of the invariant are pinned separately above — ClassItem's
  // flag→chevron mapping here, variableSides' both-or-neither shape in
  // explorerTreeHelpers.test.ts — but they only ever meet through
  // classHasDefinedVars, and nothing drove that predicate. Widen it later (to count
  // inherited variables, say, or to answer true when the count probe failed) and
  // both of those suites stay green while the class row grows a chevron that opens
  // onto nothing.
  describe.each([
    [[], []],
    [['count'], []],
    [[], ['Registry']],
    [['count'], ['Registry']],
  ])('with ivars %j and class vars %j', (ivars, classVars) => {
    it('gates the chevron on exactly what decides whether there are rows', () => {
      const ctl = makeController(ivars, classVars);

      expect(ctl.classHasDefinedVars(CLASS)).toBe(variableSides(ivars, classVars).length > 0);
    });

    it('never draws a chevron the children cannot fill, or hides children behind none', () => {
      // The same agreement, read off the rendered tree rather than the predicates:
      // a collapsible class row must have side rows under it, and a flat one none.
      const ctl = makeController(ivars, classVars);
      const row = new ClassItem(CLASS, ctl.classHasDefinedVars(CLASS));

      const collapsible = row.collapsibleState !== vscode.TreeItemCollapsibleState.None;
      expect(collapsible).toBe(sidesOf(ctl).length > 0);
    });
  });

  it('addresses the same row whether or not the side is empty', () => {
    // The reveal call sites build a node purely to address an existing row by id,
    // without knowing its emptiness — so id must not encode it.
    expect(new VarSideItem('Foo', false, true).id).toBe(new VarSideItem('Foo', false).id);
    expect(new VarSideItem('Foo', true, true).id).toBe(new VarSideItem('Foo', true).id);
  });
});
