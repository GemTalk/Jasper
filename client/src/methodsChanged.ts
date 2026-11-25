import * as vscode from 'vscode';

// Made on first use: modules that announce are loaded by tests whose vscode mock has no EventEmitter.
let changed: vscode.EventEmitter<void> | undefined;
const emitter = () => (changed ??= new vscode.EventEmitter<void>());

/**
 * Fires when methods may have changed on the stone, so senders and implementors
 * counts are stale. Announced by a method save, a refactoring, an Abort, a restore
 * from method history, Refresh Browser, and the Explorer's Refresh, which File In and
 * Undo also run. Not every change is announced: an Execute It can compile anything, unseen.
 */
export const onDidChangeMethods: vscode.Event<void> = (listener, thisArgs, disposables) =>
  emitter().event(listener, thisArgs, disposables);

export function announceMethodsChanged(): void {
  changed?.fire();
}
