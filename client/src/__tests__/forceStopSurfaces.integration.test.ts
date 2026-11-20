import { describe, it, expect, afterEach, onTestFinished, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// PROBE for #851: what the runner logs, printed when the save test fails.
const trace = vi.hoisted(() => [] as string[]);
const t0 = vi.hoisted(() => ({ at: 0 }));
vi.mock('../gciLog', async (orig) => {
  const real = await orig<typeof import('../gciLog')>();
  return {
    ...real,
    logInfo: (message: string) => {
      trace.push(`${Date.now() - t0.at}ms ${message}`);
      real.logInfo(message);
    },
    logError: (id: number, message: string) => {
      trace.push(`${Date.now() - t0.at}ms [${id}] ERROR ${message}`);
      real.logError(id, message);
    },
  };
});

import type { ActiveSession } from '../activeSession';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { forceStop } from '../forceStop';
import {
  NbCancelledError,
  runNbCall,
  setRunInProgressHandler,
  setStillRunningHandler,
  setStoppedRunCollectedHandler,
  stoppedRunHolds,
  isRunning,
  clearHolds,
  abandonedRunHolds,
} from '../nbRunner';
import { installTranscriptSink } from '../transcriptSink';
import { executeFetchString } from '../browserQueries';
import { SESSION_BUSY_MESSAGE } from '../gciLibraryError';
import { GemStoneFileSystemProvider } from '../gemstoneFileSystemProvider';
import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { evalSmalltalk } from '../smalltalkNotebookController';
import { evalPythonInScopeNb } from '../pythonQueries';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';
import { forceStopSupport } from './forceStopSupport';

describe('Force Stop from notebooks, the Explorer and saves (integration)', () => {
  let session: ActiveSession;

  useIntegrationTest(
    (testContext) => {
      session = testActiveSession(testContext.gciLibrary, testContext.session);
    },
    { sessions: 3 },
  );

  afterEach(() => {
    setStoppedRunCollectedHandler(undefined);
    setStillRunningHandler(undefined);
  });

  const { armedSession, deps, stopAndAbandon } = forceStopSupport(() => session);

  it("stops a notebook cell from the cell's own stop, and Force Stop frees the session", async () => {
    const own = armedSession();
    installTranscriptSink(own);
    let cancel: (() => void) | undefined;
    const cellRun = evalSmalltalk(
      own,
      '[[true] whileTrue] on: Break do: [:e | e resume]',
      (c) => (cancel = c),
    );
    cellRun.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 500));
    cancel!();

    await expect(cellRun).rejects.toBeInstanceOf(NbCancelledError);
    expect(stoppedRunHolds(own)).toBe(true);
    await expect(forceStop(own, deps)).resolves.toBe(true);
    await expect(evalSmalltalk(own, '3 + 4')).resolves.toBe('7');
  }, 30_000);

  // No test stone has Grail, so this shows the path works, not a stop of real Python.
  it('runs a Python cell without blocking, handing out its canceller', async () => {
    const own = armedSession();
    const onStart = vi.fn();

    const answer = await evalPythonInScopeNb(own, 'x = 1', 'file:///nb.ipynb', onStart);

    expect(answer).toMatch(/^Grail \(GemStone-Python\) not detected/);
    expect(onStart).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
  }, 30_000);

  it('offers Force Stop when an Explorer query is blocked by the stopped run', async () => {
    const told = vi.fn();
    setStillRunningHandler(told);
    const own = armedSession();
    await stopAndAbandon(own, '[[true] whileTrue: [nil]] on: Break do: [:e | e resume]');
    told.mockClear();

    expect(() => executeFetchString(own, '(3 + 4) printString')).toThrow(SESSION_BUSY_MESSAGE);
    await vi.waitFor(() => expect(told).toHaveBeenCalledWith(own));

    await expect(forceStop(own, deps)).resolves.toBe(true);
    expect(executeFetchString(own, '(3 + 4) printString')).toBe('7');
  }, 30_000);

  it('offers Stop, in plain words, when an Explorer query or a save meets a run still going', async () => {
    const told = vi.fn();
    setRunInProgressHandler(told);
    onTestFinished(() => setRunInProgressHandler(undefined));
    const own = armedSession();
    let cancel: (() => void) | undefined;
    const run = runNbCall(
      own,
      () =>
        own.GciTsNbExecute(
          '(Delay forSeconds: 30) wait',
          OOP_CLASS_UTF8,
          OOP_ILLEGAL,
          OOP_NIL,
          0,
          0,
        ),
      () => own.GciTsNbResult(),
      { suppressNotification: true, disposableProcess: true, onStart: (c) => (cancel = c) },
    );
    run.catch(() => {});

    expect(() => executeFetchString(own, '(3 + 4) printString')).toThrow(SESSION_BUSY_MESSAGE);
    await vi.waitFor(() => expect(told).toHaveBeenCalledWith(own));
    // A save goes the same way, and says why it did not happen.
    expect(() =>
      queries.compileMethod(own, 'Object', false, 'jasper-test', 'jasperBusySave ^ 1'),
    ).toThrow(SESSION_BUSY_MESSAGE);

    cancel!();
    await run.catch(() => {});
  }, 30_000);

  it.each(Array.from({ length: 10 }, (_, i) => i))(
    'fails a save made during a run, so the edit stays unsaved, and saves it once the run ends (probe %i)',
    async (iteration) => {
      trace.length = 0;
      t0.at = Date.now();
      const own = armedSession();
      const CLASS = `JasperBusySaveTest${iteration}`;
      const state = (): string => {
        let busy: string;
        try {
          busy = String(own.isBusy());
        } catch (e) {
          busy = `threw ${(e as Error).message.slice(0, 40)}`;
        }
        return (
          `running=${isRunning(own)} clear=${clearHolds(own)} abandoned=${abandonedRunHolds(own)} ` +
          `busy=${busy}`
        );
      };
      queries.compileClassDefinition(
        own,
        `Object subclass: '${CLASS}' instVarNames: #() classVars: #() classInstVars: #() ` +
          `poolDictionaries: #() inDictionary: UserGlobals options: #()`,
      );
      const provider = new GemStoneFileSystemProvider({
        getSession: () => own,
        getSessions: () => [own],
      } as unknown as SessionManager);
      const uri = vscode.Uri.parse(
        `gemstone://${own.id}/UserGlobals/${CLASS}/instance/test/jasperBusySave`,
      );
      const save = () =>
        provider.writeFile(uri, new TextEncoder().encode('jasperBusySave\n  ^ 42'), {
          create: false,
          overwrite: true,
        });
      const hasMethod = () =>
        own.executeAndFetchString(`(${CLASS} includesSelector: #jasperBusySave) printString`);
      let cancel: (() => void) | undefined;
      const run = runNbCall(
        own,
        () =>
          own.GciTsNbExecute(
            '(Delay forSeconds: 30) wait',
            OOP_CLASS_UTF8,
            OOP_ILLEGAL,
            OOP_NIL,
            0,
            0,
          ),
        () => own.GciTsNbResult(),
        { suppressNotification: true, disposableProcess: true, onStart: (c) => (cancel = c) },
      );
      run.catch(() => {});

      expect(save).toThrow(SESSION_BUSY_MESSAGE);

      trace.push(`${Date.now() - t0.at}ms cancel pressed`);
      cancel!();
      await run.then(
        (v) =>
          trace.push(
            `${Date.now() - t0.at}ms run resolved ${JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? String(x) : x)).slice(0, 200)}`,
          ),
        (e) =>
          trace.push(
            `${Date.now() - t0.at}ms run rejected ${(e as Error).name} ${(e as Error).message.slice(0, 80)}`,
          ),
      );
      const sampler = setInterval(
        () => trace.push(`${Date.now() - t0.at}ms sample ${state()}`),
        500,
      );
      try {
        // On a loaded machine the stopped run, or the clean-up after it, can still be
        // going.
        await vi.waitFor(() => expect(stoppedRunHolds(own)).toBe(false), { timeout: 10_000 });
      } catch (e) {
        trace.push(`${Date.now() - t0.at}ms waitFor timed out; watching 25s more`);
        const deadline = Date.now() + 25_000;
        while (stoppedRunHolds(own) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 250));
        }
        trace.push(`${Date.now() - t0.at}ms finally holds=${stoppedRunHolds(own)} ${state()}`);
        clearInterval(sampler);
        console.error(`PROBE851 trace (iteration ${iteration}):\n${trace.join('\n')}`);
        throw e;
      }
      clearInterval(sampler);
      expect(hasMethod()).toBe('false');
      save();
      expect(hasMethod()).toBe('true');
    },
    60_000,
  );
});
