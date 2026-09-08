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
 * The parsing lives here, free of vscode and of ProcessManager, so the shapes
 * `lsof`, `fuser` and `ps` actually emit can be pinned down by a test rather
 * than discovered in the field.
 */

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
 * PIDs out of `lsof -t <file>` or `fuser <file>`.
 *
 * Both print bare PIDs on stdout — `lsof -t` one per line, `fuser` separated by
 * spaces — and both put everything else (headers, the file name) on stderr, so
 * scraping every number in stdout is safe as long as stdout alone is captured.
 * Deduplicated: a process with the file open twice is listed twice by `lsof`,
 * and one entry per process is what a reader wants.
 */
export function parseHolderPids(output: string): number[] {
  const pids = (output.match(/\d+/g) ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(pids)];
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
      `${preamble}Jasper could not determine which process holds it — \`lsof\` and \`fuser\` ` +
      `were both unavailable or reported nothing. To find it by hand:\n\n` +
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
