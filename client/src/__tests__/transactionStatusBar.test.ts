import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import {
  registerTransactionStatusBar,
  transactionStatusIcon,
  transactionStatusText,
  transactionStatusTooltip,
  SET_MODE_COMMAND,
} from '../transactionStatusBar';
import type { ActiveSession, SessionManager } from '../sessionManager';

function session(
  transactionMode: ActiveSession['transactionMode'],
  inTransaction: boolean | undefined,
): ActiveSession {
  return { id: 2, transactionMode, inTransaction } as unknown as ActiveSession;
}

describe('what the status bar says', () => {
  // The glyph carries the part that matters at a glance: filled means a commit
  // can land right now, hollow means it cannot.
  it('fills the circle exactly when the session is in a transaction', () => {
    expect(transactionStatusIcon(session('autoBegin', true))).toBe('circle-filled');
    expect(transactionStatusIcon(session('manualBegin', true))).toBe('circle-filled');
    expect(transactionStatusIcon(session('manualBegin', false))).toBe('circle-outline');
  });

  it('gives transactionless its own glyph — a mode for looking, not writing', () => {
    expect(transactionStatusIcon(session('transactionless', false))).toBe('eye');
  });

  it('drops the eye once a transactionless session is actually in a transaction', () => {
    // It can happen (an explicit begin does work under transactionless), and the
    // eye would then be saying the opposite of what Commit does.
    expect(transactionStatusIcon(session('transactionless', true))).toBe('circle-filled');
  });

  it('does not guess when the state could not be read', () => {
    expect(transactionStatusIcon(session(undefined, undefined))).toBe('question');
    expect(transactionStatusText(session(undefined, undefined))).toBe('$(question) Unknown');
  });

  it('names the mode, and the transaction state where it varies', () => {
    expect(transactionStatusText(session('autoBegin', true))).toBe('$(circle-filled) Auto-Begin');
    expect(transactionStatusText(session('manualBegin', false))).toBe(
      '$(circle-outline) Manual · not in transaction',
    );
  });
});

describe('the status bar tooltip', () => {
  it('spells out what the session can do right now, not just the mode’s name', () => {
    const md = transactionStatusTooltip(session('manualBegin', false));
    expect(md.value).toContain('Commit: unavailable');
    expect(md.value).toContain('Begin Transaction: available');
    expect(md.value).toContain('Abort: always available');
    expect(md.value).toContain('Click to change the transaction mode');
  });

  it('reports Commit as available inside a transaction', () => {
    expect(transactionStatusTooltip(session('manualBegin', true)).value).toContain(
      'Commit: available',
    );
  });

  // "not needed in this mode" is a claim about the mode, so it must not be made
  // when the mode — or the transaction state Begin also depends on — is the
  // thing that could not be read.
  it.each([
    ['the mode', session(undefined, false)],
    ['the transaction state', session('manualBegin', undefined)],
  ])('does not blame the mode for Begin when %s could not be read', (_what, s) => {
    const value = transactionStatusTooltip(s).value;

    expect(value).toContain('Begin Transaction: unavailable');
    expect(value).toContain('could not be read');
    expect(value).not.toContain('not needed in this mode');
  });

  it('still says Begin is not needed where the mode genuinely says so', () => {
    expect(transactionStatusTooltip(session('autoBegin', true)).value).toContain(
      'Begin Transaction: not needed in this mode',
    );
  });
});

describe('registering the status bar', () => {
  // One list per event, not one shared list: the item has to be redrawn on each
  // of the four, and a single list lets any one subscription be deleted while the
  // other three keep every assertion green.
  let handlers: Record<string, Array<() => void>>;
  let selected: ActiveSession | undefined;

  function stubSessionManager(): SessionManager {
    handlers = { selection: [], add: [], remove: [], transactionState: [] };
    const subscribe = (event: string) => (h: () => void) => {
      handlers[event].push(h);
      return { dispose: vi.fn() };
    };
    return {
      getSelectedSession: () => selected,
      onDidChangeSelection: subscribe('selection'),
      onDidAddSession: subscribe('add'),
      onDidRemoveSession: subscribe('remove'),
      onDidChangeTransactionState: subscribe('transactionState'),
    } as unknown as SessionManager;
  }

  function register() {
    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    registerTransactionStatusBar(context, stubSessionManager());
    return vi.mocked(vscode.window.createStatusBarItem).mock.results.at(-1)!.value;
  }

  beforeEach(() => {
    vi.mocked(vscode.window.createStatusBarItem).mockClear();
    selected = undefined;
  });

  it('hides itself when no session is selected — there is no mode to report', () => {
    const item = register();
    expect(item.hide).toHaveBeenCalled();
    expect(item.show).not.toHaveBeenCalled();
  });

  it('shows the selected session’s state, and clicking it changes the mode', () => {
    selected = session('manualBegin', true);
    const item = register();
    expect(item.show).toHaveBeenCalled();
    expect(item.text).toBe('$(circle-filled) Manual · in transaction');
    expect(item.command).toBe(SET_MODE_COMMAND);
  });

  it('redraws when the transaction state moves, without a session change', () => {
    selected = session('manualBegin', false);
    const item = register();
    expect(item.text).toBe('$(circle-outline) Manual · not in transaction');

    selected = session('manualBegin', true);
    // Only the transaction-state subscription, so this fails if that one is the
    // one that goes missing. A commit under manualBegin moves the state without
    // moving the selection, and nothing else would redraw the item.
    handlers.transactionState.forEach((h) => h());
    expect(item.text).toBe('$(circle-filled) Manual · in transaction');
  });

  it.each(['selection', 'add', 'remove'] as const)('redraws on %s too', (event) => {
    selected = session('manualBegin', false);
    const item = register();
    selected = session('autoBegin', true);
    handlers[event].forEach((h) => h());
    expect(item.text).toBe('$(circle-filled) Auto-Begin');
  });

  it('hides again when the last session goes away', () => {
    selected = session('autoBegin', true);
    const item = register();
    selected = undefined;
    handlers.remove.forEach((h) => h());
    expect(item.hide).toHaveBeenCalled();
  });
});
