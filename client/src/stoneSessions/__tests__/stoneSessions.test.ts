import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { window } from '../../__mocks__/vscode';
import type { ActiveSession } from '../../activeSession';
import { GciLibraryError } from '../../gciLibraryError';
import { DEFAULT_LOGIN } from '../../loginTypes';
import {
  isGemCommand,
  KILL_CHECK_TIMEOUT_MS,
  killableGems,
  killStoneSession,
  parseStoneSessions,
  sessionAge,
  StoneSession,
  stopStoneSession,
  STOP_SESSION_WAIT_MS,
  TransientLogin,
} from '../stoneSessions';
import {
  KILL,
  killStoneSessionCommand,
  STOP_SESSION,
  StoneSessionTarget,
  stopStoneSessionCommand,
} from '../stoneSessionsView';

describe('parseStoneSessions', () => {
  it("reads the stone's clock, its commit-record backlog, and one session per line", () => {
    const text =
      '1793224302\t34\t20\ttrue\t7\n' +
      '2\t1\tGcUser\t3886706\tlocalhost\t1793224153\t0\treclaimgcgem\n' +
      '7\t12\tDataCurator\t41377\tthor\t1793223402\t1\t';

    expect(parseStoneSessions(text)).toEqual({
      kind: 'sessions',
      serverNow: 1793224302,
      commitRecordBacklog: 34,
      abortThreshold: 20,
      canStopSessions: true,
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
          holdsOldestCommitRecord: false,
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
          holdsOldestCommitRecord: true,
        },
      ],
    });
  });

  it('reads a stone with no other session as an empty list', () => {
    expect(parseStoneSessions('1793224302\t1\t20\tfalse\t')).toEqual({
      kind: 'sessions',
      serverNow: 1793224302,
      commitRecordBacklog: 1,
      abortThreshold: 20,
      canStopSessions: false,
      sessions: [],
    });
  });

  it('reads a transactionless session, and one with no user yet', () => {
    const [row] = (
      parseStoneSessions('100\t1\t20\ttrue\t\n9\t30\t\t555\tlocalhost\t90\t-1\t') as {
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
  const target: StoneSession = {
    id: 7,
    serial: 12,
    user: 'ewinger',
    gemPid: 39811,
    host: 'thor',
    loggedInAt: 0,
    transaction: 'in',
    holdsOldestCommitRecord: false,
  };
  const row: StoneSessionTarget = {
    stoneSession: target,
    canKill: false,
    loginUser: 'Alice',
    through,
  };
  const localRow: StoneSessionTarget = { ...row, canKill: true };

  function deps(stop: () => Promise<'ended' | 'gone' | 'stuck'>) {
    return {
      stop: vi.fn(stop),
      kill: vi.fn(async () => 'ended' as const),
      transientLogin: vi.fn(),
      refresh: vi.fn(),
      logout: vi.fn(async () => true),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.showWarningMessage).mockReset();
  });

  it('warns that uncommitted work is lost, and does nothing unless confirmed', async () => {
    const d = deps(async () => 'ended');

    await stopStoneSessionCommand(row, d);

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      "Stop GemStone session 7 (ewinger on thor, gem 39811)? Anything it hasn't committed will be lost.",
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
    expect(window.showInformationMessage).toHaveBeenCalledWith('GemStone session 7 is stopped.');
    expect(d.refresh).toHaveBeenCalledWith(true);
  });

  it("logs out this window's own session once its gem is stopped, and says so first", async () => {
    const mine = { ...row, jasperSession: { id: 3 } as ActiveSession };
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(STOP_SESSION);
    const d = deps(async () => 'ended');

    await stopStoneSessionCommand(mine, d);

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringMatching(/lost\. Jasper session 3 will be logged out\.$/),
      { modal: true },
      STOP_SESSION,
    );
    expect(d.logout).toHaveBeenCalledWith(3);
    expect(d.logout.mock.invocationCallOrder[0]).toBeLessThan(
      d.refresh.mock.invocationCallOrder[0],
    );
  });

  it("leaves this window's session logged in, and its row listed, when its gem would not stop", async () => {
    const mine = { ...row, jasperSession: { id: 3 } as ActiveSession };
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(STOP_SESSION);
    const d = deps(async () => 'stuck');

    await stopStoneSessionCommand(mine, d);

    expect(d.logout).not.toHaveBeenCalled();
    expect(d.refresh).toHaveBeenCalledWith(false);
  });

  it('says so when the session had already ended', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(STOP_SESSION);

    await stopStoneSessionCommand(
      row,
      deps(async () => 'gone'),
    );

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'GemStone session 7 had already ended.',
    );
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

  it("offers Kill when the gem that didn't answer is on this machine", async () => {
    vi.mocked(window.showWarningMessage)
      .mockResolvedValueOnce(STOP_SESSION)
      .mockResolvedValueOnce(KILL)
      .mockResolvedValueOnce(KILL);
    const d = deps(async () => 'stuck');

    await stopStoneSessionCommand(localRow, d);

    expect(window.showWarningMessage).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/still on the stone/),
      KILL,
    );
    // Kill asks for itself before it acts.
    expect(window.showWarningMessage).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/^Kill GemStone session 7/),
      { modal: true },
      KILL,
    );
    expect(d.kill).toHaveBeenCalledWith(target, d.transientLogin.mock.results[0].value);
  });

  it('says the privilege is missing, and what an administrator can run', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(STOP_SESSION);
    const d = deps(async () => {
      throw GciLibraryError.fromGciError({ number: 2151, message: 'no privilege' });
    });

    await stopStoneSessionCommand(row, d);

    expect(window.showWarningMessage).toHaveBeenLastCalledWith(
      'Stopping a session needs the SessionAccess and SystemControl privileges, which Alice ' +
        "doesn't have. " +
        'An administrator can end it with: System stopSession: 7',
    );
    expect(d.refresh).toHaveBeenCalledWith(false);
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
      'GemStone session 7 could not be stopped (the stone went away). ' +
        'An administrator can end it with: System stopSession: 7',
    );
  });
});

