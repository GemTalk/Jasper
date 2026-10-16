import { describe, it, expect, onTestFinished, vi } from 'vitest';
import type { ActiveSession } from '../activeSession';
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

  it('refuses calls once a logout fails on a gem the stone already stopped', async () => {
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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());

    stopped.logout();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('GciTsLogout failed'));
    expect(() => stopped.GciTsFetchSize(1n)).toThrow(loggedOutError);
  });

  it('refuses a second logout', () => {
    const loggedOut = loggedOutSession();

    expect(() => loggedOut.logout()).toThrow(loggedOutError);
  });
});
