import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { RowanDecorationProvider, loadedProjectUri, changeUri } from '../rowanDecorations';

const provider = new RowanDecorationProvider();

describe('RowanDecorationProvider', () => {
  it('decorates a dirty project like a modified file in the git view', () => {
    const deco = provider.provideFileDecoration(loadedProjectUri('Seaside', true));

    expect(deco?.badge).toBe('M');
    expect(deco?.color).toEqual(new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
  });

  it('leaves a clean project undecorated', () => {
    expect(provider.provideFileDecoration(loadedProjectUri('STON', false))).toBeUndefined();
  });

  it('badges image-only changes as added and disk-only as deleted', () => {
    const added = provider.provideFileDecoration(changeUri('Seaside', 'HelloJasper', 'A'));
    const deleted = provider.provideFileDecoration(changeUri('Seaside', 'WAOldWidget', 'D'));

    expect(added?.badge).toBe('A');
    expect(added?.color).toEqual(new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
    expect(deleted?.badge).toBe('D');
    expect(deleted?.color).toEqual(
      new vscode.ThemeColor('gitDecoration.deletedResourceForeground'),
    );
  });

  it('ignores URIs from other schemes', () => {
    const foreign = vscode.Uri.from({ scheme: 'file', path: '/x', query: 'state=M' });

    expect(provider.provideFileDecoration(foreign)).toBeUndefined();
  });
});
