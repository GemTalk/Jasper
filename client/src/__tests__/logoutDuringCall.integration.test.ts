import { describe, it, expect, onTestFinished, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type { ActiveSession } from '../activeSession';
import { GciLibrary } from '../gciLibrary';
import { GCI_ERR_OP_IN_PROGRESS, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { SessionManager } from '../sessionManager';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';
import { endGemAfterTest, stillOnStone } from './leftoverGem';
import {
  isVersionKnownBroken,
  knownGemStoneBugs,
  skipForKnownGemStoneBug,
} from './knownGemStoneBugs';
import { reportedSerialOf, reportedTransientLogin, reportingLoginsOf } from './sessionGateClient';

/**
 * A logout while a call on the session is still running on a worker thread.
 *
 * Nothing here waits a fixed time. The call reports that GemStone is running
 * it, and finishes when told to, through shared counters: every session sees
 * them at once, without a commit. Each counter has one writer, so "finish"
 * can't be overwritten by a "started" that comes later.
 */
describe('a logout while a call runs on a worker thread (integration)', () => {
  let gci: GciLibrary;
  let session: ActiveSession;

  useIntegrationTest(
    (testContext) => {
      gci = testContext.gciLibrary;
      session = testActiveSession(testContext.gciLibrary, testContext.session);
    },
    // This file's own session, the busy one, and the short login that ends a leftover gem.
    { sessions: 3 },
  );

  const STARTED = 998;
  const FINISH = 999;

  function counter(index: number): number {
    return Number(session.executeAndFetchString(`(System sharedCounter: ${index}) printString`));
  }

  function setCounter(index: number, value: number): void {
    session.executeAndFetchString(`System sharedCounter: ${index} setValue: ${value}. ''`);
  }

  /**
   * A block on `own` that writes a token of its own to STARTED when it starts,
   * then waits until FINISH holds that token. `finish` is registered to run
   * when the test ends too, so a failure never leaves the gem waiting.
   */
  function waitingBlock(own: ActiveSession): {
    block: bigint;
    started: () => Promise<void>;
    finish: () => void;
  } {
    const token = 1 + Math.floor(Math.random() * 2 ** 29);
    const { result: block, err } = own.GciTsExecute(
      `[System sharedCounter: ${STARTED} setValue: ${token}. ` +
        `[(System sharedCounter: ${FINISH}) = ${token}] whileFalse: [(Delay forMilliseconds: 10) wait]. 42]`,
      OOP_CLASS_UTF8,
      OOP_ILLEGAL,
      OOP_NIL,
      0,
      0,
    );
    if (err.number !== 0) throw new Error(`Could not build the block: ${err.message}`);
    const finish = () => setCounter(FINISH, token);
    onTestFinished(finish);
    const started = () =>
      vi.waitFor(() => expect(counter(STARTED)).toBe(token), { timeout: 20_000, interval: 20 });
    return { block, started, finish };
  }

  function busyLogin(): ActiveSession {
    const { session: own, err } = reportedTransientLogin(session);
    if (!own) throw new Error(`Transient login failed: ${err.message}`);
    endGemAfterTest(() => session, own);
    return own;
  }

  async function leavesTheStone(serial: string): Promise<void> {
    await vi.waitFor(() => expect(stillOnStone(session, serial)).toBe(false), {
      timeout: 20_000,
      interval: 100,
    });
  }

  it('is refused while the call runs, whether or not GemStone says why, and goes through once it returns', async () => {
    const own = busyLogin();
    const serial = reportedSerialOf(own);
    const waiting = waitingBlock(own);
    const call = own.GciTsPerformAsync(waiting.block, OOP_ILLEGAL, 'value', [], 0, 0);
    await waiting.started();

    const whileRunning = own.logout();
    waiting.finish();
    await call;
    const afterwards = own.logout();

    expect({ whileRunning, afterwards }).toEqual({ whileRunning: false, afterwards: true });
    await leavesTheStone(serial);
  }, 60_000);

  it('is refused by GemStone too, with error 2203', async (ctx) => {
    skipForKnownGemStoneBug(knownGemStoneBugs.logoutRefusalUnexplained, ctx, session);
    const own = busyLogin();
    const serial = reportedSerialOf(own);
    const waiting = waitingBlock(own);
    // The handle the call runs on, for a logout that goes past Jasper's own refusal.
    const perform = vi.spyOn(gci, 'GciTsPerformAsync');
    const call = own.GciTsPerformAsync(waiting.block, OOP_ILLEGAL, 'value', [], 0, 0);
    const handle = perform.mock.calls[0][0];
    perform.mockRestore();
    await waiting.started();

    const { success, err } = gci.GciTsNbLogout(handle);
    waiting.finish();
    await call;
    // A logout that went through freed the handle; endGemAfterTest ends the gem then.
    if (!success) own.logout();

    expect({ success, number: err.number }).toEqual({
      success: false,
      number: GCI_ERR_OP_IN_PROGRESS,
    });
    expect(err.message).not.toBe('');
    await leavesTheStone(serial);
  }, 60_000);

  it('ends the gem when GemStone fails the logout without saying why', async (ctx) => {
    const [version] = session.executeAndFetchString('System gemVersionAt: #gsVersion').split('|');
    ctx.skip(
      !isVersionKnownBroken(knownGemStoneBugs.logoutRefusalUnexplained, version),
      'skipping: only a release that fails a logout without an error number reaches this path',
    );
    const manager = reportingLoginsOf(new SessionManager());
    const own = manager.login(session.login, process.env.VITE_GEMSTONE_GCI_LIBRARY_PATH!);
    const serial = reportedSerialOf(own);
    endGemAfterTest(() => session, own);
    // A call Jasper does not count, so the logout reaches GemStone: started on
    // the library directly, with the session's handle and library taken from a
    // counted call that has already returned.
    const perform = vi.spyOn(GciLibrary.prototype, 'GciTsPerformAsync');
    await own.GciTsPerformAsync(
      own.GciTsExecute('nil', OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, 0, 0).result,
      OOP_ILLEGAL,
      'printString',
      [],
      0,
      0,
    );
    const library = perform.mock.contexts[0] as GciLibrary;
    const handle = perform.mock.calls[0][0];
    perform.mockRestore();
    const waiting = waitingBlock(own);
    const uncounted = library.GciTsPerformAsync(
      handle,
      waiting.block,
      OOP_ILLEGAL,
      'value',
      [],
      0,
      0,
    );
    onTestFinished(async () => {
      await uncounted.catch(() => {});
    });
    await waiting.started();

    await expect(manager.logout(own.id)).resolves.toBe(true);

    expect(manager.getSession(own.id)).toBeUndefined();
    await leavesTheStone(serial);
  }, 60_000);
});
