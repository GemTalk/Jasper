import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  lsofHolderPids,
  parseHolderDetails,
  parseProcHolders,
  procHoldersScript,
  sessionHolders,
} from '../extentHolders';

/**
 * The extent probe against real processes holding a real file.
 *
 * The unit tests pin the parsers to captured output, which is only ever as
 * honest as the capture. This drives the actual probe on the actual machine,
 * and it exists because a faster-looking probe (`lsof -b`) was measured at
 * fifteen times the speed and returns *nothing at all* on a real extent — a
 * mocked test agreed with it happily. A probe that answers "nobody" for a
 * database with live gems would have Jasper stop a stone on top of them, so
 * this layer is worth exercising for real.
 *
 * Deterministic by construction: every wait polls for the condition with a
 * deadline rather than sleeping a guessed interval, each test owns a directory
 * nothing else can see, and every process it starts is killed by its own
 * teardown whether the test passed or not.
 */

/** Windows runs its servers inside WSL, where Jasper's probes go through
 *  `wsl.exe`; this harness has no way to spawn a holder on that side. */
const NOT_POSIX = process.platform === 'win32';
const ON_MAC = process.platform === 'darwin';

const PROBE_TIMEOUT_MS = 5_000;

function lsofAvailable(): boolean {
  try {
    execFileSync('sh', ['-c', 'command -v lsof'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Resolved at load, not in a `beforeAll`, so it can gate `skipIf`: a guard
 *  inside the body would let a machine without the probe report passing tests
 *  that asserted nothing. */
const NO_PROBE = NOT_POSIX || (ON_MAC && !lsofAvailable());

/** The production probe, run for real: the `/proc` scan, or `lsof` on macOS. */
async function findHolders(extent: string) {
  const pids = ON_MAC
    ? await lsofHolderPids([extent], PROBE_TIMEOUT_MS)
    : parseProcHolders(
        execFileSync('sh', ['-c', procHoldersScript([extent])], {
          encoding: 'utf-8',
          timeout: PROBE_TIMEOUT_MS,
        }),
      );
  if (pids.length === 0) return [];
  return parseHolderDetails(
    execFileSync(
      'sh',
      ['-c', `ps -o pid=,user=,lstart=,args= -p ${pids.join(',')} 2>/dev/null || true`],
      { encoding: 'utf-8', timeout: PROBE_TIMEOUT_MS },
    ),
  );
}

/** Poll until the predicate holds, or fail saying what was still true. Never a
 *  fixed sleep: a process takes an unknown moment to open a file, and a guess
 *  is either slow on every run or wrong on a loaded machine. */
async function waitFor<T>(
  describeFailure: string,
  produce: () => Promise<T>,
  holds: (value: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await produce();
  while (!holds(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    last = await produce();
  }
  if (!holds(last)) {
    throw new Error(`${describeFailure} within ${timeoutMs}ms; last saw ${JSON.stringify(last)}`);
  }
  return last;
}

describe('finding what holds an extent open, against real processes', () => {
  let dir: string;
  let extent: string;
  const started: ChildProcess[] = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-extent-e2e-'));
    extent = path.join(dir, 'extent0.dbf');
    fs.writeFileSync(extent, 'not really an extent');
  });

  afterEach(async () => {
    for (const child of started.splice(0)) {
      try {
        // The whole group: the holder is a shell that forked a sleep, and
        // leaving either behind would hold the next test's file open.
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone, which is the outcome we wanted anyway.
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A process that really holds the extent open, the way a gem does.
   *
   * `extraArgs` land on the command line without being used, which is how a
   * holder is made to look like one of the stone's own housekeeping gems:
   * those name their stone in argv (`gem reclaimgcgem gs64stone 1`) and a
   * session's gem does not. That difference is the whole of `sessionHolders`.
   */
  function startHolder(...extraArgs: string[]): ChildProcess {
    return startHolderOf(extent, ...extraArgs);
  }

  function startHolderOf(file: string, ...extraArgs: string[]): ChildProcess {
    const child = spawn(
      'sh',
      ['-c', 'exec 3< "$1"; while : ; do sleep 1; done', 'holder', file, ...extraArgs],
      { detached: true, stdio: 'ignore' },
    );
    started.push(child);
    return child;
  }

  it.skipIf(NO_PROBE)('finds nothing when nothing has the extent open', async () => {
    expect(await findHolders(extent)).toEqual([]);
  });

  it.skipIf(NO_PROBE)('finds a holder that opened the extent through a symlink', async () => {
    const link = path.join(dir, 'via-link');
    fs.symlinkSync(dir, link);
    const holder = startHolderOf(path.join(link, 'extent0.dbf'));

    await waitFor(
      'the holder never appeared',
      () => findHolders(extent),
      (holders) => holders.some((h) => h.pid === holder.pid),
    );
  });

  it.skipIf(NO_PROBE)('ignores a process holding another file of the same name', async () => {
    // Every database's first extent is called extent0.dbf.
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-extent-e2e-other-'));
    try {
      const other = path.join(otherDir, 'extent0.dbf');
      fs.writeFileSync(other, 'another database');
      const stranger = startHolderOf(other);
      const holder = startHolder();

      const found = await waitFor(
        'the holder never appeared',
        () => findHolders(extent),
        (holders) => holders.some((h) => h.pid === holder.pid),
      );

      expect(found.map((h) => h.pid)).not.toContain(stranger.pid);
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it.skipIf(NO_PROBE)('names the process that has the extent open', async () => {
    const holder = startHolder();

    const found = await waitFor(
      'the holder never appeared',
      () => findHolders(extent),
      (holders) => holders.some((h) => h.pid === holder.pid),
    );

    const mine = found.find((h) => h.pid === holder.pid)!;
    // The parser has to get every field off a real `ps` line, not just the pid.
    expect(mine.user).toBe(os.userInfo().username);
    expect(mine.startedAt).toMatch(/\d{4}$/);
    expect(mine.command).toContain('holder');
  });

  it.skipIf(NO_PROBE)('stops naming it once it has gone', async () => {
    const holder = startHolder();
    await waitFor(
      'the holder never appeared',
      () => findHolders(extent),
      (holders) => holders.some((h) => h.pid === holder.pid),
    );

    process.kill(-holder.pid!, 'SIGKILL');

    await waitFor(
      'the holder was still listed after it was killed',
      () => findHolders(extent),
      (holders) => !holders.some((h) => h.pid === holder.pid),
    );
  });

  it.skipIf(NO_PROBE)('tells a session process from one of the stone’s own', async () => {
    const stoneName = 'gs64stone_probe_e2e';
    const housekeeping = startHolder(stoneName);
    const session = startHolder();

    const found = await waitFor(
      'both holders never appeared together',
      () => findHolders(extent),
      (holders) =>
        holders.some((h) => h.pid === housekeeping.pid) &&
        holders.some((h) => h.pid === session.pid),
    );

    const attached = sessionHolders(found, stoneName);
    expect(attached.map((h) => h.pid)).toContain(session.pid);
    expect(attached.map((h) => h.pid)).not.toContain(housekeeping.pid);
  });

  it.skipIf(NO_PROBE)('reads every one of several holders, not just the first', async () => {
    const holders = [startHolder(), startHolder(), startHolder()];

    const found = await waitFor(
      'not all holders appeared',
      () => findHolders(extent),
      (seen) => holders.every((h) => seen.some((s) => s.pid === h.pid)),
    );

    for (const holder of holders) {
      expect(found.map((h) => h.pid)).toContain(holder.pid);
    }
  });
});
