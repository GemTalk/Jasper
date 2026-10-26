import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../sessionManager';
import { fetchPrintString, fetchFullPrintString } from '../debugger/debugQueries';
import { sessionOn } from './fakeActiveSession';

const noErr = {
  number: 0,
  message: '',
  context: 0n,
  category: 0,
  fatal: false,
  argCount: 0,
  exceptionObj: 0n,
  args: [],
};

function createPrintStringSession(
  data: string,
  bytesReturned?: number,
  errNumber = 0,
): ActiveSession {
  const mockGci = {
    GciTsPerformFetchBytes: vi.fn(() => ({
      bytesReturned: bytesReturned ?? data.length,
      data,
      err: { ...noErr, number: errNumber, message: errNumber === 0 ? '' : 'GCI error' },
    })),
  };
  return sessionOn(mockGci);
}

function createFullPrintSession(data = '', execThrows = false): ActiveSession {
  const mockGci = {
    executeAndFetchString: vi.fn(() => {
      if (execThrows) throw new Error('execution failed');
      return data;
    }),
  };
  return sessionOn(mockGci);
}

describe('fetchPrintString', () => {
  it('returns value and truncated:false for a short clean string', () => {
    expect.assertions(2);
    const session = createPrintStringSession('hello');
    const result = fetchPrintString(session, 1000n, 10);
    expect(result.value).toBe('hello');
    expect(result.truncated).toBe(false);
  });

  it('returns truncated:true and slices value when data exceeds maxBytes', () => {
    expect.assertions(2);
    const session = createPrintStringSession('Hello World');
    const result = fetchPrintString(session, 1000n, 5);
    expect(result.truncated).toBe(true);
    expect(result.value).toBe('Hello');
  });

  it('returns truncated:true when data ends with "..."', () => {
    expect.assertions(2);
    const session = createPrintStringSession('foo bar...');
    const result = fetchPrintString(session, 1000n, 20);
    expect(result.truncated).toBe(true);
    expect(result.value).toBe('foo bar...');
  });

  it('returns truncated:true when data ends with "...)"', () => {
    expect.assertions(1);
    const session = createPrintStringSession('AnOrderedCollection (1 2 3...)');
    const result = fetchPrintString(session, 1000n, 100);
    expect(result.truncated).toBe(true);
  });

  it('returns truncated:false when ellipses appear mid-string but not at the end', () => {
    expect.assertions(1);
    const session = createPrintStringSession('AnOrderedCollection (1 ... 5 ... 9) size = 3');
    const result = fetchPrintString(session, 1000n, 100);
    expect(result.truncated).toBe(false);
  });

  it('returns truncated:true when string has multiple ellipses with trailing "...)"', () => {
    expect.assertions(1);
    const session = createPrintStringSession('AnOrderedCollection (1 2 3 ... 4 5 6 ... 7 8 9 ...)');
    const result = fetchPrintString(session, 1000n, 100);
    expect(result.truncated).toBe(true);
  });

  it('returns error value and truncated:false when GCI returns an error', () => {
    expect.assertions(2);
    const session = createPrintStringSession('', undefined, 2010);
    const result = fetchPrintString(session, 1000n, 10);
    expect(result.value).toContain('<error:');
    expect(result.truncated).toBe(false);
  });

  it('returns error value and truncated:false when GCI throws', () => {
    expect.assertions(2);
    const session = sessionOn({
      GciTsPerformFetchBytes: vi.fn(() => {
        throw new Error('connection lost');
      }),
    });
    const result = fetchPrintString(session, 1000n, 10);
    expect(result.value).toBe('<error getting printString>');
    expect(result.truncated).toBe(false);
  });

  it('truncates everything when maxBytes is 0', () => {
    expect.assertions(2);
    const session = createPrintStringSession('hello');
    const result = fetchPrintString(session, 1000n, 0);
    expect(result.truncated).toBe(true);
    expect(result.value).toBe('');
  });

  it('does not truncate when data length exactly equals maxBytes', () => {
    expect.assertions(2);
    const session = createPrintStringSession('hello');
    const result = fetchPrintString(session, 1000n, 5);
    expect(result.truncated).toBe(false);
    expect(result.value).toBe('hello');
  });

  it('truncates when maxBytes is -1, slice(0,-1) drops last character', () => {
    expect.assertions(2);
    const session = createPrintStringSession('hello');
    const result = fetchPrintString(session, 1000n, -1);
    expect(result.truncated).toBe(true);
    expect(result.value).toBe('hell');
  });
});

describe('fetchFullPrintString', () => {
  it('returns full string on happy path', () => {
    expect.assertions(1);
    const session = createFullPrintSession('this is the full print string');
    expect(fetchFullPrintString(session, 1000n)).toBe('this is the full print string');
  });

  it('surfaces the underlying error message when the execute fails', () => {
    expect.assertions(1);
    const session = createFullPrintSession('', true);
    expect(fetchFullPrintString(session, 1000n)).toBe('<error: execution failed>');
  });

  it('embeds the oop in emitted Smalltalk', () => {
    expect.assertions(1);
    const gci = { executeAndFetchString: vi.fn((_session: unknown, _code: string) => 'result') };
    const session = sessionOn(gci);
    fetchFullPrintString(session, 99999n);
    const code = gci.executeAndFetchString.mock.calls[0][1];
    expect(code).toContain('99999');
  });
});
