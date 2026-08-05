import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logInfo: vi.fn() }));

import { workspace, window, languages, Uri } from '../__mocks__/vscode';
import { openWorkspace, WORKSPACE_TEMPLATE } from '../workspace';

describe('openWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the NAMED untitled document "Workspace" (not Untitled-N)', async () => {
    await openWorkspace();

    const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as Uri;
    expect(uri.scheme).toBe('untitled');
    expect(uri.path).toBe('Workspace');
  });

  it('sets the document language to gemstone-smalltalk', async () => {
    await openWorkspace();
    expect(languages.setTextDocumentLanguage).toHaveBeenCalledWith(
      expect.anything(),
      'gemstone-smalltalk',
    );
  });

  it('seeds the workspace template into a fresh, empty buffer', async () => {
    await openWorkspace();
    // The template is inserted via a WorkspaceEdit (keeps the named doc, no Untitled-N).
    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-seed a buffer that hot-exit already restored with content', async () => {
    vi.mocked(workspace.openTextDocument).mockResolvedValueOnce({
      uri: Uri.from({ scheme: 'untitled', path: 'Workspace' }),
      languageId: 'gemstone-smalltalk',
      getText: () => WORKSPACE_TEMPLATE, // already has the user's content
    } as never);

    await openWorkspace();

    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('shows the document with preview disabled (a permanent tab)', async () => {
    await openWorkspace();
    expect(window.showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preview: false }),
    );
  });
});
