import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logInfo: vi.fn() }));

import { workspace, window, languages, Uri, TabInputText } from '../__mocks__/vscode';
import { openWorkspace, workspaceUri, WORKSPACE_TEMPLATE } from '../workspace';
import { SMALLTALK_LANGUAGE } from '../languageIds';

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
      SMALLTALK_LANGUAGE,
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
      languageId: SMALLTALK_LANGUAGE,
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

  describe('several workspaces', () => {
    const openTabs = (paths: string[]) => {
      window.tabGroups.all = [
        {
          tabs: paths.map((path) => ({
            input: new TabInputText(Uri.from({ scheme: 'untitled', path })),
          })),
        },
      ];
    };

    afterEach(() => {
      window.tabGroups.all = [];
    });

    it('opens "Workspace 2" while "Workspace" is open, rather than reusing it', async () => {
      openTabs(['Workspace']);
      await openWorkspace();
      const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as Uri;
      expect(uri.path).toBe('Workspace 2');
    });

    it('opens a new one on every click — no limit', async () => {
      const opened: string[] = [];
      for (let i = 0; i < 4; i++) {
        openTabs(opened);
        await openWorkspace();
        opened.push((vi.mocked(workspace.openTextDocument).mock.calls[i][0] as Uri).path);
      }
      expect(opened).toEqual(['Workspace', 'Workspace 2', 'Workspace 3', 'Workspace 4']);
    });

    it('ignores tabs that are not text editors', async () => {
      window.tabGroups.all = [
        { tabs: [{ input: { uri: Uri.from({ scheme: 'untitled', path: 'Workspace' }) } }] },
      ];
      await openWorkspace();
      const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as Uri;
      expect(uri.path).toBe('Workspace');
    });

    it('reuses a lower number once that workspace is closed', () => {
      const second = Uri.from({ scheme: 'untitled', path: 'Workspace 2' }).toString();
      expect(workspaceUri([second]).path).toBe('Workspace');
    });
  });
});
