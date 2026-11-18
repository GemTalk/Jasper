import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

vi.mock('../browserQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../browserQueries')>()),
  executeFetchStringAsync: vi.fn(),
}));

import { ActiveSession } from '../sessionManager';
import { executeFetchStringAsync } from '../browserQueries';
import { NbCancelledError } from '../nbRunner';
import {
  fetchPrintString,
  fetchFullPrintString,
  fullPrintStringCode,
  parseFullPrintString,
  FULL_PRINT_STRING_MAX_CHARS,
} from '../debugger/debugQueries';
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

describe('fullPrintStringCode', () => {
  it('prints the object at the oop into a PrintStream one character past the cap', () => {
    expect.assertions(2);
    const code = fullPrintStringCode(99999n, 1000);
    expect(code).toContain('(Object _objectForOop: 99999) printOn: ws');
    // One past the cap: a PrintStream is full once it holds maxSize characters,
    // so a print of exactly the cap must not read as cut short.
    expect(code).toContain('PrintStream printingOn: String new maxSize: 1001');
  });

  it('never prints into an unlimited WriteStream', () => {
    expect.assertions(1);
    expect(fullPrintStringCode(1n, 10)).not.toContain('WriteStream');
  });

  it('answers the cut-short flag ahead of the text', () => {
    expect.assertions(1);
    expect(fullPrintStringCode(1n, 10)).toContain(
      "(ws isFull ifTrue: ['T'] ifFalse: ['F']) , ws _collection",
    );
  });
});

describe('parseFullPrintString', () => {
  it('reads a leading T as cut short', () => {
    expect.assertions(1);
    expect(parseFullPrintString("T'aaaa...")).toEqual({ text: "'aaaa...", truncated: true });
  });

  it('reads a leading F as whole', () => {
    expect.assertions(1);
    expect(parseFullPrintString('Fan Account')).toEqual({ text: 'an Account', truncated: false });
  });

  it('keeps a text that itself starts with T or F', () => {
    expect.assertions(1);
    expect(parseFullPrintString('FTrue story')).toEqual({ text: 'True story', truncated: false });
  });

  it('reads an empty print as whole', () => {
    expect.assertions(1);
    expect(parseFullPrintString('F')).toEqual({ text: '', truncated: false });
  });
});

describe('fetchFullPrintString', () => {
  const session = {} as ActiveSession;
  const fetchMock = vi.mocked(executeFetchStringAsync);

  it('runs the capped print without blocking and answers the text', async () => {
    expect.assertions(3);
    fetchMock.mockResolvedValue('Fthis is the full print string');
    const result = await fetchFullPrintString(session, 1000n);
    expect(result).toEqual({ text: 'this is the full print string', truncated: false });
    expect(fetchMock.mock.lastCall?.[0]).toBe(session);
    expect(fetchMock.mock.lastCall?.[1]).toBe(
      fullPrintStringCode(1000n, FULL_PRINT_STRING_MAX_CHARS),
    );
  });

  it('reports a print the cap cut short', async () => {
    expect.assertions(1);
    fetchMock.mockResolvedValue('T#( 1, 2, 3...');
    expect(await fetchFullPrintString(session, 1000n)).toEqual({
      text: '#( 1, 2, 3...',
      truncated: true,
    });
  });

  it('passes a smaller cap through to the Smalltalk', async () => {
    expect.assertions(1);
    fetchMock.mockResolvedValue('F1');
    await fetchFullPrintString(session, 7n, 50);
    expect(fetchMock.mock.lastCall?.[1]).toBe(fullPrintStringCode(7n, 50));
  });

  it('answers a failed print as error text instead of rejecting', async () => {
    expect.assertions(1);
    fetchMock.mockImplementation(() =>
      Promise.reject(new Error('a MessageNotUnderstood occurred')),
    );
    expect(await fetchFullPrintString(session, 1000n)).toEqual({
      text: '<error: a MessageNotUnderstood occurred>',
      truncated: false,
    });
  });

  it('answers a Cancel as error text instead of rejecting', async () => {
    expect.assertions(1);
    fetchMock.mockImplementation(() => Promise.reject(new NbCancelledError()));
    expect(await fetchFullPrintString(session, 1000n)).toEqual({
      text: '<error: GemStone operation cancelled>',
      truncated: false,
    });
  });

  it('answers a non-Error rejection as error text', async () => {
    expect.assertions(1);
    fetchMock.mockImplementation(() => Promise.reject('session busy'));
    expect((await fetchFullPrintString(session, 1000n)).text).toBe('<error: session busy>');
  });
});
