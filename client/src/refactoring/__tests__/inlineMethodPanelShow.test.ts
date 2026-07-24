import { describe, it, expect, vi, beforeEach } from 'vitest';

// A controllable webview panel so the paginated inline-method panel's message
// wiring (loadMore / loadAll / apply / cancel / dispose) can be driven.
vi.mock('vscode', () => ({
  ViewColumn: { Active: 1 },
  window: {
    createWebviewPanel: vi.fn(() => {
      const messageCbs: Array<(m: unknown) => void> = [];
      const disposeCbs: Array<() => void> = [];
      return {
        webview: {
          html: '',
          postMessage: vi.fn(),
          onDidReceiveMessage: (cb: (m: unknown) => void) => {
            messageCbs.push(cb);
            return { dispose() {} };
          },
        },
        onDidDispose: (cb: () => void) => {
          disposeCbs.push(cb);
          return { dispose() {} };
        },
        dispose: () => disposeCbs.forEach((c) => c()),
        __emit: (m: unknown) => messageCbs.forEach((c) => c(m)),
      };
    }),
    showErrorMessage: vi.fn(),
  },
}));

import * as vscode from 'vscode';
import { showInlineMethodPanel } from '../inlineMethodPanel';
import { StartInlinePreview } from '../inlineMethodPreview';

interface MockPanel {
  __emit: (m: unknown) => void;
  dispose: () => void;
  webview: { postMessage: ReturnType<typeof vi.fn> };
}
function lastPanel(): MockPanel {
  const mock = vscode.window.createWebviewPanel as unknown as {
    mock: { results: Array<{ value: MockPanel }> };
  };
  return mock.mock.results[mock.mock.results.length - 1].value;
}

const start: StartInlinePreview = {
  token: 'tok',
  total: 2,
  targetSelector: 'total',
  lastSender: true,
  outOfScope: { collision: null, decline: null },
  page: {
    changes: [
      {
        id: '1',
        kind: 'methodRecompile',
        dictName: 'UserGlobals',
        className: 'Account',
        isMeta: false,
        selector: 'report',
        category: 'printing',
        oldSource: 'report\n\t^ self total',
        newSource: 'report\n\t^ balance',
      },
    ],
    nextOffset: 2,
    done: false,
  },
};

beforeEach(() => vi.clearAllMocks());

describe('showInlineMethodPanel', () => {
  it('applies with the deselected ids and resolves the apply result', async () => {
    const handlers = {
      loadPage: vi.fn(),
      apply: vi.fn(async () => ({ applied: 2, failed: [] })),
      cleanup: vi.fn(),
    };

    const result = showInlineMethodPanel('total', start, handlers);
    lastPanel().__emit({ command: 'apply', deselected: ['2'] });

    expect(await result).toEqual({ applied: 2, failed: [] });
    expect(handlers.apply).toHaveBeenCalledWith(['2']);
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined and cleans up on cancel', async () => {
    const handlers = { loadPage: vi.fn(), apply: vi.fn(), cleanup: vi.fn() };

    const result = showInlineMethodPanel('total', start, handlers);
    lastPanel().__emit({ command: 'cancel' });

    expect(await result).toBeUndefined();
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined and cleans up when the panel is disposed', async () => {
    const handlers = { loadPage: vi.fn(), apply: vi.fn(), cleanup: vi.fn() };

    const result = showInlineMethodPanel('total', start, handlers);
    lastPanel().dispose();

    expect(await result).toBeUndefined();
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('fetches the next page when asked for more', async () => {
    const handlers = {
      loadPage: vi.fn(async () => ({ changes: [], nextOffset: 3, done: true })),
      apply: vi.fn(),
      cleanup: vi.fn(),
    };

    void showInlineMethodPanel('total', start, handlers);
    lastPanel().__emit({ command: 'loadMore' });

    await vi.waitFor(() => expect(handlers.loadPage).toHaveBeenCalledWith(2));
  });

  it('drains every remaining page on loadAll', async () => {
    const pages = [
      { changes: [], nextOffset: 3, done: false },
      { changes: [], nextOffset: 4, done: true },
    ];
    const handlers = {
      loadPage: vi.fn(async () => pages.shift()!),
      apply: vi.fn(),
      cleanup: vi.fn(),
    };

    void showInlineMethodPanel('total', start, handlers);
    lastPanel().__emit({ command: 'loadAll' });

    await vi.waitFor(() => expect(handlers.loadPage).toHaveBeenCalledTimes(2));
  });

  it('surfaces an error and stays open when applying fails', async () => {
    const handlers = {
      loadPage: vi.fn(),
      apply: vi.fn(async () => {
        throw new Error('boom');
      }),
      cleanup: vi.fn(),
    };

    void showInlineMethodPanel('total', start, handlers);
    lastPanel().__emit({ command: 'apply', deselected: [] });

    await vi.waitFor(() =>
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom')),
    );
    expect(handlers.cleanup).not.toHaveBeenCalled();
  });
});
