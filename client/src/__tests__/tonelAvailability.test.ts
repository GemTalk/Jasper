// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../queries/tonel/tonelCapability` for the full statement.
//
// Whether Jasper offers the Tonel commands at all.
//
// The rule is HIDDEN, not degraded: on a stone without the machinery the menu
// entries are absent, rather than present and failing when clicked. Two
// mechanisms, because one is not enough — a context key drives the menus, and a
// runtime guard backs it up, since the command palette ignores `when` clauses
// entirely and would otherwise let a user invoke a command the menus hide.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', () => ({
  tonelCapability: vi.fn(() => ({ available: true, missing: [] })),
}));

import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
import {
  TONEL_AVAILABLE_CONTEXT,
  refreshTonelAvailability,
  requireTonelAvailable,
} from '../tonelAvailability';

const SESSION = { id: 1 } as ActiveSession;

const contextCalls = (): unknown[][] =>
  vi.mocked(vscode.commands.executeCommand).mock.calls.filter((c) => c[0] === 'setContext');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queries.tonelCapability).mockReturnValue({ available: true, missing: [] });
});

describe('refreshTonelAvailability', () => {
  it('turns the commands on when the stone has the machinery', () => {
    expect(refreshTonelAvailability(SESSION)).toBe(true);
    expect(contextCalls()).toContainEqual(['setContext', TONEL_AVAILABLE_CONTEXT, true]);
  });

  it('turns them off when it does not', () => {
    vi.mocked(queries.tonelCapability).mockReturnValue({
      available: false,
      missing: ['RwTonelParser class>>on:filePath:forReader:'],
    });
    expect(refreshTonelAvailability(SESSION)).toBe(false);
    expect(contextCalls()).toContainEqual(['setContext', TONEL_AVAILABLE_CONTEXT, false]);
  });

  it('turns them off when there is no session, without asking the stone', () => {
    expect(refreshTonelAvailability(undefined)).toBe(false);
    expect(queries.tonelCapability).not.toHaveBeenCalled();
    expect(contextCalls()).toContainEqual(['setContext', TONEL_AVAILABLE_CONTEXT, false]);
  });

  it('turns them off when the probe itself fails, rather than throwing', () => {
    // This runs on every session connect. A probe that raises — a busy session, a
    // login that half-succeeded — must not take the connect path down with it.
    vi.mocked(queries.tonelCapability).mockImplementation(() => {
      throw new Error('session is busy');
    });
    expect(refreshTonelAvailability(SESSION)).toBe(false);
    expect(contextCalls()).toContainEqual(['setContext', TONEL_AVAILABLE_CONTEXT, false]);
  });

  it('always sets the key, so a `when` clause is never left reading undefined', () => {
    // Until it is set, the key is undefined, which a `!` clause reads as false —
    // fine by luck, not by design. Set it on every refresh, both ways.
    refreshTonelAvailability(undefined);
    refreshTonelAvailability(SESSION);
    expect(contextCalls()).toHaveLength(2);
  });
});

describe('requireTonelAvailable', () => {
  it('allows a command through on a stone that supports it', () => {
    expect(requireTonelAvailable(SESSION)).toBe(true);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('refuses when the machinery is absent', () => {
    vi.mocked(queries.tonelCapability).mockReturnValue({ available: false, missing: ['a', 'b'] });
    expect(requireTonelAvailable(SESSION)).toBe(false);
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('says what is needed rather than just refusing', () => {
    // The palette route is how a user reaches a hidden command, so the refusal is
    // the only explanation they get. "Nothing happened" is not one.
    vi.mocked(queries.tonelCapability).mockReturnValue({ available: false, missing: ['a'] });
    requireTonelAvailable(SESSION);
    const text = String(vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0]);
    expect(text).toMatch(/rowan3/i);
    expect(text).toMatch(/3\.7\.5/);
  });

  it('refuses without a session', () => {
    expect(requireTonelAvailable(undefined)).toBe(false);
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });
});
