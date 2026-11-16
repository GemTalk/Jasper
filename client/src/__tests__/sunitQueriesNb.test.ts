/**
 * The non-blocking SUnit run queries.
 *
 * A test can run for minutes, and the blocking GCI call holds the extension host
 * for its whole duration — which is why nothing could interrupt one. These two
 * wrappers are what put a run on the pollable path, so what matters here is that
 * they send the SAME Smalltalk the blocking pair sends, parse the answer the same
 * way, and forward the canceller a stop button needs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', () => {
  class BrowserQueryError extends Error {}
  return {
    BrowserQueryError,
    StoppedByBreakError: class StoppedByBreakError extends BrowserQueryError {},
    defaultQueryExecutorUsing: vi.fn(() => vi.fn()),
    executeFetchStringNb: vi.fn(),
  };
});
vi.mock('../nbRunner', async (orig) => ({
  ...(await orig()),
  stoppedRunCleared: vi.fn(() => Promise.resolve()),
  sayStillRunningUnlessItEnds: vi.fn(),
}));

import { BrowserQueryError, executeFetchStringNb, StoppedByBreakError } from '../browserQueries';
import { NbCancelledError, sayStillRunningUnlessItEnds, stoppedRunCleared } from '../nbRunner';
import { runTestClassNb, runTestMethodNb } from '../sunitQueries';
import { runTestClassCode, parseTestClassResults } from '../queries/runTestClass';
import { runTestMethodCode, parseTestMethodResult } from '../queries/runTestMethod';
import type { ActiveSession } from '../sessionManager';

const session = { id: 1 } as unknown as ActiveSession;
const nb = vi.mocked(executeFetchStringNb);

beforeEach(() => {
  nb.mockClear();
  vi.mocked(stoppedRunCleared).mockClear();
  vi.mocked(sayStillRunningUnlessItEnds).mockClear();
});

describe('runTestMethodNb', () => {
  it('sends the same code the blocking query sends, and parses its answer', async () => {
    nb.mockResolvedValueOnce('failed\tTestFailure: nope\t42');

    const result = await runTestMethodNb(session, 'MyTestCase', 'testAdd', 'UserGlobals');

    // Same builder as the blocking path: one behaviour, two ways of waiting for it.
    expect(nb.mock.calls[0][2]).toBe(runTestMethodCode('MyTestCase', 'testAdd', 'UserGlobals'));
    expect(result).toEqual({
      className: 'MyTestCase',
      selector: 'testAdd',
      status: 'failed',
      message: 'TestFailure: nope',
      durationMs: 42,
    });
  });

  it('forwards the canceller, which is the whole point of the non-blocking path', async () => {
    nb.mockResolvedValueOnce('passed\t\t1');
    const onStart = vi.fn();

    await runTestMethodNb(session, 'MyTestCase', 'testAdd', 'UserGlobals', onStart);

    expect(nb.mock.calls[0][5]).toBe(onStart);
  });

  it('names the run in the progress notification, so a long one says what it is', async () => {
    nb.mockResolvedValueOnce('passed\t\t1');

    await runTestMethodNb(session, 'MyTestCase', 'testAdd');

    expect(nb.mock.calls[0][3]).toContain('MyTestCase>>testAdd');
  });

  it('answers a raw Break from its own stop as a stopped test, once the session is clear', async () => {
    let cleared = false;
    vi.mocked(stoppedRunCleared).mockImplementationOnce(async () => {
      cleared = true;
    });
    nb.mockRejectedValueOnce(new StoppedByBreakError('a Break occurred'));

    const result = await runTestMethodNb(session, 'MyTestCase', 'testAdd');

    expect(cleared).toBe(true);
    expect(sayStillRunningUnlessItEnds).toHaveBeenCalledWith(session);
    expect(result).toMatchObject({ status: 'error', message: 'Break: a Break occurred' });
  });

  it('passes any other failure through unchanged', async () => {
    const cancelled = new NbCancelledError();
    const failed = new BrowserQueryError('busy');
    nb.mockRejectedValueOnce(cancelled).mockRejectedValueOnce(failed);

    await expect(runTestMethodNb(session, 'MyTestCase', 'testAdd')).rejects.toBe(cancelled);
    await expect(runTestMethodNb(session, 'MyTestCase', 'testAdd')).rejects.toBe(failed);
    expect(stoppedRunCleared).not.toHaveBeenCalled();
  });
});

describe('runTestClassNb', () => {
  it('fails with a raw Break from its own stop only once the session is clear', async () => {
    let cleared = false;
    vi.mocked(stoppedRunCleared).mockImplementationOnce(async () => {
      cleared = true;
    });
    const stopped = new StoppedByBreakError('a Break occurred');
    nb.mockRejectedValueOnce(stopped);

    await expect(runTestClassNb(session, 'MyTestCase')).rejects.toBe(stopped);
    expect(cleared).toBe(true);
    expect(sayStillRunningUnlessItEnds).toHaveBeenCalledWith(session);
  });

  it('passes any other failure through without waiting', async () => {
    const cancelled = new NbCancelledError();
    nb.mockRejectedValueOnce(cancelled);

    await expect(runTestClassNb(session, 'MyTestCase')).rejects.toBe(cancelled);
    expect(stoppedRunCleared).not.toHaveBeenCalled();
  });

  it('sends the same code the blocking query sends, and parses every line', async () => {
    nb.mockResolvedValueOnce(
      'MyTestCase\ttestAdd\tpassed\t\nMyTestCase\ttestRemove\tfailed\tTestFailure: nope\n',
    );

    const results = await runTestClassNb(session, 'MyTestCase', 'UserGlobals');

    expect(nb.mock.calls[0][2]).toBe(runTestClassCode('MyTestCase', 'UserGlobals'));
    expect(results.map((r) => [r.selector, r.status])).toEqual([
      ['testAdd', 'passed'],
      ['testRemove', 'failed'],
    ]);
  });

  it('forwards the canceller', async () => {
    nb.mockResolvedValueOnce('');
    const onStart = vi.fn();

    await runTestClassNb(session, 'MyTestCase', 'UserGlobals', onStart);

    expect(nb.mock.calls[0][5]).toBe(onStart);
  });
});

describe('the code/parse split', () => {
  // The split exists so one piece of Smalltalk serves both the blocking and the
  // non-blocking path. These pin the halves that the wrappers above rely on.
  it('scopes the class to its dictionary when one is given', () => {
    expect(runTestClassCode('MyTestCase', 'UserGlobals')).toContain('UserGlobals');
    expect(runTestMethodCode('MyTestCase', 'testAdd', 'UserGlobals')).toContain('UserGlobals');
  });

  it('reads an unparseable answer as an error rather than inventing a pass', () => {
    expect(parseTestMethodResult('', 'MyTestCase', 'testAdd').status).toBe('error');
    expect(parseTestClassResults('MyTestCase\ttestAdd\t\t\n', 'MyTestCase')[0].status).toBe(
      'error',
    );
  });

  it('answers no results for an empty class run', () => {
    expect(parseTestClassResults('', 'MyTestCase')).toEqual([]);
  });
});
