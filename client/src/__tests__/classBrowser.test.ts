import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { window, workspace, Uri, ViewColumn } from '../__mocks__/vscode';
import { ClassBrowser } from '../classBrowser';
import type { ActiveSession } from '../sessionManager';
import type { GemStoneLogin } from '../loginTypes';

function makeSession(id = 1): ActiveSession {
  return { id, login: { label: 'test' } as GemStoneLogin } as unknown as ActiveSession;
}

// ── ClassBrowser panel lifecycle ─────────────────────────

describe('ClassBrowser', () => {
  let session: ActiveSession;

  beforeEach(() => {
    vi.clearAllMocks();
    session = makeSession();
  });

  it('does not open the class definition editor when the class name is null', async () => {
    await ClassBrowser.showOrUpdate(session, ['UserGlobals'], 1, null);

    expect(workspace.openTextDocument).not.toHaveBeenCalled();
    expect(window.showTextDocument).not.toHaveBeenCalled();
  });

  it('opens the class definition editor when the class name is not null', async () => {
    await ClassBrowser.showOrUpdate(session, ['UserGlobals'], 1, 'Array');

    // ?dict=<index> scopes the definition lookup to this exact dictionary.
    expect(workspace.openTextDocument).toHaveBeenCalledWith(
      Uri.parse('gemstone://1/UserGlobals/Array/definition?dict=1'),
    );
    expect(window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: Uri.parse('gemstone://1/UserGlobals/Array/definition?dict=1'),
      }),
      expect.objectContaining({
        viewColumn: ViewColumn.Two,
        preview: true,
        preserveFocus: true,
      }),
    );
  });
});
