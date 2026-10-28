import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { window } from '../__mocks__/vscode';
import type { ActiveSession } from '../activeSession';
import { GciLibraryError } from '../gciLibraryError';
import { DEFAULT_LOGIN } from '../loginTypes';
import { parseStoneSessions, sessionAge, StoneSession } from '../stoneSessions';
import {
  STOP_SESSION,
  StoneSessionRowItem,
  StoneSessionsItem,
  stopStoneSessionCommand,
} from '../stoneSessionsView';

describe('parseStoneSessions', () => {
  it("reads the stone's clock and one session per line", () => {
    const text =
      '1793224302\n' +
      '2\t1\tGcUser\t3886706\tlocalhost\t1793224153\t0\treclaimgcgem\n' +
      '7\t12\tDataCurator\t41377\tthor\t1793223402\t1\t';

    expect(parseStoneSessions(text)).toEqual({
      kind: 'sessions',
      serverNow: 1793224302,
      sessions: [
        {
          id: 2,
          serial: 1,
          user: 'GcUser',
          gemPid: 3886706,
          host: 'localhost',
          loggedInAt: 1793224153,
          transaction: 'out',
          systemGem: 'reclaimgcgem',
        },
        {
          id: 7,
          serial: 12,
          user: 'DataCurator',
          gemPid: 41377,
          host: 'thor',
          loggedInAt: 1793223402,
          transaction: 'in',
          systemGem: undefined,
        },
      ],
    });
  });

  it('reads a stone with no other session as an empty list', () => {
    expect(parseStoneSessions('1793224302')).toEqual({
      kind: 'sessions',
      serverNow: 1793224302,
      sessions: [],
    });
  });

  it('reads a transactionless session, and one with no user yet', () => {
    const [row] = (
      parseStoneSessions('100\n9\t30\t\t555\tlocalhost\t90\t-1\t') as {
        sessions: StoneSession[];
      }
    ).sessions;

    expect(row).toMatchObject({ user: '', transaction: 'transactionless' });
  });

  it('reads the answer for a login without SessionAccess', () => {
    expect(parseStoneSessions('noSessionAccess')).toEqual({ kind: 'noAccess' });
  });
});

describe('sessionAge', () => {
  it.each([
    [45, '45s'],
    [14 * 60 + 59, '14m'],
    [3 * 3600 + 5, '3h'],
    [2 * 86400 + 7200, '2d'],
    // The stone's clock can run behind the time a login was recorded by a moment.
    [-3, '0s'],
  ])('%i seconds reads as %s', (seconds, age) => {
    expect(sessionAge(1000, 1000 + seconds)).toBe(age);
  });
});

describe('Stop Session', () => {
  const through = { id: 1, login: DEFAULT_LOGIN } as ActiveSession;
  const parent = new StoneSessionsItem(
    { ...DEFAULT_LOGIN, gs_user: 'Alice' },
    0,
    through,
    undefined,
  );
  const target: StoneSession = {
    id: 7,
    serial: 12,
    user: 'ewinger',
    gemPid: 39811,
    host: 'thor',
    loggedInAt: 0,
    transaction: 'in',
  };
  const row = new StoneSessionRowItem(parent, target, 100, { stuck: false });

  function deps(stop: () => Promise<'ended' | 'gone' | 'stuck'>) {
    return { stop: vi.fn(stop), transientLogin: vi.fn(), refresh: vi.fn() };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.showWarningMessage).mockReset();
  });

  it('warns that uncommitted work is lost, and does nothing unless confirmed', async () => {
    const d = deps(async () => 'ended');

    await stopStoneSessionCommand(row, d);

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      "Stop session 7 (ewinger on thor, gem 39811)? Anything it hasn't committed is lost.",
      { modal: true },
      STOP_SESSION,
    );
    expect(d.stop).not.toHaveBeenCalled();
  });

  it('stops the session once confirmed, and reads the list again', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(STOP_SESSION);
    const d = deps(async () => 'ended');

    await stopStoneSessionCommand(row, d);

    expect(d.stop).toHaveBeenCalledWith(target, d.transientLogin.mock.results[0].value);
    expect(d.transientLogin).toHaveBeenCalledWith(through);
    expect(window.showInformationMessage).toHaveBeenCalledWith('Session 7 is stopped.');
    expect(d.refresh).toHaveBeenCalledWith(parent);
  });

  it('says so when the session had already ended', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(STOP_SESSION);

    await stopStoneSessionCommand(
      row,
      deps(async () => 'gone'),
    );

    expect(window.showInformationMessage).toHaveBeenCalledWith('Session 7 had already ended.');
  });

  it("names the gem's process when the gem doesn't answer", async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(STOP_SESSION);

    await stopStoneSessionCommand(
      row,
      deps(async () => 'stuck'),
    );

    expect(window.showWarningMessage).toHaveBeenLastCalledWith(
      expect.stringMatching(/still on the stone.*process 39811 on thor/),
    );
  });

  it('says the privilege is missing, and what an administrator can run', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(STOP_SESSION);
    const d = deps(async () => {
      throw GciLibraryError.fromGciError({ number: 2151, message: 'no privilege' });
    });

    await stopStoneSessionCommand(row, d);

    expect(window.showWarningMessage).toHaveBeenLastCalledWith(
      "Stopping a session needs the SessionAccess privilege, which Alice doesn't have. " +
        'An administrator can end it with: System stopSession: 7',
    );
    expect(d.refresh).toHaveBeenCalledWith(parent);
  });

  it('passes on any other failure, with the same way out', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(STOP_SESSION);

    await stopStoneSessionCommand(
      row,
      deps(async () => {
        throw new Error('the stone went away');
      }),
    );

    expect(window.showWarningMessage).toHaveBeenLastCalledWith(
      'Session 7 could not be stopped (the stone went away). ' +
        'An administrator can end it with: System stopSession: 7',
    );
  });
});
