import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logInfo: vi.fn() }));

import { workspace, Uri } from '../__mocks__/vscode';
import { openExampleWorkspace } from '../workspace';

function insertedText(): string {
  const edit = (vi.mocked(workspace.applyEdit).mock.calls[0] as unknown[])[0] as {
    edits: Array<{ edit: { newText: string } }>;
  };
  return edit.edits.map((e) => e.edit.newText).join('');
}

describe('openExampleWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    workspace.textDocuments = [];
  });

  it('opens a Workspace named for the class, holding the example after a how-to line', async () => {
    await openExampleWorkspace('Parser', '"Display It: a Dictionary"\nParser parse: \'{}\'\n\n');

    const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as Uri;
    expect(uri.path).toBe('Parser example');
    const text = insertedText();
    expect(text).toMatch(/^"Trying Parser, an example from the Jasper Assistant\./);
    expect(text).toMatch(/Display It.*Inspect It/s);
    expect(text.endsWith('"Display It: a Dictionary"\nParser parse: \'{}\'\n')).toBe(true);
  });

  it('takes a new name while a document still holds the old one, even with its tab closed', async () => {
    workspace.textDocuments = [{ uri: Uri.from({ scheme: 'untitled', path: 'Parser example' }) }];

    await openExampleWorkspace('Parser', 'Parser new');

    const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as Uri;
    expect(uri.path).toBe('Parser example 2');
  });
});
