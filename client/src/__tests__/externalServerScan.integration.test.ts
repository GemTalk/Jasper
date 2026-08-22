import { describe, it, expect, beforeAll, vi } from 'vitest';
// parseGslist is a pure function, but it lives beside ProcessManager, which
// imports vscode. Nothing here touches the editor API; the mock only lets the
// import resolve outside a VS Code host.
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import { execFileSync, execSync, type ExecFileSyncOptionsWithStringEncoding } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  HostServerProcess,
  applyServerEnvironment,
  classifyServerIdentity,
  findExternalServers,
  parseHostServerProcesses,
  parseServerEnvironment,
} from '../externalServerScan';

import { parseGslist } from '../processManager';
import { posix } from 'path';

/**
 * The scan, run against the live test stone rather than against fixtures.
 *
 * Everything else about this feature is unit-tested off recorded `ps` lines,
 * which proves the parsing rules but not the premise underneath them: that
 * GemStone's servers really do look like that, that `ps` really does hand over
 * a server's environment on this platform, and above all that `gslist` really
 * is blind to a live server registered somewhere else. Those are claims about
 * GemStone and the OS, and only a real stone can settle them — which is also
 * why this belongs in the CI matrix, where it runs against every release rather
 * than against whatever one machine happens to have installed.
 *
 * Deliberately not built on `useIntegrationTest`: nothing here needs a GCI
 * session, and taking one would add a login (and a commit guard) to a test
 * whose whole subject is the process table.
 */

/** The lock directory the test stone actually registered in. */
const GLOBAL_DIR = process.env.VITE_GEMSTONE_GLOBAL_DIR;
const VERSION = process.env.VITE_GEMSTONE_VERSION;
/** `!tcp@localhost#server!<stoneName>` */
const STONE_NAME = process.env.VITE_GEMSTONE_STONE_NRS?.split('!').pop();
/** `!tcp@localhost#netldi:<ldiName>#task!gemnetobject` */
const LDI_NAME = process.env.VITE_GEMSTONE_GEM_NRS?.match(/#netldi:([^#!]+)/)?.[1];
/** `<product>/lib/libgcits-….so` → `<product>/bin/gslist` */
const GSLIST = process.env.VITE_GEMSTONE_GCI_LIBRARY_PATH?.replace(/\/lib\/[^/]+$/, '/bin/gslist');

const configured = Boolean(GLOBAL_DIR && VERSION && STONE_NAME && LDI_NAME && GSLIST);

/** A running process's GemStone environment, read the way ProcessManager reads
 *  it. On a platform that refuses to expose it this comes back empty, leaving
 *  the command line as the only identity evidence — a fallback, not a parser
 *  bug, and the tests below say which of the two they are looking at. */
function readEnvironment(pid: number): Record<string, string> {
  return parseServerEnvironment(
    execSync(`ps eww -p ${pid} -o command= 2>/dev/null || true`, { encoding: 'utf-8' }),
  );
}

/**
 * Run the real gslist against a chosen lock directory.
 *
 * gslist exits non-zero when it has nothing to report ("Could not list server
 * info"), which makes an empty listing indistinguishable from a real failure at
 * the exit-code level — so its output is taken either way. ProcessManager does
 * the same thing by catching and falling back to an empty list, which is why
 * that catch is load-bearing rather than defensive.
 */
function gslist(globalDir: string): string {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    encoding: 'utf-8',
    env: { ...process.env, GEMSTONE_GLOBAL_DIR: globalDir },
    // Its warning about an empty directory is expected here and would otherwise
    // print into the test output as though something had gone wrong.
    stdio: ['ignore', 'pipe', 'ignore'],
  };
  try {
    return execFileSync(GSLIST as string, ['-cvl'], options);
  } catch (e) {
    return (e as { stdout?: string }).stdout ?? '';
  }
}

