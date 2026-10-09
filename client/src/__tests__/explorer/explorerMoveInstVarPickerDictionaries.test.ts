import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getClassHierarchy: vi.fn(),
  getClassDescendantNames: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * Picking where a ▲/▼ move sends an instance variable, when two classes in the hierarchy share
 * a name.
 *
 * Two dictionaries may each bind a class called `Leaf`, and both can sit in the same lineage.
 * Listed by name alone they are two identical rows, and a bare name answered back is one the
 * engine declines as ambiguous rather than guessing — so the move could not be made at all in
 * such a hierarchy.
 *
 * Both halves are pinned: what the user is shown has to distinguish the rows, and what comes
 * back has to carry the dictionary of the row that was picked. The dictionary is already in
 * both queries' answers (`dictIndex` / `dictName`), resolved by class identity, so nothing new
 * has to be asked for.
 *
 * The rows for names only one dictionary claims are left to the implementation — these pin the
 * ambiguous case.
 */

type Picker = {
  pickInstVarMoveTargets: (
    session: ActiveSession,
    item: { className: string; ivarName: string },
    direction: 'up' | 'down',
  ) => Promise<{ className: string; dictIndex?: number }[] | undefined>;
};

function makeController(): Picker {
  const sessionManager = { getSelectedSession: () => ({}) } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.className = 'Mid';
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 7;
  return ctl as unknown as Picker;
}

const session = {} as ActiveSession;

const pick = (direction: 'up' | 'down') =>
  makeController().pickInstVarMoveTargets(
    session,
    { className: 'Root', ivarName: 'weight' },
    direction,
  );

/** Everything the user can read on each offered row. */
const offeredRows = (): string[] => {
  const items = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as {
    label: string;
    description?: string;
    detail?: string;
  }[];
  return items.map((i) => [i.label, i.description, i.detail].filter(Boolean).join(' · '));
};

/** Two descendants of the same name, each bound by a different dictionary. */
const sameNamedDescendants = () =>
  vi.mocked(queries.getClassDescendantNames).mockReturnValue([
    { className: 'Leaf', parentName: 'Mid', dictName: 'DictA', dictIndex: 3 },
    { className: 'Leaf', parentName: 'Mid', dictName: 'DictB', dictIndex: 5 },
  ] as never);

/** Two ancestors of the same name, likewise. */
const sameNamedAncestors = () =>
  vi.mocked(queries.getClassHierarchy).mockReturnValue([
    { kind: 'superclass', className: 'Base', dictName: 'DictB', dictIndex: 5 },
    { kind: 'superclass', className: 'Base', dictName: 'DictA', dictIndex: 3 },
  ] as never);

beforeEach(() => vi.clearAllMocks());

describe('choosing between two same-named subclasses', () => {
  it('offers two rows the user can tell apart', async () => {
    sameNamedDescendants();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await pick('down');

    const [first, second] = offeredRows();
    expect(first).not.toBe(second);
  });

  it('names each row’s dictionary, which is the only thing that differs', async () => {
    sameNamedDescendants();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await pick('down');

    expect(offeredRows()[0]).toContain('DictA');
    expect(offeredRows()[1]).toContain('DictB');
  });

  it('answers with the dictionary of the row that was picked', async () => {
    sameNamedDescendants();
    vi.mocked(vscode.window.showQuickPick).mockImplementation(
      async (items) => [(await items)[1]] as never,
    );

    const targets = await pick('down');

    expect(targets).toEqual([expect.objectContaining({ className: 'Leaf', dictIndex: 5 })]);
  });

  it('keeps each chosen class with its own dictionary when both are picked', async () => {
    sameNamedDescendants();
    vi.mocked(vscode.window.showQuickPick).mockImplementation(
      async (items) => (await items) as never,
    );

    const targets = await pick('down');

    expect(targets).toEqual([
      expect.objectContaining({ className: 'Leaf', dictIndex: 3 }),
      expect.objectContaining({ className: 'Leaf', dictIndex: 5 }),
    ]);
  });
});

describe('choosing between two same-named ancestors', () => {
  it('names each row’s dictionary, so the two are not the same row twice', async () => {
    // The ▲ rows already differ in their "immediate superclass" / "ancestor" note, which says
    // nothing about which class is which — the dictionary is what separates them.
    sameNamedAncestors();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await pick('up');

    expect(offeredRows()[0]).toContain('DictA');
    expect(offeredRows()[1]).toContain('DictB');
  });

  it('answers with the dictionary of the ancestor that was picked', async () => {
    sameNamedAncestors();
    // The ▲ path reverses the list so the immediate superclass leads; the picked row is
    // whichever object the picker handed out, so the dictionary has to ride on it.
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => (await items)[0]);

    const targets = await pick('up');

    expect(targets).toEqual([expect.objectContaining({ className: 'Base', dictIndex: 3 })]);
  });
});
