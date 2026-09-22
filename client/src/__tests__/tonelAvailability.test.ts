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

// A FRESH session object per test. The capability answer is cached per session
// (see tonelAvailability.ts), so sharing one object across tests would let an
// earlier test's probe answer decide a later one's.
let SESSION: ActiveSession;

const contextCalls = (): unknown[][] =>
  vi.mocked(vscode.commands.executeCommand).mock.calls.filter((c) => c[0] === 'setContext');

beforeEach(() => {
  vi.clearAllMocks();
  SESSION = { id: 1 } as ActiveSession;
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

  it('names the capabilities that are actually missing', () => {
    // The probe answers `missing` specifically so a refusal can distinguish "Rowan
    // is not here at all" from "Rowan changed one selector under us" — only the
    // second is a bug worth filing, and they read identically without the names.
    vi.mocked(queries.tonelCapability).mockReturnValue({
      available: false,
      missing: ['Class>>_rwOptionsArray'],
    });
    requireTonelAvailable(SESSION);
    const text = String(vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0]);
    expect(text).toContain('Class>>_rwOptionsArray');
  });

  it('caps the list on a stone where everything is absent', () => {
    // On a base extent every capability is missing; naming all of them makes the
    // warning unreadable and says nothing the first few do not.
    vi.mocked(queries.tonelCapability).mockReturnValue({
      available: false,
      missing: ['Cap1>>one', 'Cap2>>two', 'Cap3>>three', 'Cap4>>four', 'Cap5>>five'],
    });
    requireTonelAvailable(SESSION);
    const text = String(vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0]);
    expect(text).toContain('Cap1>>one, Cap2>>two, Cap3>>three');
    expect(text).toContain('2 more');
    expect(text).not.toContain('Cap4>>four');
  });

  it('does not claim anything is missing when the probe itself failed', () => {
    // A probe that raised answers no names; inventing "Missing: " there would be a
    // false diagnosis.
    vi.mocked(queries.tonelCapability).mockImplementation(() => {
      throw new Error('session busy');
    });
    requireTonelAvailable(SESSION);
    const text = String(vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0]);
    expect(text).not.toContain('Missing:');
  });

  it('refuses without a session', () => {
    expect(requireTonelAvailable(undefined)).toBe(false);
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });
});

describe('the capability probe is not repeated needlessly', () => {
  it('asks the stone once per session, not once per command', () => {
    // The probe is a ten-way doit and the guard runs on every Tonel command —
    // once per FILE in a multi-file file-in.
    vi.mocked(queries.tonelCapability).mockReturnValue({ available: true, missing: [] });

    requireTonelAvailable(SESSION);
    requireTonelAvailable(SESSION);
    requireTonelAvailable(SESSION);

    expect(queries.tonelCapability).toHaveBeenCalledTimes(1);
  });

  it('asks again after a refresh, which is when the answer could differ', () => {
    vi.mocked(queries.tonelCapability).mockReturnValue({ available: true, missing: [] });
    requireTonelAvailable(SESSION);
    refreshTonelAvailability(SESSION);
    requireTonelAvailable(SESSION);

    // Once for the first guard, once for the refresh itself; the guard after it
    // reuses the refresh's answer.
    expect(queries.tonelCapability).toHaveBeenCalledTimes(2);
  });

  it('does not cache a probe that threw, so one busy moment is not permanent', () => {
    vi.mocked(queries.tonelCapability).mockImplementationOnce(() => {
      throw new Error('session busy');
    });
    expect(requireTonelAvailable(SESSION)).toBe(false);

    vi.mocked(queries.tonelCapability).mockReturnValue({ available: true, missing: [] });
    expect(requireTonelAvailable(SESSION)).toBe(true);
  });
});
