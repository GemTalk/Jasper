import { describe, it, expect, vi, beforeEach } from 'vitest';

// browserQueries pulls in sessionManager/gciLog, which import vscode; koffi only
// loads its native lib in a constructor, so importing the module graph is safe.
vi.mock('vscode', () => ({
  window: { createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), append: vi.fn() })) },
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn() })) },
}));

import { executeFetchStringWithLimit, BrowserQueryError } from '../browserQueries';
import { ActiveSession } from '../sessionManager';

function makeSession(gciOverrides: Record<string, unknown> = {}): ActiveSession {
  const gci = {
    GciTsCallInProgress: vi.fn(() => ({ result: 0 })),
    utf8ClassOop: vi.fn(() => 42n),
    GciTsExecuteFetchBytes: vi.fn(() => ({ bytesReturned: 3, data: 'abc', err: { number: 0 } })),
    ...gciOverrides,
  };
  return {
    id: 1,
    handle: {},
    gci: gci as unknown as ActiveSession['gci'],
    login: {} as ActiveSession['login'],
    stoneVersion: '3.7.2',
  };
}

describe('executeFetchStringWithLimit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the requested maxBytes through to the GCI fetch', () => {
    const session = makeSession();
    const out = executeFetchStringWithLimit(session, 'label', 'CODE', 8 * 1024 * 1024);
    expect(out).toBe('abc');
    const call = (session.gci.GciTsExecuteFetchBytes as ReturnType<typeof vi.fn>).mock.calls[0];
    // signature: (handle, code, -1, utf8Oop, ctx, symbolList, maxResultSize)
    expect(call[1]).toBe('CODE');
    expect(call[6]).toBe(8 * 1024 * 1024);
  });

  it('throws when the session is busy', () => {
    const session = makeSession({ GciTsCallInProgress: vi.fn(() => ({ result: 1 })) });
    expect(() => executeFetchStringWithLimit(session, 'l', 'C', 1024)).toThrow(/busy/i);
    expect(session.gci.GciTsExecuteFetchBytes).not.toHaveBeenCalled();
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
