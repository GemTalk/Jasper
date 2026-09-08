import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import {
  closeEditorsForRemovedMethods,
  FS_CHANGED_COMMAND,
  refreshExplorer,
  refreshSearch,
  refreshSymbolList,
  reloadGemstoneEditors,
  REMOVE_OVERLAY_CATEGORY_COMMAND,
  removeOverlayCategory,
  RENAME_OVERLAY_CATEGORY_COMMAND,
  renameOverlayCategory,
  revealMethod,
  SEARCH_RESYNC_COMMAND,
  SYMBOL_LIST_CHANGED_COMMAND,
} from '../afterUndo';

/**
 * Putting the IDE back in step (#434).
 *
 * The rule with teeth is the DIRTY one: a reverted method's editor is reloaded, but an editor
 * with unsaved edits is left alone. Reverting it would discard the user's typing, and an undo
 * of something else is not licence to do that. Everything else here is best-effort by design —
 * a pane that is not open must never fail the undo that was otherwise fine.
 */

function editor(scheme: string, isDirty: boolean, id = scheme) {
  return { document: { uri: { scheme, toString: () => id }, isDirty } };
}

/** Open documents, as `vscode.workspace.textDocuments` reports them. */
function openDocuments(...docs: { document: { uri: unknown; isDirty: boolean } }[]) {
  Object.defineProperty(vscode.workspace, 'textDocuments', {
    value: docs.map((e) => e.document),
    writable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vscode.window.showTextDocument).mockResolvedValue(undefined as never);
  vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);
  Object.defineProperty(vscode.window, 'activeTextEditor', { value: undefined, writable: true });
  openDocuments();
});

describe('reloadGemstoneEditors', () => {
  it('reverts a clean GemStone editor so it shows the restored source', async () => {
    Object.defineProperty(vscode.window, 'visibleTextEditors', {
      value: [editor('gemstone', false)],
      writable: true,
    });

    await reloadGemstoneEditors();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.revert');
  });

  it('leaves a DIRTY GemStone editor alone', async () => {
    // Reverting it would silently discard what the user has typed.
    Object.defineProperty(vscode.window, 'visibleTextEditors', {
      value: [editor('gemstone', true)],
      writable: true,
    });

    await reloadGemstoneEditors();

    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('ignores editors that are not GemStone documents', async () => {
    Object.defineProperty(vscode.window, 'visibleTextEditors', {
      value: [editor('file', false)],
      writable: true,
    });

    await reloadGemstoneEditors();

    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('puts focus back where it started', async () => {
    // Reverting an editor means focusing it, so a reload of some OTHER method's editor would
    // otherwise leave the user looking at a tab they did not open.
    const active = editor('gemstone', false, 'active');
    const other = editor('gemstone', false, 'other');
    Object.defineProperty(vscode.window, 'visibleTextEditors', {
      value: [other],
      writable: true,
    });
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: active, writable: true });
    // Model what showTextDocument actually does: it moves focus.
    vi.mocked(vscode.window.showTextDocument).mockImplementation(((doc: unknown) => {
      const target = [active, other].find((e) => e.document === doc);
      Object.defineProperty(vscode.window, 'activeTextEditor', { value: target, writable: true });
      return Promise.resolve(undefined);
    }) as never);

    await reloadGemstoneEditors();

    expect(vscode.window.activeTextEditor).toBe(active);
  });

  it('leaves focus alone when nothing moved it', async () => {
    const active = editor('gemstone', false, 'active');
    Object.defineProperty(vscode.window, 'visibleTextEditors', { value: [], writable: true });
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: active, writable: true });

    await reloadGemstoneEditors();

    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
  });

  it('carries on when one editor cannot be shown', async () => {
    // A tab closed underneath the undo must not fail the undo.
    Object.defineProperty(vscode.window, 'visibleTextEditors', {
      value: [editor('gemstone', false, 'a'), editor('gemstone', false, 'b')],
      writable: true,
    });
    vi.mocked(vscode.window.showTextDocument)
      .mockRejectedValueOnce(new Error('gone'))
      .mockResolvedValue(undefined as never);

    await expect(reloadGemstoneEditors()).resolves.toBeUndefined();
  });
});

describe('refreshExplorer and revealMethod', () => {
  it('rebuilds the Explorer panes', async () => {
    await refreshExplorer();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.explorer.refresh');
  });

  it('does not fail when the Explorer is not active', async () => {
    vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('no such command'));
    await expect(refreshExplorer()).resolves.toBeUndefined();
  });

  it('lands the Explorer on a method, naming its side', async () => {
    await revealMethod('Account', 'balance', true);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.revealMethodByName',
      'Account',
      'balance',
      true,
    );
  });

  it('does not fail when the row is not in the rebuilt tree', async () => {
    vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('not found'));
    await expect(revealMethod('Account', 'balance', false)).resolves.toBeUndefined();
  });
});

