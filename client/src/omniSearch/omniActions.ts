/**
 * Dispatch an OmniAction to the right handler. Pure routing — the handlers (which touch `vscode`,
 * the SystemBrowser, and the `gemstone:` uri builders) are injected by `omniSearchCommand.ts`, so
 * this stays unit-testable and the `switch` is exhaustiveness-checked at compile time.
 */
import * as vscode from 'vscode';
import { OmniAction, OmniResult } from './omniTypes';

type ByKind<K extends OmniAction['kind']> = Extract<OmniAction, { kind: K }>;

export interface OmniActionHandlers {
  openClass(action: ByKind<'openClass'>): void | Promise<void>;
  openMethod(action: ByKind<'openMethod'>): void | Promise<void>;
  revealDictionary(action: ByKind<'revealDictionary'>): void | Promise<void>;
  revealGlobal(action: ByKind<'revealGlobal'>): void | Promise<void>;
  revealCategory(action: ByKind<'revealCategory'>): void | Promise<void>;
}

function assertNever(x: never): never {
  throw new Error(`Unhandled OmniAction: ${JSON.stringify(x)}`);
}

export async function runOmniAction(
  action: OmniAction,
  handlers: OmniActionHandlers,
): Promise<void> {
  switch (action.kind) {
    case 'openClass':
      await handlers.openClass(action);
      return;
    case 'openMethod':
      await handlers.openMethod(action);
      return;
    case 'revealDictionary':
      await handlers.revealDictionary(action);
      return;
    case 'revealGlobal':
      await handlers.revealGlobal(action);
      return;
    case 'revealCategory':
      await handlers.revealCategory(action);
      return;
    default:
      assertNever(action);
  }
}

/**
 * Select a result's test in the Testing view, when it has one. Reads the result's
 * own action rather than its label — the label is display text, the action is the
 * class/selector the result actually stands for. A result that isn't a test class
 * or test method is left alone by the command, which says so.
 */
export async function revealTestForResult(result: OmniResult): Promise<void> {
  const a = result.action;
  if (a.kind === 'openMethod') {
    await vscode.commands.executeCommand(
      'gemstone.revealTestInTestingView',
      a.dictName,
      a.className,
      a.selector,
    );
    return;
  }
  if (a.kind === 'openClass') {
    await vscode.commands.executeCommand(
      'gemstone.revealTestInTestingView',
      a.dictName,
      a.className,
    );
  }
}
