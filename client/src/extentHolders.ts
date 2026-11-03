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

import { shellQuote } from './shellQuote';

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
 * and `mountinfo` turns the mount id into a device. Mount ids are unique
 * system-wide, but each mount namespace's `mountinfo` lists only its own, so
 * for a holder in a container the script reads that holder's `mountinfo` too.
 * The extent is identified the same way, by opening it read-only for a moment
 * and reading the script's own `fdinfo`: `stat` would name a btrfs subvolume's
 * own device, which `mountinfo` never shows, and nothing would ever match.
 *
 * Only descriptors whose link ends in an extent's name, or in the name of the
 * file it is a symlink to, are looked at; reading every descriptor's `fdinfo`
 * measured 1.3 s against 0.05 s. Kernels before Linux 5.14 have no `ino:` in
 * `fdinfo`, and there both sides fall back to `stat`; that does touch the
 * mount, so on those kernels a same-named file held on a dead mount can still
 * stall the scan.
 *
 * Without root it sees only the user's own processes.
 *
 * Prints `E` per extent and `F <pid>` per candidate descriptor, each followed
 * by `m<mount id> <ino>` (or `<st_dev> <ino>` from `stat`); a bare `U` for an
 * extent that exists but cannot be opened; and `M <mount id> <major:minor>`
 * per mount. `parseProcHolders` reads it.
 */
export function procHoldersScript(extents: string[]): string {
  const readFdinfo = (file: string) => [
    `  mnt= ino=`,
    `  while IFS=': \t' read -r key value; do`,
    `    case $key in mnt_id) mnt=$value ;; ino) ino=$value ;; esac`,
    `  done < ${file}`,
  ];
  return [
    // A failed `exec` redirect would otherwise end the script under dash.
    `exec 2>/dev/null`,
    // find's -lname takes a pattern; `[1]` in a name would match "1", not itself.
    `glob() { printf '%s\\n' "$1" | sed 's/[][*?\\\\]/\\\\&/g'; }`,
    `set --`,
    `for e in ${extents.map(shellQuote).join(' ')}; do`,
    `  command exec 9< "$e" || { [ -e "$e" ] && echo U; continue; }`,
    ...readFdinfo(`/proc/$$/fdinfo/9`),
    `  if [ -n "$ino" ]; then echo "E m$mnt $ino"`,
    `  else echo "E $(stat -L -c '%d %i' "$e")"; fi`,
    `  real=$(readlink /proc/$$/fd/9)`,
    `  exec 9<&-`,
    `  set -- "$@" -o -lname "*/$(glob "\${e##*/}")" -o -lname "*/$(glob "\${real##*/}")"`,
    `done`,
    `[ $# -gt 0 ] || exit 0`,
    `shift`,
    `known=' '`,
    `while read -r id _ dev _; do echo "M $id $dev"; known="$known$id "; done < /proc/self/mountinfo`,
    `find /proc/[0-9]*/fd -mindepth 1 -maxdepth 1 \\( "$@" \\) |`,
    `while IFS= read -r fd; do`,
    ...readFdinfo(`"\${fd%/fd/*}/fdinfo/\${fd##*/}"`),
    `  pid=\${fd#/proc/}; pid=\${pid%%/*}`,
    `  case $known in *" $mnt "*) ;; *)`,
    `    while read -r id _ dev _; do echo "M $id $dev"; known="$known$id "; done < /proc/$pid/mountinfo`,
    `  esac`,
    `  if [ -n "$ino" ]; then echo "F $pid m$mnt $ino"`,
    `  else echo "F $pid $(stat -L -c '%d %i' "$fd")"; fi`,
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

/** The PIDs `procHoldersScript` found holding one of the extents, or undefined
 *  when it could not identify every extent that exists (`U`: one could not be
 *  opened; or its device and inode are missing or name no known mount), since
 *  who holds that one is then unknown. */
export function parseProcHolders(output: string): number[] | undefined {
  const extents: { where: string; ino: string }[] = [];
  const mounts = new Map<string, string>();
  const descriptors: { pid: number; where: string; ino: string }[] = [];
  for (const line of output.split('\n')) {
    const [kind, a, b, c] = line.trim().split(/\s+/);
    if (kind === 'E') {
      if (!b) return undefined;
      extents.push({ where: a, ino: b });
    } else if (kind === 'U') return undefined;
    else if (kind === 'M' && b) mounts.set(a, b);
    else if (kind === 'F' && c) descriptors.push({ pid: Number(a), where: b, ino: c });
  }
  const identity = ({ where, ino }: { where: string; ino: string }) => {
    const device = where.startsWith('m')
      ? mounts.get(where.slice(1))
      : /^\d+$/.test(where)
        ? deviceName(where)
        : undefined;
    return device === undefined ? undefined : `${device} ${ino}`;
  };
  if (extents.length === 0) return undefined;
  if (extents.some((e) => identity(e) === undefined)) return undefined;
  const held = new Set(extents.map(identity));
  const pids = descriptors
    .filter((d) => {
      const id = identity(d);
      return id !== undefined && held.has(id);
    })
    .map(({ pid }) => pid);
  return [...new Set(pids)];
}

/** How long past its own timeout `runLsof` waits for `lsof` to exit. */
const LSOF_EXIT_GRACE_MS = 1_000;

/**
 * Run `lsof` and answer its stdout. For macOS, which has no `/proc`.
 *
 * Run directly, not through a shell, so the timeout ends `lsof` itself; with a
 * shell in between it ends only the shell. `-O` keeps `lsof` from making its
 * risky calls in a child process, which the timeout would not reach either.
 * SIGKILL, because it cannot be caught or ignored.
 *
 * `execFile` reports only once `lsof` has exited, and a process waiting in the
 * kernel on a hard NFS mount may not die even on SIGKILL until the mount
 * answers; a second timer gives up on it regardless.
 *
 * `lsof` exits 1 both when nothing is open and when it hit an error, such as a
 * file it could not stat. Under `-w` only the error writes to stderr, so that
 * is what tells them apart. An error rejects even when stdout has an answer for
 * the other files: what it says about the one that failed is unknown.
 */
function runLsof(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error(`lsof did not exit within ${timeoutMs + LSOF_EXIT_GRACE_MS} ms`)),
      timeoutMs + LSOF_EXIT_GRACE_MS,
    );
    execFile(
      'lsof',
      ['-n', '-P', '-w', '-O', ...args],
      { encoding: 'utf-8', timeout: timeoutMs, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        clearTimeout(deadline);
        if ((error && typeof error.code !== 'number') || stderr.trim()) {
          reject(error ?? new Error(stderr));
        } else resolve(stdout);
      },
    );
  });
}

