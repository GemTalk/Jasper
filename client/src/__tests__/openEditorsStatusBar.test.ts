import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import { registerOpenEditorsStatusBar } from '../openEditorsStatusBar';
import { Uri, TabInputText, window, commands } from '../__mocks__/vscode';
import type * as vscode from 'vscode';

const CLOSE_ALL_COMMAND = 'gemstone.explorer.closeAllOpenEditors';

function openTabs(...uriStrings: string[]): void {
  window.tabGroups.all = [
    { tabs: uriStrings.map((s) => ({ input: new TabInputText(Uri.parse(s)), isDirty: false })) },
  ];
}

function fakeContext(): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

// The most recently created status-bar item — the one this module registers.
function statusItem() {
  return vi.mocked(window.createStatusBarItem).mock.results.at(-1)!.value as {
    text: string;
    tooltip?: string;
    command?: string;
    show: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
  };
}

// The callback registered for the close-all command.
function closeAllHandler(): () => void {
  const call = vi
    .mocked(commands.registerCommand)
    .mock.calls.find(([id]) => id === CLOSE_ALL_COMMAND);
  return call![1] as () => void;
}

describe('Close All GemStone Editors status-bar button', () => {
  afterEach(() => {
    window.tabGroups.all = [];
    vi.clearAllMocks();
  });

  it('shows a count and runs close-all when GemStone editors are open', () => {
    openTabs('gemstone://1/Globals/Array/instance/accessing/at%3A');

    registerOpenEditorsStatusBar(fakeContext());

    const item = statusItem();
    expect(item.command).toBe(CLOSE_ALL_COMMAND);
    expect(item.text).toContain('Close 1 GemStone editor');
    expect(item.show).toHaveBeenCalled();
  });

  it('pluralizes the label for more than one editor', () => {
    openTabs(
      'gemstone://1/Globals/Array/instance/accessing/at%3A',
      'gemstone://1/Globals/Array/instance/accessing/size',
    );

    registerOpenEditorsStatusBar(fakeContext());

    expect(statusItem().text).toContain('Close 2 GemStone editors');
  });

  it('counts a document split across editor groups once', () => {
    const source = 'gemstone://1/Globals/Array/instance/accessing/at%3A';
    window.tabGroups.all = [
      { tabs: [{ input: new TabInputText(Uri.parse(source)), isDirty: false }] },
      { tabs: [{ input: new TabInputText(Uri.parse(source)), isDirty: false }] },
    ];

    registerOpenEditorsStatusBar(fakeContext());

    expect(statusItem().text).toContain('1 GemStone editor');
  });

  it('hides itself when no GemStone editor is open', () => {
    openTabs();

    registerOpenEditorsStatusBar(fakeContext());

    expect(statusItem().hide).toHaveBeenCalled();
    expect(statusItem().show).not.toHaveBeenCalled();
  });

  it('closes every open GemStone editor tab when invoked', () => {
    openTabs(
      'gemstone://1/Globals/Array/instance/accessing/at%3A',
      'gemstone://1/Globals/Array/instance/accessing/size',
    );
    registerOpenEditorsStatusBar(fakeContext());

    closeAllHandler()();

    const closed = vi.mocked(window.tabGroups.close).mock.calls.at(-1)![0] as unknown[];
    expect(closed).toHaveLength(2);
  });
});
