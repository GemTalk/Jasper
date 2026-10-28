import { describe, it, expect, vi, beforeEach } from 'vitest';

// browserQueries pulls in sessionManager/gciLog, which import vscode; koffi only
// loads its native lib in a constructor, so importing the module graph is safe.
vi.mock('vscode', () => ({
  window: { createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), append: vi.fn() })) },
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn() })) },
}));

import { executeFetchStringWithLimit, BrowserQueryError } from '../browserQueries';
import { ActiveSession } from '../sessionManager';
import type { GciLibrary } from '../gciLibrary';
import { fakeActiveSession, startNonBlockingCall } from './fakeActiveSession';

function makeSession(gciOverrides: Record<string, unknown> = {}): ActiveSession {
  const gci = {
    GciTsNbExecute: vi.fn(() => ({ success: true, err: { number: 0 } })),
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
    const session = makeSession({ GciTsExecuteFetchBytes: fetchBytes });
    startNonBlockingCall(session);

    expect(() => executeFetchStringWithLimit(session, 'l', 'C', 1024)).toThrow(/busy/i);
    expect(fetchBytes).not.toHaveBeenCalled();
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
