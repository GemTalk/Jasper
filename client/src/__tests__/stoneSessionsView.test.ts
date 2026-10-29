import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { window } from '../__mocks__/vscode';
import type { ActiveSession } from '../activeSession';
import { DEFAULT_LOGIN } from '../loginTypes';
import type { StoneSession, StoneSessionList } from '../stoneSessions';
import {
  KILL,
  REREAD_AFTER_LOGOUT_MS,
  StoneSessions,
  StoneSessionsDeps,
  StoneSessionsInfo,
} from '../stoneSessionsView';

function makeSession(id: number): ActiveSession {
  return { id, login: { ...DEFAULT_LOGIN, gs_user: 'DataCurator' } } as unknown as ActiveSession;
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
    killableGems: ReturnType<typeof vi.fn<(sessions: StoneSession[]) => Set<number>>>;
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
      // Jasper session 1 is GemStone's session 4.
      serverSessionOf: (id) => (id === 1 ? '4' : undefined),
      transientLogin: vi.fn(),
      stop: vi.fn(async () => 'ended' as const),
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

    // The stone lets the gem go a moment after the logout returns, so the read
    // the logout causes can still list it.
    it('reads it again a moment later, and says so', () => {
      windowSessions = [makeSession(1), makeSession(2)];
      describeIt();
      const changed = vi.fn();
      sessions.onDidChange(changed);
      windowSessions = [makeSession(1)];
      describeIt();
      expect(deps.read).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(REREAD_AFTER_LOGOUT_MS);

      expect(changed).toHaveBeenCalledTimes(1);
      describeIt();
      expect(deps.read).toHaveBeenCalledTimes(3);
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

  it('flags the session holding the oldest commit record once the stone asks for aborts', () => {
    listed().sessions[1].holdsOldestCommitRecord = true;
    expect(rowsOf(describeIt())[1].holdsBacklog).toBe(false);

    sessions.forget('db:db-1');
    list = { ...listed(), commitRecordBacklog: 20 };
    const [first, holder] = rowsOf(describeIt());

    expect(holder.holdsBacklog).toBe(true);
    expect(holder.tip).toContain('Holds back 20 commit records');
    expect(first.holdsBacklog).toBe(false);
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
    // Killing this window's own session logs it out, and the list is read again.
    expect(deps.logout).toHaveBeenCalledWith(1);
    describeIt();
    expect(deps.read).toHaveBeenCalledTimes(2);
  });
});