describe('refreshSearch', () => {
  it('resyncs GemStone Search for the session the undo happened in', async () => {
    // Search caches its class list, so a class an undo unbound stays on offer as a hit and
    // opening it lands on "Class not found".
    await refreshSearch(7);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(SEARCH_RESYNC_COMMAND, 7);
  });

  it('does not fail when GemStone Search is not registered', async () => {
    vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('no such command'));
    await expect(refreshSearch(1)).resolves.toBeUndefined();
  });
});

describe('telling VS Code the source changed', () => {
  /**
   * An undo recompiles over GCI, never through the file system provider, so VS Code is never
   * told the resource changed and a clean editor goes on showing the source the undo just
   * discarded — which is how an undo gets silently re-saved. The notification is what a save
   * already sends; it reaches tabs in other groups and tabs that are not on top, and needs no
   * focus.
   */
  it('announces every open clean GemStone document', async () => {
    const a = editor('gemstone', false, 'a');
    const b = editor('gemstone', false, 'b');
    openDocuments(a, b);

    await reloadGemstoneEditors();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(FS_CHANGED_COMMAND, [
      a.document.uri,
      b.document.uri,
    ]);
  });

  it('announces a document that is open but not visible', async () => {
    // The reason this exists alongside the revert: a background tab is not a visible editor,
    // so the revert never reaches it.
    const background = editor('gemstone', false, 'background');
    openDocuments(background);
    Object.defineProperty(vscode.window, 'visibleTextEditors', { value: [], writable: true });

    await reloadGemstoneEditors();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(FS_CHANGED_COMMAND, [
      background.document.uri,
    ]);
  });

  it('leaves a DIRTY document out', async () => {
    openDocuments(editor('gemstone', true, 'dirty'));

    await reloadGemstoneEditors();

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      FS_CHANGED_COMMAND,
      expect.anything(),
    );
  });

  it('ignores documents that are not GemStone', async () => {
    openDocuments(editor('file', false, 'onDisk'));

    await reloadGemstoneEditors();

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      FS_CHANGED_COMMAND,
      expect.anything(),
    );
  });

  it('does not fail when the provider is not registered', async () => {
    openDocuments(editor('gemstone', false, 'a'));
    vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('no such command'));

    await expect(reloadGemstoneEditors()).resolves.toBeUndefined();
  });
});

describe('refreshSymbolList', () => {
  it('asks the Explorer to rebuild from the symbol list up', async () => {
    // A pane refresh is not enough: every dictionary below the change has shifted index, and
    // the Explorer caches those indices as the key to everything it shows.
    await refreshSymbolList(7);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(SYMBOL_LIST_CHANGED_COMMAND, 7);
  });

  it('survives the Explorer not being registered', async () => {
    vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('no such command'));

    await expect(refreshSymbolList(7)).resolves.toBeUndefined();
  });
});

describe('the overlay-category bridges', () => {
  const slot = { className: 'Account', isMeta: false, dict: 7 };

  it('passes a rename through to the Explorer and answers what it made of it', async () => {
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue('ok');

    await expect(renameOverlayCategory(slot, 'reading', 'accessing')).resolves.toBe('ok');

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      RENAME_OVERLAY_CATEGORY_COMMAND,
      slot,
      'reading',
      'accessing',
    );
  });

  it('passes a removal through the same way', async () => {
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue('ok');

    await expect(removeOverlayCategory(slot, 'tests')).resolves.toBe('ok');

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      REMOVE_OVERLAY_CATEGORY_COMMAND,
      slot,
      'tests',
    );
  });

  it('reads a missing Explorer as not-listed rather than throwing at the undo', async () => {
    // The overlay is the only place such a category exists, so an Explorer that is not there
    // is indistinguishable from one that has discarded it — and neither is a failure.
    vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('no such command'));

    await expect(renameOverlayCategory(slot, 'a', 'b')).resolves.toBe('not-listed');
    await expect(removeOverlayCategory(slot, 'a')).resolves.toBe('not-listed');
  });

  it('reads an answerless command as not-listed too', async () => {
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);

    await expect(renameOverlayCategory(slot, 'a', 'b')).resolves.toBe('not-listed');
    await expect(removeOverlayCategory(slot, 'a')).resolves.toBe('not-listed');
  });
});

