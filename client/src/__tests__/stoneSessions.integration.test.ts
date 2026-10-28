import { describe, it, expect, vi } from 'vitest';
import { execSync } from 'child_process';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type { ActiveSession } from '../activeSession';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import {
  listStoneSessions,
  StoneSession,
  StoneSessionList,
  stopStoneSession,
  STOP_SESSION_WAIT_MS,
  TransientLogin,
} from '../stoneSessions';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';
import { endGemAfterTest, loginSerialOf, stillOnStone } from './leftoverGem';

describe('Stone sessions (integration)', () => {
  let session: ActiveSession;

  useIntegrationTest((testContext) => {
    session = testActiveSession(testContext.gciLibrary, testContext.session);
  });

  const loginAs =
    (login = session.login): TransientLogin =>
    () => {
      const { session: own, err } = session.transientLogin(login);
      if (!own) throw new Error(`Login failed: ${err.message}`);
      return { session: own, logout: () => void own.logout() };
    };

  /** A session of its own, whose gem is ended whatever the test does. */
  function otherSession(): { own: ActiveSession; serial: number } {
    const { session: own } = loginAs()();
    endGemAfterTest(() => session, own);
    return { own, serial: Number(loginSerialOf(own)) };
  }

  function rowFor(list: StoneSessionList, serial: number): StoneSession | undefined {
    if (list.kind !== 'sessions') throw new Error(`Expected sessions, got ${list.kind}`);
    return list.sessions.find((s) => s.serial === serial);
  }

  it("lists another login's session, with its user, gem process and host", () => {
    const { own, serial } = otherSession();
    const pid = Number(
      own.executeAndFetchString(
        '((System descriptionOfSession: System session) at: 2) printString',
      ),
    );

    const list = listStoneSessions(loginAs());

    expect(rowFor(list, serial)).toMatchObject({
      user: session.login.gs_user,
      gemPid: pid,
      transaction: expect.stringMatching(/^(in|out|transactionless)$/),
    });
    expect(rowFor(list, serial)!.host).not.toBe('');
  });

  it("names GemStone's own gems, and leaves out the login it reads through", () => {
    let reader: number | undefined;
    const list = listStoneSessions(() => {
      const login = loginAs()();
      reader = Number(login.session.executeAndFetchString('System session printString'));
      return login;
    });
    if (list.kind !== 'sessions') throw new Error(list.kind);

    expect(list.sessions.some((s) => s.systemGem === 'symbolgem')).toBe(true);
    const ids = list.sessions.map((s) => s.id);
    expect(ids).not.toContain(reader);
    expect(ids).toContain(Number(session.executeAndFetchString('System session printString')));
    expect(list.sessions.every((s) => s.loggedInAt <= list.serverNow)).toBe(true);
  });

  it('stops an idle session', async () => {
    const { serial } = otherSession();
    const row = rowFor(listStoneSessions(loginAs()), serial)!;

    await expect(stopStoneSession(row, loginAs())).resolves.toBe('ended');
    expect(stillOnStone(session, String(serial))).toBe(false);
  }, 30_000);

  it('stops a session busy with a run that ignores breaks', async () => {
    const { own, serial } = otherSession();
    own.GciTsNbExecute(
      '[[true] whileTrue: [nil]] on: Break do: [:e | e resume]',
      OOP_CLASS_UTF8,
      OOP_ILLEGAL,
      OOP_NIL,
      0,
      0,
    );
    const row = rowFor(listStoneSessions(loginAs()), serial)!;

    const startedAt = Date.now();
    await expect(stopStoneSession(row, loginAs())).resolves.toBe('ended');
    expect(Date.now() - startedAt).toBeLessThan(STOP_SESSION_WAIT_MS);
  }, 30_000);

  it('answers that a session had already ended, touching nothing', async () => {
    const { own, serial } = otherSession();
    const row = rowFor(listStoneSessions(loginAs()), serial)!;
    own.logout();
    // The stone lets the gem go a moment after the logout returns.
    const deadline = Date.now() + 5000;
    while (stillOnStone(session, String(serial)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await expect(stopStoneSession(row, loginAs())).resolves.toBe('gone');
  }, 30_000);

  // A gem frozen for good is stood in for by one held with SIGSTOP, which
  // Windows has no way to do.
  it.skipIf(process.platform === 'win32')(
    "says so when a frozen gem doesn't answer the stop",
    async () => {
      const { serial } = otherSession();
      const row = rowFor(listStoneSessions(loginAs()), serial)!;
      execSync(`kill -STOP ${row.gemPid}`);
      try {
        await expect(stopStoneSession(row, loginAs())).resolves.toBe('stuck');
      } finally {
        execSync(`kill -CONT ${row.gemPid}`);
      }
    },
    30_000,
  );
});
