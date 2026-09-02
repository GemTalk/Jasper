import { describe, it, expect, vi } from 'vitest';

import {
  bringUpDatabase,
  takeDownDatabase,
  clearSessionsForStop,
  ServerTarget,
} from '../databaseLifecycle';
import { ExtentHolder } from '../../extentHolders';
import { GemStoneDatabase } from '../../sysadminTypes';

const db: GemStoneDatabase = {
  dirName: 'db-1',
  path: '/home/user/gemstone/db-1',
  config: {
    version: '3.7.4',
    stoneName: 'gs64stone',
    ldiName: 'gs64ldi',
    baseExtent: 'extent0.dbf',
  },
};

/**
 * A database whose two servers actually change state as the per-server commands
 * are run — those commands refresh the process cache before they return, so the
 * running-state lookups here read what the last one achieved.
 *
 * `stoneUnchanged` is the stone command declining: `gemstone.stopStone` asks for
 * the DataCurator password and offers a force-stop, and Cancel leaves the stone
 * running without failing. `gemstone.startStone` does the same when its
 * shared-memory prompt is cancelled.
 */
function deps(
  stoneRunning: boolean,
  netldiRunning: boolean,
  opts: { stoneUnchanged?: boolean } = {},
) {
  const state = { stone: stoneRunning, netldi: netldiRunning };
  return {
    isStoneRunning: vi.fn(() => state.stone),
    isNetldiRunning: vi.fn(() => state.netldi),
    run: vi.fn(async (command: string, _target: ServerTarget) => {
      if (command === 'gemstone.startStone' && !opts.stoneUnchanged) state.stone = true;
      if (command === 'gemstone.stopStone' && !opts.stoneUnchanged) state.stone = false;
      if (command === 'gemstone.startNetldi') state.netldi = true;
      if (command === 'gemstone.stopNetldi') state.netldi = false;
    }),
  };
}

const commandsRun = (d: ReturnType<typeof deps>) => d.run.mock.calls.map((c) => c[0]);

describe('bringUpDatabase', () => {
  it('starts both servers of a stopped database', async () => {
    const d = deps(false, false);

    await bringUpDatabase(db, d);

    expect(commandsRun(d)).toEqual(['gemstone.startStone', 'gemstone.startNetldi']);
    expect(d.run.mock.calls[0][1]).toEqual({ kind: 'stone', db });
    expect(d.run.mock.calls[1][1]).toEqual({ kind: 'netldi', db });
  });

  it('leaves a server that is already up alone', async () => {
    // Half-started databases are ordinary — someone brought the NetLDI up by
    // hand, or a previous stop only got one of the two.
    const d = deps(false, true);

    await bringUpDatabase(db, d);

    expect(commandsRun(d)).toEqual(['gemstone.startStone']);
  });

  it('does nothing to a database that is already up', async () => {
    const d = deps(true, true);

    await bringUpDatabase(db, d);

    expect(d.run).not.toHaveBeenCalled();
  });

  it('leaves the NetLDI alone when the stone did not come up', async () => {
    // Cancelling the shared-memory prompt, or a start that failed and said so.
    // A NetLDI raised beside a stone that never started is not what was asked
    // for, and leaves the database in a state nobody chose.
    const d = deps(false, false, { stoneUnchanged: true });

    await bringUpDatabase(db, d);

    expect(commandsRun(d)).toEqual(['gemstone.startStone']);
  });
});

describe('takeDownDatabase', () => {
  it('stops both servers of a running database', async () => {
    const d = deps(true, true);

    await takeDownDatabase(db, d);

    expect(commandsRun(d)).toEqual(['gemstone.stopStone', 'gemstone.stopNetldi']);
    expect(d.run.mock.calls[0][1]).toEqual({ kind: 'stone', db });
    expect(d.run.mock.calls[1][1]).toEqual({ kind: 'netldi', db });
  });

  it('stops only what is up', async () => {
    const d = deps(false, true);

    await takeDownDatabase(db, d);

    expect(commandsRun(d)).toEqual(['gemstone.stopNetldi']);
  });

  it('does nothing to a database that is already down', async () => {
    const d = deps(false, false);

    await takeDownDatabase(db, d);

    expect(d.run).not.toHaveBeenCalled();
  });

  it('leaves the NetLDI up when stopping the stone was cancelled', async () => {
    // The regression this guards: Cancel at the stone's password prompt used to
    // fall straight through to the NetLDI, so declining to stop the database
    // stopped half of it anyway and left the stone unreachable.
    const d = deps(true, true, { stoneUnchanged: true });

    await takeDownDatabase(db, d);

    expect(commandsRun(d)).toEqual(['gemstone.stopStone']);
  });

  it('stops the stone before its NetLDI', async () => {
    // A session logging in through the NetLDI while the stone is going down is
    // the failure this ordering avoids.
    const d = deps(true, true);

    await takeDownDatabase(db, d);

    expect(commandsRun(d)).toEqual(['gemstone.stopStone', 'gemstone.stopNetldi']);
  });
});

