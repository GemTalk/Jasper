import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode'));

import type * as vscode from 'vscode';
import { openGemstoneDocument } from '../gemstoneExplorer';
import type { SourceEditorPlacement } from '../sourceEditorPlacement';
import { Uri, TabInputText, ViewColumn, window, commands } from '../__mocks__/vscode';

const SOURCE = 'gemstone://1/UserGlobals/M2Demo/instance/inline-demos/twiceAtom';

function methodDoc(uriString = SOURCE): vscode.TextDocument {
  return { uri: Uri.parse(uriString) } as unknown as vscode.TextDocument;
}

// A placement whose column choice is fixed, so the test controls which branch of
// the "not already open" path runs without exercising the real balancing logic.
function stubPlacement(choice: number | 'new'): SourceEditorPlacement {
  return {
    remember: vi.fn(),
    balancedColumn: vi.fn(() => choice),
  } as unknown as SourceEditorPlacement;
}

function openTabInGroup(uriString: string, viewColumn: number): void {
  window.tabGroups.all = [
    { viewColumn, tabs: [{ input: new TabInputText(Uri.parse(uriString)) }] },
  ];
}

const showTextDocument = window.showTextDocument as ReturnType<typeof vi.fn>;
const executeCommand = commands.executeCommand as ReturnType<typeof vi.fn>;
const closeTab = window.tabGroups.close as ReturnType<typeof vi.fn>;

const OTHER = 'gemstone://1/UserGlobals/M2Demo/instance/inline-demos/other';

describe('openGemstoneDocument — open to side', () => {
  beforeEach(() => {
    window.tabGroups.all = [];
    showTextDocument.mockClear();
    executeCommand.mockClear();
  });

  afterEach(() => {
    window.tabGroups.all = [];
    vi.clearAllMocks();
  });

  it('reveals the existing editor when the method is already open, without duplicating it', async () => {
    openTabInGroup(SOURCE, ViewColumn.Two);
    const placement = stubPlacement('new');

    await openGemstoneDocument(methodDoc(), true, placement);

    expect(placement.balancedColumn).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
    expect(showTextDocument).toHaveBeenCalledTimes(1);
    expect(showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ viewColumn: ViewColumn.Two, preview: false }),
    );
  });

  it('ignores an open editor for a different method and opens a new one', async () => {
    openTabInGroup('gemstone://1/UserGlobals/M2Demo/instance/inline-demos/other', ViewColumn.Two);
    const placement = stubPlacement(ViewColumn.Three);

    await openGemstoneDocument(methodDoc(), true, placement);

    expect(placement.balancedColumn).toHaveBeenCalled();
    expect(showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ viewColumn: ViewColumn.Three, preview: false }),
    );
  });

  it('appends a fresh group when nothing is open and balancing asks for a new column', async () => {
    const placement = stubPlacement('new');

    await openGemstoneDocument(methodDoc(), true, placement);

    expect(executeCommand).toHaveBeenCalledWith('workbench.action.focusLastEditorGroup');
    expect(showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ viewColumn: ViewColumn.Beside, preview: false }),
    );
  });

  it('opens a single-click method as a reusable non-preview tab in the active column, keeping focus in the tree', async () => {
    const placement = stubPlacement('new');

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

  it('closes the previous single-click tab when navigating to another method, so tabs do not pile up', async () => {
    window.tabGroups.all = [
      { viewColumn: ViewColumn.Two, tabs: [{ input: new TabInputText(Uri.parse(OTHER)) }] },
    ];
    const placement = stubPlacement('new');
    placement.reusableTab = OTHER;

    await openGemstoneDocument(methodDoc(), false, placement);

    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(placement.reusableTab).toBe(SOURCE);
  });

  it('keeps the previous single-click tab open when it has unsaved edits', async () => {
    window.tabGroups.all = [
      {
        viewColumn: ViewColumn.Two,
        tabs: [{ input: new TabInputText(Uri.parse(OTHER)), isDirty: true }],
      },
    ];
    const placement = stubPlacement('new');
    placement.reusableTab = OTHER;

    await openGemstoneDocument(methodDoc(), false, placement);

    expect(closeTab).not.toHaveBeenCalled();
  });

  it('keeps the previous single-click tab open when the user pinned it', async () => {
    window.tabGroups.all = [
      {
        viewColumn: ViewColumn.Two,
        tabs: [{ input: new TabInputText(Uri.parse(OTHER)), isPinned: true }],
      },
    ];
    const placement = stubPlacement('new');
    placement.reusableTab = OTHER;

    await openGemstoneDocument(methodDoc(), false, placement);

    expect(closeTab).not.toHaveBeenCalled();
  });
});
