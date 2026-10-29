import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type { ActiveSession } from '../activeSession';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import {
  killableGems,
  killStoneSession,
  listStoneSessions,
  StoneSession,
  StoneSessionList,
  stopStoneSession,
  STOP_SESSION_WAIT_MS,
  TransientLogin,
} from '../stoneSessions';
import { isThisMachine } from '../thisMachine';
import { wslExec, wslExecSync } from '../wslBridge';
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

  // Kill is offered only on a row Jasper judges to be on this machine, from the
  // host the stone reports — on Windows, a gem inside WSL.
  it('places a gem of this machine on this machine', () => {
    const { serial } = otherSession();
    expect(isThisMachine(rowFor(listStoneSessions(loginAs()), serial)!.host)).toBe(true);
  });

  it('says whether the login may stop sessions, which takes SystemControl too', () => {
    const list = listStoneSessions(loginAs());
    if (list.kind !== 'sessions') throw new Error(list.kind);
    const hasIt = session.executeAndFetchString(
      '(System myUserProfile privileges includes: #SystemControl) printString',
    );
    expect(list.canStopSessions).toBe(hasIt === 'true');
  });

  // On Windows the gems, and so the check, are inside WSL.
  it('offers Kill on a gem this OS user runs, and not on a process it may not signal', () => {
    const { serial } = otherSession();
    const row = rowFor(listStoneSessions(loginAs()), serial)!;
    // Process 1 is init, which only root may signal.
    const init = { ...row, gemPid: 1 };

    const killable = killableGems([row, init], session.login.gem_host, isThisMachine, (command) =>
      wslExecSync(command),
    );

    // WSL on a CI runner can run as root, which may signal anything.
    const root = wslExecSync('id -u').trim() === '0';
    expect(killable).toEqual(new Set(root ? [row.gemPid, 1] : [row.gemPid]));
  });

  // Building a backlog would take real commits, which tests must not make; the
  // flag itself is pinned in the unit tests and by hand.
  it("reports the stone's commit-record backlog and the size at which it asks for aborts", () => {
    const { serial } = otherSession();
    const threshold = Number(
      session.executeAndFetchString(
        '(System stoneConfigurationAt: #StnSignalAbortCrBacklog) printString',
      ),
    );

    const list = listStoneSessions(loginAs());

    if (list.kind !== 'sessions') throw new Error(list.kind);
    expect(list.abortThreshold).toBe(threshold);
    expect(list.commitRecordBacklog).toBeGreaterThanOrEqual(0);
    expect(typeof rowFor(list, serial)!.holdsOldestCommitRecord).toBe('boolean');
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

  // A gem frozen for good is stood in for by one held with SIGSTOP, sent where
  // the gems run: inside WSL on Windows.
  it("says so when a frozen gem doesn't answer the stop", async () => {
    const { serial } = otherSession();
    const row = rowFor(listStoneSessions(loginAs()), serial)!;
    wslExecSync(`kill -STOP ${row.gemPid}`);
    try {
      await expect(stopStoneSession(row, loginAs())).resolves.toBe('stuck');
    } finally {
      wslExecSync(`kill -CONT ${row.gemPid}`);
    }
  }, 30_000);

  describe('Kill', () => {
    const shell = (command: string) => wslExec(command);

    it("ends a session busy with a run that ignores breaks, by its gem's process", async () => {
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

      await expect(killStoneSession(row, loginAs(), shell)).resolves.toBe('ended');
      expect(stillOnStone(session, String(serial))).toBe(false);
    }, 30_000);

    it('ends a gem frozen for good, which only SIGKILL reaches', async () => {
      const { serial } = otherSession();
      const row = rowFor(listStoneSessions(loginAs()), serial)!;
      wslExecSync(`kill -STOP ${row.gemPid}`);

      await expect(killStoneSession(row, loginAs(), shell)).resolves.toBe('ended');
      expect(stillOnStone(session, String(serial))).toBe(false);
      expect(listStoneSessions(loginAs()).kind).toBe('sessions');
    }, 30_000);

    it('leaves alone a session that has already ended, signalling nothing', async () => {
      const { own, serial } = otherSession();
      const row = rowFor(listStoneSessions(loginAs()), serial)!;
      own.logout();
      const deadline = Date.now() + 5000;
      while (stillOnStone(session, String(serial)) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const commands: string[] = [];

      await expect(
        killStoneSession(row, loginAs(), async (command) => {
          commands.push(command);
          return await shell(command);
        }),
      ).resolves.toBe('gone');
      expect(commands).toEqual([]);
    }, 30_000);
  });
});
