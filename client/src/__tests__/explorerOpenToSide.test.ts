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
    tabs: {
      uri: string;
      isDirty?: boolean;
      isPinned?: boolean;
      isPreview?: boolean;
      active?: boolean;
    }[];
  }[],
): void {
  window.tabGroups.all = groups.map((g) => {
    const tabs = g.tabs.map((t) => ({
      input: new TabInputText(Uri.parse(t.uri)),
      isDirty: t.isDirty,
      isPinned: t.isPinned,
      isPreview: t.isPreview,
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
    it('opens a preview tab in the active group, keeping focus in the tree', async () => {
      const placement = new SourceEditorPlacement();

      await openGemstoneDocument(methodDoc(), 'preview', placement);

      expect(showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          viewColumn: ViewColumn.Active,
          preview: true,
          preserveFocus: true,
        }),
      );
    });

    it('opens the preview tab in the group that already holds our editors', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(NAV));
      setGroups([{ viewColumn: 2, tabs: [{ uri: NAV, active: true }] }]);

      await openGemstoneDocument(methodDoc(), 'preview', placement);

      expect(showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: 2, preview: true, preserveFocus: true }),
      );
    });

    it('leaves the transient-tab bookkeeping to VS Code — never closes a tab itself', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(NAV));
      setGroups([{ viewColumn: 2, tabs: [{ uri: NAV, active: true }] }]);

      await openGemstoneDocument(methodDoc(), 'preview', placement);

      expect(closeTab).not.toHaveBeenCalled();
    });
  });

  describe('double-click', () => {
    it('opens a permanent (non-preview) tab, keeping focus in the tree', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(NAV));
      setGroups([{ viewColumn: 2, tabs: [{ uri: NAV, active: true }] }]);

      await openGemstoneDocument(methodDoc(), 'keep', placement);

      expect(showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: 2, preview: false, preserveFocus: true }),
      );
      expect(executeCommand).not.toHaveBeenCalledWith('workbench.action.pinEditor');
    });
  });

  describe('pin', () => {
    it('pins the method as a tab in our group', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(NAV));
      setGroups([{ viewColumn: 2, tabs: [{ uri: NAV, active: true }] }]);

      await openGemstoneDocument(methodDoc(), 'pin', placement);

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
      setGroups([
        { viewColumn: 2, tabs: [{ uri: NAV }, { uri: SIDE, isPinned: true, active: true }] },
      ]);

      await openGemstoneDocument(methodDoc(), 'pin', placement);

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

    it('restores the browsed method as a preview tab, not promoting it, when pinning another', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(NAV));
      placement.remember(Uri.parse(SIDE));
      setGroups([{ viewColumn: 2, tabs: [{ uri: SIDE, isPreview: true, active: true }] }]);

      await openGemstoneDocument(methodDoc(), 'pin', placement);

      const restore = showTextDocument.mock.calls.find((c) => String(c[0]) === SIDE);
      expect(restore?.[1]).toMatchObject({ viewColumn: 2, preview: true, preserveFocus: true });
    });

    it('does not restore the view when the pinned method was the one already showing', async () => {
      const placement = new SourceEditorPlacement();
      placement.remember(Uri.parse(SOURCE));
      setGroups([{ viewColumn: 2, tabs: [{ uri: SOURCE, active: true }] }]);

      await openGemstoneDocument(methodDoc(), 'pin', placement);

      expect(executeCommand).toHaveBeenCalledWith('workbench.action.pinEditor');
      expect(showTextDocument.mock.calls.filter((c) => c[1]?.preserveFocus === true)).toHaveLength(
        0,
      );
    });

    it('opens the first pin in the active group when nothing is open yet', async () => {
      const placement = new SourceEditorPlacement();

      await openGemstoneDocument(methodDoc(), 'pin', placement);

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
