import { describe, it, expect, vi } from 'vitest';
import {
  ExternalServerReport,
  ReconcileDeps,
  describeExternalServers,
  manualResolutionMessage,
  reconcileExternalServers,
  reconcileMessage,
} from '../externalServerReconcile';
import { ExternalServer, ExternalServerFinding, ServerIdentity } from '../externalServerScan';
import { GemStoneDatabase } from '../sysadminTypes';

const DB: GemStoneDatabase = {
  dirName: 'db-1',
  path: '/home/u/jasperStones/db-1',
  config: {
    version: '3.7.5',
    stoneName: 'gs64stone',
    ldiName: 'gs64ldi',
    baseExtent: 'extent0.dbf',
  },
};

const JASPER_ROOT = '/home/u/jasperStones';

function server(
  type: 'stone' | 'netldi',
  identity: ServerIdentity = 'confirmed',
  overrides: Partial<ExternalServer['process']> = {},
): ExternalServer {
  return {
    process: {
      pid: type === 'stone' ? 1889606 : 1889602,
      type,
      name: type === 'stone' ? 'gs64stone' : 'gs64ldi',
      version: '3.7.5',
      globalDir: '/opt/GemStone64Bit3.7.5-x86_64.Linux',
      dbPathHints: [`${DB.path}/conf/gs64stone.conf`],
      command: `/opt/sys/${type === 'stone' ? 'stoned' : 'netldid'}`,
      ...overrides,
    },
    identity,
  };
}

const BOTH: ExternalServerFinding = { stone: server('stone'), netldi: server('netldi') };

function report(finding: ExternalServerFinding = BOTH): ExternalServerReport {
  return describeExternalServers(DB, finding, JASPER_ROOT);
}

function makeDeps(overrides: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    confirm: vi.fn(async () => 'restart' as const),
    stopExternal: vi.fn(async () => 'stopped'),
    killExternal: vi.fn(async () => ({ killed: true, reason: 'killed' })),
    report: vi.fn(),
    showError: vi.fn(),
    ...overrides,
  };
}

describe('describeExternalServers', () => {
  it('lists the stone before the netldi, as the user reads them', () => {
    expect(report().servers.map((s) => s.kind)).toEqual(['Stone', 'NetLDI']);
  });

  it('carries the process id and registration directory of each server', () => {
    expect(report().servers[0]).toMatchObject({
      name: 'gs64stone',
      pid: 1889606,
      registeredIn: '/opt/GemStone64Bit3.7.5-x86_64.Linux',
    });
  });

  it('permits a restart only when every server found is confirmed', () => {
    expect(report().confirmed).toBe(true);
    expect(report({ stone: server('stone', 'unknown') }).confirmed).toBe(false);
    expect(report({ stone: server('stone', 'different') }).confirmed).toBe(false);
  });

  it('has nothing to confirm when nothing was found', () => {
    expect(report({}).confirmed).toBe(false);
  });
});

describe('reconcileMessage', () => {
  it('describes the situation as a mismatch, not a missing install', () => {
    // A user looking at live processes who is told GemStone is not installed
    // goes off to debug their shell profile — the exact detour this replaced.
    const message = reconcileMessage(report());

    expect(message).toContain("started outside Jasper's environment");
    expect(message).not.toMatch(/not installed|install path|not found/i);
  });

  it('explains that Jasper and the host can see different servers', () => {
    const message = reconcileMessage(report());

    expect(message).toContain(JASPER_ROOT);
    expect(message).toContain('alive on the host');
  });

  it('names both servers when both were started outside Jasper', () => {
    expect(reconcileMessage(report())).toContain('"gs64stone" and "gs64ldi" are running');
  });

  it('names just the one server when only one was', () => {
    const finding = { netldi: server('netldi') };

    expect(reconcileMessage(report(finding))).toContain('"gs64ldi" are running');
  });

  it('warns that a restart loses uncommitted work', () => {
    expect(reconcileMessage(report())).toContain('uncommitted sessions');
  });

  it('names each process and where it is registered', () => {
    const message = reconcileMessage(report());

    expect(message).toContain('PID 1889606');
    expect(message).toContain('PID 1889602');
    expect(message).toContain('registered in /opt/GemStone64Bit3.7.5-x86_64.Linux');
  });

  it('says so when it could not tell where a server is registered', () => {
    const finding = { stone: server('stone', 'confirmed', { globalDir: undefined }) };

    expect(reconcileMessage(report(finding))).toContain('registration directory unknown');
  });

  it('warns that a same-named server may be a different database', () => {
    const message = reconcileMessage(report({ stone: server('stone', 'unknown') }));

    expect(message).toContain('could not confirm');
    expect(message).toContain('"Restart & Connect" is not offered');
  });

  it('says outright when the paths point at another database', () => {
    const message = reconcileMessage(report({ stone: server('stone', 'different') }));

    expect(message).toContain('point outside this database');
  });

  it('does not promise a restart that will not be offered', () => {
    expect(reconcileMessage(report({ stone: server('stone', 'unknown') }))).not.toContain(
      'uncommitted sessions',
    );
  });
});

