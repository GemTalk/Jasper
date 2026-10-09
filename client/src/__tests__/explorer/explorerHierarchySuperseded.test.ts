import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getClassHistory: vi.fn(),
  getClassEnvironments: vi.fn(() => []),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
}));

import * as queries from '../../browserQueries';
import { ExplorerController, HierarchyItem } from '../../gemstoneExplorer';
import type { ClassHierarchyEntry } from '../../queries/getClassHierarchy';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import { window } from '../../__mocks__/vscode';

/**
 * A hierarchy row for a class the symbol list no longer binds.
 *
 * Redefining a class makes a NEW class object and leaves its subclasses pointing at the old one,
 * so the old one is still a real superclass that no dictionary holds. It arrives two ways: a
 * redefinition made outside a refactoring, and a refactoring that failed part-way (it stops at
 * the first failure, with the classes before it already re-versioned). Every Explorer command
 * that addresses a class THROUGH its dictionary has nowhere to send such a row, and used to say
 * so as `not a class: Object`, which reads as a broken tool.
 */

const SESSION = { id: 1 } as ActiveSession;

type HierAccess = { hierChain: ClassHierarchyEntry[]; hierSubs: ClassHierarchyEntry[] };

const entry = (over: Partial<ClassHierarchyEntry> = {}): ClassHierarchyEntry => ({
  className: 'Parent',
  dictName: 'UserGlobals',
  dictIndex: 1,
  kind: 'superclass',
  binding: 'bound',
  ...over,
});

function makeController(chain: ClassHierarchyEntry[]): ExplorerController {
  const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictIndex = 1;
  ctl.state.dictName = 'UserGlobals';
  ctl.state.className = 'Child';
  const access = ctl as unknown as HierAccess;
  access.hierChain = chain;
  access.hierSubs = [];
  return ctl;
}

/** The rows the pane renders for a chain, walking the single-branch nesting. */
function rowsOf(ctl: ExplorerController): HierarchyItem[] {
  const rows: HierarchyItem[] = [];
  let next = ctl.hierarchyChildren();
  while (next.length > 0) {
    rows.push(...next);
    next = ctl.hierarchyChildren(next[0]);
  }
  return rows;
}

const supersededChain = [
  entry({ className: 'Parent', dictName: '', dictIndex: undefined, binding: 'superseded' }),
  entry({ className: 'Child', kind: 'self' }),
];

const warning = () => String(vi.mocked(window.showWarningMessage).mock.calls[0]?.[0] ?? '');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a hierarchy row whose class nothing binds', () => {
  it('marks a superseded row on its face', () => {
    const rows = rowsOf(makeController(supersededChain));

    const parent = rows.find((r) => r.className === 'Parent')!;
    expect(parent.description).toBe('(old version)');
  });

  it('leaves an ordinary ancestor unmarked', () => {
    const rows = rowsOf(makeController([entry(), entry({ className: 'Child', kind: 'self' })]));

    expect(rows.find((r) => r.className === 'Parent')!.description).toBeUndefined();
  });

  it('marks a removed class differently from a superseded one', () => {
    const rows = rowsOf(
      makeController([
        entry({ className: 'Parent', dictName: '', dictIndex: undefined, binding: 'unbound' }),
        entry({ className: 'Child', kind: 'self' }),
      ]),
    );

    expect(rows.find((r) => r.className === 'Parent')!.description).toBe('(unbound)');
  });

  it('marks a class held only under another name, and says so on hover', () => {
    const rows = rowsOf(
      makeController([
        entry({ className: 'Parent', dictName: '', dictIndex: undefined, binding: 'aliased' }),
        entry({ className: 'Child', kind: 'self' }),
      ]),
    );

    const parent = rows.find((r) => r.className === 'Parent')!;
    expect(parent.description).toBe('(alias only)');
    expect(String(parent.tooltip)).toContain('another name');
    expect(parent.contextValue).toBe('explorerHierClassUnbound');
  });

  it('explains on hover what the row is, and names the failed refactoring', () => {
    const rows = rowsOf(makeController(supersededChain));

    const tip = String(rows.find((r) => r.className === 'Parent')!.tooltip);
    expect(tip).toContain('older version');
    expect(tip).toContain('failed');
    expect(tip).toContain('Undo');
  });

  it('withholds the menus that cannot act on it', () => {
    const rows = rowsOf(makeController(supersededChain));

    expect(rows.find((r) => r.className === 'Parent')!.contextValue).toBe(
      'explorerHierClassUnbound',
    );
    expect(rows.find((r) => r.className === 'Child')!.contextValue).toBe('explorerHierClass');
  });
});

describe('a command invoked on a row nothing binds', () => {
  const node = (binding: 'superseded' | 'unbound' | 'aliased') =>
    new HierarchyItem('Parent', '', 'ancestor', 0, false, undefined, undefined, binding);

  it('declines Class History with the reason, and runs no query', async () => {
    const ctl = makeController(supersededChain);

    await ctl.classHistory(node('superseded'));

    expect(queries.getClassHistory).not.toHaveBeenCalled();
    expect(warning()).toContain('Class History');
    expect(warning()).toContain('older version');
  });

  it('names the failed refactoring, since that is where Undo is the answer', async () => {
    const ctl = makeController(supersededChain);

    await ctl.classHistory(node('superseded'));

    expect(warning()).toContain('failed part-way');
    expect(warning()).toContain('Undo');
  });

  it('says a removed class is removed, not superseded', async () => {
    const ctl = makeController(supersededChain);

    await ctl.classHistory(node('unbound'));

    expect(warning()).toContain('removed');
    expect(warning()).not.toContain('older version');
  });

  it('says a class held only under another name is reachable only by that name', async () => {
    const ctl = makeController(supersededChain);

    await ctl.classHistory(node('aliased'));

    expect(warning()).toContain('another name');
    expect(warning()).not.toContain('older version');
  });

  it('declines every command that addresses a class through its dictionary', async () => {
    const ctl = makeController(supersededChain);
    const commands: [string, (n: HierarchyItem) => Promise<void>][] = [
      ['Rename Class', (n) => ctl.renameClass(n)],
      ['Insert Superclass', (n) => ctl.insertSuperclass(n)],
      ['Extract Superclass', (n) => ctl.extractSuperclass(n)],
      ['Split Class', (n) => ctl.splitClass(n)],
      ['Class History', (n) => ctl.classHistory(n)],
      // File Out matches the hierarchy menus by PREFIX, so unlike the refactoring commands it is
      // still offered on an unbound row; it resolves through the dictionary just the same.
      ['File Out', (n) => ctl.fileOutClass(n)],
      ['File Out as Tonel', (n) => ctl.fileOutClassAsTonel(n)],
    ];
    for (const [label, run] of commands) {
      vi.mocked(window.showWarningMessage).mockClear();
      await run(node('superseded'));
      expect(warning(), label).toContain(label);
    }
  });

  it('lets an ordinary ancestor through the guard', async () => {
    // The guard's whole observable is the refusal, so its absence is what "through" means here;
    // what classHistory does afterwards belongs to explorerClassHistoryUndo.test.ts.
    const ctl = makeController(supersededChain);
    vi.mocked(queries.getClassHistory).mockReturnValue('[]');

    await ctl.classHistory(new HierarchyItem('Parent', 'UserGlobals', 'ancestor', 0, false));

    expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
  });
});
