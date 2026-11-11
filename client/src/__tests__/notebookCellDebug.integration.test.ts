import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../transcriptChannel', async (orig) => {
  const actual = await orig<typeof import('../transcriptChannel')>();
  return { ...actual, appendTranscriptOutput: vi.fn(actual.appendTranscriptOutput) };
});

import type { ActiveSession } from '../activeSession';
import { OOP_ILLEGAL } from '../gciConstants';
import { fetchCellResult } from '../notebookCellResult';
import { NbCancelledError } from '../nbRunner';
import { installTranscriptSink } from '../transcriptSink';
import { appendTranscriptOutput } from '../transcriptChannel';
import * as queries from '../browserQueries';
import { CONTINUE_FLAGS } from '../debugger/conditionalBreakpoints';
import { clearStack } from '../debugger/debugQueries';
import { evalSmalltalk, type OpenCellDebugger } from '../smalltalkNotebookController';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';

interface Stop {
  gsProcess: bigint;
  message: string;
}

/** A debugger that resumes the stopped process at once, as the user pressing Resume. */
function resumingDebugger(stops: Stop[]): OpenCellDebugger {
  return (session, gsProcess, message) => {
    stops.push({ gsProcess, message });
    return {
      result: Promise.resolve().then(() => {
        const { result, err } = session.GciTsContinueWith(
          gsProcess,
          OOP_ILLEGAL,
          null,
          CONTINUE_FLAGS,
        );
        if (err.number !== 0) throw new Error(err.message);
        return fetchCellResult(session, result);
      }),
      close: () => {},
    };
  };
}

/** A debugger that waits until it is closed, then terminates the process, as Terminate does. */
function waitingDebugger(stops: Stop[]): OpenCellDebugger & { closeAll: () => void } {
  const closers: (() => void)[] = [];
  const open: OpenCellDebugger = (session, gsProcess, message) => {
    stops.push({ gsProcess, message });
    let close = (): void => {};
    const result = new Promise<string>((_resolve, reject) => {
      close = () => {
        void clearStack(session, gsProcess).then(() => reject(new NbCancelledError()));
      };
    });
    closers.push(close);
    return { result, close };
  };
  return Object.assign(open, { closeAll: () => closers.forEach((c) => c()) });
}

describe('debugging a Smalltalk notebook cell (integration)', () => {
  let session: ActiveSession;
  const CLASS = 'JasperNotebookCellDebugTest';
  const SOURCE = 'twice: n\n  | r |\n  r := n * 2.\n  ^ r';

  useIntegrationTest((testContext) => {
    session = testActiveSession(testContext.gciLibrary, testContext.session);
  });

  afterEach(() => {
    try {
      queries.clearAllBreaks(session, CLASS, false, 'twice:');
    } catch {
      // The class only exists in the breakpoint tests.
    }
  });

  function armBreakpointInTwice(): void {
    queries.compileClassDefinition(
      session,
      `Object subclass: '${CLASS}' instVarNames: #() classVars: #() classInstVars: #() ` +
        `poolDictionaries: #() inDictionary: UserGlobals options: #()`,
    );
    queries.compileMethod(session, CLASS, false, 'test', SOURCE);
    const offsets = queries.getSourceOffsets(session, CLASS, false, 'twice:', 0);
    const at = SOURCE.indexOf('n * 2');
    const stepPoint = offsets.findIndex((offset) => offset - 1 >= at) + 1;
    queries.setBreakAtStepPoint(session, CLASS, false, 'twice:', stepPoint, 0);
  }

  it('stops at self halt, and the cell shows its result once the debugger resumes it', async () => {
    const stops: Stop[] = [];

    const answer = await evalSmalltalk(
      session,
      '| x | x := 4. self halt. x + 1',
      undefined,
      resumingDebugger(stops),
    );

    expect(stops).toHaveLength(1);
    expect(stops[0].message).toContain('Halt');
    expect(answer).toBe('5');
  }, 30_000);

  it('stops at self pause, and resumes to the result', async () => {
    const stops: Stop[] = [];

    const answer = await evalSmalltalk(
      session,
      'self pause. 3',
      undefined,
      resumingDebugger(stops),
    );

    expect(stops).toHaveLength(1);
    expect(answer).toBe('3');
  }, 30_000);

  it('stops at a breakpoint in a method the cell calls', async () => {
    armBreakpointInTwice();
    const stops: Stop[] = [];

    const answer = await evalSmalltalk(
      session,
      `${CLASS} new twice: 21`,
      undefined,
      resumingDebugger(stops),
    );

    expect(stops).toHaveLength(1);
    expect(stops[0].message).toMatch(/breakpoint/i);
    expect(answer).toBe('42');
  }, 30_000);

  // Each Transcript write pauses the cell and resumes it; the resume must keep
  // debugging on, or every breakpoint after the first write is skipped.
  it('still stops at a breakpoint reached after the cell writes to the Transcript', async () => {
    // Each test's abort undoes the sink, so it is installed here, where the write needs it.
    expect(installTranscriptSink(session)).toBe(true);
    armBreakpointInTwice();
    vi.mocked(appendTranscriptOutput).mockClear();
    const stops: Stop[] = [];

    const answer = await evalSmalltalk(
      session,
      `Transcript show: 'before'. ${CLASS} new twice: 5`,
      undefined,
      resumingDebugger(stops),
    );

    expect(vi.mocked(appendTranscriptOutput).mock.calls.join('')).toContain('before');
    expect(stops).toHaveLength(1);
    expect(answer).toBe('10');
  }, 30_000);

  it('reports an ordinary error inline and opens no debugger', async () => {
    const stops: Stop[] = [];

    const answer = await evalSmalltalk(session, '1/0', undefined, resumingDebugger(stops));

    expect(stops).toHaveLength(0);
    expect(answer).toMatch(/^Error: ZeroDivide/);
  }, 30_000);

  it('ends the cell as stopped when its debugger is closed, and leaves the session usable', async () => {
    const stops: Stop[] = [];
    const debuggerUnderTest = waitingDebugger(stops);

    const run = evalSmalltalk(session, 'self halt. 3', undefined, debuggerUnderTest);
    await vi.waitFor(() => expect(stops).toHaveLength(1), { timeout: 10_000 });
    debuggerUnderTest.closeAll();

    await expect(run).rejects.toBeInstanceOf(NbCancelledError);
    await expect(evalSmalltalk(session, '3 + 4')).resolves.toBe('7');
  }, 30_000);

  it("closes the debugger when the cell's own stop is pressed while it is paused", async () => {
    const stops: Stop[] = [];
    const debuggerUnderTest = waitingDebugger(stops);
    let stop: (() => void) | undefined;
    let stopRequested: () => boolean = () => false;

    const run = evalSmalltalk(
      session,
      'self halt. 3',
      (cancel, requested) => {
        stop = cancel;
        stopRequested = requested;
      },
      debuggerUnderTest,
    );
    await vi.waitFor(() => expect(stops).toHaveLength(1), { timeout: 10_000 });
    stop!();

    await expect(run).rejects.toBeInstanceOf(NbCancelledError);
    expect(stopRequested()).toBe(true);
    await expect(evalSmalltalk(session, '3 + 4')).resolves.toBe('7');
  }, 30_000);
});
