/**
 * regexSearchUsing: how the host turns the stone's answer, or its failure, into what the engine shows,
 * and how Cancel reaches the stone. The GCI call is faked; regexSearch.integration.test.ts runs it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

const mocks = vi.hoisted(() => ({
  executeFetchStringAsync: vi.fn(),
}));

vi.mock('../../browserQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../browserQueries')>()),
  executeFetchStringAsync: mocks.executeFetchStringAsync,
}));

import { regexSearchUsing } from '../omniSearchCommand';
import { BrowserQueryError } from '../../browserQueries';
import { NbCancelledError } from '../../nbRunner';
import { GCI_ERR_OP_IN_PROGRESS } from '../../gciConstants';
import type { ActiveSession } from '../../sessionManager';

const session = { id: 7 } as unknown as ActiveSession;
const ROW = 'UserGlobals\tFoo\t0\tbar\tfixture\t0';

beforeEach(() => {
  mocks.executeFetchStringAsync.mockReset();
});

describe('regexSearchUsing', () => {
  it('answers the rows as Source results of this session', async () => {
    mocks.executeFetchStringAsync.mockResolvedValue(`0\t2\t900\t1\n3-5,8-9\n${ROW}\n`);

    const outcome = await regexSearchUsing(session)('ba.', true, 200).outcome;

    expect(outcome).toMatchObject({
      kind: 'results',
      skipped: 2,
      truncated: true,
      wholeMethods: false,
    });
    if (outcome.kind !== 'results') throw new Error('unreachable');
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]).toMatchObject({
      categoryId: 'source',
      label: 'Foo>>bar',
      action: {
        kind: 'openMethod',
        sessionId: 7,
        className: 'Foo',
        selector: 'bar',
        matches: [
          { start: 2, end: 5 },
          { start: 7, end: 9 },
        ],
      },
    });
  });

  it('sends the pattern, Aa and the limit to the stone without blocking, with a title for the progress notice', async () => {
    mocks.executeFetchStringAsync.mockResolvedValue('0\t0\t1\t0\n\n');

    await regexSearchUsing(session)('printOn:', false, 1234).outcome;

    const [s, code, title] = mocks.executeFetchStringAsync.mock.calls[0];
    expect(s).toBe(session);
    expect(code).toContain(
      "GsRegexSourceSearch pattern: 'printOn:' ignoreCase: false limit: 1234.",
    );
    expect(title).toBe('GemStone Search: searching method source…');
  });

  it("refuses a pattern the stone refused, giving the stone's reason", async () => {
    mocks.executeFetchStringAsync.mockResolvedValue('#error\tcounted repetition is not supported');

    const outcome = await regexSearchUsing(session)('a{3}', false, 200).outcome;

    expect(outcome).toEqual({
      kind: 'refused',
      message: "This pattern can't be used: counted repetition is not supported",
    });
  });

  it('refuses, saying what to do, when the session is busy with another run', async () => {
    mocks.executeFetchStringAsync.mockRejectedValue(
      new BrowserQueryError('busy', GCI_ERR_OP_IN_PROGRESS),
    );

    const outcome = await regexSearchUsing(session)('a', false, 200).outcome;

    expect(outcome).toEqual({
      kind: 'refused',
      message: 'The session is busy with another run. Wait for it or stop it, then press Enter.',
    });
  });

  it('answers cancelled when the stone was stopped', async () => {
    mocks.executeFetchStringAsync.mockRejectedValue(new NbCancelledError());

    expect(await regexSearchUsing(session)('a', false, 200).outcome).toEqual({ kind: 'cancelled' });
  });

  it('passes any other failure on', async () => {
    mocks.executeFetchStringAsync.mockRejectedValue(new BrowserQueryError('session lost', 4100));

    await expect(regexSearchUsing(session)('a', false, 200).outcome).rejects.toThrow(
      'session lost',
    );
  });

  it("cancels its own call on the stone, through that call's own canceller", async () => {
    const stopThisCall = vi.fn();
    let finish!: (s: string) => void;
    mocks.executeFetchStringAsync.mockImplementation(
      (_s: unknown, _code: string, _title: string, onStart: (c: () => void) => void) => {
        onStart(stopThisCall);
        return new Promise<string>((resolve) => (finish = resolve));
      },
    );
    const run = regexSearchUsing(session)('(a+)+b', false, 200);
    await vi.waitFor(() => expect(mocks.executeFetchStringAsync).toHaveBeenCalled());

    run.cancel();
    finish('0\t0\t1\t0\n\n');

    expect(stopThisCall).toHaveBeenCalledTimes(1);
    expect(await run.outcome).toEqual({ kind: 'cancelled' });
  });

  it('never reaches the stone when cancelled before it started', async () => {
    mocks.executeFetchStringAsync.mockResolvedValue('0\t0\t1\t0\n\n');
    const run = regexSearchUsing(session)('a', false, 200);

    run.cancel();

    expect(await run.outcome).toEqual({ kind: 'cancelled' });
    expect(mocks.executeFetchStringAsync).not.toHaveBeenCalled();
  });

  // Replacing a search cancels it, but the stone holds the session until it answers the soft break;
  // a search started at once was refused as busy by the one it had just replaced.
  it('starts a search only after the one before it has settled', async () => {
    let finishFirst!: (s: string) => void;
    mocks.executeFetchStringAsync
      .mockImplementationOnce(() => new Promise<string>((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce('0\t0\t1\t0\n\n');
    const search = regexSearchUsing(session);
    const first = search('(a+)+b', false, 200);
    await vi.waitFor(() => expect(mocks.executeFetchStringAsync).toHaveBeenCalledTimes(1));

    first.cancel();
    const second = search('b', false, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.executeFetchStringAsync).toHaveBeenCalledTimes(1);

    finishFirst('0\t0\t1\t0\n\n');
    expect(await second.outcome).toMatchObject({ kind: 'results' });
    expect(mocks.executeFetchStringAsync).toHaveBeenCalledTimes(2);
  });
});