describe('Kill', () => {
  const through = { id: 1, login: DEFAULT_LOGIN } as ActiveSession;
  const target: StoneSession = {
    id: 7,
    serial: 12,
    user: 'ewinger',
    gemPid: 39811,
    host: 'uffda',
    loggedInAt: 0,
    transaction: 'in',
    holdsOldestCommitRecord: false,
  };
  const row: StoneSessionTarget = {
    stoneSession: target,
    canKill: true,
    loginUser: DEFAULT_LOGIN.gs_user,
    through,
  };

  function deps(kill: () => Promise<'ended' | 'gone' | 'stuck'>) {
    return {
      stop: vi.fn(async () => 'ended' as const),
      kill: vi.fn(kill),
      transientLogin: vi.fn(),
      refresh: vi.fn(),
      logout: vi.fn(async () => true),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.showWarningMessage).mockReset();
  });

  it('warns that the gem is ended and uncommitted work lost, and does nothing unless confirmed', async () => {
    const d = deps(async () => 'ended');

    await killStoneSessionCommand(row, d);

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'Kill GemStone session 7 (ewinger on uffda)? Its gem, process 39811, will be ended on ' +
        "this machine, and anything it hasn't committed will be lost.",
      { modal: true },
      KILL,
    );
    expect(d.kill).not.toHaveBeenCalled();
  });

  it('kills the session once confirmed, and reads the list again', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(KILL);
    const d = deps(async () => 'ended');

    await killStoneSessionCommand(row, d);

    expect(d.kill).toHaveBeenCalledWith(target, d.transientLogin.mock.results[0].value);
    expect(d.transientLogin).toHaveBeenCalledWith(through);
    expect(window.showInformationMessage).toHaveBeenCalledWith('GemStone session 7 is killed.');
    expect(d.refresh).toHaveBeenCalledWith(true);
    expect(d.logout).not.toHaveBeenCalled();
  });

  it("logs out this window's own session once its gem is killed, and says so first", async () => {
    const mine = { ...row, jasperSession: { id: 3 } as ActiveSession };
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(KILL);
    const d = deps(async () => 'ended');

    await killStoneSessionCommand(mine, d);

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Jasper session 3 will be logged out\.$/),
      { modal: true },
      KILL,
    );
    expect(d.logout).toHaveBeenCalledWith(3);
  });

  it('says why the gem could not be killed, and what someone allowed to can run', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(KILL);
    const d = deps(async () => {
      throw new Error('kill: (39811) - Operation not permitted');
    });

    await killStoneSessionCommand(row, d);

    expect(window.showWarningMessage).toHaveBeenLastCalledWith(
      'GemStone session 7 could not be killed: kill: (39811) - Operation not permitted. ' +
        'Someone allowed to end process 39811 on uffda can run: kill -9 39811',
    );
    expect(d.refresh).toHaveBeenCalledWith(false);
  });

  it('says so when the gem outlives SIGKILL', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(KILL);

    await killStoneSessionCommand(
      row,
      deps(async () => 'stuck'),
    );

    expect(window.showWarningMessage).toHaveBeenLastCalledWith(
      expect.stringMatching(/still on the stone after its gem, process 39811, was sent SIGKILL/),
    );
  });
});

