import { describe, it, expect, vi, beforeEach } from 'vitest';

// A controllable webview panel so the extract-superclass panel's message wiring
// (loadMore / loadAll / apply / cancel / dispose) can be driven.
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
import { showExtractSuperclassPanel } from '../extractSuperclassPanel';
import { StartExtractSuperPreview } from '../extractSuperclassPreview';

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

const start: StartExtractSuperPreview = {
  token: 'tok',
  total: 2,
  newClass: 'Pet',
  sharedParent: 'Animal',
  outOfScope: { decline: null, note: null },
  page: {
    changes: [
      {
        id: '1',
        kind: 'classAdd',
        dictName: 'UserGlobals',
        className: 'Pet',
        isMeta: false,
        selector: null,
        category: null,
        oldSource: '',
        newSource: "Animal subclass: 'Pet'",
      },
    ],
    nextOffset: 2,
    done: false,
  },
};

beforeEach(() => vi.clearAllMocks());

describe('showExtractSuperclassPanel', () => {
  it('applies (with an empty deselection, since every row is required) and resolves the result', async () => {
    const handlers = {
      loadPage: vi.fn(),
      apply: vi.fn(async () => ({ applied: 3, failed: [] })),
      cleanup: vi.fn(),
    };

    const result = showExtractSuperclassPanel('Extract superclass Pet', start, handlers);
    lastPanel().__emit({ command: 'apply', deselected: [] });

    expect(await result).toEqual({ applied: 3, failed: [] });
    expect(handlers.apply).toHaveBeenCalledWith([]);
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('applies once even when two apply messages arrive (double-click / replayed message)', async () => {
    const handlers = {
      loadPage: vi.fn(),
      apply: vi.fn(async () => ({ applied: 3, failed: [] })),
      cleanup: vi.fn(),
    };

    const result = showExtractSuperclassPanel('Extract superclass Pet', start, handlers);
    lastPanel().__emit({ command: 'apply', deselected: [] });
    lastPanel().__emit({ command: 'apply', deselected: [] });

    expect(await result).toEqual({ applied: 3, failed: [] });
    expect(handlers.apply).toHaveBeenCalledTimes(1);
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined and cleans up on cancel', async () => {
    const handlers = { loadPage: vi.fn(), apply: vi.fn(), cleanup: vi.fn() };

    const result = showExtractSuperclassPanel('Extract superclass Pet', start, handlers);
    lastPanel().__emit({ command: 'cancel' });

    expect(await result).toBeUndefined();
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined and cleans up when the panel is disposed', async () => {
    const handlers = { loadPage: vi.fn(), apply: vi.fn(), cleanup: vi.fn() };

    const result = showExtractSuperclassPanel('Extract superclass Pet', start, handlers);
    lastPanel().dispose();

    expect(await result).toBeUndefined();
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
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

    void showExtractSuperclassPanel('Extract superclass Pet', start, handlers);
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

    void showExtractSuperclassPanel('Extract superclass Pet', start, handlers);
    lastPanel().__emit({ command: 'apply', deselected: [] });

    await vi.waitFor(() =>
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom')),
    );
    expect(handlers.cleanup).not.toHaveBeenCalled();
  });
});
