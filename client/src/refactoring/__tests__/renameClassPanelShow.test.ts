import { describe, it, expect, vi, beforeEach } from 'vitest';

// A controllable webview panel so the paginated preview panel's message wiring
// (loadMore / apply / cancel) can be driven.
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
import { showRenameClassPanel } from '../renameClassPanel';
import { StartClassPreview } from '../renameClassPreview';

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

const start: StartClassPreview = {
  token: 'tok',
  total: 2,
  oldName: 'Foo',
  newName: 'Bar',
  outOfScope: { references: 0, descendants: 1, skipped: 0, collision: null },
  skippedMethods: [],
  page: {
    changes: [
      {
        id: '1',
        kind: 'classRename',
        dictName: 'UserGlobals',
        className: 'Foo',
        isMeta: false,
        selector: null,
        newName: 'Bar',
        category: null,
        oldSource: 'a',
        newSource: 'b',
      },
    ],
    nextOffset: 2,
    done: false,
  },
};

beforeEach(() => vi.clearAllMocks());

describe('showRenameClassPanel', () => {
  it('applies with the deselected ids and resolves the apply result', async () => {
    const handlers = {
      loadPage: vi.fn(),
      apply: vi.fn(async () => ({ applied: 2, failed: [], committed: false })),
      cleanup: vi.fn(),
    };

    const result = showRenameClassPanel(
      'Foo',
      'Bar',
      start,
      { recompileSubclasses: true, migrateInstances: true, removeOldFromHistory: false },
      handlers,
    );
    lastPanel().__emit({ command: 'apply', deselected: ['3'] });

    expect(await result).toEqual({ applied: 2, failed: [], committed: false });
    expect(handlers.apply).toHaveBeenCalledWith(['3']);
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined and cleans up on cancel', async () => {
    const handlers = { loadPage: vi.fn(), apply: vi.fn(), cleanup: vi.fn() };

    const result = showRenameClassPanel(
      'Foo',
      'Bar',
      start,
      { recompileSubclasses: true, migrateInstances: true, removeOldFromHistory: false },
      handlers,
    );
    lastPanel().__emit({ command: 'cancel' });

    expect(await result).toBeUndefined();
    expect(handlers.cleanup).toHaveBeenCalledTimes(1);
  });

  it('fetches the next page when asked for more', async () => {
    const handlers = {
      loadPage: vi.fn(async () => ({ changes: [], nextOffset: 3, done: true })),
      apply: vi.fn(),
      cleanup: vi.fn(),
    };

    void showRenameClassPanel(
      'Foo',
      'Bar',
      start,
      { recompileSubclasses: true, migrateInstances: true, removeOldFromHistory: false },
      handlers,
    );
    lastPanel().__emit({ command: 'loadMore' });
    await vi.waitFor(() => expect(handlers.loadPage).toHaveBeenCalledWith(2));
  });
});
