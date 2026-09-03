import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { SysadminStorage } from '../sysadminStorage';
import { GemStoneDatabase, GemStoneProcess } from '../sysadminTypes';
import { DEFAULT_GS_PW } from '../loginTypes';
import { appendSysadmin, showSysadmin } from '../sysadminChannel';
import { needsWsl, windowsPathToWsl, wslSpawn, wslExecSync, wslExec } from '../wslBridge';
import {
  ExtentHolder,
  parseHolderPids,
  parseHolderDetails,
  explainExtentLocked,
} from '../extentHolders';
import { wslReaddirSync } from '../wslFs';
import { versionsMatch } from './versionMatch';
import { isRegisteredDatabase, registeredPaths, versionMismatchNote } from './registeredDatabase';
import {
  ExternalServer,
  ExternalServerFinding,
  HostServerProcess,
  commandIsServer,
  findExternalServerCandidates,
  parseHostServerProcesses,
  parseServerEnvironment,
  pickExternalServer,
  withServerEnvironment,
} from '../externalServerScan';
import { explainMissingInstall, explainStartFailure } from '../startFailureMessage';

/** Ceiling on the `ps` calls the external-server scan makes. They run
 *  synchronously from the Databases tree's getChildren, on the extension host's
 *  event loop, and under WSL each is a `wsl.exe` spawn — so a hung one would
 *  freeze the editor with no way out. Generous for a process-table read; the
 *  callers' catch degrades to "saw nothing", which is the safe direction. */
const PS_TIMEOUT_MS = 5000;

/** A stone or NetLDI found running out of a product tree, with everything
 *  registering it as a database needs: its name, where it registers, and the
 *  configuration it was started with. See `discoverServersUnder`. */
