import { describe, it, expect, vi } from 'vitest';

// A controllable webview panel so the ok/invalid round-trip can be driven.
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
  },
}));

import * as vscode from 'vscode';
import { showRenameClassEditor } from '../renameClassEditor';

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

describe('showRenameClassEditor', () => {
  const OPTS = {
    copyMethods: true,
    recompileSubclasses: true,
    migrateInstances: true,
    removeOldFromHistory: false,
  };

  it('resolves with the new name, scope, and options when validation passes', async () => {
    const result = showRenameClassEditor({ oldName: 'Account' }, () => undefined);
    lastPanel().__emit({
      command: 'ok',
      newName: 'BankAccount',
      scope: { kind: 'wholeSystem' },
      options: OPTS,
    });

    expect(await result).toEqual({
      newName: 'BankAccount',
      scope: { kind: 'wholeSystem' },
      options: OPTS,
    });
  });

  it('rejects a name in use without closing, then resolves once a free name is entered', async () => {
    const validate = vi.fn((name: string) =>
      name === 'Taken' ? 'The name Taken is already in use.' : undefined,
    );

    const result = showRenameClassEditor({ oldName: 'Account' }, validate);
    const panel = lastPanel();
    panel.__emit({ command: 'ok', newName: 'Taken', scope: { kind: 'wholeSystem' } });

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'invalid' }),
    );

    panel.__emit({
      command: 'ok',
      newName: 'BankAccount',
      scope: { kind: 'wholeSystem' },
      options: OPTS,
    });
    expect(await result).toEqual({
      newName: 'BankAccount',
      scope: { kind: 'wholeSystem' },
      options: OPTS,
    });
  });

  it('resolves undefined when cancelled', async () => {
    const result = showRenameClassEditor({ oldName: 'Account' }, () => undefined);
    lastPanel().__emit({ command: 'cancel' });

    expect(await result).toBeUndefined();
  });

  it('rejects a malformed scope from the webview without closing, then resolves on a valid one', async () => {
    const validate = vi.fn(() => undefined);
    const result = showRenameClassEditor({ oldName: 'Account' }, validate);
    const panel = lastPanel();

    // A malformed scope must be refused BEFORE validate() and must not resolve.
    panel.__emit({
      command: 'ok',
      newName: 'BankAccount',
      scope: { kind: 'bogus' },
      options: OPTS,
    });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'invalid' }),
    );
    expect(validate).not.toHaveBeenCalled();

    // The editor stayed open; a well-formed scope now resolves.
    panel.__emit({
      command: 'ok',
      newName: 'BankAccount',
      scope: { kind: 'dictionary', dictName: 'UserGlobals' },
      options: OPTS,
    });
    expect(await result).toEqual({
      newName: 'BankAccount',
      scope: { kind: 'dictionary', dictName: 'UserGlobals' },
      options: OPTS,
    });
  });
});
