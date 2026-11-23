import { expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { registerGemStoneExplorer } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * Registers the Explorer against fake tree views and a fake session manager, and returns the
 * handler it registered for `command`. The calling test file must mock `vscode` with
 * `__mocks__/vscode.js`.
 */
export function registeredExplorerCommand(command: string): (...a: unknown[]) => unknown {
  vi.mocked(vscode.window.createTreeView).mockImplementation(
    () =>
      ({
        onDidChangeVisibility: vi.fn(),
        onDidChangeCheckboxState: vi.fn(),
        onDidChangeSelection: vi.fn(),
        onDidCollapseElement: vi.fn(),
        onDidExpandElement: vi.fn(),
        reveal: vi.fn(),
        dispose: vi.fn(),
      }) as never,
  );
  const context = {
    subscriptions: [] as { dispose?: () => void }[],
    globalState: { get: vi.fn(), update: vi.fn(async () => {}), keys: () => [] },
    extensionPath: '/x',
  } as unknown as vscode.ExtensionContext;
  const sessionManager = {
    getSelectedSession: () => ({ id: 1 }) as ActiveSession,
    resolveSession: () => Promise.resolve({ id: 1 } as ActiveSession),
    onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
    onDidRemoveSession: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as SessionManager;
  registerGemStoneExplorer(context, sessionManager);
  const call = vi.mocked(vscode.commands.registerCommand).mock.calls.find((c) => c[0] === command);
  expect(call, `${command} has no handler`).toBeDefined();
  return call![1] as (...a: unknown[]) => unknown;
}