/**
 * Closing the editors for methods an undo DELETED (#434).
 *
 * The rule with teeth here is the DICTIONARY. A class name is not unique in a session — a
 * symbol list can hold `Account` in two dictionaries — so a match on class and selector alone
 * would close the editor for a method that still exists, which is worse than the stale tab
 * this is meant to remove. The dirty rule is the same one the reload follows.
 */
const METHOD = 'gemstone://1/Globals/Account/instance/accessing/balance';

function methodTab(uri: string, isDirty = false) {
  return { input: new vscode.TabInputText(vscode.Uri.parse(uri)), isDirty };
}

function openTabs(...tabs: { input: unknown; isDirty?: boolean }[]) {
  Object.defineProperty(vscode.window.tabGroups, 'all', {
    value: [{ viewColumn: 1, tabs }],
    writable: true,
  });
}

const slot = (over: Record<string, unknown> = {}) => ({
  dict: 'Globals',
  className: 'Account',
  isMeta: false,
  selector: 'balance',
  environmentId: 0,
  ...over,
});

describe('closeEditorsForRemovedMethods', () => {
  beforeEach(() => {
    openTabs();
    vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(true);
  });

  it('closes the editor for a method the undo removed', async () => {
    const tab = methodTab(METHOD);
    openTabs(tab);

    await closeEditorsForRemovedMethods(1, [slot()]);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(tab);
  });

  it('leaves a method the undo did not touch', async () => {
    openTabs(methodTab('gemstone://1/Globals/Account/instance/accessing/total'));

    await closeEditorsForRemovedMethods(1, [slot()]);

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });

  it('leaves the class side alone when the instance side went', async () => {
    openTabs(methodTab('gemstone://1/Globals/Account/class/accessing/balance'));

    await closeEditorsForRemovedMethods(1, [slot({ isMeta: false })]);

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });

  it('leaves a dirty editor open rather than discarding what was typed', async () => {
    openTabs(methodTab(METHOD, true));

    await closeEditorsForRemovedMethods(1, [slot()]);

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });

  it("leaves another session's editor alone", async () => {
    openTabs(methodTab('gemstone://2/Globals/Account/instance/accessing/balance'));

    await closeEditorsForRemovedMethods(1, [slot()]);

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });

  it('leaves a same-named class in ANOTHER dictionary open', async () => {
    // The whole reason the dictionary is part of the match: this Account>>#balance is a
    // different method that still exists.
    openTabs(methodTab('gemstone://1/UserGlobals/Account/instance/accessing/balance'));

    await closeEditorsForRemovedMethods(1, [slot({ dict: 'Globals' })]);

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });

  it("compares a recorded symbol-list INDEX against the tab's own index", async () => {
    const mine = methodTab(`${METHOD}?dict=3`);
    openTabs(methodTab('gemstone://1/UserGlobals/Account/instance/accessing/balance?dict=7'), mine);

    await closeEditorsForRemovedMethods(1, [slot({ dict: 3 })]);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(1);
    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(mine);
  });

  it('closes on class and selector when the tab carries no dictionary index', async () => {
    // A URI with no ?dict= was resolved by walking the symbol list in order, the same lookup
    // the Explorer's selection used — so it is the same class, and the alternative is leaving
    // the stale tab in the common case. Documented on sameDictionary.
    const tab = methodTab(METHOD);
    openTabs(tab);

    await closeEditorsForRemovedMethods(1, [slot({ dict: 3 })]);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(tab);
  });

  it('closes every tab showing the same method, however its URI was built', async () => {
    const withIndex = methodTab(`${METHOD}?dict=3`);
    const withoutIndex = methodTab(METHOD);
    openTabs(withIndex, withoutIndex);

    await closeEditorsForRemovedMethods(1, [slot({ dict: 3 })]);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(2);
  });

  it('does nothing at all when the undo removed no methods', async () => {
    openTabs(methodTab(METHOD));

    await closeEditorsForRemovedMethods(1, []);

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });

  it('ignores tabs that are not method source — a class definition, say', async () => {
    openTabs(methodTab('gemstone://1/Globals/Account/definition'));

    await closeEditorsForRemovedMethods(1, [slot()]);

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });

  it('does not fail the undo when a tab refuses to close', async () => {
    vi.mocked(vscode.window.tabGroups.close).mockRejectedValue(new Error('nope'));
    openTabs(methodTab(METHOD));

    await expect(closeEditorsForRemovedMethods(1, [slot()])).resolves.toBeUndefined();
  });
});
