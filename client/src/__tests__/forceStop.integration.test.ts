import { describe, it, expect, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// What the runner logs, kept so a test that fails can say what happened; GCI
// output is not shown in CI otherwise.
const trace = vi.hoisted(() => [] as string[]);
vi.mock('../gciLog', async (orig) => {
  const real = await orig<typeof import('../gciLog')>();
  const at = (line: string): void => void trace.push(`${Date.now() % 100_000} ${line}`);
  return {
    ...real,
    logInfo: (message: string) => {
      at(message);
      real.logInfo(message);
    },
    logError: (id: number, message: string) => {
      at(`[${id}] ERROR ${message}`);
      real.logError(id, message);
    },
  };
});

import type { ActiveSession } from '../activeSession';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { forceStop, FORCE_STOP_WAIT_MS, rearmAfterForceStop } from '../forceStop';
import {
  NbCancelledError,
  runNbCall,
  setStillRunningHandler,
  setStoppedRunCollectedHandler,
  stoppedRunHolds,
} from '../nbRunner';
import {
  endClientForwarderMode,
  installTranscriptSink,
  settleNbResult,
  startClientForwarderMode,
} from '../transcriptSink';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';
import { forceStopSupport } from './forceStopSupport';

describe('Force Stop (integration)', () => {
  let session: ActiveSession;

  useIntegrationTest((testContext) => {
    session = testActiveSession(testContext.gciLibrary, testContext.session);
  });

  afterEach(() => {
    setStoppedRunCollectedHandler(undefined);
    setStillRunningHandler(undefined);
  });

  const { armedSession, deps, stopAndAbandon, settled, armed } = forceStopSupport(() => session);

  it('stops a run that ignores the stop, keeping the session and its uncommitted changes', async () => {
    const own = armedSession();
    own.executeAndFetchString(`UserGlobals at: #ForceStopProbe put: 1. 'ok'`);
    await stopAndAbandon(own, '[[true] whileTrue: [nil]] on: Break do: [:e | e resume]');

    const startedAt = Date.now();
    await expect(forceStop(own, deps)).resolves.toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(FORCE_STOP_WAIT_MS);

    expect(own.executeAndFetchString('System needsCommit printString')).toBe('true');
    expect(own.executeAndFetchString('(3 + 4) printString')).toBe('7');
    expect(armed(own)).toBe('true');
    own.executeAndFetchString(`System abortTransaction. 'ok'`);
    expect(armed(own)).toBe('true');
  }, 30_000);

  // A soft break that reaches the gem before it has started the call is lost; the
  // runner sends it again when it stops waiting. The gem is held back with
  // SIGSTOP while the call and the Cancel go out, which Windows has no way to do.
  it.skipIf(process.platform === 'win32').each([
    ['one press', 1],
    ['two quick presses', 2],
  ])(
    'stops a run whose Cancel reached the gem before the run had started (%s)',
    async (_how, presses) => {
      trace.length = 0;
      const own = armedSession();
      const pid = own
        .executeAndFetchString('((System descriptionOfSession: System session) at: 2) printString')
        .trim();
      let cancel: (() => void) | undefined;
      execSync(`kill -STOP ${pid}`);
      let run: Promise<unknown>;
      try {
        run = runNbCall(
          own,
          () =>
            own.GciTsNbExecute(
              '[true] whileTrue: [nil]',
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
        for (let i = 0; i < presses; i++) cancel!();
        await new Promise((resolve) => setTimeout(resolve, 500));
      } finally {
        execSync(`kill -CONT ${pid}`);
      }

      // Given up on, or answered with a Break where the first one was not lost
      // (macOS); either way it has to end, which the loop never does by itself.
      await settled(run);
      const deadline = Date.now() + 10_000;
      while (stoppedRunHolds(own) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      try {
        expect(stoppedRunHolds(own)).toBe(false);
        expect(own.executeAndFetchString('(3 + 4) printString')).toBe('7');
      } catch (e) {
        // How the session looks from here, a few times over, after the refusal.
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          let answer: string;
          try {
            answer = own.executeAndFetchString('(3 + 4) printString');
          } catch (again) {
            answer = `refused: ${(again as Error).message.slice(0, 60)}`;
          }
          trace.push(
            `${Date.now() % 100_000} retry ${i}: holds=${stoppedRunHolds(own)} ` +
              `busy=${own.isBusy()} inProgress=${own.GciTsCallInProgress().result} 3+4 ${answer}`,
          );
        }
        console.error(`What the runner did:\n${trace.join('\n')}`);
        throw e;
      }
    },
    30_000,
  );

  it('can stop the same session again', async () => {
    const own = armedSession();
    for (let i = 0; i < 2; i++) {
      await stopAndAbandon(own, '[[true] whileTrue: [nil]] on: Break do: [:e | e resume]');
      await expect(forceStop(own, deps)).resolves.toBe(true);
    }
    expect(own.executeAndFetchString('(3 + 4) printString')).toBe('7');
  }, 30_000);

  it('stops a run while it streams to the Transcript', async () => {
    const own = armedSession();
    installTranscriptSink(own);
    const code =
      "[Transcript nextPutAll: 'streaming'. [true] whileTrue: [nil]] on: Break do: [:e | e resume]";
    let wroteOnce: () => void = () => {};
    const onWorker = new Promise<void>((resolve) => (wroteOnce = resolve));
    let cancel: (() => void) | undefined;
    startClientForwarderMode(own, code);
    const run = runNbCall(
      own,
      () => own.GciTsNbExecute(code, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, 0, 0),
      (signal) => settleNbResult(own, () => wroteOnce(), signal),
      {
        suppressNotification: true,
        disposableProcess: true,
        onStart: (c) => (cancel = c),
        onAbandonedCollected: () => endClientForwarderMode(own),
      },
    );
    run.catch(() => {});
    await onWorker;
    cancel!();
    await expect(run).rejects.toBeInstanceOf(NbCancelledError);

    await expect(forceStop(own, deps)).resolves.toBe(true);
    expect(own.executeAndFetchString("Transcript nextPutAll: 'after'. (3 + 4) printString")).toBe(
      '7',
    );
  }, 30_000);

  it('says a run that catches every exception is still going, and re-arms once it ends', async () => {
    setStoppedRunCollectedHandler(rearmAfterForceStop);
    const own = armedSession();
    await stopAndAbandon(
      own,
      '| t | t := Time millisecondClockValue. ' +
        '[[(Time millisecondClockValue - t) < 9000] whileTrue: [nil]] on: Exception do: [:e | e resume]',
    );

    await expect(forceStop(own, deps)).resolves.toBe(false);
    expect(stoppedRunHolds(own)).toBe(true);

    const deadline = Date.now() + 15_000;
    while (stoppedRunHolds(own) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(stoppedRunHolds(own)).toBe(false);
    expect(armed(own)).toBe('true');
  }, 40_000);
});