describe('stopStoneSession', () => {
  const target = { id: 7, serial: 12 };

  /** A stone that answers Stop with `sent`, then `onStone()` for each "still there?". */
  function setUp(sent: boolean, onStone: () => boolean) {
    const asked: string[] = [];
    const logout = vi.fn();
    const login: TransientLogin = () => ({
      session: {
        executeAndFetchString: (code: string) => {
          asked.push(code);
          return String(code.includes('stopSession:') ? sent : onStone());
        },
      } as unknown as ActiveSession,
      logout,
    });
    return { login, asked, logout };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stops the session only while its login still has it, and waits for it to leave', async () => {
    let polls = 0;
    const { login, asked, logout } = setUp(true, () => ++polls < 2);

    const outcome = stopStoneSession(target, login);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(outcome).resolves.toBe('ended');
    expect(asked[0]).toMatch(
      /descriptionOfSessionSerialNum: 12\) at: 10\. now = 7 ifTrue: \[System stopSession: now\]/,
    );
    expect(logout).toHaveBeenCalled();
  });

  it('leaves a session number that has passed to another login alone', async () => {
    const { login, asked } = setUp(false, () => true);
    await expect(stopStoneSession(target, login)).resolves.toBe('gone');
    expect(asked).toHaveLength(1);
  });

  it('answers stuck when the session is still there after the wait', async () => {
    const { login, logout } = setUp(true, () => true);

    const outcome = stopStoneSession(target, login);
    await vi.advanceTimersByTimeAsync(STOP_SESSION_WAIT_MS + 1000);

    await expect(outcome).resolves.toBe('stuck');
    expect(logout).toHaveBeenCalled();
  });
});

describe('killStoneSession', () => {
  const target = { id: 7, serial: 12, gemPid: 39811 };
  const GEM = '/opt/GemStone64Bit3.7.5-x86_64.Linux/sys/gem TCP 5';

  /** A stone whose answer to "still there?" is `onStone()`, and a shell that records its commands. */
  function setUp(onStone: () => boolean, shell: (command: string) => string) {
    const asked: string[] = [];
    const commands: string[] = [];
    const logout = vi.fn();
    const login: TransientLogin = () => ({
      session: {
        executeAndFetchString: (code: string) => {
          asked.push(code);
          return String(onStone());
        },
      } as unknown as ActiveSession,
      logout,
    });
    const run = async (command: string) => {
      commands.push(command);
      return shell(command);
    };
    return { login, run, asked, commands, logout };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('checks the login still has that session and gem before touching anything', async () => {
    const { login, run, asked, commands, logout } = setUp(
      () => false,
      () => GEM,
    );

    await expect(killStoneSession(target, login, run)).resolves.toBe('gone');
    expect(asked[0]).toMatch(/descriptionOfSessionSerialNum: 12\b.*at: 10\) = 7 .*at: 2\) = 39811/);
    expect(commands).toEqual([]);
    expect(logout).toHaveBeenCalled();
  });

  it('sends SIGTERM, which ends a busy gem', async () => {
    let alive = true;
    const { login, run, commands } = setUp(
      () => alive,
      (command) => {
        if (command.startsWith('kill')) alive = false;
        return command.startsWith('ps') ? GEM : '';
      },
    );

    await expect(killStoneSession(target, login, run)).resolves.toBe('ended');
    expect(commands).toEqual([
      'ps -p 39811 -o command= 2>/dev/null || true',
      'kill -TERM 39811 2>&1 || true',
    ]);
  });

  it('follows with SIGKILL for a gem frozen for good', async () => {
    let alive = true;
    const { login, run, commands } = setUp(
      () => alive,
      (command) => {
        if (command.startsWith('kill -KILL')) alive = false;
        return command.startsWith('ps') ? GEM : '';
      },
    );

    const outcome = killStoneSession(target, login, run);
    await vi.advanceTimersByTimeAsync(STOP_SESSION_WAIT_MS + 1000);

    await expect(outcome).resolves.toBe('ended');
    expect(commands.at(-1)).toBe('kill -KILL 39811 2>&1 || true');
  });

  // SIGTERM ended the gem, but the stone hadn't let the session go when the wait ran out.
  it('keeps waiting when the gem is already gone by the time SIGKILL is sent', async () => {
    let killSent = false;
    let pollsSinceKill = 0;
    const { login, run } = setUp(
      () => !killSent || ++pollsSinceKill <= 1,
      (command) => {
        if (command.startsWith('kill -KILL')) {
          killSent = true;
          return 'sh: kill: (39811) - No such process';
        }
        return command.startsWith('ps') ? GEM : '';
      },
    );

    const outcome = killStoneSession(target, login, run);
    await vi.advanceTimersByTimeAsync(2 * STOP_SESSION_WAIT_MS + 1000);

    await expect(outcome).resolves.toBe('ended');
  });

  it('answers stuck when the session outlives SIGKILL', async () => {
    const { login, run } = setUp(
      () => true,
      (command) => (command.startsWith('ps') ? GEM : ''),
    );

    const outcome = killStoneSession(target, login, run);
    await vi.advanceTimersByTimeAsync(2 * STOP_SESSION_WAIT_MS + 1000);

    await expect(outcome).resolves.toBe('stuck');
  });

  it('refuses a process id that is not a gem here, and signals nothing', async () => {
    const { login, run, commands } = setUp(
      () => true,
      () => '/usr/bin/vim notes.txt\n',
    );

    await expect(killStoneSession(target, login, run)).rejects.toThrow(
      'Process 39811 on this machine is not a GemStone gem (/usr/bin/vim notes.txt).',
    );
    expect(commands.some((c) => c.startsWith('kill'))).toBe(false);
  });

  it('refuses a process id with no process here, as a gem on another machine has', async () => {
    const { login, run } = setUp(
      () => true,
      () => '',
    );

    await expect(killStoneSession(target, login, run)).rejects.toThrow(
      'There is no process 39811 on this machine.',
    );
  });

  it("passes on kill's complaint, rather than reading it as a gem that ignored the signal", async () => {
    const { login, run } = setUp(
      () => true,
      (command) => (command.startsWith('ps') ? GEM : 'sh: kill: (39811) - Operation not permitted'),
    );

    await expect(killStoneSession(target, login, run)).rejects.toThrow(
      'sh: kill: (39811) - Operation not permitted',
    );
  });
});

