/**
 * Who is holding a database's extent files open.
 *
 * A gem that outlives its stone keeps `extent0.dbf` open exclusively, and the
 * next `startstone` then fails with "File is open by another process" and says
 * nothing about who. Jasper never kills these: a process it did not start,
 * holding a file it cannot see inside, is not something to signal on a guess —
 * it may be a topaz session with uncommitted work, or a gem of another
 * checkout's stone. Naming them is the help that can be given safely.
 *
 * The probes and their parsing live here, free of vscode and of ProcessManager,
 * so the shapes `/proc`, `lsof` and `ps` actually emit can be pinned down by a
 * test rather than discovered in the field.
 */

import { execFile } from 'child_process';

/** A process holding one of a database's files open. */
export interface ExtentHolder {
  pid: number;
  /** Owning user, when `ps` reported one. */
  user?: string;
  /** Start time as `ps -o lstart` prints it, e.g. `Tue Sep  1 17:26:25 2026`. */
  startedAt?: string;
  /** Full command line, empty when `ps` had nothing to say. */
  command: string;
}

/**
 * PIDs out of `lsof -t <file>`.
 *
 * It prints bare PIDs on stdout, one per line, and everything else on stderr,
 * so scraping every number in stdout is safe as long as stdout alone is
 * captured. Deduplicated: a process with the file open twice is listed twice,
 * and one entry per process is what a reader wants.
 */
export function parseHolderPids(output: string): number[] {
  const pids = (output.match(/\d+/g) ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(pids)];
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * A shell script that lists the processes holding any of `extents` open, from
 * `/proc` alone. For Linux, and for Windows, whose servers run inside WSL.
 *
 * `fuser` and `lsof` check every mount, and an unresponsive network mount
 * blocks them for good; a timeout then ends the shell around them but not the
 * tool, which stays behind stuck. Reading a descriptor's link text and its
 * `fdinfo` never touches the file's mount.
 *
 * Matched by device and inode, not by path: one disk can be mounted twice (a
 * bind mount), and a gem that opened the extent through the other path would
 * be missed by a path comparison. A `fdinfo` gives the inode and a mount id,
 * and `mountinfo` turns the mount id into a device. Kernels before Linux 5.14
 * have no `ino:` in `fdinfo`, and there the script runs `stat` on just the
 * descriptors whose name matched; that does touch their mount, so on those
 * kernels a same-named file held on a dead mount can still stall the scan.
 *
 * Without root it sees only the user's own processes, as `fuser` did.
 *
 * Prints `E <st_dev> <ino>` per extent, `M <mount id> <major:minor>` per mount,
 * and `F <pid> m<mount id> <ino>` (or `F <pid> <st_dev> <ino>`) per candidate
 * descriptor; `parseProcHolders` reads it.
 */
export function procHoldersScript(extents: string[]): string {
  const names = [...new Set(extents.map((e) => e.slice(e.lastIndexOf('/') + 1)))]
    .map((name) => `-lname ${shellQuote(`*/${name.replace(/[[\]*?\\]/g, '\\$&')}`)}`)
    .join(' -o ');
  return [
    `stat -L -c 'E %d %i' -- ${extents.map(shellQuote).join(' ')} 2>/dev/null`,
    `while read -r id _ dev _; do echo "M $id $dev"; done < /proc/self/mountinfo`,
    `find /proc/[0-9]*/fd -mindepth 1 -maxdepth 1 \\( ${names} \\) 2>/dev/null |`,
    `while IFS= read -r fd; do`,
    `  mnt= ino=`,
    `  while IFS=': \t' read -r key value; do`,
    `    case $key in mnt_id) mnt=$value ;; ino) ino=$value ;; esac`,
    `  done < "\${fd%/fd/*}/fdinfo/\${fd##*/}"`,
    `  pid=\${fd#/proc/}; pid=\${pid%%/*}`,
    `  if [ -n "$ino" ]; then echo "F $pid m$mnt $ino"`,
    `  else echo "F $pid $(stat -L -c '%d %i' "$fd" 2>/dev/null)"; fi`,
    `done`,
  ].join('\n');
}

/** `major:minor`, as `mountinfo` prints it, from a decimal `st_dev`. The minor
 *  is split across two bit ranges, so this is not just a shift. */
function deviceName(stDev: string): string {
  const dev = BigInt(stDev);
  const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & ~0xfffn);
  const minor = (dev & 0xffn) | ((dev >> 12n) & ~0xffn);
  return `${major}:${minor}`;
}

/** The PIDs `procHoldersScript` found holding one of the extents. */
export function parseProcHolders(output: string): number[] {
  const extents = new Set<string>();
  const mounts = new Map<string, string>();
  const descriptors: { pid: number; where: string; ino: string }[] = [];
  for (const line of output.split('\n')) {
    const [kind, a, b, c] = line.trim().split(/\s+/);
    if (kind === 'E' && /^\d+$/.test(a ?? '') && b) extents.add(`${deviceName(a)} ${b}`);
    else if (kind === 'M' && b) mounts.set(a, b);
    else if (kind === 'F' && c) descriptors.push({ pid: Number(a), where: b, ino: c });
  }
  const pids = descriptors
    .filter(({ where, ino }) => {
      const device = where.startsWith('m')
        ? mounts.get(where.slice(1))
        : /^\d+$/.test(where)
          ? deviceName(where)
          : undefined;
      return device !== undefined && extents.has(`${device} ${ino}`);
    })
    .map(({ pid }) => pid);
  return [...new Set(pids)];
}

