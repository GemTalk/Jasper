import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  getClassComment: vi.fn(),
  setClassComment: vi.fn(),
  canClassBeWritten: vi.fn(),
  // BrowserQueryError is imported by commentBrowser; provide a minimal stand-in.
  BrowserQueryError: class BrowserQueryError extends Error {},
}));

import { window, ViewColumn } from '../__mocks__/vscode';
import { CommentBrowser } from '../commentBrowser';
import * as queries from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
import type { GemStoneLogin } from '../loginTypes';
import type { ExportManager } from '../exportManager';

function makeSession(id = 1): ActiveSession {
  return { id, login: { label: 'test' } as GemStoneLogin } as unknown as ActiveSession;
}

describe('CommentBrowser', () => {
  let session: ActiveSession;
  let exportManager: { syncClass: ReturnType<typeof vi.fn> };
  let mockPanel: {
    webview: {
      html: string;
      postMessage: ReturnType<typeof vi.fn>;
      onDidReceiveMessage: ReturnType<typeof vi.fn>;
    };
    title: string;
    reveal: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    onDidDispose: ReturnType<typeof vi.fn>;
  };
  let hostMessageHandler: (msg: unknown) => void;

  function resetPanels(): void {
    (CommentBrowser as unknown as { panels: Map<number, unknown> }).panels = new Map();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetPanels();
    session = makeSession();
    exportManager = { syncClass: vi.fn().mockResolvedValue(undefined) };

    vi.mocked(window.createWebviewPanel).mockImplementation((_type: string, title: string) => {
      mockPanel = {
        webview: {
          html: '',
          postMessage: vi.fn(),
          onDidReceiveMessage: vi.fn((handler: (msg: unknown) => void) => {
            hostMessageHandler = handler;
            return { dispose: () => {} };
          }),
        },
        title,
        reveal: vi.fn(),
        dispose: vi.fn(),
        onDidDispose: vi.fn(() => ({ dispose: () => {} })),
      };
      return mockPanel as unknown as ReturnType<typeof window.createWebviewPanel>;
    });

    vi.mocked(queries.getClassComment).mockReturnValue('the class comment');
    vi.mocked(queries.setClassComment).mockReturnValue('ok');
    vi.mocked(queries.canClassBeWritten).mockReturnValue(true);
    vi.mocked(window.showWarningMessage).mockResolvedValue(undefined);
  });

  afterEach(resetPanels);

  describe('showOrUpdate (first call)', () => {
    it('opens a webview panel titled Comment: <className> in group 2 without stealing focus', async () => {
      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Account',
        exportManager as unknown as ExportManager,
      );

      expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneCommentBrowser',
        'Comment: Account',
        { viewColumn: ViewColumn.Two, preserveFocus: true },
        expect.objectContaining({ enableScripts: true, retainContextWhenHidden: true }),
      );
    });

    it('fetches the comment for the selected class', async () => {
      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Account',
        exportManager as unknown as ExportManager,
      );

      expect(queries.getClassComment).toHaveBeenCalledWith(session, 'Account', 7);
    });

    it('sends the comment to the webview once it signals ready', async () => {
      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Account',
        exportManager as unknown as ExportManager,
      );

      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();

      hostMessageHandler({ command: 'ready' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadComment',
        className: 'Account',
        text: 'the class comment',
        canWrite: true,
      });
    });
  });

  describe('showOrUpdate (subsequent calls)', () => {
    beforeEach(async () => {
      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Account',
        exportManager as unknown as ExportManager,
      );
      hostMessageHandler({ command: 'ready' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
      vi.mocked(window.createWebviewPanel).mockClear();
    });

    it('reuses the panel and refills it with the newly selected class comment', async () => {
      vi.mocked(queries.getClassComment).mockReturnValue('another comment');

      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Invoice',
        exportManager as unknown as ExportManager,
      );

      expect(window.createWebviewPanel).not.toHaveBeenCalled();
      expect(mockPanel.title).toBe('Comment: Invoice');
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadComment',
        className: 'Invoice',
        text: 'another comment',
        canWrite: true,
      });
    });

    it('does not steal the active tab: updating the panel never reveals it', async () => {
      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Invoice',
        exportManager as unknown as ExportManager,
      );

      expect(mockPanel.reveal).not.toHaveBeenCalled();
    });

    it('re-selecting the same class is a no-op — no re-fetch, no refill, no reveal', async () => {
      vi.mocked(queries.getClassComment).mockClear();

      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Account',
        exportManager as unknown as ExportManager,
      );

      expect(queries.getClassComment).not.toHaveBeenCalled();
      expect(mockPanel.reveal).not.toHaveBeenCalled();
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('read-only classes', () => {
    it('tells the webview the comment cannot be edited', async () => {
      vi.mocked(queries.canClassBeWritten).mockReturnValue(false);

      await CommentBrowser.showOrUpdate(
        session,
        'Kernel',
        9,
        'Object',
        exportManager as unknown as ExportManager,
      );
      hostMessageHandler({ command: 'ready' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadComment', className: 'Object', canWrite: false }),
      );
    });

    it('treats the class as writable when the writability check fails', async () => {
      vi.mocked(queries.canClassBeWritten).mockImplementation(() => {
        throw new Error('busy');
      });

      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Account',
        exportManager as unknown as ExportManager,
      );
      hostMessageHandler({ command: 'ready' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadComment', canWrite: true }),
      );
    });
  });

  describe('dirty guard on class switch', () => {
    beforeEach(async () => {
      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Account',
        exportManager as unknown as ExportManager,
      );
      hostMessageHandler({ command: 'ready' });
      // The user edits the comment for Account.
      hostMessageHandler({ command: 'edited', text: 'work in progress' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('prompts before replacing unsaved edits when a different class is selected', async () => {
      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Invoice',
        exportManager as unknown as ExportManager,
      );

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Account'),
        expect.objectContaining({ modal: true }),
        'Save',
        "Don't Save",
      );
    });

    it('saves the outgoing class edits when the user chooses Save, then loads the new class', async () => {
      vi.mocked(window.showWarningMessage).mockResolvedValue('Save');
      vi.mocked(queries.getClassComment).mockReturnValue('invoice comment');

      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Invoice',
        exportManager as unknown as ExportManager,
      );

      expect(queries.setClassComment).toHaveBeenCalledWith(
        session,
        'Account',
        'work in progress',
        7,
      );
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadComment', className: 'Invoice' }),
      );
    });

    it("discards the edits and loads the new class when the user chooses Don't Save", async () => {
      vi.mocked(window.showWarningMessage).mockResolvedValue("Don't Save");

      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Invoice',
        exportManager as unknown as ExportManager,
      );

      expect(queries.setClassComment).not.toHaveBeenCalled();
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadComment', className: 'Invoice' }),
      );
    });

    it('keeps the current class and does not refill when the prompt is cancelled', async () => {
      vi.mocked(window.showWarningMessage).mockResolvedValue(undefined);

      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Invoice',
        exportManager as unknown as ExportManager,
      );

      expect(queries.setClassComment).not.toHaveBeenCalled();
      expect(mockPanel.title).toBe('Comment: Account');
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadComment' }),
      );
    });
  });

  describe('saving an edited comment', () => {
    beforeEach(async () => {
      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Account',
        exportManager as unknown as ExportManager,
      );
      hostMessageHandler({ command: 'ready' });
    });

    it('writes the edited comment back to GemStone for the shown class', () => {
      hostMessageHandler({ command: 'save', text: 'edited comment' });

      expect(queries.setClassComment).toHaveBeenCalledWith(session, 'Account', 'edited comment', 7);
    });

    it('re-syncs the class mirror and confirms the save to the webview', () => {
      hostMessageHandler({ command: 'save', text: 'edited comment' });

      expect(exportManager.syncClass).toHaveBeenCalledWith(session, 'UserGlobals', 'Account');
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({ command: 'saved' });
    });

    it('saves against the class currently shown after the panel is refilled', async () => {
      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Invoice',
        exportManager as unknown as ExportManager,
      );

      hostMessageHandler({ command: 'save', text: 'invoice comment' });

      expect(queries.setClassComment).toHaveBeenCalledWith(
        session,
        'Invoice',
        'invoice comment',
        7,
      );
    });

    it('reports a failed save to the webview and does not confirm it', () => {
      vi.mocked(queries.setClassComment).mockImplementation(() => {
        throw new Error('read-only');
      });

      hostMessageHandler({ command: 'save', text: 'edited comment' });

      expect(window.showErrorMessage).toHaveBeenCalled();
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalledWith({ command: 'saved' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({ command: 'saveError' });
    });
  });

  describe('disposeForSession', () => {
    it('disposes the panel for the given session', async () => {
      await CommentBrowser.showOrUpdate(
        session,
        'UserGlobals',
        7,
        'Account',
        exportManager as unknown as ExportManager,
      );

      CommentBrowser.disposeForSession(session.id);

      expect(mockPanel.dispose).toHaveBeenCalled();
    });

    it('does nothing when no panel exists for the session', () => {
      expect(() => CommentBrowser.disposeForSession(99)).not.toThrow();
    });
  });
});
