import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { window } from '../__mocks__/vscode';
import type { ActiveSession } from '../activeSession';
import { DEFAULT_LOGIN } from '../loginTypes';
import type { StoneSession, StoneSessionList } from '../stoneSessions';
import {
  KILL,
  REREAD_AFTER_LOGOUT_MS,
  STOP_SESSION,
  StoneSessions,
  StoneSessionsDeps,
  StoneSessionsInfo,
} from '../stoneSessionsView';

function makeSession(
  id: number,
  stone = DEFAULT_LOGIN.stone,
  gem_host = DEFAULT_LOGIN.gem_host,
): ActiveSession {
  return {
    id,
    login: { ...DEFAULT_LOGIN, gs_user: 'DataCurator', stone, gem_host },
  } as unknown as ActiveSession;
}

function stoneSession(overrides: Partial<StoneSession>): StoneSession {
  return {
    id: 1,
    serial: 1,
    user: 'DataCurator',
    gemPid: 100,
    host: 'localhost',
    loggedInAt: 0,
    transaction: 'out',
    holdsOldestCommitRecord: false,
    ...overrides,
  };
}

type Listed = Extract<StoneSessionList, { kind: 'sessions' }>;
const rowsOf = (info: StoneSessionsInfo) => {
  if (info.kind !== 'sessions') throw new Error(info.message);
  return info.rows;
};

