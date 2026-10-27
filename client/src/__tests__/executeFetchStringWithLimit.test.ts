import { describe, it, expect, vi, beforeEach } from 'vitest';

// browserQueries pulls in sessionManager/gciLog, which import vscode; koffi only
// loads its native lib in a constructor, so importing the module graph is safe.
vi.mock('vscode', () => ({
  window: { createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), append: vi.fn() })) },
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn() })) },
}));

import { executeFetchStringWithLimit, BrowserQueryError } from '../browserQueries';
import { SESSION_BUSY_MESSAGE } from '../gciLibraryError';
import { ActiveSession } from '../sessionManager';
import type { GciLibrary } from '../gciLibrary';
import { fakeActiveSession } from './fakeActiveSession';

function makeSession(gciOverrides: Record<string, unknown> = {}): ActiveSession {
  const gci = {
    GciTsCallInProgress: vi.fn(() => ({ result: 0 })),
    utf8ClassOop: vi.fn(() => 42n),
    GciTsExecuteFetchBytes: vi.fn(() => ({ bytesReturned: 3, data: 'abc', err: { number: 0 } })),
    ...gciOverrides,
  };
  return fakeActiveSession({
    id: 1,
    handle: {},
    gci,
    login: {},
    stoneVersion: '3.7.2',
  });
}

describe('executeFetchStringWithLimit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the requested maxBytes through to the GCI fetch', () => {
    const fetchBytes = vi.fn((..._args: Parameters<GciLibrary['GciTsExecuteFetchBytes']>) => ({
      bytesReturned: 3,
      data: 'abc',
      err: { number: 0 },
    }));
    const session = makeSession({ GciTsExecuteFetchBytes: fetchBytes });
    const out = executeFetchStringWithLimit(session, 'label', 'CODE', 8 * 1024 * 1024);
    expect(out).toBe('abc');
    const call = fetchBytes.mock.calls[0];
    // signature: (handle, code, -1, utf8Oop, ctx, symbolList, maxResultSize)
    expect(call[1]).toBe('CODE');
    expect(call[6]).toBe(8 * 1024 * 1024);
  });

  it('throws when the session is busy', () => {
    const fetchBytes = vi.fn();
    const session = makeSession({
      GciTsCallInProgress: vi.fn(() => ({ result: 1 })),
      GciTsExecuteFetchBytes: fetchBytes,
    });
    expect(() => executeFetchStringWithLimit(session, 'l', 'C', 1024)).toThrow(
      SESSION_BUSY_MESSAGE,
    );
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it('says in plain words when GemStone refuses the call because the session is busy', () => {
    const session = makeSession({
      GciTsExecuteFetchBytes: vi.fn(() => ({
        data: '',
        err: { number: 2203, message: 'session has a GciTsNb operation in progress' },
      })),
    });

    let thrown: unknown;
    try {
      executeFetchStringWithLimit(session, 'l', 'C', 1024);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BrowserQueryError);
    expect((thrown as BrowserQueryError).message).toBe(SESSION_BUSY_MESSAGE);
    expect((thrown as BrowserQueryError).gciErrorNumber).toBe(2203);
  });

  it('throws a BrowserQueryError with the underlying GCI error message', () => {
    const session = makeSession({
      GciTsExecuteFetchBytes: vi.fn(() => ({
        bytesReturned: -1,
        data: '',
        err: { number: 2010, message: 'boom' },
      })),
    });

    expect(() => executeFetchStringWithLimit(session, 'l', 'C', 1024)).toThrow(BrowserQueryError);
    expect(() => executeFetchStringWithLimit(session, 'l', 'C', 1024)).toThrow('boom');
  });
});
