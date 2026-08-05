import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import { SourceEditorPlacement } from '../sourceEditorPlacement';
import { Uri, TabInputText, TabInputTextDiff, window } from '../__mocks__/vscode';

function gemUri(path: string): Uri {
  return Uri.parse(`gemstone://1/${path}`);
}

function setGroups(
  groups: { viewColumn?: number; uris: (Uri | { original: Uri; modified: Uri })[] }[],
): void {
  window.tabGroups.all = groups.map((g) => ({
    viewColumn: g.viewColumn,
    tabs: g.uris.map((u) =>
      'modified' in u
        ? { input: new TabInputTextDiff(u.original, u.modified) }
        : { input: new TabInputText(u) },
    ),
  }));
}

describe('SourceEditorPlacement', () => {
  beforeEach(() => {
    window.tabGroups.all = [];
  });

  describe('homeColumn', () => {
    it('creates a home region the first time, before it has opened anything', async () => {
      const createHome = vi.fn(async () => 7);
      const placement = new SourceEditorPlacement(createHome);

      const column = await placement.homeColumn();

      expect(createHome).toHaveBeenCalledOnce();
      expect(column).toBe(7);
    });

    it('reuses the group holding an editor it opened instead of creating another', async () => {
      const createHome = vi.fn(async () => 7);
      const placement = new SourceEditorPlacement(createHome);
      const uri = gemUri('Globals/Array/instance/accessing/at%3A');
      placement.remember(uri);
      setGroups([{ viewColumn: 2, uris: [uri] }]);

      const column = await placement.homeColumn();

      expect(createHome).not.toHaveBeenCalled();
      expect(column).toBe(2);
    });

    it('ignores a gemstone editor it did not open and creates its own region', async () => {
      const createHome = vi.fn(async () => 7);
      const placement = new SourceEditorPlacement(createHome);
      setGroups([{ viewColumn: 2, uris: [gemUri('Globals/Foreign/instance/x/y')] }]);

      const column = await placement.homeColumn();

      expect(createHome).toHaveBeenCalledOnce();
      expect(column).toBe(7);
    });

    it('re-finds its group by editor identity even after columns renumber', async () => {
      const createHome = vi.fn(async () => 7);
      const placement = new SourceEditorPlacement(createHome);
      const uri = gemUri('Globals/Array/instance/accessing/at%3A');
      placement.remember(uri);
      setGroups([{ viewColumn: 1, uris: [uri] }]);

      expect(await placement.homeColumn()).toBe(1);
    });

    it('finds its editor even when it lives on the modified side of a diff tab', async () => {
      const placement = new SourceEditorPlacement(async () => 7);
      const modified = gemUri('Globals/Array/instance/accessing/at%3A%20(session%20override)');
      placement.remember(modified);
      setGroups([{ viewColumn: 3, uris: [{ original: gemUri('base'), modified }] }]);

      expect(await placement.homeColumn()).toBe(3);
    });

    it('throws if asked for a home region without a create strategy', async () => {
      const placement = new SourceEditorPlacement();

      await expect(placement.homeColumn()).rejects.toThrow(/createHome/);
    });
  });

  describe('sourceColumn', () => {
    it('is undefined when none of our editors are open', () => {
      const placement = new SourceEditorPlacement();
      setGroups([{ viewColumn: 1, uris: [gemUri('other')] }]);

      expect(placement.sourceColumn()).toBeUndefined();
    });

    it('reports the group holding our editors', () => {
      const placement = new SourceEditorPlacement();
      const nav = gemUri('nav');
      const pinned = gemUri('pinned');
      [nav, pinned].forEach((u) => placement.remember(u));
      setGroups([{ viewColumn: 2, uris: [nav, pinned] }]);

      expect(placement.sourceColumn()).toBe(2);
    });

    it('ignores a foreign editor', () => {
      const placement = new SourceEditorPlacement();
      const nav = gemUri('nav');
      placement.remember(nav);
      setGroups([
        { viewColumn: 1, uris: [gemUri('foreign')] },
        { viewColumn: 2, uris: [nav] },
      ]);

      expect(placement.sourceColumn()).toBe(2);
    });

    it('finds our editor on the modified side of a diff tab', () => {
      const placement = new SourceEditorPlacement();
      const modified = gemUri('Globals/Array/instance/x/y%20(session%20override)');
      placement.remember(modified);
      setGroups([{ viewColumn: 3, uris: [{ original: gemUri('base'), modified }] }]);

      expect(placement.sourceColumn()).toBe(3);
    });
  });
});
