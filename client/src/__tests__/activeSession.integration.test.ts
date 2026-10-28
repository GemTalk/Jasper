import { describe, it, expect, onTestFinished, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type { ActiveSession } from '../activeSession';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, GS_ERR_HALT } from '../gciConstants';
import { pollNbResultReady, runNbCall } from '../nbRunner';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';
import { endGemAfterTest, loginSerialOf, stillOnStone } from './leftoverGem';

/**
 * Each call below would hand a freed native session to the GCI library if it
 * got that far, which is undefined behavior: the 3.7.x GciTsNbPoll and the
 * 3.6.2 GciTsNbResult crash the process. Passing means the session refused
 * the call before reaching the library.
 */
describe('a logged-out session (integration)', () => {
  let session: ActiveSession;

  useIntegrationTest((testContext) => {
    session = testActiveSession(testContext.gciLibrary, testContext.session);
  });

  function transientSession(): ActiveSession {
    const { session: transient, err } = session.transientLogin(session.login);
    if (!transient) throw new Error(`Transient login failed: ${err.message}`);
    return transient;
  }

  function loggedOutSession(): ActiveSession {
    const transient = transientSession();
    transient.logout();
    return transient;
  }

  const loggedOutError = 'The GemStone session is logged out.';

  it('refuses a raw GCI call', () => {
    const loggedOut = loggedOutSession();

    expect(() => loggedOut.GciTsFetchSize(1n)).toThrow(loggedOutError);
  });

  it('refuses to collect a non-blocking result', () => {
    const loggedOut = loggedOutSession();

    expect(() => loggedOut.GciTsNbResult()).toThrow(loggedOutError);
  });

  it('refuses to poll for a non-blocking result', () => {
    const loggedOut = loggedOutSession();

    expect(() => loggedOut.GciTsNbPoll(0)).toThrow(loggedOutError);
  });

  it('refuses to evaluate code', () => {
    const loggedOut = loggedOutSession();

    expect(() => loggedOut.executeAndFetchString('3 + 4')).toThrow(loggedOutError);
  });

  it('refuses calls once a gem the stone already stopped is logged out', async () => {
    const stopped = transientSession();
    const id = stopped.executeAndFetchString('System session printString');
    const serial = loginSerialOf(stopped);
    session.executeAndFetchString(`System stopSession: ${id}. 'ok'`);
    // The stone deregisters the stopped gem asynchronously, and a loaded machine
    // can take past waitFor's default second. 4s stays inside the test's own 5s.
    await vi.waitFor(() => expect(stillOnStone(session, serial)).toBe(false), { timeout: 4_000 });
    // Succeeds, since it doesn't wait for the gem; the session must still refuse
    // every call afterwards.
    stopped.logout();

    expect(() => stopped.GciTsFetchSize(1n)).toThrow(loggedOutError);
  });

  it('refuses a second logout', () => {
    const loggedOut = loggedOutSession();

    expect(() => loggedOut.logout()).toThrow(loggedOutError);
  });

  it('rejects a non-blocking call that is outstanding when the session logs out', async () => {
    const transient = transientSession();
    let started = false;
    const runningCall = runNbCall(
      transient,
      // Shorter than the test's 5s timeout, so a call the logout fails to settle
      // resolves and fails the assertion instead of timing the test out.
      () =>
        transient.GciTsNbExecute(
          '(Delay forSeconds: 3) wait',
          OOP_CLASS_UTF8,
          OOP_ILLEGAL,
          OOP_NIL,
          0,
          0,
        ),
      () => transient.GciTsNbResult(),
      {
        suppressNotification: true,
        onStart: () => {
          started = true;
        },
      },
    );
    // A logout the session refuses leaves it alive, so cleanup can't trust that
    // the logout below took effect.
    onTestFinished(async () => {
      await runningCall.catch(() => {});
      try {
        transient.logout();
      } catch (e) {
        if (!(e instanceof Error && e.message === loggedOutError)) throw e;
      }
    });
    // A logout that lands before the call starts would reject it with the same
    // error, passing without ever covering an outstanding call.
    expect(started).toBe(true);

    transient.logout();

    await expect(runningCall).rejects.toThrow(loggedOutError);
  });
});

