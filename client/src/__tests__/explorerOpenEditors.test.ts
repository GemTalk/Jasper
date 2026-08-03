import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import { DirtyDecorationProvider } from '../explorerOpenEditors';
import { Uri, TabInputText, window } from '../__mocks__/vscode';

const SOURCE = 'gemstone://1/Globals/Array/instance/accessing/at%3A';

function openTab(uriString: string, isDirty: boolean): void {
  const uri = Uri.parse(uriString);
  window.tabGroups.all = [{ tabs: [{ input: new TabInputText(uri), isDirty }] }];
}

describe('DirtyDecorationProvider', () => {
  afterEach(() => {
    window.tabGroups.all = [];
  });

  it('marks a gemstone editor with unsaved changes with an unsaved-changes dot', () => {
    openTab(SOURCE, true);

    const decoration = new DirtyDecorationProvider().provideFileDecoration(Uri.parse(SOURCE));

    expect(decoration?.badge).toBe('●');
    expect(decoration?.tooltip).toBe('Unsaved changes');
  });

  it('leaves a saved editor undecorated', () => {
    openTab(SOURCE, false);

    const decoration = new DirtyDecorationProvider().provideFileDecoration(Uri.parse(SOURCE));

    expect(decoration).toBeUndefined();
  });

  it('never decorates a non-gemstone resource', () => {
    openTab(SOURCE, true);

    const decoration = new DirtyDecorationProvider().provideFileDecoration(
      Uri.parse('file:///tmp/x.st'),
    );

    expect(decoration).toBeUndefined();
  });
});
