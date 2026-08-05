import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
// The controller module pulls in browserQueries (→ native GCI). Stub just the two hierarchy
// queries the picker calls; nothing else is exercised by pickInstVarMoveTargets.
vi.mock('../browserQueries', () => ({
  getClassHierarchy: vi.fn(),
  getClassDescendantNames: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';

/**
 * Drives ExplorerController.pickInstVarMoveTargets — the ▲/▼ destination picker behind the
 * "Move Instance Variable Up/Down…" arrows. Stubs the hierarchy queries and showQuickPick, so it
 * pins the load-bearing choices (immediate-superclass-first ordering, the two "nowhere to move"
 * messages, and multi-select on the ▼ path only) without a live tree or stone.
 */

type Picker = {
  pickInstVarMoveTargets: (
    session: ActiveSession,
    item: { className: string; ivarName: string },
    direction: 'up' | 'down',
  ) => Promise<string[] | undefined>;
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
const pick = (ctl: Picker, direction: 'up' | 'down'): Promise<string[] | undefined> =>
  ctl.pickInstVarMoveTargets(session, { className: 'Leaf', ivarName: 'weight' }, direction);

beforeEach(() => vi.clearAllMocks());

describe('ExplorerController move-ivar destination picker', () => {
  describe('▲ up', () => {
    it('lists ancestors with the immediate superclass first', async () => {
      // getClassHierarchy returns superclasses root-first; the picker must reverse them.
      vi.mocked(queries.getClassHierarchy).mockReturnValue([
        { kind: 'superclass', className: 'Object' },
        { kind: 'superclass', className: 'Animal' },
        { kind: 'superclass', className: 'Mid' },
        { kind: 'subclass', className: 'Grand' },
      ] as never);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

      await pick(makeController(), 'up');

      const items = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as {
        label: string;
        description?: string;
      }[];
      expect(items.map((i) => i.label)).toEqual(['Mid', 'Animal', 'Object']);
      expect(items[0].description).toBe('immediate superclass');
      expect(items[1].description).toBe('ancestor');
    });

    it('resolves the hierarchy dict-scoped and single-select (no canPickMany)', async () => {
      vi.mocked(queries.getClassHierarchy).mockReturnValue([
        { kind: 'superclass', className: 'Mid' },
      ] as never);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: 'Mid' });

      const result = await pick(makeController(), 'up');

      expect(queries.getClassHierarchy).toHaveBeenCalledWith(session, 'Leaf', 7);
      expect(vi.mocked(vscode.window.showQuickPick).mock.calls[0][1]).not.toHaveProperty(
        'canPickMany',
      );
      expect(result).toEqual(['Mid']);
    });

    it('returns undefined when the user cancels', async () => {
      vi.mocked(queries.getClassHierarchy).mockReturnValue([
        { kind: 'superclass', className: 'Mid' },
      ] as never);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

      expect(await pick(makeController(), 'up')).toBeUndefined();
    });

    it('tells the user and picks nothing when the class has no superclass', async () => {
      vi.mocked(queries.getClassHierarchy).mockReturnValue([] as never);

      const result = await pick(makeController(), 'up');

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining("Leaf has no superclass to move 'weight' up to"),
      );
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });
  });

  describe('▼ down', () => {
    it('offers every descendant as a multi-select and returns all chosen labels', async () => {
      vi.mocked(queries.getClassDescendantNames).mockReturnValue([
        { className: 'LeafA', parentName: 'Mid' },
        { className: 'LeafB', parentName: 'Mid' },
      ] as never);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue([
        { label: 'LeafA' },
        { label: 'LeafB' },
      ] as never);

      const result = await pick(makeController(), 'down');

      expect(queries.getClassDescendantNames).toHaveBeenCalledWith(session, 'Leaf', 7);
      expect(vi.mocked(vscode.window.showQuickPick).mock.calls[0][1]).toMatchObject({
        canPickMany: true,
      });
      expect(result).toEqual(['LeafA', 'LeafB']);
    });

    it('returns undefined when the user picks nothing', async () => {
      vi.mocked(queries.getClassDescendantNames).mockReturnValue([
        { className: 'LeafA', parentName: 'Mid' },
      ] as never);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue([] as never);

      expect(await pick(makeController(), 'down')).toBeUndefined();
    });

    it('tells the user and picks nothing when the class has no subclasses', async () => {
      vi.mocked(queries.getClassDescendantNames).mockReturnValue([] as never);

      const result = await pick(makeController(), 'down');

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining("Leaf has no subclasses to move 'weight' down to"),
      );
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });
  });
});
