import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// Stub only what the class-history flow touches.
vi.mock('../browserQueries', () => ({
  getClassHistory: vi.fn(),
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Published', 'Globals']),
  revertClassToVersion: vi.fn(),
  removeClassVersion: vi.fn(),
  getClassEnvironments: vi.fn(() => []),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
}));
// The undo recorder's class-binding capture — mocked so the flow records without a stone.
vi.mock('../undo/queries/classSlotQueries', () => ({
  captureClassSlots: vi.fn(),
  forgetStashKeys: vi.fn(),
  newStashKey: vi.fn(() => 'k1'),
  releaseStashKeys: vi.fn(),
}));
vi.mock('../refactoring/classHistoryPanel', () => ({ showClassHistoryPanel: vi.fn() }));

import * as queries from '../browserQueries';
import { captureClassSlots } from '../undo/queries/classSlotQueries';
import { showClassHistoryPanel } from '../refactoring/classHistoryPanel';
import { ExplorerController, HierarchyItem } from '../gemstoneExplorer';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undo/undoStack';
import type { SessionManager, ActiveSession } from '../sessionManager';

/**
 * Restoring a class version is an ordinary CLASS EDIT (#434).
 *
 * Restoring binds a NEW version under the class name, so it reverts the way every other class
 * edit does — by binding back the version that is bound now. The case with teeth is a restore
 * ACROSS A RENAME: it unbinds one name and binds another, so both have to be recorded, or the
 * revert puts the old version back and leaves the new name bound alongside it.
 */

const HISTORY = JSON.stringify([
  { index: 2, name: 'Account', oop: 200, isCurrent: true, definition: '', changedMethods: [] },
  { index: 1, name: 'Ledger', oop: 100, isCurrent: false, definition: '', changedMethods: [] },
]);

const bound = (oop: string) => ({ bound: true, oop, selectors: [] });
const unbound = { bound: false, oop: null, selectors: [] };

function makeController() {
  const session = { id: 1, rbSupportAvailable: true } as unknown as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictIndex = 3;
  ctl.state.dictName = 'UserGlobals';
  vi.spyOn(
    ctl as unknown as { refreshAfterClassReshape: () => Promise<void> },
    'refreshAfterClassReshape',
  ).mockResolvedValue();
  return ctl;
}

/** Run the panel's `restore` callback, which is where the recording lives. */
async function restoreVersion(ctl: ExplorerController, index: number): Promise<void> {
  // classHistory reads only `className` off the node, and ClassItem is module-private.
  await ctl.classHistory({ className: 'Account' });
  const handlers = vi.mocked(showClassHistoryPanel).mock.calls[0][2] as {
    restore: (i: number) => Promise<unknown>;
  };
  await handlers.restore(index);
}

let captureCalls = 0;
/** The name the class ends up bound under — differs from 'Account' across a rename. */
let restoredName = 'Account';

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
  restoredName = 'Account';
  vi.mocked(queries.getClassHistory).mockReturnValue(HISTORY);
  vi.mocked(captureClassSlots).mockReset();
  // A restore binds a NEW version, so the read-back sees a different oop than the capture on
  // the way in — which is what tells the recorder the edit changed something.
  captureCalls = 0;
  vi.mocked(captureClassSlots).mockImplementation((_e, slots) => {
    captureCalls += 1;
    return slots.map((s) =>
      captureCalls === 1
        ? s.className === 'Account'
          ? bound('200')
          : unbound
        : s.className === restoredName
          ? bound('300')
          : unbound,
    );
  });
});

describe('ExplorerController.classHistory — restore', () => {
  it('records the class binding, so the restore can be reverted', async () => {
    const ctl = makeController();
    vi.mocked(queries.revertClassToVersion).mockReturnValue(
      JSON.stringify({ reverted: true, index: 2, newIndex: 3, name: 'Account' }),
    );

    await restoreVersion(ctl, 2);

    expect(peekUndoEntry(1)).toMatchObject({
      kind: 'classEdit',
      label: 'Restore Account to version 2',
      slots: [{ dict: 3, className: 'Account' }],
    });
  });

  it('records BOTH names when the restore crosses a rename', async () => {
    // Restoring the version the class was called Ledger under renames it back, which unbinds
    // Account and binds Ledger; reverting has to undo both halves.
    const ctl = makeController();
    restoredName = 'Ledger';
    vi.mocked(queries.revertClassToVersion).mockReturnValue(
      JSON.stringify({ reverted: true, index: 1, newIndex: 3, name: 'Ledger' }),
    );

    await restoreVersion(ctl, 1);

    const entry = peekUndoEntry(1);
    expect(entry?.kind === 'classEdit' && entry.slots.map((s) => s.className)).toEqual([
      'Account',
      'Ledger',
    ]);
  });

  it('records nothing when the restore did not happen', async () => {
    const ctl = makeController();
    vi.mocked(queries.revertClassToVersion).mockReturnValue(
      JSON.stringify({ reverted: false, error: 'no such version' }),
    );

    await restoreVersion(ctl, 2);

    expect(undoStackDepth(1)).toBe(0);
  });
});