export interface DiscoveredServer {
  type: 'stone' | 'netldi';
  name: string;
  pid: number;
  version?: string;
  globalDir?: string;
  confPath?: string;
  port?: number;
  status?: string;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

// versionsMatch lives in versionMatch.ts so the process-table scan can share it
// without importing this module (which would make the two circular). Re-exported
// here because this is where callers have always found it.
export { versionsMatch } from './versionMatch';

/** Options shared by the process-start commands. */
export interface StartOptions {
  /** Whether to reveal the GemStone Admin output channel. Defaults to true —
   *  pass false when the start is a step inside a larger flow that owns the
   *  user's attention (see the login auto-start recovery). */
  reveal?: boolean;
}

export interface StaleLockReport {
  /** Path to the .LCK file on the host filesystem (a WSL path under Windows). */
  lockPath: string;
  /** True when we believe the lock is orphaned and safe to remove. */
  safe: boolean;
  /** One-line explanation suitable for a confirmation dialog. */
  reason: string;
  /** Current command line `ps` reports for the recorded PID, when known. */
  currentPidOwner?: string;
}

export interface ForceKillResult {
  /** True when the stone is (now) stopped — killed, or already not running. */
  killed: boolean;
  /** One-line explanation suitable for a notification. */
  reason: string;
}

/** Classify what `ps -p <pid> -o command=` returned. Exported so the safety
 *  rule can be tested without spawning a shell.
 *
 *  `psOutput` is the trimmed stdout from
 *  `ps -p <pid> -o command= 2>/dev/null || echo GONE`. */
export function classifyPidOwnership(psOutput: string): {
  pidGone: boolean;
  isGemStoneServer: boolean;
  command: string;
} {
  const command = psOutput.trim();
  if (command === '' || command === 'GONE') {
    return { pidGone: true, isGemStoneServer: false, command: '' };
  }
  // Real stoned/netldid processes have one of those tokens as the executable
  // basename (matched at a word boundary so unrelated apps like
  // "ssh-agent" or "iTunesHelper" do not get a false positive).
  const lowered = command.toLowerCase();
  const looksLikeServer = /(?:^|[/\s])(?:stoned|netldid)(?:\s|$)/.test(lowered);
  return { pidGone: false, isGemStoneServer: looksLikeServer, command };
}

/**
 * Whether a failed `gslist` run failed only by finding nothing.
 *
 * `gslist -cvl` exits 1 and prints "No GemStone servers." for a directory nothing
 * has registered in, which `execSync` surfaces as a thrown error indistinguishable
 * from a real one — a missing binary, an unreadable lock directory. The message is
 * the only thing that separates them, and it can arrive on either stream depending
 * on the release, so both are searched.
 *
 * Exported for testing.
 */
export function saysNoServers(error: unknown): boolean {
  const streams = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
  const text = [streams?.stdout, streams?.stderr, streams?.message]
    .map((part) => (part === undefined || part === null ? '' : String(part)))
    .join('\n');
  return /no\s+gemstone\s+servers/i.test(text);
}

/** Parse `gslist -cvl` output into structured process records.
 *  Exported for testing. Lines that don't match the data-row format
 *  (header, separator, info lines, blanks) are silently skipped. */
export function parseGslist(output: string): GemStoneProcess[] {
  const processes: GemStoneProcess[] = [];
  for (const line of output.split('\n')) {
    // Data row: {status}  {version}  {owner}  {pid} {port} {month} {day} {time} {type}  {name}
    // Status can be one word ("OK", "frozen", "killed", "exists", "unknown(EPERM)")
    // or two ("exe deleted"). We anchor on the version, which always starts with a digit,
    // so the non-greedy first capture absorbs the status without eating into version.
    const match = line.match(
      /^\s*(\S+(?: \S+)?)\s+(\d[\d.]*)\s+\S+\s+(\d+)\s+(\d+)\s+(\w+\s+\d+\s+[\d:]+)\s+(Stone|Netldi)\s+(.+)$/i,
    );
    if (!match) continue;
    const typeLower = match[6].toLowerCase();
    if (typeLower !== 'stone' && typeLower !== 'netldi') continue;
    const type = typeLower === 'stone' ? 'stone' : 'netldi';
    const status = match[1].trim();
    const proc: GemStoneProcess = {
      type,
      version: match[2],
      pid: parseInt(match[3], 10),
      name: match[7].trim(),
      startTime: match[5],
      status,
      responding: status.toUpperCase() === 'OK',
    };
    if (type === 'netldi') {
      proc.port = parseInt(match[4], 10);
    }
    processes.push(proc);
  }
  return processes;
}

/** Wrap a value in single quotes, escaping any single quotes it contains,
 *  so it survives verbatim through a POSIX shell. */
export function shellSingleQuote(v: string): string {
  return `'${v.split("'").join(`'\\''`)}'`;
}

/** Shell `export` statements for an environment, single-quote escaped.
 *  Used both to seed a WSL terminal and to re-assert Jasper's values in a
 *  native one after the user's startup files have had their turn. */
export function exportCommand(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `export ${k}=${shellSingleQuote(v)}`)
    .join('; ');
}

export class ProcessManager {
  private cachedProcesses: GemStoneProcess[] = [];
  /** Host process table, scanned at most once per refresh and only when
   *  something is missing from gslist. Undefined = not scanned yet. */
  private cachedHostServers: HostServerProcess[] | undefined;
  /** External-server verdict per database dirName, for the same refresh.
   *  Absent = not asked yet; a stored `{}` is a real "nothing external". */
  private cachedExternal = new Map<string, ExternalServerFinding>();
  /**
   * Whether the last `refreshProcesses` actually got an answer out of gslist.
   *
   * `cachedProcesses` goes empty for three different reasons — gslist ran and
   * found nothing, there was no extracted version to run it from, or the spawn
   * threw — and only the first means "nothing is registered where Jasper
   * looks". The external-server cross-check turns that distinction into an
   * accusation and then into a kill, so it must not guess: "we could not look"
   * can never be allowed to read as "we looked and it wasn't there".
   */
  private gslistReadable = false;

  constructor(private storage: SysadminStorage) {}

  getProcesses(): GemStoneProcess[] {
    return this.cachedProcesses;
  }

  /** Run gslist -cvl and parse output */
  refreshProcesses(): GemStoneProcess[] {
    // The host scan and the external-server verdicts derived from it are only
    // meaningful next to a given gslist reading, so they expire with it.
    this.cachedHostServers = undefined;
    this.cachedExternal.clear();
    this.gslistReadable = false;
    const gslistPath = this.findGslist();
    if (!gslistPath) {
      this.cachedProcesses = [];
      return [];
    }
    const gsPath = gslistPath.replace(/\/bin\/gslist$/, '');
    const rootPath = needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath();
    const own = this.readGslist(gsPath, rootPath);
    // An answer, empty or not, is the signal that the read happened; only an
    // unreadable listing leaves this false.
    if (own !== undefined) this.gslistReadable = true;
    // The registered databases are read whether or not Jasper's own listing came
    // back. They register in someone else's directory, so their servers are there
    // to be found even when Jasper's own root has nothing to say — and a failure
    // here used to take them down with it, reporting every registered stone as
    // Stopped while it was plainly running.
    this.cachedProcesses = [...(own ?? []), ...this.registeredProcesses(own ?? [])];
    return this.cachedProcesses;
  }

  /**
   * One `gslist -cvl` reading of a directory, or undefined when it could not be
   * read at all.
   *
   * `gslist` exits non-zero when it finds nothing — "No GemStone servers." for a
   * directory nothing has registered in — and `execSync` raises a non-zero exit as
   * an error. That is an answer, and a completely ordinary one: a machine whose
   * databases are all registered from elsewhere has nothing in Jasper's own root
   * by definition. Reading it as a failure is what made every registered database
   * read Stopped there.
   */
  private readGslist(gsPath: string, globalDir: string): GemStoneProcess[] | undefined {
    try {
      const env = this.versionEnvironment(gsPath, globalDir);
      return parseGslist(wslExecSync(`"${gsPath}/bin/gslist" -cvl`, env));
    } catch (e) {
      return saysNoServers(e) ? [] : undefined;
    }
  }

  /**
   * The servers of the *registered* databases, read where they actually
   * register rather than where Jasper does.
   *
   * A registered database's stone was started by someone else, in someone
   * else's `GEMSTONE_GLOBAL_DIR` — so Jasper's own `gslist` cannot see it, and
   * the row would read Stopped while the stone is plainly up. That blind spot
   * is what `externalServerScan` exists to notice; for a database Jasper has
   * been *told* about, there is a better answer than noticing: ask `gslist`
   * about the directory the database records, with the installation's own
   * `gslist` binary. That gives the same facts as any other row — status, PID,
   * port and the version actually running — instead of the little a process
   * table can prove.
   *
   * Reading is all this does. One directory is read once even when several
   * databases share it, rows already seen in Jasper's own listing are not
   * duplicated, and an installation that cannot be read reports nothing rather
   * than failing the whole refresh.
   */
  private registeredProcesses(own: GemStoneProcess[]): GemStoneProcess[] {
    const rows: GemStoneProcess[] = [];
    const read = new Set<string>([
      needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath(),
    ]);
    for (const db of this.storage.getDatabases()) {
      const registered = registeredPaths(db.config);
      if (!registered) continue;
      const globalDir = needsWsl() ? windowsPathToWsl(registered.globalDir) : registered.globalDir;
      if (read.has(globalDir)) continue;
      read.add(globalDir);
      const gsPath = needsWsl() ? windowsPathToWsl(registered.productPath) : registered.productPath;
      const found = this.readGslist(gsPath, globalDir);
      if (found === undefined) {
        appendSysadmin(
          `Could not list servers for registered database ${db.dirName} in ${globalDir}`,
        );
        continue;
      }
      for (const proc of found) {
        const seen = own.some(
          (p) => p.type === proc.type && p.name === proc.name && p.pid === proc.pid,
        );
        if (!seen) rows.push({ ...proc, globalDir });
      }
    }
    return rows;
  }

  /**
   * What is running right now out of a GemStone product tree — the answer the
   * Register Existing form needs before it can be filled in correctly.
   *
   * Registering an installation means recording where its servers register and
   * what configuration they run on, and the only authority on both is a running
   * server: its `GEMSTONE_GLOBAL_DIR` is where `startstone` put its lock, and
   * its `-e`/`-z` argument is the configuration it was actually started with.
   * Guessing those from GemStone's defaults works for a stock layout and is
   * wrong for any other, which would leave Jasper unable to stop the very
   * stone it just adopted.
   *
   * A process-table read plus, for each directory those processes name, one
   * `gslist` in it — so a discovered server carries its port and status too.
   * Read-only from end to end, and empty rather than throwing when the host
   * will not answer: a stopped installation can still be registered by hand.
   */
  discoverServersUnder(productPath: string): DiscoveredServer[] {
    const tree = productPath.replace(/\/+$/, '');
    const found: DiscoveredServer[] = [];
    let hosts: HostServerProcess[];
    try {
      hosts = this.hostServers().filter((p) => p.command.startsWith(`${tree}/`));
    } catch {
      return [];
    }
    for (const host of hosts) {
      const env = this.serverEnvironment(host.pid);
      found.push({
        type: host.type,
        name: host.name,
        pid: host.pid,
        version: host.version,
        globalDir: env.GEMSTONE_GLOBAL_DIR,
        // The configuration the server was started with, in the order GemStone
        // itself resolves it: the explicit argument first, its environment
        // second. Both name a file or a directory; the caller records it as-is
        // rather than trimming it to a directory, since GemStone accepts either.
        confPath: host.dbPathHints[0] ?? env.GEMSTONE_SYS_CONF ?? env.GEMSTONE_EXE_CONF,
      });
    }

    // One gslist per directory the discovered servers register in, to put a
    // port (and the version GemStone itself reports) on each row.
    for (const globalDir of new Set(found.map((f) => f.globalDir).filter(isDefined))) {
      // No gslist reading for this directory leaves each row with what the process
      // table gave it, which is enough to register with.
      for (const row of this.readGslist(tree, globalDir) ?? []) {
        for (const entry of found) {
          if (entry.type !== row.type || entry.name !== row.name) continue;
          entry.port = row.port;
          entry.status = row.status;
          entry.version = row.version || entry.version;
        }
      }
    }
    return found;
  }

  /**
   * The versions of servers running under this database's names that are not
   * the version it is recorded as — one entry per server that disagrees.
   *
   * Recorded and running can differ for any database (a stone started from a
   * different install by hand), but a registered one is where it happens by
   * ordinary accident: its record names the product tree it was registered
   * from, and nothing stops someone starting that stone name from another. The
   * commands refuse to start or stop such a server (see `versionMismatchNote`),
   * because `startstone` would collide with a live stone and a stop driven by
   * the wrong product tree is the wrong binaries aimed at a live extent.
   *
   * Name alone identifies the server here, deliberately: matching on version
   * too is what hides a mismatch as an absence.
   */
  getVersionMismatch(db: GemStoneDatabase): { stone?: string; netldi?: string } {
    const recorded = db.config.version;
    const running = (type: 'stone' | 'netldi', name: string): string | undefined => {
      const row = this.cachedProcesses.find((p) => p.type === type && p.name === name);
      if (row) return versionsMatch(row.version, recorded) ? undefined : row.version;
      // Not in any gslist Jasper reads: the host scan may still have seen it,
      // and its version — when the product path carries one — is evidence too.
      const host = this.hostServers().find(
        (p) => p.type === type && p.name === name && p.version !== undefined,
      );
      return host?.version && !versionsMatch(host.version, recorded) ? host.version : undefined;
    };
    const stone = running('stone', db.config.stoneName);
    const netldi = running('netldi', db.config.ldiName);
    return { ...(stone ? { stone } : {}), ...(netldi ? { netldi } : {}) };
  }

  /**
   * Why this database cannot be started or stopped right now, or undefined when
   * it can: the wording that names both versions, for whichever server
   * disagrees. Every surface that can act on a server goes through it, so one
   * rule covers the panel, the sidebar and the palette.
   */
  versionMismatchRefusal(db: GemStoneDatabase, type?: 'stone' | 'netldi'): string | undefined {
    const mismatch = this.getVersionMismatch(db);
    const stone = versionMismatchNote(db.config.version, mismatch.stone, 'stone');
    const netldi = versionMismatchNote(db.config.version, mismatch.netldi, 'NetLDI');
    if (type === 'stone') return stone;
    if (type === 'netldi') return netldi;
    return stone ?? netldi;
  }

  /**
   * The port this database's NetLDI is listening on right now, from whichever
   * `gslist` reading saw it — or undefined when it is not running.
   *
   * The live answer, not the recorded one. A NetLDI takes a fresh ephemeral port
   * every time it starts unless it is told which to use, so a port written down
   * when a database was registered describes only that moment: restart the
   * NetLDI and every login built from the record dials a port nobody is
   * listening on, which surfaces as `ECONNABORTED` rather than as anything
   * mentioning ports. `startNetldi` pins the recorded port precisely so this
   * stops moving; this is what keeps the record and the logins honest when
   * something else moved it.
   */
  netldiPortFor(db: GemStoneDatabase): number | undefined {
    return this.cachedProcesses.find(
      (p) =>
        p.type === 'netldi' &&
        p.name === db.config.ldiName &&
        versionsMatch(p.version, db.config.version),
    )?.port;
  }

  /** Which directory identifies this database on a running server's command
   *  line: its installation for a registered database, its own directory for
   *  one Jasper laid out. */
  private identityDirFor(db: GemStoneDatabase): string {
    const registered = registeredPaths(db.config);
    const dir = registered ? registered.identityDir : db.path;
    return needsWsl() ? windowsPathToWsl(dir) : dir;
  }

  /** Determine whether the .LCK file for a stale process appears safe to remove.
   *  Safe = recorded PID is gone, or has been reused by some non-GemStone process.
   *  Unsafe = a real stoned/netldid is still running under that PID (a genuinely
   *  hung server that the operator should investigate, not auto-clean). */
  inspectStaleLock(proc: GemStoneProcess): StaleLockReport {
    // `globalDir` is set on rows that came from a registered database's own
    // gslist; Jasper's root is right for everything it manages itself. Looking
    // in the wrong directory finds no lock and reads as a server that vanished.
    const rootPath =
      proc.globalDir ?? (needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath());
    return this.inspectLockAt(proc.name, proc.pid, rootPath);
  }

  /**
   * The same safety rule as `inspectStaleLock`, for a lock whose directory is
   * named explicitly rather than assumed to be Jasper's own root.
   *
   * Split out because a server started outside Jasper has no gslist record to
   * pass — that is what makes it external — and its lock lives in whichever
   * `locks/` directory it registered in. The rule itself is unchanged and is
   * exactly the one wanted there: a PID that is still a live GemStone server
   * means the lock is in use, whoever owns the directory.
   */
  inspectLockAt(name: string, pid: number, rootPath: string): StaleLockReport {
    const lockPath = `${rootPath.replace(/\/+$/, '')}/locks/${name}..LCK`;
    let psOutput = '';
    try {
      // `|| echo GONE` collapses the "no such pid" exit into stdout so we get
      // one branch to parse instead of catching and decoding errno strings.
      psOutput = wslExecSync(`ps -p ${pid} -o command= 2>/dev/null || echo GONE`).trim();
    } catch {
      // execSync threw before producing output — likely no shell or ps. Treat
      // as inconclusive; the safer default is to refuse.
      return {
        lockPath,
        safe: false,
        reason: `Could not check PID ${pid} (ps unavailable). Refusing to delete the lock.`,
      };
    }
    const ownership = classifyPidOwnership(psOutput);
    if (ownership.pidGone) {
      return {
        lockPath,
        safe: true,
        reason: `PID ${pid} no longer exists. The lock file is orphaned.`,
      };
    }
    if (ownership.isGemStoneServer) {
      return {
        lockPath,
        safe: false,
        reason: `PID ${pid} is still a running GemStone server (${ownership.command}). Use stopstone instead.`,
        currentPidOwner: ownership.command,
      };
    }
    return {
      lockPath,
      safe: true,
      reason: `PID ${pid} has been reused by an unrelated process (${ownership.command}). The lock file is orphaned.`,
      currentPidOwner: ownership.command,
    };
  }

  /** Delete the .LCK file at `lockPath`. Returns true on success.
   *  Callers must inspect safety first; this method does not re-check. */
  deleteStaleLock(lockPath: string): boolean {
    try {
      wslExecSync(`rm -f "${lockPath.replace(/"/g, '\\"')}"`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The `stoned` / `netldid` processes alive on the host, whether or not
   * Jasper's `gslist` knows about them. Scanned at most once between refreshes,
   * because the only caller that needs it asks per database row.
   */
  private hostServers(): HostServerProcess[] {
    if (this.cachedHostServers) return this.cachedHostServers;
    try {
      // `-A`, not `-e`: on procps the two are synonyms for "every process", but
      // on BSD/Darwin `-e` means "also show the environment" and is not a
      // selection flag at all — so `ps -eo …` there lists only the invoking
      // user's processes that have a controlling terminal, which a detached
      // stoned or netldid never does, and the scan would come back empty on
      // every Mac. `-A` selects on both.
      this.cachedHostServers = parseHostServerProcesses(
        wslExecSync('ps -Ao pid=,command=', undefined, { timeout: PS_TIMEOUT_MS }),
      );
    } catch {
      // No ps, or a process table we could not read. An empty scan means "we
      // saw nothing", which leaves every state exactly as it was before this
      // detection existed — never a false accusation that a server is external.
      this.cachedHostServers = [];
    }
    return this.cachedHostServers;
  }

  /** Read a running process's GemStone environment. `ps eww` appends the
   *  environment to the command line, which is where `GEMSTONE_GLOBAL_DIR`
   *  (the directory the server registered in) and the conf/log paths that
   *  identify its database live. Best effort: an unreadable environment just
   *  leaves what the command line already told us — which on macOS may be
   *  always, since it has not let `ps` read another process's environment for
   *  many releases. There the command line is the only identity evidence. */
  private serverEnvironment(pid: number): Record<string, string> {
    try {
      return parseServerEnvironment(
        wslExecSync(`ps eww -p ${pid} -o command= 2>/dev/null || true`, undefined, {
          timeout: PS_TIMEOUT_MS,
        }),
      );
    } catch {
      return {};
    }
  }

  /**
   * Which of a database's servers are running on the host but missing from
   * Jasper's own `gslist` — started outside Jasper's environment, and so
   * registered in a `locks/` directory Jasper does not look in.
   *
   * This is the cross-check that keeps the Databases view honest. Jasper's
   * `gslist` is authoritative about what Jasper manages and blind to
   * everything else, so on its own it reports a live external server as
   * *Stopped* — and then a login that plainly cannot work looks like a database
   * that merely needs starting.
   *
   * Costs nothing in the healthy case: when both servers are already visible to
   * `gslist` there is nothing to explain, so the process table is never
   * scanned. Memoized per database until the next `refreshProcesses()`.
   *
   * Reports nothing at all unless the gslist read succeeded. An unreadable
   * gslist leaves an empty process list, which would otherwise make every live
   * server look absent from it — including servers Jasper started itself, which
   * would then be offered up for a restart and a kill.
   */
  getExternalServers(db: GemStoneDatabase): ExternalServerFinding {
    const cached = this.cachedExternal.get(db.dirName);
    if (cached) return cached;

    let finding: ExternalServerFinding = {};
    const bothVisible =
      this.isStoneRunning(db.config.stoneName, db.config.version) &&
      this.isNetldiRunning(db.config.ldiName, db.config.version);
    if (this.gslistReadable && !bothVisible) {
      // Which directory identifies this database on a server's command line.
      // For a registered database that is its installation, not Jasper's record
      // directory — the running server's `-e`/`-z`/`-l` paths have never heard
      // of the latter, so judging identity by it would call the real server
      // somebody else's.
      const dbPath = this.identityDirFor(db);
      const target = { path: dbPath, config: db.config };
      const candidates = findExternalServerCandidates(
        target,
        this.getProcesses(),
        this.hostServers(),
      );
      // Every candidate's environment is read before any of them is picked: a
      // server the command line cannot place is often placed by its
      // environment, and that can change which of two same-named servers wins.
      const settle = (found: ExternalServer[]): ExternalServer | undefined =>
        pickExternalServer(
          found
            .map((s) => withServerEnvironment(s, this.serverEnvironment(s.process.pid), dbPath))
            .filter((s) => this.stillMatchesVersion(s, db.config.version))
            .filter((s) => !this.registeredWhereJasperLooks(s)),
        );
      const stone = settle(candidates.stone);
      const netldi = settle(candidates.netldi);
      finding = { ...(stone && { stone }), ...(netldi && { netldi }) };
    }
    this.cachedExternal.set(db.dirName, finding);
    return finding;
  }

  /** Drop a candidate whose version only became known from its environment and
   *  turns out to belong to a different install. `findExternalServerCandidates`
   *  admits an unparseable version on name alone — deliberately — but once the
   *  real one is in hand there is no reason to keep guessing. */
  private stillMatchesVersion(server: ExternalServer, version: string): boolean {
    const found = server.process.version;
    return !found || versionsMatch(found, version);
  }

  /** True when the server is registered in the very directory Jasper's own
   *  gslist reads, which makes "started outside Jasper's environment" false
   *  whatever gslist reported. The backstop behind `gslistReadable`: it catches
   *  any other way a server Jasper manages could go missing from that listing,
   *  and it is the one fact that settles the question outright. */
  private registeredWhereJasperLooks(server: ExternalServer): boolean {
    const root = needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath();
    const globalDir = server.process.globalDir;
    return globalDir !== undefined && globalDir.replace(/\/+$/, '') === root.replace(/\/+$/, '');
  }

  /**
   * Clean-stop a server that is registered outside Jasper.
   *
   * The stop scripts find their target through `GEMSTONE_GLOBAL_DIR`, so
   * running them in Jasper's own environment would look for the server in
   * Jasper's `locks/` directory and report it as not running — the very blind
   * spot that got us here. Pointing them at the directory the server actually
   * registered in is what lets it stop cleanly instead of being killed.
   *
   * Only `GEMSTONE_GLOBAL_DIR` is taken from the running server, not its
   * `GEMSTONE_NRS_ALL`. That variable can carry `#dir:` and `#netldi:`
   * components which would also steer the stop, and `parseServerEnvironment`
   * does capture it — but adopting a foreign NRS string wholesale is how a
   * command ends up somewhere nobody intended, which is the hazard this branch
   * exists to remove rather than spread. When the global dir is not enough to
   * reach the server, the kill fallback is the answer.
   *
   * Rejects if the stop fails, leaving the caller to fall back to
   * `killHostServer`.
   */
  async stopExternalServer(
    db: GemStoneDatabase,
    server: ExternalServer,
    password: string = DEFAULT_GS_PW,
  ): Promise<string> {
    const gsPath = this.productPathFor(db);
    const globalDir =
      server.process.globalDir ??
      (needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath());
    const env = this.versionEnvironment(gsPath, globalDir);
    if (server.process.type === 'netldi') {
      return this.runCommand(
        `${gsPath}/bin/stopnetldi`,
        [server.process.name],
        env,
        `Stopping externally started NetLDI ${server.process.name}`,
        { reveal: false },
      );
    }
    return this.runCommand(
      `${gsPath}/bin/stopstone`,
      [server.process.name, 'DataCurator', password],
      env,
      `Stopping externally started stone ${server.process.name}`,
      { reveal: false },
    );
  }

  /**
   * Signal a host process by PID, for a server a clean stop could not reach.
   *
   * Unlike `forceKillStone` this does not go through gslist — an external
   * server is by definition absent from it — so the PID comes from the process
   * scan. The safety re-check before signalling is correspondingly stricter:
   * not just "is this still a GemStone server" but "is it still *this* server,
   * by name". The reconcile that leads here holds its PID across a modal dialog
   * the user can sit on indefinitely, so the number has had real time to be
   * recycled — possibly onto another stone, which the weaker check would wave
   * through.
   *
   * A SIGKILL leaves the server's `..LCK` behind, so a confirmed server whose
   * registration directory is known gets that lock cleared too. It is a lock on
   * the database Jasper manages, orphaned by Jasper's own signal: leaving it
   * means `gslist` in the user's own shell keeps listing a dead stone, and their
   * next `startstone` from that shell refuses (for a netldi, the lock also holds
   * its port). Jasper's own restart would work, because it starts in its own
   * root — which is exactly why this would never show up in Jasper's own
   * testing. Only *unconfirmed* identity or an unknown directory is left alone;
   * that really is a directory Jasper has no business writing in.
   */
  async killHostServer(
    server: ExternalServer,
    opts: { graceMs?: number } = {},
  ): Promise<ForceKillResult> {
    const { pid, name, type } = server.process;
    const label = `${type === 'stone' ? 'Stone' : 'NetLDI'} "${name}"`;
    const psFor = (p: number): string =>
      wslExecSync(`ps -p ${p} -o command= 2>/dev/null || echo GONE`).trim();

    let ownership;
    try {
      ownership = classifyPidOwnership(psFor(pid));
    } catch {
      return { killed: false, reason: `Could not verify PID ${pid}; refusing to kill.` };
    }
    if (ownership.pidGone) {
      return { killed: true, reason: `PID ${pid} was already gone.` };
    }
    if (!ownership.isGemStoneServer) {
      return {
        killed: false,
        reason: `PID ${pid} is now an unrelated process (${ownership.command}); refusing to kill.`,
      };
    }
    if (!commandIsServer(ownership.command, type, name)) {
      return {
        killed: false,
        reason:
          `PID ${pid} is a GemStone server, but no longer ${label} — it is now ` +
          `${ownership.command}. Refusing to kill it.`,
      };
    }

    try {
      const graceMs = opts.graceMs ?? 800;
      const settle = async (): Promise<void> => {
        if (graceMs > 0) await new Promise((r) => setTimeout(r, graceMs));
      };
      // "Is this server still there", not "is something GemStone-ish still
      // there": anything else under that PID — gone, recycled, a different
      // server — means the one we set out to stop is no longer running, and
      // signalling again would hit a bystander.
      const stillRunning = (): boolean => commandIsServer(psFor(pid), type, name);
      const refusal = this.signal(pid, '');
      await settle();
      if (stillRunning()) {
        this.signal(pid, '-9');
        // Wait again before believing the worst: SIGKILL is immediate but
        // reaping is not, so checking straight away can still see the process
        // and report a failure that would send the user off to resolve by hand
        // something that in fact died.
        await settle();
        if (stillRunning()) {
          // Say which of the two it is. "Survived SIGKILL" sends the user
          // looking for a wedged process; a server owned by another user needs
          // sudo, and nothing else will do.
          return {
            killed: false,
            reason: refusal
              ? `${label} (PID ${pid}) could not be signalled: ${refusal}. It is probably ` +
                `owned by another user — stop it from that user's shell, or with sudo.`
              : `${label} (PID ${pid}) survived SIGKILL.`,
          };
        }
      }
    } catch {
      return { killed: false, reason: `Failed to signal PID ${pid}.` };
    }
    return {
      killed: true,
      reason: `${label} stopped (PID ${pid}).${this.clearExternalLock(server)}`,
    };
  }

  /** Send a signal and hand back `kill`'s complaint, if it made one. The plain
   *  `2>/dev/null || true` form swallows EPERM, which then reads downstream as a
   *  process that ignored SIGKILL rather than one we were never allowed to
   *  touch. */
  private signal(pid: number, flag: string): string | undefined {
    const complaint = wslExecSync(`kill ${flag} ${pid} 2>&1 || true`).trim();
    return complaint === '' ? undefined : complaint;
  }

  /**
   * Clear the `..LCK` a killed external server left in its own registration
   * directory, when Jasper is entitled to: identity confirmed, directory known.
   *
   * Returns a sentence to append to the kill's reason — including when it
   * declined — so the outcome is never silent. Best effort: a lock we cannot
   * remove is a nuisance, not a reason to report the kill as failed.
   */
  private clearExternalLock(server: ExternalServer): string {
    const { name, pid, globalDir } = server.process;
    if (server.identity !== 'confirmed' || !globalDir) {
      return ' Its lock file was left in place, since Jasper could not confirm which database it belongs to.';
    }
    try {
      const report = this.inspectLockAt(name, pid, globalDir);
      if (!report.safe)
        return ` Its lock file ${report.lockPath} was left in place: ${report.reason}`;
      return this.deleteStaleLock(report.lockPath)
        ? ` Its stale lock file ${report.lockPath} was removed.`
        : ` Its stale lock file ${report.lockPath} could not be removed; delete it by hand.`;
    } catch {
      return ` Its lock file in ${globalDir}/locks may need removing by hand.`;
    }
  }

  private findGslist(): string | undefined {
    // Look for gslist in any extracted version
    const versions = this.storage.getExtractedVersions();
    for (const version of versions) {
      const gsPath = needsWsl()
        ? this.storage.getWslGemstonePath(version)
        : this.storage.getGemstonePath(version);
      if (gsPath) {
        const gslistPath = `${gsPath}/bin/gslist`;
        try {
          wslExecSync(`test -x "${gslistPath}"`);
          return gslistPath;
        } catch {
          continue;
        }
      }
    }
    return undefined;
  }

  /**
   * Environment for a GemStone version's product directory: the product dir,
   * the global dir, and the PATH / dynamic-library / man paths its binaries
   * need. Shared by the version terminal, the per-database environment, and
   * process listing so the three cannot drift — a version terminal that omitted
   * PATH could not find binaries in `$GEMSTONE/bin`. Callers layer any
   * stone-specific vars (GEMSTONE_SYS_CONF, GEMSTONE_LOG, …) on top.
   *
   * Every GemStone variable that can steer discovery is set here, including the
   * ones whose right value is "nothing". Commands run through wslExecSync and
   * wslSpawn inherit `process.env`, so a `GEMSTONE_NRS_ALL` left over in the
   * shell that launched the editor would otherwise reach `gslist` and the
   * version terminal — and its `#dir:` and `#netldi:` components can send them
   * somewhere other than what Jasper manages. Blanking it makes what Jasper
   * discovers a function of Jasper's own configuration alone; the per-database
   * environment sets the real value on top.
   */
  private versionEnvironment(gsPath: string, rootPath: string): Record<string, string> {
    const env: Record<string, string> = {
      GEMSTONE: gsPath,
      GEMSTONE_GLOBAL_DIR: rootPath,
      GEMSTONE_NRS_ALL: '',
      PATH: `${gsPath}/bin:/usr/local/bin:/usr/bin:/bin`,
    };
    if (process.platform === 'darwin') {
      env.DYLD_LIBRARY_PATH = `${gsPath}/lib`;
    } else {
      env.LD_LIBRARY_PATH = `${gsPath}/lib`;
    }
    env.MANPATH = `${gsPath}/doc`;
    return env;
  }

  /** Why Jasper cannot run a version's binaries, naming the root it searched.
   *  See explainMissingInstall for why it is not phrased as a missing setting. */
  private missingInstallMessage(version: string): string {
    return explainMissingInstall(version, this.storage.getRootPath());
  }

  /**
   * The product tree whose binaries run this database.
   *
   * A registered database names its own tree, and that name wins over a lookup
   * by version: two installations can report the same version, and the one that
   * matters is the one the database was registered from — not whichever tree
   * Jasper happens to have installed under that number.
   */
  private productPathFor(db: GemStoneDatabase): string {
    const registered = registeredPaths(db.config);
    if (registered) {
      return needsWsl() ? windowsPathToWsl(registered.productPath) : registered.productPath;
    }
    const gsPath = needsWsl()
      ? this.storage.getWslGemstonePath(db.config.version)
      : this.storage.getGemstonePath(db.config.version);
    if (!gsPath) throw new Error(this.missingInstallMessage(db.config.version));
    return gsPath;
  }

  private getEnvironment(db: GemStoneDatabase): Record<string, string> {
    const gsPath = this.productPathFor(db);
    const dbPath = needsWsl() ? windowsPathToWsl(db.path) : db.path;
    const rootPath = needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath();
    const registered = registeredPaths(db.config);
    if (registered) {
      const confDir = needsWsl() ? windowsPathToWsl(registered.confDir) : registered.confDir;
      const globalDir = needsWsl() ? windowsPathToWsl(registered.globalDir) : registered.globalDir;
      return {
        // The installation's own configuration and registration directory —
        // pointing these at Jasper's would start a stone on default settings
        // against an extent path it does not own, and register it where the
        // user's own tools cannot find it.
        ...this.versionEnvironment(gsPath, globalDir),
        GEMSTONE_SYS_CONF: confDir,
        // No GEMSTONE_EXE_CONF: that one steers the *gem's* configuration, and
        // the installation already has its own answer (whatever its NetLDI
        // passes, or the product default). Pointing it at the stone's system
        // configuration would be Jasper inventing a value for a process it does
        // not own — a created database is where Jasper gets to decide both.
        // Jasper's own log directory, deliberately: this is the log of what
        // JASPER started, and the one file its actions create. The stone's own
        // logging stays wherever the installation's configuration puts it.
        GEMSTONE_LOG: `${dbPath}/log/${db.config.stoneName}.log`,
        // Left blank rather than composed: `#dir:` and `#netldi:` would send
        // gems the installation spawns into Jasper's directories, which is
        // exactly the writing into someone else's setup this avoids. The
        // installation's own NetLDI configuration governs instead.
        GEMSTONE_NRS_ALL: '',
      };
    }
    return {
      ...this.versionEnvironment(gsPath, rootPath),
      GEMSTONE_SYS_CONF: `${dbPath}/conf`,
      GEMSTONE_LOG: `${dbPath}/log/${db.config.stoneName}.log`,
      GEMSTONE_EXE_CONF: `${dbPath}/conf`,
      GEMSTONE_NRS_ALL: `#netldi:${db.config.ldiName}#dir:${dbPath}#log:${dbPath}/log/%N_%P.log`,
    };
  }

  /** Start a stone */
  async startStone(db: GemStoneDatabase, opts?: StartOptions): Promise<string> {
    const env = this.getEnvironment(db);
    const gsPath = env.GEMSTONE;
    const dbPath = needsWsl() ? windowsPathToWsl(db.path) : db.path;
    const logPath = `${dbPath}/log/${db.config.stoneName}.log`;
    try {
      return await this.runCommand(
        `${gsPath}/bin/startstone`,
        ['-l', logPath, db.config.stoneName],
        env,
        `Starting stone ${db.config.stoneName}`,
        opts,
      );
    } catch (e) {
      // "File is open by another process" names no process, and every way into
      // starting a stone hits it the same way — the tree's button, the panel's,
      // the offer that follows a failed login, Quick Setup, a restore. Naming
      // the holder here rather than in one command means none of them are left
      // relaying an error the user cannot act on.
      const output = e instanceof Error ? e.message : String(e);
      const explained = explainExtentLocked(
        db.config.stoneName,
        output,
        await this.findExtentHolders(db),
      );
      throw explained ? new Error(explained) : e;
    }
  }

  /** Stop a stone cleanly via `stopstone`, which authenticates as DataCurator.
   *  `password` defaults to GemStone's stock DataCurator password (correct for a
   *  freshly-created stone); callers that know the real one pass it explicitly. */
  async stopStone(db: GemStoneDatabase, password: string = DEFAULT_GS_PW): Promise<string> {
    const env = this.getEnvironment(db);
    const gsPath = env.GEMSTONE;
    return this.runCommand(
      `${gsPath}/bin/stopstone`,
      [db.config.stoneName, 'DataCurator', password],
      env,
      `Stopping stone ${db.config.stoneName}`,
    );
  }

  /**
   * The processes holding a database's extent files open.
   *
   * Used two ways, both read-only: to confirm a database's gems really are gone
   * before its servers are stopped, and to name the holder when a start fails
   * because the extent is still open. Jasper never signals what this finds — a
   * process it did not start, holding a file it cannot see inside, is the
   * user's to judge.
   *
   * `fuser` first, `lsof -t` second: both print bare PIDs on stdout and both
   * report the same holders, but `fuser` interrogates one file while `lsof`
   * walks every process on the host — measured at 0.2s against 1.5s on a
   * developer machine. Neither being available is not an error; it means
   * Jasper cannot name the holder and says so.
   *
   * Asynchronous throughout: even the fast path is slow enough that running it
   * on the extension host's event loop would stall every other extension, and
   * the stop path can repeat it while waiting for gems to exit.
   *
   * Every probe carries a timeout, and being asynchronous is exactly why it
   * has to. `lsof` can wedge on an unresponsive mount; run synchronously that
   * froze the window, which was at least unmistakable. Awaited, a probe that
   * never returns leaves the progress notification up for ever with the editor
   * working normally around it — the stop simply never happens and nothing
   * says so. A timed-out probe falls through to the next one, or to the bare
   * PIDs, the same as a missing tool.
   *
   * `lsof -b` is not used, though it is fifteen times faster again: it skips
   * the kernel calls that could block, and on a plain ext4 extent it returns
   * *nothing at all*. A probe that reports an empty list for a database with
   * four live processes on it would have Jasper stop a stone on top of its own
   * gems — the exact failure this exists to prevent.
   */
  async findExtentHolders(db: GemStoneDatabase): Promise<ExtentHolder[]> {
    const dataDir = path.join(db.path, 'data');
    let extents: string[];
    try {
      extents = wslReaddirSync(dataDir)
        .filter((f) => /^extent.*\.dbf$/i.test(f))
        .map((f) => path.join(dataDir, f));
    } catch {
      return [];
    }
    if (extents.length === 0) return [];

    const quoted = extents.map((e) => `"${e}"`).join(' ');
    let pids: number[] = [];
    for (const probe of [`fuser ${quoted}`, `lsof -n -P -w -t -- ${quoted}`]) {
      try {
        // Both exit non-zero when nothing holds the file, which exec rejects
        // on — `|| true` keeps "no holders" from reading as "probe failed", so
        // the fallback only runs when the tool itself is missing.
        pids = parseHolderPids(
          await wslExec(`${probe} 2>/dev/null || true`, undefined, { timeout: PS_TIMEOUT_MS }),
        );
      } catch {
        continue;
      }
      if (pids.length > 0) break;
    }
    if (pids.length === 0) return [];

    let detailed: ExtentHolder[] = [];
    try {
      detailed = parseHolderDetails(
        await wslExec(
          `ps -o pid=,user=,lstart=,args= -p ${pids.join(',')} 2>/dev/null || true`,
          undefined,
          { timeout: PS_TIMEOUT_MS },
        ),
      );
    } catch {
      // The shell itself failed; fall through to the bare PIDs below.
    }
    // `ps` printing nothing is the ordinary case for a process that exited
    // between the probe and this call, and it exits 0 doing it — so an empty
    // result is not an error and must not be confused with one. Either way the
    // PIDs are worth reporting: "held by PID 444, and ps no longer knows what
    // that was" is actionable, "Jasper could not determine which process holds
    // it" is not.
    return detailed.length > 0 ? detailed : pids.map((pid) => ({ pid, command: '' }));
  }

  /** Force-stop a running stone by signalling its process, for when a clean
   *  `stopstone` isn't possible (e.g. the DataCurator password is unknown).
   *  Verifies the recorded PID is still THIS GemStone server before signalling
   *  — so a reused PID is never killed — then SIGTERMs (escalating to SIGKILL
   *  if it survives) and clears the now-orphaned lock. The stone recovers from
   *  its transaction log on next start. */
  async forceKillStone(
    db: GemStoneDatabase,
    opts: { graceMs?: number } = {},
  ): Promise<ForceKillResult> {
    const proc = this.refreshProcesses().find(
      (p) => p.type === 'stone' && p.name === db.config.stoneName,
    );
    if (!proc) {
      return { killed: true, reason: `Stone "${db.config.stoneName}" is not running.` };
    }

    const psFor = (pid: number): string =>
      wslExecSync(`ps -p ${pid} -o command= 2>/dev/null || echo GONE`).trim();

    let ownership;
    try {
      ownership = classifyPidOwnership(psFor(proc.pid));
    } catch {
      return { killed: false, reason: `Could not verify PID ${proc.pid}; refusing to kill.` };
    }
    if (ownership.pidGone) {
      this.clearLockFor(proc);
      return { killed: true, reason: `PID ${proc.pid} was already gone.` };
    }
    if (!ownership.isGemStoneServer) {
      return {
        killed: false,
        reason: `PID ${proc.pid} is now an unrelated process (${ownership.command}); refusing to kill.`,
      };
    }
    // The stricter name check killHostServer uses. The window here is smaller
    // (refreshProcesses ran moments ago), but it is not zero — a modal
    // escalation dialog and an optional password prompt sit in front of this —
    // and there is no reason for the two kill paths to differ in rigor.
    if (!commandIsServer(ownership.command, 'stone', proc.name)) {
      return {
        killed: false,
        reason:
          `PID ${proc.pid} is a GemStone server, but no longer stone "${proc.name}" — it is ` +
          `now ${ownership.command}. Refusing to kill it.`,
      };
    }

    try {
      const graceMs = opts.graceMs ?? 800;
      const settle = async (): Promise<void> => {
        if (graceMs > 0) await new Promise((r) => setTimeout(r, graceMs));
      };
      const stillRunning = (): boolean => commandIsServer(psFor(proc.pid), 'stone', proc.name);
      wslExecSync(`kill ${proc.pid} 2>/dev/null || true`);
      await settle();
      if (stillRunning()) {
        wslExecSync(`kill -9 ${proc.pid} 2>/dev/null || true`);
        // Settle before both the verdict and the lock cleanup. Without it the
        // lock check runs against a not-yet-reaped stoned, reads it as a live
        // server, and silently keeps the lock — in the escalation case, the one
        // where the lock matters most.
        await settle();
        if (stillRunning()) {
          return {
            killed: false,
            reason: `Stone "${proc.name}" (PID ${proc.pid}) survived SIGKILL.`,
          };
        }
      }
    } catch {
      return { killed: false, reason: `Failed to signal PID ${proc.pid}.` };
    }

    this.clearLockFor(proc);
    return {
      killed: true,
      reason: `Stone "${db.config.stoneName}" force-stopped (PID ${proc.pid}); it will recover on next start.`,
    };
  }

  /** Best-effort removal of a stopped process's lock file (safe checks apply). */
  private clearLockFor(proc: GemStoneProcess): void {
    try {
      const report = this.inspectStaleLock(proc);
      if (report.safe) this.deleteStaleLock(report.lockPath);
    } catch {
      /* best effort — a lingering lock is handled by the Processes view */
    }
  }

  /** Start NetLDI */
  // Databases created before the gem cache bump have a 50 MB gem.conf, which
  // overflows loading a large Rowan project. Raise it here (idempotent) so an
  // existing stone self-heals on its next start — the gem.conf path is
  // host-native, so plain fs works under WSL too. Never lowers a larger value;
  // any failure is swallowed so startup always proceeds.
  private static readonly MIN_GEM_CACHE_KB = 500000;
  private ensureAdequateGemCache(db: GemStoneDatabase): void {
    // Never for a registered database: its gem configuration is the
    // installation's file, and raising a value inside it — however well meant —
    // is editing someone else's setup. (Jasper's own databases get 500 MB
    // because a small temp-object cache is what a large image runs out of; a
    // registered one keeps whatever its owner chose.)
    if (isRegisteredDatabase(db)) return;
    const confFile = path.join(db.path, 'conf', 'gem.conf');
    try {
      if (!fs.existsSync(confFile)) return;
      const original = fs.readFileSync(confFile, 'utf8');
      const setting = /GEM_TEMPOBJ_CACHE_SIZE\s*=\s*(\d+)\s*;/;
      const match = setting.exec(original);
      if (match && Number(match[1]) >= ProcessManager.MIN_GEM_CACHE_KB) return;
      const line = `GEM_TEMPOBJ_CACHE_SIZE = ${ProcessManager.MIN_GEM_CACHE_KB};`;
      const updated = match
        ? original.replace(match[0], line)
        : `${original.replace(/\n?$/, '\n')}${line}\n`;
      fs.writeFileSync(confFile, updated);
      appendSysadmin(
        `Raised gem temp-object cache to ${ProcessManager.MIN_GEM_CACHE_KB} KB in ${confFile}`,
      );
    } catch {
      /* leave the conf untouched; the gem just keeps its current cache */
    }
  }

  async startNetldi(db: GemStoneDatabase, opts?: StartOptions): Promise<string> {
    this.ensureAdequateGemCache(db);
    const env = this.getEnvironment(db);
    const gsPath = env.GEMSTONE;
    const dbPath = needsWsl() ? windowsPathToWsl(db.path) : db.path;
    const logPath = `${dbPath}/log/${db.config.ldiName}.log`;
    const user = needsWsl() ? wslExecSync('whoami').trim() : os.userInfo().username;
    // A registered database's recorded port is asked for by name (`-P`), not
    // hoped for. Without it a NetLDI comes back on a fresh ephemeral port, and
    // every login built from the record — including the one Jasper generated —
    // then dials a port nothing is listening on. Only registered databases
    // record a port; a created one's logins address their NetLDI by name.
    const port = registeredPaths(db.config)?.netldiPort;
    return this.runCommand(
      `${gsPath}/bin/startnetldi`,
      ['-a', user, '-g', ...(port ? ['-P', String(port)] : []), '-l', logPath, db.config.ldiName],
      env,
      `Starting NetLDI ${db.config.ldiName}`,
      opts,
    );
  }

  /** Stop NetLDI */
  async stopNetldi(db: GemStoneDatabase): Promise<string> {
    const env = this.getEnvironment(db);
    const gsPath = env.GEMSTONE;
    return this.runCommand(
      `${gsPath}/bin/stopnetldi`,
      [db.config.ldiName],
      env,
      `Stopping NetLDI ${db.config.ldiName}`,
    );
  }

  /**
   * Open a terminal in a version's product directory, with PATH (and the
   * dynamic-library / man paths) set so `$GEMSTONE/bin` tools are runnable —
   * the same version environment the database terminal gets, minus the
   * stone-specific vars, so nothing ties it to a particular stone.
   */
  openVersionTerminal(version: string): void {
    const gsPath = needsWsl()
      ? this.storage.getWslGemstonePath(version)
      : this.storage.getGemstonePath(version);
    if (!gsPath) throw new Error(this.missingInstallMessage(version));
    const rootPath = needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath();
    const env = this.versionEnvironment(gsPath, rootPath);
    if (needsWsl()) {
      const envExports = Object.entries(env)
        .map(([k, v]) => `export ${k}='${v}'`)
        .join('; ');
      const terminal = vscode.window.createTerminal({
        name: `GemStone: ${version}`,
        shellPath: 'wsl.exe',
        shellArgs: ['-e', 'bash'],
      });
      terminal.show();
      terminal.sendText(`cd '${gsPath}' && ${envExports} && exec bash`);
    } else {
      const terminal = vscode.window.createTerminal({
        name: `GemStone: ${version}`,
        env,
        cwd: gsPath,
      });
      terminal.show();
    }
  }

  /** Open a terminal with GemStone environment.
   *
   *  `prepared` is typed at the prompt but not run, for the cases where Jasper
   *  can say exactly what the user would want to look at — the processes
   *  holding a database's extents, say — without running it on their behalf.
   *  They see the command, and press Enter or edit it. */
  openTerminal(db: GemStoneDatabase, prepared?: string): void {
    const env = this.getEnvironment(db);
    if (needsWsl()) {
      const dbPath = windowsPathToWsl(db.path);
      const envExports = Object.entries(env)
        .map(([k, v]) => `export ${k}='${v}'`)
        .join('; ');
      const terminal = vscode.window.createTerminal({
        name: `GemStone: ${db.config.stoneName}`,
        shellPath: 'wsl.exe',
        shellArgs: ['-e', 'bash'],
      });
      terminal.show();
      terminal.sendText(`cd '${dbPath}' && ${envExports} && exec bash`);
      if (prepared) terminal.sendText(prepared, false);
    } else {
      const terminal = vscode.window.createTerminal({
        name: `GemStone: ${db.config.stoneName}`,
        env,
        cwd: db.path,
      });
      terminal.show();
      // Re-export after the shell has started, the way the WSL branch above
      // already does. `env` is applied *before* the interactive shell reads the
      // user's startup files, so an `unset GEMSTONE` or a competing
      // `export GEMSTONE=…` in .bashrc silently wins — and this terminal is
      // supposed to be the one place a user can trust to have the database's
      // environment. Sending the exports afterwards makes Jasper's values
      // authoritative.
      //
      // PATH is the exception: our value is a *complete* fixed string, so
      // re-exporting it wholesale would discard whatever the user's startup
      // files prepended (nvm, homebrew, pyenv, cargo…). We only need
      // GemStone's bin to win, so assert it as a *prefix* and leave the rest
      // of the user's PATH intact.
      const { PATH, ...gsEnv } = env;
      const gsBin = PATH.split(':')[0];
      terminal.sendText(
        `${exportCommand(gsEnv)}; export PATH=${shellSingleQuote(gsBin)}:"$PATH"`,
        true,
      );
      if (prepared) terminal.sendText(prepared, false);
    }
  }

  private runCommand(
    cmd: string,
    args: string[],
    env: Record<string, string>,
    label: string,
    opts?: StartOptions,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      appendSysadmin(`\n--- ${label} ---`);
      // Revealing the Admin channel takes focus off the editor. Right for an
      // explicit Start Stone click; wrong when the start is one step inside a
      // connect the user is waiting on. Either way the output is still
      // recorded, so a caller that stays quiet loses nothing but the interruption.
      if (opts?.reveal !== false) showSysadmin();
      const proc = wslSpawn(cmd, args, env);
      let output = '';

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        appendSysadmin(text.trimEnd());
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        appendSysadmin(text.trimEnd());
      });

      proc.on('close', (code: number | null, signal: string | null) => {
        if (code === 0) {
          resolve(output);
          return;
        }
        // A signal-killed process reports a null exit code, so the plain
        // "exit code ${code}" wording degrades to the meaningless "exit code
        // null" — and it is usually killed before writing a word of output, so
        // the message is all the user gets.
        if (signal) {
          // Only SIGKILL earns the memory-pressure advice: macOS jetsam kills
          // that way under pressure, and it is easy to mistake for a broken
          // database. Any other signal — a SIGSEGV from a broken install, a
          // SIGTERM from someone running kill — has its own cause, and pointing
          // at memory would send the user looking in the wrong place.
          const advice =
            signal === 'SIGKILL'
              ? `This is usually memory pressure rather than a problem with the database; ` +
                `free some memory and try again. Check the log in the database's log ` +
                `directory if it persists.`
              : `Check the log in the database's log directory for what it was doing.`;
          reject(
            new Error(
              `${label} was killed by ${signal} before it could report anything. ` +
                `${advice}${output ? `\n${output}` : ''}`,
            ),
          );
          return;
        }
        // The GemStone scripts' bare "GEMSTONE environment variable is not
        // defined" is a lie about the cause — Jasper set it — and relaying it
        // sends the user into their shell profile. Say what is really going on.
        const explained = explainStartFailure(label, output, env.GEMSTONE);
        reject(new Error(explained ?? `${label} failed (exit code ${code})\n${output}`));
      });

      proc.on('error', (err) => {
        reject(new Error(`${label} failed: ${err.message}`));
      });
    });
  }

  /** Whether a stone of this name and version appears in Jasper's own gslist.
   *  Name alone is ambiguous when two installed versions share a stone name, so
   *  the version must match too (see versionsMatch).
   *
   *  This is "visible to Jasper", not "alive on this host" — a server started
   *  outside Jasper's environment is registered elsewhere and answers false
   *  here. Anything that must not act while a process is alive wants
   *  `isServerAlive` instead. */
  isStoneRunning(stoneName: string, version: string): boolean {
    return this.cachedProcesses.some(
      (p) => p.type === 'stone' && p.name === stoneName && versionsMatch(p.version, version),
    );
  }

  /** Whether a netldi of this name and version appears in Jasper's own gslist.
   *  See isStoneRunning, including what it does not cover. */
  isNetldiRunning(ldiName: string, version: string): boolean {
    return this.cachedProcesses.some(
      (p) => p.type === 'netldi' && p.name === ldiName && versionsMatch(p.version, version),
    );
  }

  /**
   * Whether this database's stone or netldi is running *anywhere we can see* —
   * Jasper's own gslist or the host process table.
   *
   * The guard for anything destructive. `isStoneRunning` answers "can Jasper
   * work with it", which is false for a server started outside Jasper's
   * environment even though the process is alive and has the extent open — so
   * using it to gate a delete or an extent replacement would let Jasper pull
   * the files out from under a running stone.
   */
  isServerAlive(db: GemStoneDatabase, type: 'stone' | 'netldi'): boolean {
    const inGslist =
      type === 'stone'
        ? this.isStoneRunning(db.config.stoneName, db.config.version)
        : this.isNetldiRunning(db.config.ldiName, db.config.version);
    return inGslist || this.getExternalServers(db)[type] !== undefined;
  }
}
