import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  getGlobalsForDictionary: vi.fn(),
}));

import { window, commands, ViewColumn } from '../__mocks__/vscode';
import { GlobalsBrowser } from '../globalsBrowser';
import * as queries from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
import type { GemStoneLogin } from '../loginTypes';

function makeSession(id = 1): ActiveSession {
  return {
    id,
    login: { label: 'test' } as GemStoneLogin,
  } as unknown as ActiveSession;
}

const sampleGlobals = [
  { name: '_remoteNil', className: 'UndefinedObject', value: 'remoteNil' },
  { name: 'AllUsers', className: 'UserProfileSet', value: 'anUserProfileSet(...)' },
];

describe('GlobalsBrowser', () => {
  let session: ActiveSession;
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
  let messageHandler: (msg: unknown) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    (GlobalsBrowser as unknown as { panels: Map<number, unknown> }).panels = new Map();

    session = makeSession();

    vi.mocked(window.createWebviewPanel).mockImplementation((_type: string, title: string) => {
      mockPanel = {
        webview: {
          html: '',
          postMessage: vi.fn(),
          onDidReceiveMessage: vi.fn((handler: (msg: unknown) => void) => {
            messageHandler = handler;
            return { dispose: () => {} };
          }),
        },
        title,
        reveal: vi.fn(),
        dispose: vi.fn(),
        onDidDispose: vi.fn((_handler: unknown) => ({ dispose: () => {} })),
      };
      return mockPanel as unknown as ReturnType<typeof window.createWebviewPanel>;
    });

    vi.mocked(commands.executeCommand).mockResolvedValue(undefined);
    vi.mocked(queries.getGlobalsForDictionary).mockReturnValue(sampleGlobals);
  });

  afterEach(() => {
    (GlobalsBrowser as unknown as { panels: Map<number, unknown> }).panels = new Map();
  });

  describe('showOrUpdate (first call)', () => {
    it('creates a webview panel titled Globals: <dictName>', async () => {
      await GlobalsBrowser.showOrUpdate(session, 'Globals', 1);

      expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneGlobalsBrowser',
        'Globals: Globals',
        ViewColumn.Two,
        expect.objectContaining({ enableScripts: true, retainContextWhenHidden: true }),
      );
    });

    it('does not set editor layout (handled by systemBrowser)', async () => {
      await GlobalsBrowser.showOrUpdate(session, 'Globals', 1);

      expect(commands.executeCommand).not.toHaveBeenCalledWith(
        'vscode.setEditorLayout',
        expect.anything(),
      );
    });

    it('sends loadGlobals after the webview signals ready', async () => {
      await GlobalsBrowser.showOrUpdate(session, 'Globals', 1);

      // Not yet sent — webview has not signalled ready
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();

      messageHandler({ command: 'ready' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadGlobals',
        items: sampleGlobals,
      });
    });

    it('fetches globals using the provided dictIndex', async () => {
      await GlobalsBrowser.showOrUpdate(session, 'DataCurator', 2);

      expect(queries.getGlobalsForDictionary).toHaveBeenCalledWith(session, 2);
    });
  });

  describe('showOrUpdate (subsequent calls)', () => {
    beforeEach(async () => {
      await GlobalsBrowser.showOrUpdate(session, 'Globals', 1);
      messageHandler({ command: 'ready' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
      vi.mocked(window.createWebviewPanel).mockClear();
    });

    it('reuses the existing panel instead of creating a new one', async () => {
      await GlobalsBrowser.showOrUpdate(session, 'UserGlobals', 2);

      expect(window.createWebviewPanel).not.toHaveBeenCalled();
    });

    it('updates the panel title', async () => {
      await GlobalsBrowser.showOrUpdate(session, 'UserGlobals', 2);

      expect(mockPanel.title).toBe('Globals: UserGlobals');
    });

    it('reveals the existing panel without stealing focus', async () => {
      await GlobalsBrowser.showOrUpdate(session, 'UserGlobals', 2);

      expect(mockPanel.reveal).toHaveBeenCalledWith(undefined, true);
    });

    it('sends fresh loadGlobals immediately (panel already ready)', async () => {
      const newGlobals = [{ name: 'SomeGlobal', className: 'String', value: "'hello'" }];
      vi.mocked(queries.getGlobalsForDictionary).mockReturnValue(newGlobals);

      await GlobalsBrowser.showOrUpdate(session, 'UserGlobals', 2);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadGlobals',
        items: newGlobals,
      });
    });
  });

  describe('disposeForSession', () => {
    it('disposes the panel for the given session', async () => {
      await GlobalsBrowser.showOrUpdate(session, 'Globals', 1);

      GlobalsBrowser.disposeForSession(session.id);

      expect(mockPanel.dispose).toHaveBeenCalled();
    });

    it('does nothing when no panel exists for the session', () => {
      expect(() => GlobalsBrowser.disposeForSession(99)).not.toThrow();
    });
  });

  describe('double-click to inspect', () => {
    let webviewMessageHandler: (msg: unknown) => void;

    beforeEach(async () => {
      await GlobalsBrowser.showOrUpdate(session, 'Globals', 1);
      // Capture the message handler that the webview uses to send messages to the host
      webviewMessageHandler = vi.mocked(mockPanel.webview.onDidReceiveMessage).mock.calls[0][0] as (
        msg: unknown,
      ) => void;
    });

    it('executes gemstone.inspectGlobal when inspectGlobal message is received', () => {
      webviewMessageHandler({ command: 'inspectGlobal', name: 'AllUsers' });

      expect(commands.executeCommand).toHaveBeenCalledWith('gemstone.inspectGlobal', {
        className: 'AllUsers',
      });
    });

    it('passes the global name through to the command', () => {
      webviewMessageHandler({ command: 'inspectGlobal', name: '_remoteNil' });

      expect(commands.executeCommand).toHaveBeenCalledWith('gemstone.inspectGlobal', {
        className: '_remoteNil',
      });
    });
  });

  describe('panel disposal', () => {
    it('removes the panel from the registry when disposed', async () => {
      await GlobalsBrowser.showOrUpdate(session, 'Globals', 1);

      // Simulate VS Code disposing the panel
      const disposeHandler = vi.mocked(mockPanel.onDidDispose).mock.calls[0][0] as () => void;
      disposeHandler();

      // A new call should create a fresh panel
      vi.mocked(window.createWebviewPanel).mockClear();
      await GlobalsBrowser.showOrUpdate(session, 'Globals', 1);
      expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
    });
  });
});