describe('logging out never waits for the gem (integration)', () => {
  let session: ActiveSession;

  useIntegrationTest((testContext) => {
    session = testActiveSession(testContext.gciLibrary, testContext.session);
  });

  /** Polls until `serial` is off the stone, or fails after `ms`; never a hung test. */
  async function expectOffTheStone(serial: string, ms = 10_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (stillOnStone(session, serial) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(stillOnStone(session, serial)).toBe(false);
  }

  function transientWithSerial(): { transient: ActiveSession; serial: string } {
    const { session: transient, err } = session.transientLogin(session.login);
    if (!transient) throw new Error(`Transient login failed: ${err.message}`);
    const serial = loginSerialOf(transient);
    // Ends a gem the test leaves behind, so a failure can't strand it.
    endGemAfterTest(() => session, transient);
    return { transient, serial };
  }

  it('returns at once while a run that ignores stops is going, and the gem leaves', async () => {
    const { transient, serial } = transientWithSerial();
    const runningCall = runNbCall(
      transient,
      () =>
        transient.GciTsNbExecute(
          '[[true] whileTrue: [nil]] on: Break do: [:e | e resume]',
          OOP_CLASS_UTF8,
          OOP_ILLEGAL,
          OOP_NIL,
          0,
          0,
        ),
      () => transient.GciTsNbResult(),
      { suppressNotification: true },
    );
    runningCall.catch(() => {});

    const startedAt = Date.now();
    expect(transient.logout()).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(1000);

    await expect(runningCall).rejects.toThrow('The GemStone session is logged out.');
    await expectOffTheStone(serial);
  }, 20_000);

  it('logs out an idle session, and the gem leaves', async () => {
    const { transient, serial } = transientWithSerial();

    expect(transient.logout()).toBe(true);

    await expectOffTheStone(serial);
  }, 20_000);
});

describe('whether a session is busy (integration)', () => {
  let session: ActiveSession;

  useIntegrationTest((testContext) => {
    session = testActiveSession(testContext.gciLibrary, testContext.session);
  });

  // Logging out with a non-blocking call outstanding frees the session too, so
  // a test can leave one behind.
  function transientSession(): ActiveSession {
    const { session: transient, err } = session.transientLogin(session.login);
    if (!transient) throw new Error(`Transient login failed: ${err.message}`);
    onTestFinished(() => {
      transient.logout();
    });
    return transient;
  }

  function startNonBlocking(on: ActiveSession, code: string): void {
    const { success, err } = on.GciTsNbExecute(code, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, 0, 0);
    if (!success) throw new Error(`Non-blocking start failed: ${err.message}`);
  }

  async function resultReady(on: ActiveSession): Promise<void> {
    for (;;) {
      const { result, err } = pollNbResultReady(on);
      if (result === 1) return;
      if (result === -1) throw new Error(`Polling for the result failed: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  function delayOn(on: ActiveSession, milliseconds: number): bigint {
    const { result, err } = on.GciTsExecute(
      `Delay forMilliseconds: ${milliseconds}`,
      OOP_CLASS_UTF8,
      OOP_ILLEGAL,
      OOP_NIL,
      0,
      0,
    );
    if (err.number !== 0) throw new Error(`Could not build the delay: ${err.message}`);
    return result;
  }

  // A logout is refused while a worker owns the session, so the session would
  // leak if a failed assertion skipped waiting for the call. onTestFinished
  // callbacks run last-registered first, so this wait runs before the logout
  // transientSession registered.
  function waitBeforeLogout<T>(call: Promise<T>): Promise<T> {
    onTestFinished(async () => {
      await call;
    });
    return call;
  }

  function startOnWorker(on: ActiveSession): Promise<unknown> {
    return waitBeforeLogout(on.GciTsPerformAsync(delayOn(on, 300), OOP_ILLEGAL, 'wait', [], 0, 0));
  }

  function resumeOnWorker(on: ActiveSession, process: bigint): Promise<unknown> {
    return waitBeforeLogout(on.GciTsContinueWithAsync(process, OOP_ILLEGAL, null, 0));
  }

  function pausedProcess(on: ActiveSession, code: string): bigint {
    const { err } = on.GciTsExecute(
      `self pause. ${code}`,
      OOP_CLASS_UTF8,
      OOP_ILLEGAL,
      OOP_NIL,
      0,
      0,
    );
    if (err.number !== GS_ERR_HALT) throw new Error(`The process did not pause: ${err.message}`);
    return BigInt(err.context);
  }

  it('is free right after login', () => {
    const transient = transientSession();

    expect(transient.isBusy()).toBe(false);
  });

  it('is busy while code it started without waiting is still running', () => {
    const transient = transientSession();

    startNonBlocking(transient, '(Delay forSeconds: 1) wait');

    expect(transient.isBusy()).toBe(true);
  });

  it('is busy while a message it sent without waiting is still running', () => {
    const transient = transientSession();
    const delay = delayOn(transient, 1000);

    const { success, err } = transient.GciTsNbPerform(delay, OOP_ILLEGAL, 'wait', [], 0, 0);

    expect(success, err.message).toBe(true);
    expect(transient.isBusy()).toBe(true);
  });

  it('stays busy after code started without waiting finishes, until its answer is read', async () => {
    const transient = transientSession();
    startNonBlocking(transient, 'true');

    await resultReady(transient);

    expect(transient.isBusy()).toBe(true);
  });

  it('is free once the answer to code started without waiting is read', async () => {
    const transient = transientSession();
    startNonBlocking(transient, 'true');
    await resultReady(transient);

    transient.GciTsNbResult();

    expect(transient.isBusy()).toBe(false);
  });

  it('is free once the error from code started without waiting is read', async () => {
    const transient = transientSession();
    startNonBlocking(transient, '1/0');
    await resultReady(transient);

    const { err } = transient.GciTsNbResult();

    expect(err.number).not.toBe(0);
    expect(transient.isBusy()).toBe(false);
  });

  it('is busy while a message send runs on another thread', () => {
    const transient = transientSession();

    void startOnWorker(transient);

    expect(transient.isBusy()).toBe(true);
  });

  it('is busy while a paused process resumes on another thread', () => {
    const transient = transientSession();
    const process = pausedProcess(transient, '(Delay forMilliseconds: 300) wait');

    void resumeOnWorker(transient, process);

    expect(transient.isBusy()).toBe(true);
  });

  it('is free once a call on another thread finishes', async () => {
    const transient = transientSession();

    await startOnWorker(transient);

    expect(transient.isBusy()).toBe(false);
  });

  // Without the refusal, each of these crashes the process instead of failing:
  // the 3.7.x GciTsNbPoll and the 3.6.2 GciTsNbResult.
  it('refuses to poll for a non-blocking result while a message send runs on another thread', () => {
    const transient = transientSession();
    void startOnWorker(transient);

    const poll = () => transient.GciTsNbPoll(0);

    expect(poll).toThrow('would crash the GCI library');
  });

  it('refuses to collect a non-blocking result while a message send runs on another thread', () => {
    const transient = transientSession();
    void startOnWorker(transient);

    const collect = () => transient.GciTsNbResult();

    expect(collect).toThrow('would crash the GCI library');
  });

  it('refuses to poll for a non-blocking result while a paused process resumes on another thread', () => {
    const transient = transientSession();
    const process = pausedProcess(transient, '(Delay forMilliseconds: 300) wait');
    void resumeOnWorker(transient, process);

    const poll = () => transient.GciTsNbPoll(0);

    expect(poll).toThrow('would crash the GCI library');
  });

  it('refuses to collect a non-blocking result while a paused process resumes on another thread', () => {
    const transient = transientSession();
    const process = pausedProcess(transient, '(Delay forMilliseconds: 300) wait');
    void resumeOnWorker(transient, process);

    const collect = () => transient.GciTsNbResult();

    expect(collect).toThrow('would crash the GCI library');
  });

  // The send on the other thread is collected against in the same tick it
  // starts, so it still counts. Whether GemStone then refuses it or runs it
  // after the collect depends on when its thread gets there, so the test
  // doesn't assert either.
  it('collects a non-blocking result that was outstanding when a send on another thread started', async () => {
    const transient = transientSession();
    const delay = delayOn(transient, 300);
    startNonBlocking(transient, '3 + 4');
    await resultReady(transient);
    void waitBeforeLogout(transient.GciTsPerformAsync(delay, OOP_ILLEGAL, 'wait', [], 0, 0));

    const { result, err } = transient.GciTsNbResult();

    expect(err.number, err.message).toBe(0);
    expect(transient.GciTsOopToI64(result).value).toBe(7n);
  });

  it('polls for a non-blocking result that was outstanding when a send on another thread started', async () => {
    const transient = transientSession();
    const delay = delayOn(transient, 300);
    startNonBlocking(transient, '3 + 4');
    await resultReady(transient);
    void waitBeforeLogout(transient.GciTsPerformAsync(delay, OOP_ILLEGAL, 'wait', [], 0, 0));

    const { result, err } = pollNbResultReady(transient);

    expect(err.number, err.message).toBe(0);
    expect(result).toBe(1);
  });

  it('polls for and collects a non-blocking result again once a call on another thread finishes', async () => {
    const transient = transientSession();
    await startOnWorker(transient);
    startNonBlocking(transient, '3 + 4');
    await resultReady(transient);

    const { result, err } = transient.GciTsNbResult();

    expect(err.number, err.message).toBe(0);
    expect(transient.GciTsOopToI64(result).value).toBe(7n);
  });
});
