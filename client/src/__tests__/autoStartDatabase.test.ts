import { describe, it, expect, vi, beforeEach } from 'vitest';
// This module's chain now reaches versionsMatch via processManager, which pulls
// in vscode; mock it so the injected-deps test still runs headless.
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import { maybeStartDatabaseAndRetry, AutoStartDeps } from '../autoStartDatabase';
import { DEFAULT_LOGIN, GemStoneLogin } from '../loginTypes';
import { GemStoneDatabase, GemStoneProcess } from '../sysadminTypes';
import { ExternalServerFinding } from '../externalServerScan';
import { describeExternalServers } from '../externalServerReconcile';

const LOGIN: GemStoneLogin = {
  ...DEFAULT_LOGIN,
  stone: 'alpha',
  netldi: 'alpha_ldi',
  version: '3.7.5',
};
const ORIGINAL_ERROR = 'Login failed: some GCI complaint';

const DB: GemStoneDatabase = {
  dirName: 'db-1',
  path: '/root/db-1',
  config: { version: '3.7.5', stoneName: 'alpha', ldiName: 'alpha_ldi', baseExtent: 'extent0.dbf' },
};

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
const STONE_UP = proc();
const LDI_UP = proc({ type: 'netldi', name: 'alpha_ldi' });

function makeDeps(overrides: Partial<AutoStartDeps> = {}): AutoStartDeps {
  return {
    getDatabases: vi.fn(() => [DB]),
    refreshProcesses: vi.fn(() => [] as GemStoneProcess[]),
    getExternalServers: vi.fn(() => ({})),
    describeExternalServers: vi.fn((db, finding) => describeExternalServers(db, finding, '/root')),
    reconcile: {
      confirm: vi.fn(async () => 'restart' as const),
      stopExternal: vi.fn(async () => 'stopped'),
      killExternal: vi.fn(async () => ({ killed: true, reason: 'killed' })),
    },
    startStone: vi.fn(async () => 'started'),
    startNetldi: vi.fn(async () => 'started'),
    getMode: vi.fn(() => 'ask' as const),
    setMode: vi.fn(async () => {}),
    confirm: vi.fn(async () => 'yes' as const),
    showError: vi.fn(),
    report: vi.fn(),
    retryLogin: vi.fn(async () => {}),
    refreshViews: vi.fn(),
    ...overrides,
  };
}

async function run(deps: AutoStartDeps, login = LOGIN) {
  await maybeStartDatabaseAndRetry(login, ORIGINAL_ERROR, deps);
}

describe('maybeStartDatabaseAndRetry — when it should stand aside', () => {
  it('shows the original error and starts nothing for a database Jasper does not manage', async () => {
    const deps = makeDeps({ getDatabases: vi.fn(() => []) });

    await run(deps);

    expect(deps.showError).toHaveBeenCalledWith(ORIGINAL_ERROR);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.startStone).not.toHaveBeenCalled();
    expect(deps.retryLogin).not.toHaveBeenCalled();
  });

  it('shows the original error for a remote login', async () => {
    const deps = makeDeps();

    await run(deps, { ...LOGIN, gem_host: 'db.example.com' });

    expect(deps.showError).toHaveBeenCalledWith(ORIGINAL_ERROR);
    expect(deps.startStone).not.toHaveBeenCalled();
  });

  it('shows the original error when both processes are already up — a bad password must not offer a start', async () => {
    const deps = makeDeps({ refreshProcesses: vi.fn(() => [STONE_UP, LDI_UP]) });

    await run(deps);

    expect(deps.showError).toHaveBeenCalledWith(ORIGINAL_ERROR);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.startStone).not.toHaveBeenCalled();
  });

  it('explains an unresponsive stone instead of offering to start it', async () => {
    const deps = makeDeps({
      refreshProcesses: vi.fn(() => [proc({ status: 'frozen', responding: false }), LDI_UP]),
    });

    await run(deps);

    const msg = (deps.showError as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(msg).toMatch(/not responding/i);
    expect(msg).toContain('alpha');
    expect(deps.startStone).not.toHaveBeenCalled();
  });

  it('does nothing but show the original error when the preference is never', async () => {
    const deps = makeDeps({ getMode: vi.fn(() => 'never' as const) });

    await run(deps);

    expect(deps.showError).toHaveBeenCalledWith(ORIGINAL_ERROR);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.startStone).not.toHaveBeenCalled();
  });
});

