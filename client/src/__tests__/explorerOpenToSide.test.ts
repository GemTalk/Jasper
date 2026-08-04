import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type * as vscode from 'vscode';
import { openGemstoneDocument } from '../gemstoneExplorer';
import { SourceEditorPlacement } from '../sourceEditorPlacement';
import { Uri, TabInputText, ViewColumn, window, commands } from '../__mocks__/vscode';

const SOURCE = 'gemstone://1/UserGlobals/M2Demo/instance/inline-demos/twiceAtom';
const NAV = 'gemstone://1/UserGlobals/M2Demo/instance/inline-demos/nav';
const SIDE = 'gemstone://1/UserGlobals/M2Demo/instance/inline-demos/side';

function methodDoc(uriString = SOURCE): vscode.TextDocument {
  return { uri: Uri.parse(uriString) } as unknown as vscode.TextDocument;
}

function setGroups(
  groups: {
    viewColumn?: number;
    tabs: { uri: string; isDirty?: boolean; isPinned?: boolean; active?: boolean }[];
  }[],
): void {
  window.tabGroups.all = groups.map((g) => {
    const tabs = g.tabs.map((t) => ({
      input: new TabInputText(Uri.parse(t.uri)),
      isDirty: t.isDirty,
      isPinned: t.isPinned,
    }));
    const activeIndex = g.tabs.findIndex((t) => t.active);
    return {
      viewColumn: g.viewColumn,
      activeTab: activeIndex >= 0 ? tabs[activeIndex] : undefined,
      tabs,
    };
  });
}

const showTextDocument = window.showTextDocument as ReturnType<typeof vi.fn>;
const executeCommand = commands.executeCommand as ReturnType<typeof vi.fn>;
const closeTab = window.tabGroups.close as ReturnType<typeof vi.fn>;

describe('openGemstoneDocument', () => {
  beforeEach(() => {
    window.tabGroups.all = [];
    vi.clearAllMocks();
  });
  afterEach(() => {
    window.tabGroups.all = [];
  });

  describe('single-click navigation', () => {
    it('opens one transient tab in the active group, keeping focus in the tree', async () => {
      const placement = new SourceEditorPlacement();

      await openGemstoneDocument(methodDoc(), false, placement);

      expect(showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          viewColumn: ViewColumn.Active,
          preview: false,
          preserveFocus: true,
        }),
      );
      expect(placement.reusableTab).toBe(SOURCE);
    });

    it('opens the transient tab in the group that already holds our editors', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(NAV));
      placement.reusableTab = NAV;
      setGroups([{ viewColumn: 2, tabs: [{ uri: NAV, active: true }] }]);

      await openGemstoneDocument(methodDoc(), false, placement);

      expect(showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: 2, preview: false, preserveFocus: true }),
      );
    });

    it('reveals a method already open in our group instead of duplicating it', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(NAV));
      placement.remember(Uri.parse(SOURCE));
      placement.reusableTab = NAV;
      setGroups([
        {
          viewColumn: 2,
          tabs: [
            { uri: NAV, active: true },
            { uri: SOURCE, isPinned: true },
          ],
        },
      ]);

      await openGemstoneDocument(methodDoc(), false, placement);

      expect(showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: 2, preview: false, preserveFocus: true }),
      );
      // The transient wasn't replaced and nothing was closed.
      expect(placement.reusableTab).toBe(NAV);
      expect(closeTab).not.toHaveBeenCalled();
    });

    it('closes the previous transient so browsing does not pile up tabs', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(NAV));
      placement.reusableTab = NAV;
      setGroups([{ viewColumn: 2, tabs: [{ uri: NAV, active: true }] }]);

      await openGemstoneDocument(methodDoc(), false, placement);

      expect(closeTab).toHaveBeenCalledTimes(1);
      expect(placement.reusableTab).toBe(SOURCE);
    });

    it('keeps the previous transient when it has unsaved edits', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(NAV));
      placement.reusableTab = NAV;
      setGroups([{ viewColumn: 2, tabs: [{ uri: NAV, isDirty: true, active: true }] }]);

      await openGemstoneDocument(methodDoc(), false, placement);

      expect(closeTab).not.toHaveBeenCalled();
    });

    it('closes the outgoing transient in our column, never a System Browser copy of the same URI', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(NAV));
      placement.reusableTab = NAV;
      placement.reusableColumn = 2;
      // The same gemstone:// method is open in the System Browser's group (column 1)
      // and as our transient (column 2). The foreign group is listed first, so a
      // whole-window scan would reach and close it first.
      setGroups([
        { viewColumn: 1, tabs: [{ uri: NAV }] },
        { viewColumn: 2, tabs: [{ uri: NAV, active: true }] },
      ]);
      const foreignTab = window.tabGroups.all[0].tabs[0];
      const ourTab = window.tabGroups.all[1].tabs[0];

      await openGemstoneDocument(methodDoc(), false, placement);

      expect(closeTab).toHaveBeenCalledTimes(1);
      expect(closeTab.mock.calls[0][0]).toBe(ourTab);
      expect(closeTab.mock.calls[0][0]).not.toBe(foreignTab);
    });
  });

  describe('pin', () => {
    it('pins the method as a tab in our group', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(NAV));
      placement.reusableTab = NAV;
      setGroups([{ viewColumn: 2, tabs: [{ uri: NAV, active: true }] }]);

      await openGemstoneDocument(methodDoc(), true, placement);

      expect(showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: 2, preview: false, preserveFocus: false }),
      );
      expect(executeCommand).toHaveBeenCalledWith('workbench.action.pinEditor');
    });

    it('adds a new pin without stealing the view from the method being read', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(NAV));
      placement.remember(Uri.parse(SIDE));
      placement.reusableTab = NAV;
      setGroups([
        { viewColumn: 2, tabs: [{ uri: NAV }, { uri: SIDE, isPinned: true, active: true }] },
      ]);

      await openGemstoneDocument(methodDoc(), true, placement);

      expect(showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: 2, preview: false, preserveFocus: false }),
      );
      expect(executeCommand).toHaveBeenCalledWith('workbench.action.pinEditor');
      // Restores the previously-visible tab (SIDE), so the new pin parks in the
      // background rather than switching what you're reading.
      const restore = showTextDocument.mock.calls.find((c) => c[1]?.preserveFocus === true);
      expect(restore).toBeDefined();
      expect(String(restore?.[0])).toBe(SIDE);
      expect(restore?.[1]).toMatchObject({ viewColumn: 2 });
    });

    it('promotes the transient method to a pinned tab and frees the transient slot', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(SOURCE));
      placement.reusableTab = SOURCE;
      setGroups([{ viewColumn: 2, tabs: [{ uri: SOURCE, active: true }] }]);

      await openGemstoneDocument(methodDoc(), true, placement);

      expect(executeCommand).toHaveBeenCalledWith('workbench.action.pinEditor');
      expect(placement.reusableTab).toBeUndefined();
      // The pinned method was already the visible one, so nothing is restored.
      expect(showTextDocument.mock.calls.filter((c) => c[1]?.preserveFocus === true)).toHaveLength(
        0,
      );
    });

    it('opens the first pin in the active group when nothing is open yet', async () => {
      const placement = new SourceEditorPlacement();

      await openGemstoneDocument(methodDoc(), true, placement);

      expect(showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          viewColumn: ViewColumn.Active,
          preview: false,
          preserveFocus: false,
        }),
      );
      expect(executeCommand).toHaveBeenCalledWith('workbench.action.pinEditor');
    });
  });
});