describe('the process-table scan, against a live stone', () => {
  let hostServers: HostServerProcess[];

  beforeAll(() => {
    if (!configured) return;
    hostServers = parseHostServerProcesses(execSync('ps -Ao pid=,command=', { encoding: 'utf-8' }));
  });

  const stone = (): HostServerProcess | undefined =>
    hostServers.find((p) => p.type === 'stone' && p.name === STONE_NAME);
  /** The live stone with its own environment folded in — the same two steps
   *  ProcessManager takes before judging identity. */
  const enrichedStone = (): HostServerProcess => {
    const found = stone() as HostServerProcess;
    return applyServerEnvironment(found, readEnvironment(found.pid));
  };
  const netldi = (): HostServerProcess | undefined =>
    hostServers.find((p) => p.type === 'netldi' && p.name === LDI_NAME);

  it('finds the running stone and netldi in the real process table', (ctx) => {
    if (!configured) return ctx.skip('no .env.test — run npm run test:server:start');

    expect(stone()).toBeDefined();
    expect(netldi()).toBeDefined();
  });

  it('reads the version out of a real product directory path', (ctx) => {
    if (!configured) return ctx.skip('no .env.test — run npm run test:server:start');

    // Version matching is what keeps two installs sharing a stone name apart,
    // so a version the scan cannot read would quietly disable that guard.
    expect(stone()?.version).toBe(VERSION);
    expect(netldi()?.version).toBe(VERSION);
  });

  it('reads the lock directory a real server registered in', (ctx) => {
    if (!configured) return ctx.skip('no .env.test — run npm run test:server:start');

    // `ps eww` exposes a process's environment on Linux; if a platform refuses,
    // this fails loudly here rather than silently costing the reconcile the one
    // detail a user needs to go find the server by hand.
    // A macOS failure here means "fall back to another identity source", not
    // "the parser broke": Darwin has not let ps read another process's
    // environment for many releases, and if that holds then globalDir is always
    // undefined there and Restart & Connect is never offered — only
    // Connect as-is. Worth failing loudly over rather than discovering later.
    expect(enrichedStone().globalDir).toBe(GLOBAL_DIR);
  });

  it('sees the running servers when gslist is pointed at their own lock directory', (ctx) => {
    if (!configured) return ctx.skip('no .env.test — run npm run test:server:start');

    const listed = parseGslist(gslist(GLOBAL_DIR as string));

    expect(listed.some((p) => p.type === 'stone' && p.name === STONE_NAME)).toBe(true);
    expect(listed.some((p) => p.type === 'netldi' && p.name === LDI_NAME)).toBe(true);
  });

  it('sees nothing when gslist is pointed anywhere else, though the servers are still up', (ctx) => {
    if (!configured) return ctx.skip('no .env.test — run npm run test:server:start');

    // This is the whole bug, reproduced: same live servers, same gslist binary,
    // a different GEMSTONE_GLOBAL_DIR — and they vanish. Jasper always points
    // gslist at the root it manages, so a server started from a shell with
    // other settings is invisible to it while plainly alive on the host.
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-gslist-'));
    try {
      const listed = parseGslist(gslist(elsewhere));

      expect(listed).toEqual([]);
      expect(stone()).toBeDefined();
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('reports both servers as started outside Jasper when gslist looked elsewhere', (ctx) => {
    if (!configured) return ctx.skip('no .env.test — run npm run test:server:start');

    // The end-to-end claim: a real gslist reading that missed real running
    // servers, crossed against the real process table, produces the finding the
    // reconcile acts on.
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-gslist-'));
    try {
      const db = {
        path: '/nonexistent/db-1',
        config: {
          stoneName: STONE_NAME as string,
          ldiName: LDI_NAME as string,
          version: VERSION as string,
        },
      };

      const finding = findExternalServers(db, parseGslist(gslist(elsewhere)), hostServers);

      expect(finding.stone?.process.name).toBe(STONE_NAME);
      expect(finding.netldi?.process.name).toBe(LDI_NAME);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('finds nothing to reconcile while gslist can see the servers', (ctx) => {
    if (!configured) return ctx.skip('no .env.test — run npm run test:server:start');

    // The healthy case, which must stay silent: these servers are registered
    // exactly where this gslist looks, so nothing is "outside".
    const db = {
      path: '/nonexistent/db-1',
      config: {
        stoneName: STONE_NAME as string,
        ldiName: LDI_NAME as string,
        version: VERSION as string,
      },
    };

    expect(findExternalServers(db, parseGslist(gslist(GLOBAL_DIR as string)), hostServers)).toEqual(
      {},
    );
  });

  it('confirms a real server against the database directory it was pointed at', (ctx) => {
    if (!configured) return ctx.skip('no .env.test — run npm run test:server:start');

    // `confirmed` is the only state that authorizes a kill, and everything else
    // proving it is built from recorded strings. This is the positive control:
    // take the directory the *live* process names and check that the classifier
    // recognizes it. The harness may start its stone with no such path at all
    // (it passes no -e/-z/-l and sets no GEMSTONE_SYS_CONF), in which case there
    // is nothing to control against and saying so beats asserting a tautology.
    const enriched = enrichedStone();
    const hint = enriched.dbPathHints.find((p) => p.startsWith('/'));
    if (!hint) {
      return ctx.skip(
        'the live stone names no absolute database path, so there is no directory to confirm against',
      );
    }

    expect(classifyServerIdentity(enriched, posix.dirname(hint))).toBe('confirmed');
  });

  it('refuses to vouch for a real server whose database it cannot place', (ctx) => {
    if (!configured) return ctx.skip('no .env.test — run npm run test:server:start');

    // The counterpart, asserted to the exact verdict rather than merely
    // "not confirmed" — which would pass even if the classifier were hardcoded.
    // Which verdict is right depends on whether the live process names any
    // absolute path at all: one that does points elsewhere, one that does not
    // gives nothing to go on.
    const enriched = enrichedStone();
    const expected = enriched.dbPathHints.some((p) => p.startsWith('/')) ? 'different' : 'unknown';

    expect(classifyServerIdentity(enriched, '/somewhere/that/is/not/its/database')).toBe(expected);
  });
});
