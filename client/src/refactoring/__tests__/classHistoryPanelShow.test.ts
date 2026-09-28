import { describe, it, expect, vi, beforeEach } from 'vitest';

// A controllable webview panel so the restore message → handler wiring can be
// driven, plus a showWarningMessage that returns whatever the test queues.
const confirmQueue: Array<string | undefined> = [];
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
    showWarningMessage: vi.fn(() => Promise.resolve(confirmQueue.shift())),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
}));

import * as vscode from 'vscode';
import { showClassHistoryPanel } from '../classHistoryPanel';
import { ClassVersion } from '../classHistoryModel';

const versions: ClassVersion[] = [
  {
    index: 2,
    name: 'Bar',
    oop: 2,
    timeStamp: 't2',
    userId: 'u',
    isCurrent: true,
    definition: "Object subclass: 'Bar'",
    changedMethods: [],
  },
  {
    index: 1,
    name: 'Foo',
    oop: 1,
    timeStamp: 't1',
    userId: 'u',
    isCurrent: false,
    definition: "Object subclass: 'Foo'",
    changedMethods: [],
  },
];

interface MockPanel {
  __emit: (m: unknown) => void;
  webview: { postMessage: ReturnType<typeof vi.fn> };
}
function lastPanel(): MockPanel {
  const mock = vscode.window.createWebviewPanel as unknown as {
    mock: { results: Array<{ value: MockPanel }> };
  };
  return mock.mock.results[mock.mock.results.length - 1].value;
}

beforeEach(() => {
  confirmQueue.length = 0;
  vi.clearAllMocks();
});

const noopRemove = vi.fn(async (index: number) => ({
  result: { removed: true, index, remaining: 1 },
  versions,
}));

describe('showClassHistoryPanel restore wiring', () => {
  it('confirms, calls the restore handler with the clicked index, and refreshes the list', async () => {
    confirmQueue.push('Restore');
    const restore = vi.fn(async (index: number) => ({
      result: { reverted: true, index, newIndex: 3 },
      versions,
    }));

    showClassHistoryPanel('Bar', versions, { restore, remove: noopRemove });
    lastPanel().__emit({ command: 'restore', index: 1 });
    await vi.waitFor(() => expect(restore).toHaveBeenCalledWith(1));

    await vi.waitFor(() =>
      expect(lastPanel().webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'refresh' }),
      ),
    );
  });

  it('does not restore when the confirmation is dismissed', async () => {
    confirmQueue.push(undefined);
    const restore = vi.fn();

    showClassHistoryPanel('Bar', versions, { restore, remove: noopRemove });
    lastPanel().__emit({ command: 'restore', index: 1 });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(restore).not.toHaveBeenCalled();
  });

  it('confirms and calls the remove handler for a remove message', async () => {
    confirmQueue.push('Remove');
    const remove = vi.fn(async (index: number) => ({
      result: { removed: true, index, remaining: 1 },
      versions,
    }));

    showClassHistoryPanel('Bar', versions, { restore: vi.fn(), remove });
    lastPanel().__emit({ command: 'remove', index: 1 });

    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(1));
  });

  // The tab and the confirmation dialog are the two places a user decides "is this the class I
  // meant?", so both name the dictionary when there is one (#396).
  describe('naming the dictionary', () => {
    it('puts the dictionary in the tab title', () => {
      showClassHistoryPanel(
        'Shadowed',
        versions,
        { restore: vi.fn(), remove: vi.fn() },
        { dictName: 'DictionaryB' },
      );

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneClassHistory',
        'Class History: Shadowed (DictionaryB)',
        expect.anything(),
        expect.anything(),
      );
    });

    it('leaves the tab title unqualified when no dictionary was given', () => {
      showClassHistoryPanel('Shadowed', versions, { restore: vi.fn(), remove: vi.fn() });

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneClassHistory',
        'Class History: Shadowed',
        expect.anything(),
        expect.anything(),
      );
    });

    it('names the dictionary in the restore confirmation', async () => {
      confirmQueue.push(undefined); // decline, so nothing runs
      const panel = showClassHistoryPanel(
        'Shadowed',
        versions,
        { restore: vi.fn(), remove: vi.fn() },
        { dictName: 'DictionaryB' },
      );

      (panel as unknown as { __emit: (m: unknown) => void }).__emit({
        command: 'restore',
        index: 1,
      });
      await Promise.resolve();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Restore Shadowed (DictionaryB) to version [1]?'),
        expect.anything(),
        expect.anything(),
      );
    });

    it('names the dictionary in the remove-version confirmation', async () => {
      confirmQueue.push(undefined);
      const panel = showClassHistoryPanel(
        'Shadowed',
        versions,
        { restore: vi.fn(), remove: vi.fn() },
        { dictName: 'DictionaryB' },
      );

      (panel as unknown as { __emit: (m: unknown) => void }).__emit({
        command: 'remove',
        index: 1,
      });
      await Promise.resolve();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Remove version [1] of Shadowed (DictionaryB)'),
        expect.anything(),
        expect.anything(),
      );
    });

    it('passes the shadowing dictionaries through to the rendered page', () => {
      const panel = showClassHistoryPanel(
        'Shadowed',
        versions,
        { restore: vi.fn(), remove: vi.fn() },
        { dictName: 'DictionaryB', alsoDefinedIn: ['DictionaryA'] },
      );

      expect(panel.webview.html).toContain('This name is also defined in <code>DictionaryA</code>');
    });
  });
});