describe('maybeStartDatabaseAndRetry — the prompt', () => {
  it('names the database in the prompt', async () => {
    const deps = makeDeps();

    await run(deps);

    expect(deps.confirm).toHaveBeenCalledWith('alpha');
  });

  it('starts and retries on Yes, without persisting a preference', async () => {
    const deps = makeDeps({ confirm: vi.fn(async () => 'yes' as const) });

    await run(deps);

    expect(deps.startStone).toHaveBeenCalledWith(DB);
    expect(deps.startNetldi).toHaveBeenCalledWith(DB);
    expect(deps.retryLogin).toHaveBeenCalled();
    expect(deps.setMode).not.toHaveBeenCalled();
  });

  it('persists always and then starts, on Always', async () => {
    const deps = makeDeps({ confirm: vi.fn(async () => 'always' as const) });

    await run(deps);

    expect(deps.setMode).toHaveBeenCalledWith('always');
    expect(deps.startStone).toHaveBeenCalled();
    expect(deps.retryLogin).toHaveBeenCalled();
  });

  it('persists never and starts nothing, on Never', async () => {
    const deps = makeDeps({ confirm: vi.fn(async () => 'never' as const) });

    await run(deps);

    expect(deps.setMode).toHaveBeenCalledWith('never');
    expect(deps.startStone).not.toHaveBeenCalled();
    expect(deps.retryLogin).not.toHaveBeenCalled();
  });

  it('starts nothing on No, and does not nag with the original error', async () => {
    const deps = makeDeps({ confirm: vi.fn(async () => 'no' as const) });

    await run(deps);

    expect(deps.startStone).not.toHaveBeenCalled();
    expect(deps.retryLogin).not.toHaveBeenCalled();
    expect(deps.showError).not.toHaveBeenCalled();
    expect(deps.setMode).not.toHaveBeenCalled();
  });

  it('treats a dismissed prompt as No', async () => {
    const deps = makeDeps({ confirm: vi.fn(async () => undefined) });

    await run(deps);

    expect(deps.startStone).not.toHaveBeenCalled();
    expect(deps.retryLogin).not.toHaveBeenCalled();
    expect(deps.setMode).not.toHaveBeenCalled();
  });

  it('skips the prompt entirely when the preference is always', async () => {
    const deps = makeDeps({ getMode: vi.fn(() => 'always' as const) });

    await run(deps);

    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.startStone).toHaveBeenCalled();
    expect(deps.retryLogin).toHaveBeenCalled();
  });
});

describe('maybeStartDatabaseAndRetry — starting only what is down', () => {
  it('starts only the netldi when the stone is already up', async () => {
    const deps = makeDeps({ refreshProcesses: vi.fn(() => [STONE_UP]) });

    await run(deps);

    expect(deps.startStone).not.toHaveBeenCalled();
    expect(deps.startNetldi).toHaveBeenCalledWith(DB);
    expect(deps.retryLogin).toHaveBeenCalled();
  });

  it('starts only the stone when the netldi is already up', async () => {
    const deps = makeDeps({ refreshProcesses: vi.fn(() => [LDI_UP]) });

    await run(deps);

    expect(deps.startStone).toHaveBeenCalledWith(DB);
    expect(deps.startNetldi).not.toHaveBeenCalled();
  });

  it('starts the stone before the netldi', async () => {
    const order: string[] = [];
    const deps = makeDeps({
      startStone: vi.fn(async () => {
        order.push('stone');
        return '';
      }),
      startNetldi: vi.fn(async () => {
        order.push('netldi');
        return '';
      }),
    });

    await run(deps);

    expect(order).toEqual(['stone', 'netldi']);
  });
});

