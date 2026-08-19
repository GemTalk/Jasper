import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  refactoringUndoStatus: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import {
  createUndoStatusBarItem,
  setUndoStatusBarItem,
  refreshRefactoringUndoContext,
  UNDO_AVAILABLE_CONTEXT_KEY,
} from '../refactoringUndoAvailability';
import { UNDO_COMMAND } from '../refactoringAppliedToast';
import type { ActiveSession } from '../../sessionManager';

/**
 * The status-bar button (#434).
 *
 * The Explorer title-bar button is easy to miss unless you are already looking at the Explorer, so
 * the action also sits in the status bar. What these pin is what makes it findable and honest:
 * it shows and hides with the record, it is coloured so it stands out from the neutral items
 * around it, and its tooltip says both GEMSTONE and WHICH refactoring — the latter being something
 * a contributed menu title can never do, since those are static.
 */

const session = { id: 1 } as ActiveSession;

function fakeItem() {
  return {
    text: '',
    tooltip: '' as string | undefined,
    color: undefined as unknown,
    command: undefined as unknown,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('the undo status-bar button', () => {
  it('is wired to the undo command and coloured to stand out', () => {
    const created = fakeItem();
    vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(created as never);

    const item = createUndoStatusBarItem();

    expect(item.command).toBe(UNDO_COMMAND);
    // A real theme colour, so it renders correctly in light and dark rather than a hardcoded hex.
    expect(item.color).toBeInstanceOf(vscode.ThemeColor);
    expect((item.color as { id: string }).id).toBe('charts.purple');
  });

  it('appears when there is something to undo, naming GemStone and the refactoring', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    vi.mocked(queries.refactoringUndoStatus).mockReturnValue(
      '{"available":true,"label":"Rename #total to #sum","total":3}',
    );

    refreshRefactoringUndoContext(session);

    expect(item.show).toHaveBeenCalled();
    expect(item.tooltip).toContain('GemStone');
    // The specific refactoring — the thing a static menu title cannot say.
    expect(item.tooltip).toContain('Rename #total to #sum');
    expect(item.text).toContain('Undo');
  });

  it('disappears once the record is used up', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    vi.mocked(queries.refactoringUndoStatus).mockReturnValue('{"available":false}');

    refreshRefactoringUndoContext(session);

    expect(item.hide).toHaveBeenCalled();
    expect(item.show).not.toHaveBeenCalled();
  });

  it('publishes the context key alongside, so the Explorer button tracks it', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    vi.mocked(queries.refactoringUndoStatus).mockReturnValue('{"available":true,"label":"x"}');

    refreshRefactoringUndoContext(session);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      UNDO_AVAILABLE_CONTEXT_KEY,
      true,
    );
  });

  it('does not fall over when no status item has been created', () => {
    setUndoStatusBarItem(undefined);
    vi.mocked(queries.refactoringUndoStatus).mockReturnValue('{"available":true,"label":"x"}');

    expect(() => refreshRefactoringUndoContext(session)).not.toThrow();
  });
});
