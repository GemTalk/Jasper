import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { showInstVarStructurePanel } from '../instVarStructurePanel';
import { StartIvarPreview } from '../instVarStructurePreview';

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

const start: StartIvarPreview = {
  token: 'tok',
  total: 2,
  topClass: 'Base',
  outOfScope: { decline: null, note: 'note' },
  page: {
    changes: [
      {
        id: '1',
        kind: 'classDefinitionEdit',
        dictName: 'UserGlobals',
        className: 'Base',
        isMeta: false,
        selector: null,
        category: null,
        oldSource: 'a',
        newSource: 'a b',
      },
    ],
    nextOffset: 2,
    done: false,
  },
};

beforeEach(() => vi.clearAllMocks());

describe('showInstVarStructurePanel', () => {
  it('applies and resolves the apply result', async () => {
    const handlers = {
      loadPage: vi.fn(),
      apply: vi.fn(async () => ({ applied: 3, failed: [] })),
      cleanup: vi.fn(),
    };

    const result = showInstVarStructurePanel('Push up', start, handlers);
    lastPanel().__emit({ command: 'apply', deselected: [] });

    expect(await result).toEqual({ applied: 3, failed: [] });
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined and cleans up on cancel', async () => {
    const handlers = { loadPage: vi.fn(), apply: vi.fn(), cleanup: vi.fn() };

    const result = showInstVarStructurePanel('Push up', start, handlers);
    lastPanel().__emit({ command: 'cancel' });

    expect(await result).toBeUndefined();
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined and cleans up when disposed', async () => {
    const handlers = { loadPage: vi.fn(), apply: vi.fn(), cleanup: vi.fn() };

    const result = showInstVarStructurePanel('Push down', start, handlers);
    lastPanel().dispose();

    expect(await result).toBeUndefined();
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('fetches the next page on loadMore', async () => {
    const handlers = {
      loadPage: vi.fn(async () => ({ changes: [], nextOffset: 3, done: true })),
      apply: vi.fn(),
      cleanup: vi.fn(),
    };

    void showInstVarStructurePanel('Push up', start, handlers);
    lastPanel().__emit({ command: 'loadMore' });

    await vi.waitFor(() => expect(handlers.loadPage).toHaveBeenCalledWith(2));
  });

  it('surfaces an error and stays open when applying fails', async () => {
    const handlers = {
      loadPage: vi.fn(),
      apply: vi.fn(async () => {
        throw new Error('boom');
      }),
      cleanup: vi.fn(),
    };

    void showInstVarStructurePanel('Push up', start, handlers);
    lastPanel().__emit({ command: 'apply', deselected: [] });

    await vi.waitFor(() =>
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom')),
    );
    expect(handlers.cleanup).not.toHaveBeenCalled();
  });
});
