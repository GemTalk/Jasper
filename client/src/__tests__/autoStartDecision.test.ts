import { describe, it, expect } from 'vitest';
import { inspectDatabaseProcesses, classifyStartNeed } from '../autoStartDecision';
import { GemStoneDatabase, GemStoneProcess } from '../sysadminTypes';
import { HostServerProcess } from '../externalServerScan';

function makeDb(overrides: Partial<GemStoneDatabase['config']> = {}): GemStoneDatabase {
  return {
    dirName: 'db-1',
    path: '/root/db-1',
    config: {
      version: '3.7.5',
      stoneName: 'alpha',
      ldiName: 'alpha_ldi',
      baseExtent: 'extent0.dbf',
      ...overrides,
    },
  };
}

function proc(overrides: Partial<GemStoneProcess> = {}): GemStoneProcess {
  return {
    type: 'stone',
    name: 'alpha',
    version: '3.7.5',
    pid: 1,
    status: 'OK',
    responding: true,
    ...overrides,
  };
}

const hostStone: HostServerProcess = {
  pid: 4242,
  type: 'stone',
  name: 'alpha',
  version: '3.7.5',
  dbPathHints: ['/root/db-1/conf/alpha.conf'],
  command: '/gs/sys/stoned alpha',
};

const stoneUp = proc();
const ldiUp = proc({ type: 'netldi', name: 'alpha_ldi' });

describe('inspectDatabaseProcesses', () => {
  it('reports both down when nothing is running', () => {
    expect(inspectDatabaseProcesses(makeDb(), [])).toEqual({
      stone: { running: false, responding: false, external: false },
      netldi: { running: false, responding: false, external: false },
    });
  });

  it('reports both up when both are running and responding', () => {
    expect(inspectDatabaseProcesses(makeDb(), [stoneUp, ldiUp])).toEqual({
      stone: { running: true, responding: true, external: false },
      netldi: { running: true, responding: true, external: false },
    });
  });

  it('distinguishes a running-but-unresponsive stone from a healthy one', () => {
    const wedged = proc({ status: 'frozen', responding: false });

    expect(inspectDatabaseProcesses(makeDb(), [wedged, ldiUp]).stone).toEqual({
      running: true,
      responding: false,
      external: false,
    });
  });

  it('ignores a same-named stone belonging to a different version', () => {
    const other = proc({ version: '3.6.2' });

    expect(inspectDatabaseProcesses(makeDb({ version: '3.7.5' }), [other]).stone.running).toBe(
      false,
    );
  });

  it('matches loosely on version precision, as the Databases view does', () => {
    const reported = proc({ version: '3.7.4.3' });

    expect(inspectDatabaseProcesses(makeDb({ version: '3.7.4' }), [reported]).stone.running).toBe(
      true,
    );
  });

  it('marks a server the host scan found but gslist did not as external', () => {
    // The case the whole detection exists for: alive on the host, invisible to
    // Jasper's gslist, and so reported as Stopped before this.
    const state = inspectDatabaseProcesses(makeDb(), [], {
      stone: { process: hostStone, identity: 'confirmed' },
    });

    expect(state.stone).toEqual({ running: false, responding: false, external: true });
    expect(state.netldi.external).toBe(false);
  });

  it('does not confuse the stone and the netldi', () => {
    // A netldi named the same as the stone must not satisfy the stone check.
    const confusable = proc({ type: 'netldi', name: 'alpha' });

    const state = inspectDatabaseProcesses(makeDb(), [confusable]);
    expect(state.stone.running).toBe(false);
    expect(state.netldi.running).toBe(false);
  });
});

describe('classifyStartNeed', () => {
  const both = {
    stone: { running: true, responding: true, external: false },
    netldi: { running: true, responding: true, external: false },
  };
  const neither = {
    stone: { running: false, responding: false, external: false },
    netldi: { running: false, responding: false, external: false },
  };

  const externalStone = {
    stone: { running: false, responding: false, external: true },
    netldi: { running: true, responding: true, external: false },
  };

  it('says nothing to do when both are up and healthy', () => {
    expect(classifyStartNeed(both)).toEqual({ kind: 'already-running' });
  });

  it('asks to start both when neither is running', () => {
    expect(classifyStartNeed(neither)).toEqual({
      kind: 'can-start',
      startStone: true,
      startNetldi: true,
    });
  });

  it('starts only the stone when the netldi is already up', () => {
    expect(classifyStartNeed({ stone: neither.stone, netldi: both.netldi })).toEqual({
      kind: 'can-start',
      startStone: true,
      startNetldi: false,
    });
  });

  it('starts only the netldi when the stone is already up', () => {
    // A login fails just as hard with no netldi as with no stone.
    expect(classifyStartNeed({ stone: both.stone, netldi: neither.netldi })).toEqual({
      kind: 'can-start',
      startStone: false,
      startNetldi: true,
    });
  });

  it('reports an unresponsive stone rather than offering to start it', () => {
    // startstone would fail against a wedged process; the user needs the stale
    // lock tooling instead, so this must not be reported as "can start".
    expect(
      classifyStartNeed({
        stone: { running: true, responding: false, external: false },
        netldi: both.netldi,
      }),
    ).toEqual({ kind: 'not-responding', what: 'stone' });
  });

  it('reports an unresponsive netldi', () => {
    expect(
      classifyStartNeed({
        stone: both.stone,
        netldi: { running: true, responding: false, external: false },
      }),
    ).toEqual({ kind: 'not-responding', what: 'netldi' });
  });

  it('prefers reporting the wedged stone when both are wedged', () => {
    expect(
      classifyStartNeed({
        stone: { running: true, responding: false, external: false },
        netldi: { running: true, responding: false, external: false },
      }),
    ).toEqual({ kind: 'not-responding', what: 'stone' });
  });

  it('reports an external server instead of offering to start it', () => {
    // startstone against a name a live process already holds collides with it
    // rather than helping, so this must never come back as "can start".
    expect(classifyStartNeed(externalStone)).toEqual({
      kind: 'external',
      stone: true,
      netldi: false,
    });
  });

  it('reports the external server even when the other side is also down', () => {
    // A plain start of the down side would still leave the login unable to
    // connect, so the mismatch is what the user needs to hear about first.
    expect(classifyStartNeed({ stone: externalStone.stone, netldi: neither.netldi })).toEqual({
      kind: 'external',
      stone: true,
      netldi: false,
    });
  });

  it('names both sides when both were started outside Jasper', () => {
    expect(
      classifyStartNeed({
        stone: { running: false, responding: false, external: true },
        netldi: { running: false, responding: false, external: true },
      }),
    ).toEqual({ kind: 'external', stone: true, netldi: true });
  });

  it('offers to start a down side even when the other is wedged', () => {
    // Stone is stopped, NetLDI is running-but-wedged. Starting the stone is
    // still worth offering — the wedged NetLDI is a separate problem and does
    // not block bringing the stone back up.
    expect(
      classifyStartNeed({
        stone: { running: false, responding: false, external: false },
        netldi: { running: true, responding: false, external: false },
      }),
    ).toEqual({ kind: 'can-start', startStone: true, startNetldi: false });
  });
});
