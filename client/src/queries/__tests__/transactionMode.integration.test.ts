// Transaction modes against a live stone.
//
// The enablement rules this feature is built on (queries/transactionMode.ts) are
// stated in terms of `System inTransaction` rather than the mode, which departs
// from how Jadeite for Dolphin states the same rules. This suite is the evidence
// for that: it pins what each mode actually does on the stone under test, so a
// future GemStone release that changes any of it fails here rather than quietly
// making the UI lie about what Commit will do.
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import { QueryExecutor } from '../types';
import {
  ERR_NOT_IN_TRANSACTION,
  TRANSACTION_MODES,
  TransactionMode,
  VIEW_REFRESH_CODE,
  getGemAutoServiceSigAbort,
  getTransactionState,
  setGemAutoServiceSigAbort,
  setTransactionMode,
} from '../transactionMode';

describe('transaction modes on a live stone', () => {
  let gci: GciLibrary;
  let session: unknown;
  let execute: QueryExecutor;

  useIntegrationTest(({ gciLibrary, session: s }) => {
    gci = gciLibrary;
    session = s;
    execute = async (code) => gci.executeAndFetchString(session, code);
  });

  // Every test here moves the session's mode, and the mode outlives the
  // harness's per-test transaction — it is session state, not transactional
  // state. Put it back so the next test starts where the harness expects.
  afterEach(async () => {
    await setTransactionMode(execute, 'autoBegin');
  });

  // Read through the one query production uses, so this suite's evidence is
  // evidence about that query too.
  const currentMode = async () => (await getTransactionState(execute)).mode;
  const inTransaction = async () => (await getTransactionState(execute)).inTransaction;

  /** The error number `code` raises, or 0 when it raises nothing. */
  async function errorNumberFrom(code: string): Promise<number> {
    return Number(
      (await execute(`([${code}. 0] on: Error do: [:ex | ex number]) printString`)).trim(),
    );
  }

  it('reads back every mode it sets, exactly as GemStone spells it', async () => {
    for (const mode of TRANSACTION_MODES) {
      expect(await setTransactionMode(execute, mode)).toBe(mode);
      expect(await currentMode()).toBe(mode);
    }
  });

  it('logs in somewhere a mode is set, rather than nowhere', async () => {
    // Not asserted to be autoBegin: STN_GEM_INITIAL_TRANSACTION_MODE can hand
    // out any of the three, which is exactly why Jasper reads it rather than
    // assuming. What must hold is that the answer is one Jasper recognizes.
    expect(TRANSACTION_MODES).toContain(await currentMode());
  });

  it('leaves the session outside a transaction under manualBegin, and a begin puts it back in', async () => {
    await setTransactionMode(execute, 'manualBegin');
    expect(await inTransaction()).toBe(false);

    gci.beginTransaction(session);
    expect(await inTransaction()).toBe(true);

    gci.abortTransaction(session);
    expect(await inTransaction()).toBe(false);
  });

  it('keeps the session inside a transaction under autoBegin, whatever it does', async () => {
    await setTransactionMode(execute, 'autoBegin');
    expect(await inTransaction()).toBe(true);

    // An abort under autoBegin immediately opens the next transaction, which is
    // why Commit is always available there.
    gci.abortTransaction(session);
    expect(await inTransaction()).toBe(true);
  });

  it('reads the mode and the transaction state together consistently', async () => {
    await setTransactionMode(execute, 'manualBegin');

    expect(await getTransactionState(execute)).toEqual({
      mode: 'manualBegin',
      inTransaction: false,
    });
  });

  // This is the rule `canCommit` encodes, and the reason it is written against
  // `inTransaction` instead of the mode: the stone refuses a commit on exactly
  // this condition, in every mode.
  it('refuses a commit outside a transaction, in every mode that allows being outside one', async () => {
    for (const mode of ['manualBegin', 'transactionless'] as TransactionMode[]) {
      await setTransactionMode(execute, mode);
      expect(await inTransaction()).toBe(false);
      expect(await errorNumberFrom('System commitTransaction')).toBe(ERR_NOT_IN_TRANSACTION);
    }
  });

  it('allows an abort outside a transaction — which is why Abort is never hidden', async () => {
    await setTransactionMode(execute, 'manualBegin');

    expect(await errorNumberFrom('System abortTransaction')).toBe(0);
  });

  // Not what the mode's name or the manual implies, and the reason Jadeite's
  // mode-shaped Commit rule would be wrong here: under transactionless an
  // explicit begin really does enter a transaction, and a commit from inside it
  // is accepted. `canCommit` follows the session's state, so it says yes; the
  // UI still does not *offer* Begin there (see canBegin).
  it('still enters a transaction on an explicit begin under transactionless', async () => {
    await setTransactionMode(execute, 'transactionless');
    expect(await inTransaction()).toBe(false);

    gci.beginTransaction(session);

    expect(await inTransaction()).toBe(true);
    // ...and the stone agrees: no 2030 from a commit attempt in this state. The
    // harness's own commit guard stops it going further, which is its job.
    expect(await errorNumberFrom('System commitTransaction')).not.toBe(ERR_NOT_IN_TRANSACTION);
  });

  // What is deliberately NOT covered here: an end-to-end SigAbort, where the stone
  // actually asks for its commit record back and the gem answers. That needs a
  // commit-record backlog past StnSignalAbortCrBacklog — hundreds of commits from
  // a second, unguarded session, against a stone config this suite does not
  // control. DelayAutoServiceSigAbort exists to make the 3007 delivery testable,
  // but it only delays a signal the stone must still send, so it does not make
  // the expensive half cheap. Covered instead: that the option arms, that the
  // session is the remote client the option requires, and (as a unit test, in
  // gciLibraryError.test.ts) that 3007 and 3008 read as a refreshed view.
  it('is a remote client, which is what makes GemAutoServiceSigAbort apply', async () => {
    // The whole SigAbort answer rests on this: the option is documented to apply
    // only where System clientIsRemote is true. Jasper logs in through a netldi
    // gemnetobject task, so it does — but a linked login would not, and this is
    // where that would be noticed.
    expect((await execute('System clientIsRemote printString')).trim()).toBe('true');
  });

  it('arms the gem’s own SigAbort servicing, and reads it back', async () => {
    await setGemAutoServiceSigAbort(execute, true);
    expect(await getGemAutoServiceSigAbort(execute)).toBe(true);

    await setGemAutoServiceSigAbort(execute, false);
    expect(await getGemAutoServiceSigAbort(execute)).toBe(false);
  });

  describe('the view refresh Jasper’s background reads use', () => {
    it('aborts to refresh when the session is clean and in an autoBegin transaction', async () => {
      await setTransactionMode(execute, 'autoBegin');

      expect((await execute(VIEW_REFRESH_CODE)).trim()).toBe('refreshed');
    });

    it.each(['manualBegin', 'transactionless'] as const)(
      'stands down inside a transaction the user began by hand under %s',
      async (mode) => {
        await setTransactionMode(execute, mode);
        gci.beginTransaction(session);

        expect((await execute(VIEW_REFRESH_CODE)).trim()).toBe(
          'skipped: session is inside a transaction begun by hand',
        );
        // ...and really did not end it.
        expect(await inTransaction()).toBe(true);
      },
    );

    it('stands down when the session holds uncommitted changes', async () => {
      await setTransactionMode(execute, 'autoBegin');
      await execute("UserGlobals at: #jasperTransactionModeProbe put: 1. 'written'");
      expect((await execute('System needsCommit printString')).trim()).toBe('true');

      expect((await execute(VIEW_REFRESH_CODE)).trim()).toBe(
        'skipped: uncommitted changes present',
      );
      // The write is still there — nothing was discarded. (The harness's abort
      // takes it away at the end of the test; it was never committed.)
      expect(
        (
          await execute('(UserGlobals includesKey: #jasperTransactionModeProbe) printString')
        ).trim(),
      ).toBe('true');
    });
  });
});
