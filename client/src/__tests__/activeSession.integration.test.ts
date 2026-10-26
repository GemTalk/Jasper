import { describe, it, expect, onTestFinished, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type { ActiveSession } from '../activeSession';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { runNbCall } from '../nbRunner';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';

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
    session.executeAndFetchString(`System stopSession: ${id}. 'ok'`);
    // The stone deregisters the stopped gem asynchronously, and a loaded machine
    // can take past waitFor's default second. 4s stays inside the test's own 5s.
    await vi.waitFor(
      () =>
        expect(
          session.executeAndFetchString(`(System currentSessions includes: ${id}) printString`),
        ).toBe('false'),
      { timeout: 4_000 },
    );
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

  const listed = (serial: string) =>
    session.executeAndFetchString(`(System currentSessions includes: ${serial}) printString`) ===
    'true';

  /** Polls until `serial` is off the stone, or fails after `ms`; never a hung test. */
  async function expectOffTheStone(serial: string, ms = 10_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (listed(serial) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(listed(serial)).toBe(false);
  }

  function transientWithSerial(): { transient: ActiveSession; serial: string } {
    const { session: transient, err } = session.transientLogin(session.login);
    if (!transient) throw new Error(`Transient login failed: ${err.message}`);
    const serial = transient.executeAndFetchString('System session printString');
    // Ends a gem the test leaves behind, so a failure can't strand it.
    onTestFinished(() => {
      if (listed(serial)) session.executeAndFetchString(`System stopSession: ${serial}. 'ok'`);
    });
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
