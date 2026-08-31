import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// Only the two per-class variable-name reads matter here; the rest of a class
// load is stubbed away so the Classes-pane tree can be asked for its rows.
vi.mock('../browserQueries', () => ({
  getDefinedInstVarNames: vi.fn(() => [] as string[]),
  getDefinedClassVarNames: vi.fn(() => [] as string[]),
  getClassHierarchy: vi.fn(() => ''),
}));

import * as vscode from 'vscode';
import { ExplorerController, ClassItem, VarSideItem } from '../gemstoneExplorer';
import * as queries from '../browserQueries';
import type { SessionManager, ActiveSession } from '../sessionManager';

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

function makeController(ivars: string[], classVars: string[]) {
  vi.mocked(queries.getDefinedInstVarNames).mockReturnValue(ivars);
  vi.mocked(queries.getDefinedClassVarNames).mockReturnValue(classVars);
  const sessionManager = {
    getSelectedSession: () => ({}) as ActiveSession,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  return ctl;
}

function sidesOf(ctl: ExplorerController): VarSideItem[] {
  return ctl.classProvider.getChildren(new ClassItem('Foo', true)) as VarSideItem[];
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

  it('addresses the same row whether or not the side is empty', () => {
    // The reveal call sites build a node purely to address an existing row by id,
    // without knowing its emptiness — so id must not encode it.
    expect(new VarSideItem('Foo', false, true).id).toBe(new VarSideItem('Foo', false).id);
    expect(new VarSideItem('Foo', true, true).id).toBe(new VarSideItem('Foo', true).id);
  });
});