/** The PIDs holding any of `extents` open, from `lsof`. */
export async function lsofHolderPids(extents: string[], timeoutMs: number): Promise<number[]> {
  return parseHolderPids(await runLsof(['-t', '--', ...extents], timeoutMs));
}

/** Every file process `pid` has open, from `lsof -Fn`, whose name lines start
 *  with `n`. */
export async function lsofOpenFiles(pid: number, timeoutMs: number): Promise<string[]> {
  const output = await runLsof(['-p', String(pid), '-Fn'], timeoutMs);
  return output
    .split('\n')
    .filter((line) => line.startsWith('n'))
    .map((line) => line.slice(1));
}

/** A shell script printing the file behind each of process `pid`'s
 *  descriptors. `readlink` reads only the link's text, so like
 *  `procHoldersScript` it never touches the file's mount. */
export function procOpenFilesScript(pid: number): string {
  return `for f in /proc/${pid}/fd/*; do readlink "$f"; done 2>/dev/null`;
}

/**
 * The extents among the files a running stone has open.
 *
 * A stone holds every extent it runs on, which is how Jasper finds a registered
 * database's extents, wherever its installation keeps them. It holds other
 * files too: its log, its transaction logs (also `.dbf`, named `tranlog<n>` by
 * default), and whatever it inherited from the process that started it. An
 * extent named some other way is missed, which leaves the caller unable to
 * check rather than wrongly sure.
 */
export function extentsAmongOpenFiles(files: string[]): string[] {
  const extents = files.filter((file) => {
    const name = file.slice(file.lastIndexOf('/') + 1);
    return /\.dbf$/i.test(name) && !/^tranlog/i.test(name);
  });
  return [...new Set(extents)];
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
 *
 * The by-hand command for Linux reads `/proc` rather than running `lsof`: an
 * empty scan can mean a dead mount, and `lsof` would hang the user's terminal
 * on it the same way. It matches on the extent's name alone, because `-lname`
 * compares the resolved path and a database path typed through a symlink would
 * match nothing; each line names the extent, so the user can tell databases
 * apart.
 */
export function explainExtentLocked(
  stoneName: string,
  output: string,
  holders: ExtentHolder[],
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (!isExtentLocked(output)) return undefined;

  const preamble = `Stone "${stoneName}" could not start: its extent is already open by another process.\n\n`;

  if (holders.length === 0) {
    return (
      `${preamble}Jasper could not determine which process holds it. To find it by hand:\n\n` +
      (platform === 'darwin'
        ? `    lsof <path to extent0.dbf>\n\n`
        : (platform === 'win32' ? `  In a WSL terminal:\n\n` : '') +
          `    find /proc/[0-9]*/fd -lname '*/extent0.dbf' -printf '%p -> %l\\n' 2>/dev/null\n\n` +
          `  (each line is /proc/<process id>/fd/… -> the extent it holds)\n\n`) +
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