describe('maybeStartDatabaseAndRetry — failures', () => {
  it('reports a failed stone start and does not retry the login', async () => {
    const deps = makeDeps({
      startStone: vi.fn(async () => {
        throw new Error('startstone: extent is in use');
      }),
    });

    await run(deps);

    expect(deps.showError).toHaveBeenCalledWith(expect.stringContaining('extent is in use'));
    expect(deps.startNetldi).not.toHaveBeenCalled();
    expect(deps.retryLogin).not.toHaveBeenCalled();
  });

  it('reports a failed netldi start and does not retry the login', async () => {
    const deps = makeDeps({
      startNetldi: vi.fn(async () => {
        throw new Error('startnetldi: port in use');
      }),
    });

    await run(deps);

    expect(deps.showError).toHaveBeenCalledWith(expect.stringContaining('port in use'));
    expect(deps.retryLogin).not.toHaveBeenCalled();
  });

  it('surfaces the actionable message when the version is not extracted', async () => {
    const deps = makeDeps({
      startStone: vi.fn(async () => {
        throw new Error('GemStone 3.7.5 not found. Please extract it first.');
      }),
    });

    await run(deps);

    expect(deps.showError).toHaveBeenCalledWith(expect.stringContaining('Please extract it first'));
  });

  it('treats "already running" as success — a silently failed process refresh must not block the login', async () => {
    // refreshProcesses swallows every error and returns [], so a broken gslist
    // is indistinguishable from "nothing running". Starting an already-running
    // stone must therefore fall through to the retry, not surface an error.
    const deps = makeDeps({
      startStone: vi.fn(async () => {
        throw new Error('startstone: stone alpha is already running');
      }),
    });

    await run(deps);

    expect(deps.showError).not.toHaveBeenCalled();
    expect(deps.startNetldi).toHaveBeenCalled();
    expect(deps.retryLogin).toHaveBeenCalled();
  });

  it("reports the retry's own error verbatim, not as a start failure", async () => {
    const deps = makeDeps({
      retryLogin: vi.fn(async () => {
        throw new Error('Only one GemStone session is allowed at a time.');
      }),
    });

    await run(deps);

    expect(deps.showError).toHaveBeenCalledWith(
      expect.stringContaining('Only one GemStone session is allowed at a time.'),
    );
    expect(deps.showError).not.toHaveBeenCalledWith(expect.stringContaining('Could not start'));
  });

  it('retries the login exactly once', async () => {
    const deps = makeDeps({
      retryLogin: vi.fn(async () => {
        throw new Error('still broken');
      }),
    });

    await run(deps);

    expect(deps.retryLogin).toHaveBeenCalledTimes(1);
  });
});