describe('clearSessionsForStop', () => {
  const holder = (pid: number): ExtentHolder => ({ pid, command: '/gs/sys/gem TCP 5' });

  /** A clock and a probe under the test's control: `probes` is what each
   *  successive look at the extents returns, so a gem "exiting" is just the
   *  next entry having one fewer holder. */
  function deps(reaped: number, probes: ExtentHolder[][]) {
    let clock = 0;
    let i = 0;
    return {
      clock: () => clock,
      waits: [] as number[],
      reapSessions: vi.fn(() => reaped),
      attachedHolders: vi.fn(() => probes[Math.min(i++, probes.length - 1)]),
      wait: vi.fn(async (ms: number) => {
        clock += ms;
      }),
      now: () => clock,
    };
  }

  const OPTS = { timeoutMs: 10_000, pollMs: 200 };

  it('does not wait at all when none of Jasper’s sessions were logged out', async () => {
    // The case that made the dialog take ten seconds: a foreign session is
    // foreign now and will be foreign later, so there is nothing to wait for.
    const d = deps(0, [[holder(111)]]);

    const holders = await clearSessionsForStop(d, OPTS);

    expect(holders.map((h) => h.pid)).toEqual([111]);
    expect(d.wait).not.toHaveBeenCalled();
    expect(d.attachedHolders).toHaveBeenCalledTimes(1);
  });

  it('returns as soon as the gems it logged out have gone', async () => {
    const d = deps(1, [[holder(111)], []]);

    const holders = await clearSessionsForStop(d, OPTS);

    expect(holders).toEqual([]);
    expect(d.wait).toHaveBeenCalledTimes(1);
  });

  it('stops once the holder list settles, rather than running to the deadline', async () => {
    // A foreign session never leaves. Polling for it until the deadline is what
    // froze the extension host — the probe is a synchronous shell-out.
    const d = deps(1, [[holder(111)], [holder(111)]]);

    const holders = await clearSessionsForStop(d, OPTS);

    expect(holders.map((h) => h.pid)).toEqual([111]);
    expect(d.wait).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting while the list is still changing', async () => {
    // Three gems going down one at a time: still progress, so still worth waiting.
    const d = deps(3, [[holder(1), holder(2), holder(3)], [holder(2), holder(3)], [holder(3)], []]);

    const holders = await clearSessionsForStop(d, OPTS);

    expect(holders).toEqual([]);
    expect(d.wait).toHaveBeenCalledTimes(3);
  });

  it('gives up at the deadline when a gem never settles or goes', async () => {
    // A list that keeps churning must not poll forever.
    let pid = 1000;
    const d = {
      reapSessions: vi.fn(() => 1),
      attachedHolders: vi.fn(() => [holder(pid++)]),
      wait: vi.fn(async () => {}),
      now: vi.fn(),
    };
    let clock = 0;
    d.wait.mockImplementation(async () => {
      clock += OPTS.pollMs;
    });
    d.now.mockImplementation(() => clock);

    const holders = await clearSessionsForStop(d, OPTS);

    expect(holders).toHaveLength(1);
    expect(d.wait.mock.calls.length).toBe(OPTS.timeoutMs / OPTS.pollMs);
  });

  it('logs out before it looks, never the other way round', async () => {
    // Probing first would see Jasper's own gems and report them as foreign.
    const order: string[] = [];
    const d = {
      reapSessions: vi.fn(() => {
        order.push('reap');
        return 0;
      }),
      attachedHolders: vi.fn(() => {
        order.push('probe');
        return [];
      }),
      wait: vi.fn(async () => {}),
      now: () => 0,
    };

    await clearSessionsForStop(d, OPTS);

    expect(order).toEqual(['reap', 'probe']);
  });
});