describe("a stone's session list", () => {
  let windowSessions: ActiveSession[];
  let list: StoneSessionList;
  let stuck: Set<number>;
  let deps: StoneSessionsDeps & {
    read: ReturnType<typeof vi.fn<(through: ActiveSession) => StoneSessionList>>;
    killableGems: ReturnType<
      typeof vi.fn<(sessions: StoneSession[], stoneHost: string) => Set<number>>
    >;
    stop: ReturnType<typeof vi.fn<StoneSessionsDeps['stop']>>;
  };
  let sessions: StoneSessions;

  beforeEach(() => {
    vi.mocked(window.showWarningMessage).mockReset();
    windowSessions = [makeSession(1)];
    stuck = new Set();
    list = {
      kind: 'sessions',
      serverNow: 7200,
      commitRecordBacklog: 1,
      abortThreshold: 20,
      canStopSessions: true,
      sessions: [
        stoneSession({ id: 4, serial: 3, gemPid: 41022 }),
        stoneSession({ id: 5, serial: 9, user: 'ewinger', gemPid: 39811, host: 'thor' }),
        stoneSession({ id: 2, serial: 1, user: 'SymbolUser', systemGem: 'symbolgem' }),
      ],
    };
    deps = {
      read: vi.fn(() => list),
      killableGems: vi.fn(
        (all: StoneSession[]) =>
          new Set(all.filter((s) => s.host === 'localhost' && !s.systemGem).map((s) => s.gemPid)),
      ),
      stuck: (s) => stuck.has(s.id),
      // Jasper session 1 is GemStone's session 4, whose login is serial 3.
      loginSerialOf: (id) => (id === 1 ? '3' : undefined),
      transientLogin: vi.fn(),
      stop: vi.fn<StoneSessionsDeps['stop']>(async () => 'ended'),
      kill: vi.fn(async () => 'ended' as const),
      logout: vi.fn(async () => true),
    };
    sessions = new StoneSessions(deps);
  });

  const describeIt = () => sessions.describe('db:db-1', windowSessions[0], windowSessions);
  const listed = () => list as Listed;

  it('reads the list through a session of this window, then keeps it', () => {
    expect(rowsOf(describeIt())).toHaveLength(3);
    expect(deps.read).toHaveBeenCalledWith(windowSessions[0]);
    describeIt();
    expect(deps.read).toHaveBeenCalledTimes(1);
    expect(deps.killableGems).toHaveBeenCalledTimes(1);
  });

  // The stone calls gems on its own machine localhost; only the login says where that is.
  it('tells the Kill check which host the stone was reached at', () => {
    windowSessions = [makeSession(1, 'gs64stone', 'thor')];
    describeIt();
    expect(deps.killableGems).toHaveBeenCalledWith(listed().sessions, 'thor');
  });

  it('reads it again once forgotten, as Refresh and Stop do', () => {
    describeIt();
    sessions.forget('db:db-1');
    describeIt();
    sessions.forgetAll();
    describeIt();
    expect(deps.read).toHaveBeenCalledTimes(3);
  });

  it('reads it again once a session of this window logs in', () => {
    describeIt();
    windowSessions = [makeSession(1), makeSession(2)];
    describeIt();
    describeIt();
    expect(deps.read).toHaveBeenCalledTimes(2);
  });

  describe('after a session of this window logs out', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    // The stone lets the gem go a moment after the logout returns, so a read
    // straight after it can still list it.
    it('reads it again only a moment later, and says so', () => {
      windowSessions = [makeSession(1), makeSession(2)];
      describeIt();
      const changed = vi.fn();
      sessions.onDidChange(changed);
      windowSessions = [makeSession(1)];
      describeIt();
      describeIt();
      expect(deps.read).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(REREAD_AFTER_LOGOUT_MS);

      expect(changed).toHaveBeenCalledTimes(1);
      describeIt();
      expect(deps.read).toHaveBeenCalledTimes(2);
    });

    it('reads it at once when another session logs in at the same time', () => {
      windowSessions = [makeSession(1), makeSession(2)];
      describeIt();
      windowSessions = [makeSession(1), makeSession(3)];
      describeIt();
      expect(deps.read).toHaveBeenCalledTimes(2);
    });

    // Stop and Kill each log in and out to do their work.
    it('drops the ended rows at once, and reads it again only a moment after Stop and Kill', async () => {
      describeIt();
      const changed = vi.fn();
      sessions.onDidChange(changed);
      vi.mocked(window.showWarningMessage).mockResolvedValue(KILL);
      await sessions.kill('db:db-1', 3);
      vi.mocked(window.showWarningMessage).mockResolvedValue(STOP_SESSION);
      await sessions.stop('db:db-1', 9);
      expect(rowsOf(describeIt()).map((r) => r.serial)).toEqual([1]);
      expect(deps.read).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(REREAD_AFTER_LOGOUT_MS);

      expect(changed).toHaveBeenCalledTimes(2);
      describeIt();
      expect(deps.read).toHaveBeenCalledTimes(2);
    });

    it('keeps the row of a session that is still on the stone after Stop', async () => {
      describeIt();
      deps.stop.mockResolvedValue('stuck');
      vi.mocked(window.showWarningMessage).mockResolvedValue(STOP_SESSION);
      await sessions.stop('db:db-1', 9);
      expect(rowsOf(describeIt()).map((r) => r.serial)).toEqual([3, 9, 1]);
      expect(deps.read).toHaveBeenCalledTimes(1);
    });

    it('waits for nothing after a login', () => {
      describeIt();
      const changed = vi.fn();
      sessions.onDidChange(changed);
      windowSessions = [makeSession(1), makeSession(2)];
      describeIt();
      vi.advanceTimersByTime(REREAD_AFTER_LOGOUT_MS);
      expect(changed).not.toHaveBeenCalled();
    });
  });

  it('marks only sessions of this window on this stone, which numbers its own', () => {
    // Jasper session 3 is login serial 3 on another stone.
    deps.loginSerialOf = (id) => (id === 1 || id === 3 ? '3' : undefined);
    const mine = makeSession(1);
    const listed = sessions.describe('db:db-1', mine, [mine, makeSession(3, 'elsewhere')]);
    expect(rowsOf(listed)[0].jasperSessionId).toBe(1);

    sessions.forgetAll();
    const other = sessions.describe('db:db-1', makeSession(2), [makeSession(1, 'elsewhere')]);
    expect(rowsOf(other)[0].jasperSessionId).toBeUndefined();
  });

  // The stone gives a session number to the next login once a gem has gone,
  // even while the Jasper session that had it is still open here.
  it("doesn't mark a newer login that was given this window's session number", () => {
    list = {
      ...listed(),
      sessions: [stoneSession({ id: 4, serial: 30, user: 'ewinger', gemPid: 41500 })],
    };
    const [row] = rowsOf(describeIt());
    expect(row.jasperSessionId).toBeUndefined();
    expect(sessions.rowOf(1)).toBeUndefined();
  });

  it("shows each session's user, gem, host and age, and leaves them out of the tip", () => {
    expect(rowsOf(describeIt())[1]).toMatchObject({
      user: 'ewinger',
      gemPid: 39811,
      host: 'thor',
      age: '2h',
    });
    expect(rowsOf(describeIt())[1].tip).toBe('Not in a transaction.');
  });

  it("marks this window's own session, and offers Stop and Kill on it as on anyone's", () => {
    const [mine, other, system] = rowsOf(describeIt());
    expect(mine).toMatchObject({ jasperSessionId: 1, canStop: true, canKill: true });
    expect(mine.tip).toContain("Stop and Kill don't ask about uncommitted changes; Log out does.");
    expect(other).toMatchObject({ canStop: true, canKill: false });
    expect(system).toMatchObject({ systemGem: 'symbolgem', canStop: false, canKill: false });
  });

  it('offers Stop only to a login with SystemControl, and says why not', () => {
    list = { ...listed(), canStopSessions: false };
    const other = rowsOf(describeIt())[1];
    expect(other.canStop).toBe(false);
    expect(rowsOf(describeIt())[0].tip).toContain(
      "Kill doesn't ask about uncommitted changes; Log out does.",
    );
    expect(other.tip).toContain('No Stop: DataCurator lacks the SystemControl privilege.');
  });

  it('offers Kill only on a gem Kill can end', () => {
    deps.killableGems.mockReturnValue(new Set());
    expect(rowsOf(describeIt()).some((r) => r.canKill)).toBe(false);
  });

  it('flags a session still running a run its user stopped, without reading again', () => {
    stuck.add(1);
    expect(rowsOf(describeIt())[0].stuck).toBe(true);
    stuck.delete(1);
    expect(rowsOf(describeIt())[0].stuck).toBe(false);
    expect(deps.read).toHaveBeenCalledTimes(1);
  });

  it("gives the stone's backlog, read again on Refresh", () => {
    expect(describeIt()).toMatchObject({ commitRecords: 1, abortThreshold: 20 });
    list = { ...listed(), commitRecordBacklog: 27 };
    expect(describeIt()).toMatchObject({ commitRecords: 1 });
    sessions.forget('db:db-1');
    expect(describeIt()).toMatchObject({ commitRecords: 27 });
  });

  it('flags the session holding the oldest commit record once the stone asks for aborts', () => {
    listed().sessions[1].holdsOldestCommitRecord = true;
    expect(rowsOf(describeIt())[1].heldBackCommitRecords).toBeUndefined();

    sessions.forget('db:db-1');
    list = { ...listed(), commitRecordBacklog: 20 };
    const [first, holder] = rowsOf(describeIt());

    expect(holder.heldBackCommitRecords).toBe(20);
    expect(holder.tip).toContain('The stone asks sessions to abort at 20 commit records');
    expect(holder.tip).toContain('The count is updated only on Refresh.');
    expect(first.heldBackCommitRecords).toBeUndefined();
    expect(holder.backlogHolders).toBe(1);
    expect(holder.tip).toContain('until this one commits or aborts');
  });

  it('says how many sessions share the oldest commit record', () => {
    listed().sessions[0].holdsOldestCommitRecord = true;
    listed().sessions[1].holdsOldestCommitRecord = true;
    list = { ...listed(), commitRecordBacklog: 27 };
    const [first, second] = rowsOf(describeIt());
    expect(first).toMatchObject({ heldBackCommitRecords: 27, backlogHolders: 2 });
    expect(second.tip).toContain('until both of these sessions commit or abort');
  });

  it('says why there is no list for a login without SessionAccess', () => {
    list = { kind: 'noAccess' };
    expect(describeIt()).toMatchObject({
      kind: 'message',
      message: 'Seeing other sessions needs the SessionAccess privilege',
    });
  });

  it('says the list could not be read, rather than showing none', () => {
    deps.read.mockImplementation(() => {
      throw new Error('the network went away');
    });
    expect(describeIt()).toEqual({
      key: 'db:db-1',
      kind: 'message',
      message: 'Could not read the sessions',
      detail: 'the network went away',
    });
  });

  it("finds the row of this window's session, and the session behind a row", () => {
    describeIt();
    expect(sessions.rowOf(1)).toEqual({ key: 'db:db-1', serial: 3 });
    expect(sessions.rowOf(2)).toBeUndefined();
    expect(sessions.target('db:db-1', 9)?.stoneSession.user).toBe('ewinger');
    expect(sessions.target('db:db-1', 999)).toBeUndefined();
  });

  it('acts only on a row it showed, and Kills only where Kill was offered', async () => {
    describeIt();
    vi.mocked(window.showWarningMessage).mockResolvedValue(KILL);

    await sessions.kill('db:db-1', 9);
    await sessions.kill('db:db-1', 999);
    expect(deps.kill).not.toHaveBeenCalled();

    await sessions.kill('db:db-1', 3);
    expect(deps.kill).toHaveBeenCalledTimes(1);
    // Killing this window's own session logs it out.
    expect(deps.logout).toHaveBeenCalledWith(1);
  });
});
