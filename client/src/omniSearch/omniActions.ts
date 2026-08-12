/**
 * Dispatch an OmniAction to the right handler. Pure routing — the handlers (which touch `vscode`,
 * the SystemBrowser, and the `gemstone:` uri builders) are injected by `omniSearchCommand.ts`, so
 * this stays unit-testable and the `switch` is exhaustiveness-checked at compile time.
 */
import { OmniAction } from './omniTypes';

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