describe('maybeStartDatabaseAndRetry — servers started outside Jasper', () => {
  const stoneOutside: ExternalServerFinding = {
    stone: {
      process: {
        pid: 1889606,
        type: 'stone',
        name: 'alpha',
        version: '3.7.5',
        globalDir: '/elsewhere',
        dbPathHints: ['/root/db-1/conf/alpha.conf'],
        command: '/gs/sys/stoned alpha',
      },
      identity: 'confirmed',
    },
  };

  function outsideDeps(overrides: Partial<AutoStartDeps> = {}): AutoStartDeps {
    return makeDeps({ getExternalServers: vi.fn(() => stoneOutside), ...overrides });
  }

  it('offers to reconcile instead of offering to start the database', async () => {
    // startstone against a name a live process already holds collides with it,
    // so the plain "start the database?" prompt is the wrong question.
    const deps = outsideDeps();

    await run(deps);

    expect(deps.reconcile.confirm).toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it('starts both servers under Jasper once the external ones are stopped', async () => {
    const deps = outsideDeps();

    await run(deps);

    expect(deps.startStone).toHaveBeenCalledWith(DB);
    expect(deps.startNetldi).toHaveBeenCalledWith(DB);
    expect(deps.retryLogin).toHaveBeenCalled();
  });

  it('does not ask a second time after the reconcile prompt agreed to restart', async () => {
    const deps = outsideDeps();

    await run(deps);

    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it('connects without touching the servers when asked to leave them alone', async () => {
    const deps = outsideDeps({
      reconcile: {
        confirm: vi.fn(async () => 'as-is' as const),
        stopExternal: vi.fn(async () => 'stopped'),
        killExternal: vi.fn(async () => ({ killed: true, reason: 'killed' })),
      },
    });

    await run(deps);

    expect(deps.startStone).not.toHaveBeenCalled();
    expect(deps.retryLogin).toHaveBeenCalled();
  });

  it('starts nothing and repeats no error when the user backs out', async () => {
    // The reconcile dialog already explained the situation; following it with
    // the raw login error would just be nagging.
    const deps = outsideDeps({
      reconcile: {
        confirm: vi.fn(async () => 'cancel' as const),
        stopExternal: vi.fn(async () => 'stopped'),
        killExternal: vi.fn(async () => ({ killed: true, reason: 'killed' })),
      },
    });

    await run(deps);

    expect(deps.startStone).not.toHaveBeenCalled();
    expect(deps.retryLogin).not.toHaveBeenCalled();
    expect(deps.showError).not.toHaveBeenCalled();
  });

  it('does not start the database when the external server could not be stopped', async () => {
    const deps = outsideDeps({
      reconcile: {
        confirm: vi.fn(async () => 'restart' as const),
        stopExternal: vi.fn(async () => {
          throw new Error('stopstone: stone not found');
        }),
        killExternal: vi.fn(async () => ({ killed: false, reason: 'owned by root' })),
      },
    });

    await run(deps);

    expect(deps.startStone).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalledWith(expect.stringContaining('owned by root'));
  });

  it('refreshes the views so the tree reflects whatever was done', async () => {
    const deps = outsideDeps();

    await run(deps);

    expect(deps.refreshViews).toHaveBeenCalled();
  });

  it('leaves an ordinary stopped database on the normal start path', async () => {
    const deps = makeDeps();

    await run(deps);

    expect(deps.reconcile.confirm).not.toHaveBeenCalled();
    expect(deps.confirm).toHaveBeenCalledWith('alpha');
  });
});

describe('maybeStartDatabaseAndRetry — housekeeping', () => {
  let deps: AutoStartDeps;
  beforeEach(() => {
    deps = makeDeps();
  });

  it('refreshes the admin views after a successful start', async () => {
    await run(deps);
    expect(deps.refreshViews).toHaveBeenCalled();
  });

  it('refreshes the admin views even when a start throws, so they are never left stale', async () => {
    const failing = makeDeps({
      startStone: vi.fn(async () => {
        throw new Error('nope');
      }),
    });

    await run(failing);

    expect(failing.refreshViews).toHaveBeenCalled();
  });

  it('does not refresh the views when it never touched anything', async () => {
    const untouched = makeDeps({ getDatabases: vi.fn(() => []) });

    await run(untouched);

    expect(untouched.refreshViews).not.toHaveBeenCalled();
  });

  it('reports progress for each stage', async () => {
    await run(deps);

    const messages = (deps.report as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(messages.some((m) => /starting .*alpha/i.test(m))).toBe(true);
    expect(messages.some((m) => /netldi/i.test(m))).toBe(true);
    expect(messages.some((m) => /connect/i.test(m))).toBe(true);
  });
});

// Reporting the outcome is this flow's whole contract, and the steps above only
// guard the failures they expect. It runs inside a VS Code command, where an
// escaping rejection becomes a bare "command failed" notification that names
// neither the login nor the reason — strictly worse than the error it replaced.
describe('maybeStartDatabaseAndRetry — an unanticipated failure', () => {
  it('is reported rather than thrown when remembering the preference fails', async () => {
    const deps = makeDeps({
      confirm: vi.fn(async () => 'never' as const),
      setMode: vi.fn(async () => {
        throw new Error('Unable to write to User Settings');
      }),
    });

    await expect(run(deps)).resolves.toBeUndefined();

    expect(deps.showError).toHaveBeenCalledWith(expect.stringContaining(ORIGINAL_ERROR));
  });

  it('is reported rather than thrown when the database list cannot be read', async () => {
    const deps = makeDeps({
      getDatabases: vi.fn(() => {
        throw new Error('EACCES: permission denied');
      }),
    });

    await expect(run(deps)).resolves.toBeUndefined();

    expect(deps.showError).toHaveBeenCalledWith(expect.stringContaining(ORIGINAL_ERROR));
  });

  it('names what went wrong, so the cause is not swallowed along with it', async () => {
    const deps = makeDeps({
      getDatabases: vi.fn(() => {
        throw new Error('EACCES: permission denied');
      }),
    });

    await run(deps);

    expect(deps.showError).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
  });
});