describe('manualResolutionMessage', () => {
  it('gives both names, the process ids, and where they are registered', () => {
    const message = manualResolutionMessage(report(), 'PID 1889606 survived SIGKILL.');

    expect(message).toContain('gs64stone');
    expect(message).toContain('gs64ldi');
    expect(message).toContain('PID 1889606');
    expect(message).toContain('/opt/GemStone64Bit3.7.5-x86_64.Linux');
  });

  it('shows how to inspect the servers where they actually are', () => {
    const message = manualResolutionMessage(report(), 'refused');

    expect(message).toContain('GEMSTONE_GLOBAL_DIR=/opt/GemStone64Bit3.7.5-x86_64.Linux gslist');
  });

  it('still gives a usable instruction when the directory is unknown', () => {
    const finding = { stone: server('stone', 'confirmed', { globalDir: undefined }) };

    const message = manualResolutionMessage(report(finding), 'refused');

    expect(message).toContain('gslist -cvl');
  });

  it('repeats the reason the stop failed', () => {
    expect(manualResolutionMessage(report(), 'ps unavailable')).toContain('ps unavailable');
  });

  it('names the lock files a kill would leave behind', () => {
    // It tells the user to kill the PIDs; following that advice without
    // removing the locks leaves gslist reporting a server that is gone and the
    // next start refusing.
    const message = manualResolutionMessage(report(), 'refused');

    expect(message).toContain('/opt/GemStone64Bit3.7.5-x86_64.Linux/locks/gs64stone..LCK');
    expect(message).toContain('/opt/GemStone64Bit3.7.5-x86_64.Linux/locks/gs64ldi..LCK');
  });

  it('says nothing about locks it cannot locate', () => {
    const finding = { stone: server('stone', 'confirmed', { globalDir: undefined }) };

    expect(manualResolutionMessage(report(finding), 'refused')).not.toContain('..LCK');
  });
});