/**
 * The PIDs holding any of `extents` open, from `lsof`. For macOS, which has no
 * `/proc`.
 *
 * Run directly, not through a shell, so the timeout ends `lsof` itself; with a
 * shell in between it ends only the shell. SIGKILL is what ended the stuck
 * `fuser` processes this replaced.
 *
 * `lsof` exits 1 when nothing is open, and also when only some of the named
 * files are, after printing their holders; either way its stdout is the
 * answer. A missing `lsof` or a timeout rejects.
 */
export function lsofHolderPids(extents: string[], timeoutMs: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'lsof',
      ['-n', '-P', '-w', '-t', '--', ...extents],
      { encoding: 'utf-8', timeout: timeoutMs, killSignal: 'SIGKILL' },
      (error, stdout) => {
        if (error && typeof error.code !== 'number') reject(error);
        else resolve(parseHolderPids(stdout));
      },
    );
  });
}

/**
 * `ps -o pid=,user=,lstart=,args= -p <pids>` into holders.
 *
 * `lstart` is always five whitespace-separated fields (`Tue Sep  1 17:26:25
 * 2026`) — that fixed width is what makes the line splittable at all, since
 * both the user name and the command can contain almost anything.
 */
export function parseHolderDetails(psOutput: string): ExtentHolder[] {
  const holders: ExtentHolder[] = [];
  for (const line of psOutput.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/);
    if (!match) continue;
    holders.push({
      pid: Number(match[1]),
      user: match[2],
      startedAt: match[3].replace(/\s+/g, ' '),
      command: match[4].trim(),
    });
  }
  return holders;
}

/**
 * Drop the processes a running stone always has open on its own extents: the
 * `stoned` itself, and the gems it runs for its own housekeeping — reclaim,
 * symbol, admin, page manager.
 *
 * Each of those names its stone on the command line (`gem reclaimgcgem
 * gs64stone 1 -T 5000`). A session's gem does not: the NetLDI starts it for a
 * client and it appears as a bare `sys/gem TCP <n>`. That difference is the
 * only thing separating "the database is running normally" from "something is
 * still logged in", and without it every stop of a healthy database would
 * report the stone itself as an unknown process holding its own extent.
 */
export function sessionHolders(holders: ExtentHolder[], stoneName: string): ExtentHolder[] {
  return holders.filter((h) => !h.command.includes(stoneName));
}

/** One holder as a line a user can act on: enough to find the process, and to
 *  recognise it as their own topaz before deciding what to do with it. */
export function describeHolder(holder: ExtentHolder): string {
  const who = holder.user ? ` (${holder.user}` : '';
  const when = holder.startedAt ? `${who ? ', started ' : ' (started '}${holder.startedAt}` : '';
  const head = `PID ${holder.pid}${who}${when}${who || when ? ')' : ''}`;
  return holder.command ? `${head}\n      ${holder.command}` : head;
}

/**
 * What to say when a stone will not start because its extent is held open.
 *
 * Returns undefined when the failure is a different one, so the caller can let
 * GemStone's own output stand.
 *
 * The message stops at naming the processes and does not offer to kill them.
 * Whether a gem is safe to signal depends on what is inside it — an orphan of a
 * stone that died an hour ago is one thing, a colleague's live topaz quite
 * another — and that is the user's call, not Jasper's.
 */
export function explainExtentLocked(
  stoneName: string,
  output: string,
  holders: ExtentHolder[],
): string | undefined {
  if (!isExtentLocked(output)) return undefined;

  const preamble = `Stone "${stoneName}" could not start: its extent is already open by another process.\n\n`;

  if (holders.length === 0) {
    return (
      `${preamble}Jasper could not determine which process holds it. To find it by hand:\n\n` +
      `    lsof <database>/data/extent0.dbf\n\n` +
      `The usual cause is a gem left over from a stone that was force-stopped: it survives ` +
      `its stone and keeps the extent open. Such a gem cannot commit anything — its stone is ` +
      `gone — so ending it loses nothing, but check the command line before you do.\n\n` +
      output
    );
  }

  const list = holders.map((h) => `  • ${describeHolder(h)}`).join('\n');
  return (
    `${preamble}Held by:\n\n${list}\n\n` +
    `Jasper has not touched these processes. A "gem" here is usually left over from a stone ` +
    `that was force-stopped — it survives its stone and keeps the extent open, and cannot ` +
    `commit anything once its stone is gone, so ending it loses no data. A topaz or another ` +
    `checkout's process is a different matter. Check each command line above, then end the ` +
    `ones you recognise as orphans and start the stone again.\n\n${output}`
  );
}

/**
 * GemStone's complaint when the repository cannot be opened exclusively.
 *
 * Anchored on the phrase `startstone` actually prints:
 *
 *     reason = exclusive open:  File is open by another process.
 *
 * The `EAGAIN`/`EWOULDBLOCK` alternative catches the same failure reported
 * through errno alone, which the stone log does in some versions.
 */
export function isExtentLocked(output: string): boolean {
  return (
    /open by another process/i.test(output) ||
    (/exclusive access/i.test(output) && /EAGAIN|EWOULDBLOCK/i.test(output))
  );
}