describe('isGemCommand', () => {
  it.each([
    ['/opt/GemStone64Bit3.7.5-x86_64.Linux/sys/gem TCP 5', true],
    ['/opt/gs/sys/gem symbolgem gs64stone -T 20480', true],
    ['/opt/gs/sys/gemnetobject', false],
    ['/opt/gs/sys/stoned gs64stone', false],
    ['/usr/bin/gem install rails', false],
  ])('%s → %s', (command, expected) => {
    expect(isGemCommand(command)).toBe(expected);
  });
});

describe('killableGems', () => {
  const gem = (overrides: Partial<StoneSession>): StoneSession => ({
    id: 1,
    serial: 1,
    user: 'DataCurator',
    gemPid: 100,
    host: 'uffda',
    loggedInAt: 0,
    transaction: 'out',
    holdsOldestCommitRecord: false,
    ...overrides,
  });
  const isLocal = (host: string) => host === 'uffda';
  const STONE_HOST = 'uffda';

  it('asks kill -0 about the gems on this machine only, and keeps those it may signal', () => {
    const shell = vi.fn(() => '100\n');

    const killable = killableGems(
      [gem({ gemPid: 100 }), gem({ gemPid: 200 }), gem({ gemPid: 300, host: 'thor' })],
      STONE_HOST,
      isLocal,
      shell,
    );

    // It runs inside every list read, so a hung shell (wsl.exe) must not hold the window.
    expect(shell).toHaveBeenCalledWith(
      'for p in 100 200; do kill -0 $p 2>/dev/null && echo $p; done; true',
      KILL_CHECK_TIMEOUT_MS,
    );
    expect(killable).toEqual(new Set([100]));
  });

  it("takes a gem the stone calls localhost to be on the stone's machine", () => {
    const shell = vi.fn(() => '100\n');
    const onLocalhost = [
      gem({ gemPid: 100, host: 'localhost' }),
      gem({ gemPid: 200, host: '127.0.0.1' }),
    ];

    expect(killableGems(onLocalhost, 'thor', isLocal, shell)).toEqual(new Set());
    expect(shell).not.toHaveBeenCalled();

    expect(killableGems(onLocalhost, 'uffda', isLocal, shell)).toEqual(new Set([100]));
    expect(shell).toHaveBeenCalledWith(
      'for p in 100 200; do kill -0 $p 2>/dev/null && echo $p; done; true',
      KILL_CHECK_TIMEOUT_MS,
    );
  });

  it("never asks about GemStone's own gems", () => {
    const shell = vi.fn(() => '');
    expect(killableGems([gem({ systemGem: 'symbolgem' })], STONE_HOST, isLocal, shell)).toEqual(
      new Set(),
    );
    expect(shell).not.toHaveBeenCalled();
  });

  it('offers no Kill when the check itself fails', () => {
    const killable = killableGems([gem({})], STONE_HOST, isLocal, () => {
      throw new Error('wsl.exe not found');
    });
    expect(killable).toEqual(new Set());
  });
});