describe('reconcileExternalServers', () => {
  it('stops nothing when the user cancels', async () => {
    const deps = makeDeps({ confirm: vi.fn(async () => 'cancel' as const) });

    const outcome = await reconcileExternalServers(DB, BOTH, report(), deps);

    expect(outcome).toEqual({ kind: 'abandoned' });
    expect(deps.stopExternal).not.toHaveBeenCalled();
    expect(deps.killExternal).not.toHaveBeenCalled();
  });

  it('stops nothing when the prompt is dismissed', async () => {
    const deps = makeDeps({ confirm: vi.fn(async () => undefined) });

    const outcome = await reconcileExternalServers(DB, BOTH, report(), deps);

    expect(outcome).toEqual({ kind: 'abandoned' });
    expect(deps.stopExternal).not.toHaveBeenCalled();
  });

  it('leaves the servers alone when asked to connect as they are', async () => {
    const deps = makeDeps({ confirm: vi.fn(async () => 'as-is' as const) });

    const outcome = await reconcileExternalServers(DB, BOTH, report(), deps);

    expect(outcome).toEqual({ kind: 'connect-as-is' });
    expect(deps.stopExternal).not.toHaveBeenCalled();
  });

  it('stops both servers cleanly, the stone first', async () => {
    const deps = makeDeps();

    const outcome = await reconcileExternalServers(DB, BOTH, report(), deps);

    expect(outcome).toEqual({ kind: 'stopped' });
    expect(vi.mocked(deps.stopExternal).mock.calls.map((c) => c[1].process.type)).toEqual([
      'stone',
      'netldi',
    ]);
    expect(deps.killExternal).not.toHaveBeenCalled();
  });

  it('force-stops only the server whose clean stop failed', async () => {
    // A clean stop needs the stock DataCurator password and a reachable
    // listener, neither of which an external server need offer.
    const deps = makeDeps({
      stopExternal: vi.fn(async (_db, s) => {
        if (s.process.type === 'stone') throw new Error('stopstone: stone not found');
        return 'stopped';
      }),
    });

    const outcome = await reconcileExternalServers(DB, BOTH, report(), deps);

    expect(outcome).toEqual({ kind: 'stopped' });
    expect(vi.mocked(deps.killExternal).mock.calls.map((c) => c[0].process.type)).toEqual([
      'stone',
    ]);
  });

  it('stops only what was actually found running outside Jasper', async () => {
    const finding = { netldi: server('netldi') };
    const deps = makeDeps();

    await reconcileExternalServers(DB, finding, report(finding), deps);

    expect(vi.mocked(deps.stopExternal).mock.calls.map((c) => c[1].process.type)).toEqual([
      'netldi',
    ]);
  });

  it('stops nothing when the report claims more is confirmed than the finding shows', async () => {
    // The gate has to read the servers that will actually be stopped, not a
    // description handed in alongside them: taking permission from the
    // description is how an unconfirmed server gets stopped anyway.
    const finding = { stone: server('stone', 'unknown') };
    const confirmedReport = report({ stone: server('stone', 'confirmed') });
    const deps = makeDeps();

    const outcome = await reconcileExternalServers(DB, finding, confirmedReport, deps);

    expect(outcome).toEqual({ kind: 'abandoned' });
    expect(deps.stopExternal).not.toHaveBeenCalled();
    expect(deps.killExternal).not.toHaveBeenCalled();
  });

  it('refuses to stop a server it could not confirm, even if asked to', async () => {
    // The dialog does not offer Restart here, but stopping the wrong stone is
    // not a mistake worth leaving to a dialog's wording.
    const finding = { stone: server('stone', 'unknown') };
    const deps = makeDeps();

    const outcome = await reconcileExternalServers(DB, finding, report(finding), deps);

    expect(outcome).toEqual({ kind: 'abandoned' });
    expect(deps.stopExternal).not.toHaveBeenCalled();
    expect(deps.killExternal).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalledWith(expect.stringContaining('did not stop anything'));
  });

  it('hands over the details to finish by hand when it cannot stop a server', async () => {
    const deps = makeDeps({
      stopExternal: vi.fn(async () => {
        throw new Error('no');
      }),
      killExternal: vi.fn(async () => ({ killed: false, reason: 'PID 1889606 is owned by root' })),
    });

    const outcome = await reconcileExternalServers(DB, BOTH, report(), deps);

    expect(outcome).toEqual({ kind: 'abandoned' });
    expect(deps.showError).toHaveBeenCalledWith(
      expect.stringContaining('PID 1889606 is owned by root'),
    );
    expect(deps.showError).toHaveBeenCalledWith(expect.stringContaining('gslist'));
  });

  it('does not try the second server after failing to stop the first', async () => {
    // Starting the database with one of the two still holding its name would
    // just collide again.
    const deps = makeDeps({
      stopExternal: vi.fn(async () => {
        throw new Error('no');
      }),
      killExternal: vi.fn(async () => ({ killed: false, reason: 'refused' })),
    });

    await reconcileExternalServers(DB, BOTH, report(), deps);

    expect(deps.killExternal).toHaveBeenCalledTimes(1);
  });

  it('says which server it is stopping while it works', async () => {
    const deps = makeDeps();

    await reconcileExternalServers(DB, BOTH, report(), deps);

    expect(deps.report).toHaveBeenCalledWith(expect.stringContaining('gs64stone'));
    expect(deps.report).toHaveBeenCalledWith(expect.stringContaining('gs64ldi'));
  });
});
