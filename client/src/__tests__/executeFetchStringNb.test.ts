import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import { executeFetchStringNb, loadRowanProjectNb, BrowserQueryError } from '../browserQueries';
import type { ActiveSession } from '../sessionManager';

// A fake session whose gci implements just the non-blocking execute path:
// start (NbExecute) → poll ready (NbPoll) → result oop (NbResult) → string
// contents (FetchChars). Overrides let each test break one link in the chain.
function fakeSession(overrides: Record<string, unknown> = {}): ActiveSession {
  return {
    id: -1,
    handle: { fake: true },
    login: { stone: 'test-stone' },
    gci: {
      GciTsCallInProgress: vi.fn(() => ({ result: 0, err: { number: 0 } })),
      utf8ClassOop: vi.fn(() => 7n),
      GciTsNbExecute: vi.fn(() => ({ success: true, err: { number: 0 } })),
      isAvailable: vi.fn(() => true),
      GciTsNbPoll: vi.fn(() => ({ result: 1, err: { number: 0 } })),
      GciTsNbResult: vi.fn(() => ({ result: 42n, err: { number: 0 } })),
      GciTsFetchChars: vi.fn(() => ({ bytesReturned: 5n, data: 'OK\tX', err: { number: 0 } })),
      ...overrides,
    },
  } as unknown as ActiveSession;
}

describe('executeFetchStringNb', () => {
  it('starts the code non-blocking and returns the result string verbatim', async () => {
    const session = fakeSession();

    const result = await executeFetchStringNb(session, 'test', '3 + 4 printString');

    expect(result).toBe('OK\tX');
    const nb = session.gci.GciTsNbExecute as ReturnType<typeof vi.fn>;
    expect(nb.mock.calls[0][1]).toBe('3 + 4 printString');
  });

  it('refuses to start while the session is busy with another call', async () => {
    const session = fakeSession({
      GciTsCallInProgress: vi.fn(() => ({ result: 1, err: { number: 0 } })),
    });

    await expect(executeFetchStringNb(session, 'test', 'code')).rejects.toThrow(
      /busy with another operation/,
    );
  });

  it('rejects when the execution cannot start', async () => {
    const session = fakeSession({
      GciTsNbExecute: vi.fn(() => ({ success: false, err: { number: 4051, message: 'no start' } })),
    });

    await expect(executeFetchStringNb(session, 'test', 'code')).rejects.toThrow('no start');
  });

  it('surfaces a GemStone error from the completed call', async () => {
    const session = fakeSession({
      GciTsNbResult: vi.fn(() => ({ result: 0n, err: { number: 2318, message: 'boom' } })),
    });

    await expect(executeFetchStringNb(session, 'test', 'code')).rejects.toThrow(BrowserQueryError);
  });
});

describe('loadRowanProjectNb', () => {
  it('runs the standard load Smalltalk and parses the OK result', async () => {
    const session = fakeSession({
      GciTsFetchChars: vi.fn(() => ({
        bytesReturned: 11n,
        data: 'OK\tSeaside3',
        err: { number: 0 },
      })),
    });

    const result = await loadRowanProjectNb(session, '/r/spec.ston', '/r', 'Loading…');

    expect(result).toEqual({ success: true, detail: 'Seaside3' });
    const nb = session.gci.GciTsNbExecute as ReturnType<typeof vi.fn>;
    const code = nb.mock.calls[0][1] as string;
    expect(code).toContain("projectFromUrl: 'file:/r/spec.ston'");
    expect(code).toContain("diskUrl: 'file:/r'");
    expect(code).toContain('resolved load');
    expect(code).toContain('System commitTransaction');
  });

  it('parses a load failure into an unsuccessful result', async () => {
    const session = fakeSession({
      GciTsFetchChars: vi.fn(() => ({ bytesReturned: 9n, data: 'ERR\tnope', err: { number: 0 } })),
    });

    const result = await loadRowanProjectNb(session, '/r/spec.ston', '/r', 'Loading…');

    expect(result).toEqual({ success: false, detail: 'nope' });
  });
});