describe('ExplorerController.classHistory — which dictionary the history belongs to', () => {
  /** Run `classHistory` on a node and answer the dictionary every history call was scoped to. */
  async function historyDictFor(
    ctl: ExplorerController,
    item: Parameters<ExplorerController['classHistory']>[0],
  ) {
    await ctl.classHistory(item);
    return vi.mocked(queries.getClassHistory).mock.calls[0][2];
  }

  it('scopes to the tree selection for a class row', async () => {
    const ctl = makeController();
    expect(await historyDictFor(ctl, { className: 'Account' })).toBe(3);
  });

  it("scopes to the NODE'S OWN dictionary for a hierarchy node, not the selection", async () => {
    // An ancestor in the Hierarchy pane usually lives in another dictionary. Scoping to the
    // selection made Class History on an ancestor fail outright ('not a class: Object'), and
    // where the selected dictionary shadows the ancestor's name it showed — and Restore
    // rewrote — the wrong class (#396).
    const ctl = makeController();
    const node = new HierarchyItem('Object', 'Globals', 'ancestor', 0, false);
    expect(await historyDictFor(ctl, node)).toBe('Globals');
  });

  it("scopes to the hierarchy node's dictionary POSITION when the node carries one", async () => {
    // Two dictionaries can share a name, so the name alone scopes to the first of them.
    const ctl = makeController();
    const node = new HierarchyItem('Object', 'Globals', 'ancestor', 0, false, undefined, 2);
    expect(await historyDictFor(ctl, node)).toBe(2);
  });

  /** The dictionary name the panel was labelled with. */
  const panelDictName = () =>
    (vi.mocked(showClassHistoryPanel).mock.calls[0][3] as { dictName?: string }).dictName;

  it("labels the panel with the hierarchy node's dictionary", async () => {
    const ctl = makeController();
    const node = new HierarchyItem('Object', 'Globals', 'ancestor', 0, false);
    await ctl.classHistory(node);
    expect(panelDictName()).toBe('Globals');
  });

  it("labels the panel with the node's OWN dictionary when the node carries an index", async () => {
    // The case the name-carrying node above cannot reach. A Hierarchy node now usually gives an
    // INDEX, and the selected dictionary's name was used for any index at all: Class History on
    // `Object`, which lives in Globals, opened saying UserGlobals. The versions listed were the
    // right ones, which is what makes a wrong label worse than a wrong lookup — nothing else on
    // screen says which of the same-named classes they belong to.
    const ctl = makeController(); // selection is index 3, 'UserGlobals'
    const node = new HierarchyItem('Object', 'Globals', 'ancestor', 0, false, undefined, 2);

    await ctl.classHistory(node);

    expect(panelDictName()).toBe('Published');
  });

  it("uses the selection's own name when the node's index IS the selected one", async () => {
    // The shortcut is still right for exactly one index, and it is the one that avoids a query.
    const ctl = makeController();
    const node = new HierarchyItem('Object', 'Globals', 'ancestor', 0, false, undefined, 3);

    await ctl.classHistory(node);

    expect(panelDictName()).toBe('UserGlobals');
  });

  it('labels a class row with the selected dictionary', async () => {
    const ctl = makeController();

    await ctl.classHistory({ className: 'Account' });

    expect(panelDictName()).toBe('UserGlobals');
  });

  it('records the restore against the dictionary the panel was opened on', async () => {
    // The panel stays open, so re-reading the tree state inside `restore` recorded the undo
    // against whatever the user clicked since — while the revert itself landed on the class the
    // panel was showing.
    const ctl = makeController();
    vi.mocked(queries.revertClassToVersion).mockReturnValue(
      JSON.stringify({ reverted: true, index: 2, newIndex: 3, name: 'Object' }),
    );
    const node = new HierarchyItem('Object', 'Globals', 'ancestor', 0, false);
    await ctl.classHistory(node);
    const handlers = vi.mocked(showClassHistoryPanel).mock.calls[0][2] as {
      restore: (i: number) => Promise<unknown>;
    };
    // the selection moves while the panel is open
    ctl.state.dictIndex = 7;
    ctl.state.dictName = 'Elsewhere';
    await handlers.restore(2);

    const entry = peekUndoEntry(1);
    const dicts = entry?.kind === 'classEdit' ? entry.slots.map((s) => s.dict) : [];
    expect(dicts.length).toBeGreaterThan(0);
    expect(dicts.every((d) => d === 'Globals')).toBe(true);
  });
});
