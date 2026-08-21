import { GemStoneProcess } from './sysadminTypes';
import { versionsMatch } from './versionMatch';

/**
 * A `stoned` / `netldid` process found by scanning the host's process table,
 * rather than by asking Jasper's own `gslist`.
 *
 * The two views can disagree. `gslist` reports what is registered in the
 * `locks/` directory it is pointed at, and Jasper always points it at its own
 * configured root; a server started from a shell with a different
 * `GEMSTONE_GLOBAL_DIR` registers somewhere else and is invisible to it. The
 * process table has no such blind spot, which is what makes it the right place
 * to notice "alive on the host, but not where Jasper looks".
 */
export interface HostServerProcess {
  pid: number;
  type: 'stone' | 'netldi';
  /** The server name the process was started with (its first argument). */
  name: string;
  /** Version parsed out of the `GemStone64Bit<version>…` product directory in
   *  the executable's path. Undefined when the path carries no such directory
   *  (an unusual install layout), which leaves the version unknown rather than
   *  guessed. */
  version?: string;
  /** `GEMSTONE_GLOBAL_DIR` the process was started with — the directory it is
   *  registered in, and so the directory a `gslist -l` must be pointed at to
   *  see it. Undefined when the environment could not be read. */
  globalDir?: string;
  /** Paths from the command line and environment that name a database
   *  directory (a conf or log file, a config directory). Used to judge whether
   *  this really is the managed database's server. */
  dbPathHints: string[];
  /** The full command line, for reporting. */
  command: string;
}

/** Whether a host process can be believed to belong to a given database. */
export type ServerIdentity =
  /** A conf/log path the process was started with lies inside the database
   *  directory — as close to proof as the process table gets. */
  | 'confirmed'
  /** Every path we can see points somewhere else: same name, different
   *  database. Stopping it would hit an unrelated stone. */
  | 'different'
  /** Nothing to go on. Treated as not confirmed. */
  | 'unknown';

/** An external server for one managed database, with what we know about it. */
export interface ExternalServer {
  process: HostServerProcess;
  identity: ServerIdentity;
}

/** What a cross-check of one database against the host found. */
export interface ExternalServerFinding {
  stone?: ExternalServer;
  netldi?: ExternalServer;
}

/**
 * Parse `ps -eo pid=,command=` output into the `stoned` / `netldid` processes
 * it contains.
 *
 * Only an executable whose *basename* is exactly `stoned` or `netldid` counts,
 * so `stopstone`, a `grep netldid`, or an unrelated `foostoned` cannot pose as
 * a server. Lines that don't look like a server are skipped silently — the
 * process table is full of them.
 *
 * Pure so the matching rules can be tested against real command lines without
 * a stone, which matters: these lines are the only identity evidence we get.
 */
export function parseHostServerProcesses(psOutput: string): HostServerProcess[] {
  const found: HostServerProcess[] = [];
  for (const line of psOutput.split('\n')) {
    // <pid> <path/to/sys/stoned|netldid> <serverName> <rest…>
    const match = line.match(/^\s*(\d+)\s+(?:\S*\/)?(stoned|netldid)\s+(\S+)(.*)$/);
    if (!match) continue;
    const [, pid, exe, name, rest] = match;
    const command = line.trim().replace(/^\d+\s+/, '');
    found.push({
      pid: parseInt(pid, 10),
      type: exe === 'stoned' ? 'stone' : 'netldi',
      name,
      version: parseProductVersion(command),
      dbPathHints: commandLineDbPaths(rest),
      command,
    });
  }
  return found;
}

/**
 * True when `command` is the command line of a `stoned`/`netldid` running under
 * this exact name.
 *
 * The re-check before signalling a PID. `classifyPidOwnership` answers the
 * weaker question — is this still *a* GemStone server — which is enough when
 * the PID was read moments ago, but not here: a reconcile holds a PID across a
 * modal dialog the user can sit on indefinitely, and in that window the number
 * can be recycled onto a different server entirely. Killing "a stoned" is not
 * the same as killing "the stoned we meant".
 *
 * Takes a bare command line (`ps -p <pid> -o command=`), so unlike
 * parseHostServerProcesses there is no PID to skip past.
 */
export function commandIsServer(command: string, type: 'stone' | 'netldi', name: string): boolean {
  const match = command.trim().match(/^(?:\S*\/)?(stoned|netldid)\s+(\S+)/);
  if (!match) return false;
  return match[1] === (type === 'stone' ? 'stoned' : 'netldid') && match[2] === name;
}

/** Pull the version out of a `GemStone64Bit3.7.5-x86_64.Linux` product
 *  directory anywhere in `text`. The same directory-name convention
 *  SysadminStorage uses to lay installs out, read back. */
export function parseProductVersion(text: string): string | undefined {
  const match = text.match(/GemStone64Bit(\d[\d.]*?)(?=[-/\s]|$)/);
  return match ? match[1].replace(/\.$/, '') : undefined;
}

/** The `-e conf`, `-z conf` and `-l log` paths a stone or netldi was started
 *  with. These are the arguments that name a *database* rather than an install,
 *  which is what makes them usable as identity evidence. */
function commandLineDbPaths(rest: string): string[] {
  const paths: string[] = [];
  const flags = /(?:^|\s)-[ezl]\s*(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = flags.exec(rest)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

/**
 * Parse the GemStone environment variables out of `ps eww -p <pid> -o command=`
 * output, which appends `KEY=value` pairs after the command line.
 *
 * A value containing spaces cannot be recovered from that format — the pairs
 * are space-separated with no quoting — so a path with a space in it comes back
 * truncated. The alternative (guessing where one value ends and the next key
 * begins) would be worse, and the paths this reads are Jasper-made or
 * GemStone-made, which do not contain spaces.
 */
export function parseServerEnvironment(psEwwOutput: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const token of psEwwOutput.split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq <= 0) continue;
    const key = token.slice(0, eq);
    if (!/^GEMSTONE(?:_[A-Z_]+)?$/.test(key)) continue;
    env[key] = token.slice(eq + 1);
  }
  return env;
}

/** The environment variables that name a database directory. `GEMSTONE` itself
 *  names the *install*, so it is deliberately not here. */
const DB_PATH_VARS = ['GEMSTONE_SYS_CONF', 'GEMSTONE_EXE_CONF', 'GEMSTONE_LOG'];

/**
 * Fold a process's environment into what we know about it: where it is
 * registered, and which database directory it was pointed at.
 */
export function applyServerEnvironment(
  proc: HostServerProcess,
  env: Record<string, string>,
): HostServerProcess {
  const hints = [...proc.dbPathHints];
  for (const key of DB_PATH_VARS) {
    if (env[key]) hints.push(env[key]);
  }
  return {
    ...proc,
    globalDir: env.GEMSTONE_GLOBAL_DIR ?? proc.globalDir,
    version: proc.version ?? parseProductVersion(env.GEMSTONE ?? ''),
    dbPathHints: [...new Set(hints)],
  };
}

/** True when `candidate` is `dir` or lies inside it. */
function isInside(candidate: string, dir: string): boolean {
  const base = dir.replace(/\/+$/, '');
  return candidate === base || candidate.startsWith(`${base}/`);
}

/**
 * Decide whether a host process really is the managed database's server.
 *
 * Name alone cannot answer this — the same stone name can belong to a different
 * database entirely — so the question is settled by the paths the process was
 * started with. Any one of them inside the database directory confirms it;
 * paths that all point elsewhere mark it as a different database of the same
 * name; no paths at all leaves it unknown.
 *
 * `unknown` and `different` are both "not confirmed" to callers: nothing gets
 * stopped on a guess.
 */
export function classifyServerIdentity(proc: HostServerProcess, dbPath: string): ServerIdentity {
  if (proc.dbPathHints.length === 0) return 'unknown';
  return proc.dbPathHints.some((p) => isInside(p, dbPath)) ? 'confirmed' : 'different';
}

/**
 * Cross-check one database's stone and netldi against the host: which of them
 * is alive as a process but missing from `gslist` — that is, started outside
 * Jasper's environment and registered where Jasper does not look.
 *
 * Matches on name *and* version, the same pairing the Databases view uses, so
 * a stone name shared by two installed versions cannot make one version's
 * server look like the other's. A host process whose version could not be
 * parsed is accepted on name alone: refusing it would hide exactly the
 * unusual-install case this detection exists for.
 */
export function findExternalServers(
  db: { path: string; config: { stoneName: string; ldiName: string; version: string } },
  gslistProcesses: GemStoneProcess[],
  hostProcesses: HostServerProcess[],
): ExternalServerFinding {
  const { stoneName, ldiName, version } = db.config;
  const finding: ExternalServerFinding = {};

  const external = (type: 'stone' | 'netldi', name: string): ExternalServer | undefined => {
    const inGslist = gslistProcesses.some(
      (p) => p.type === type && p.name === name && versionsMatch(p.version, version),
    );
    if (inGslist) return undefined;
    const proc = hostProcesses.find(
      (p) =>
        p.type === type && p.name === name && (!p.version || versionsMatch(p.version, version)),
    );
    if (!proc) return undefined;
    return { process: proc, identity: classifyServerIdentity(proc, db.path) };
  };

  const stone = external('stone', stoneName);
  if (stone) finding.stone = stone;
  const netldi = external('netldi', ldiName);
  if (netldi) finding.netldi = netldi;
  return finding;
}

/**
 * Fold a process's own environment into an already-matched external server and
 * re-judge its identity.
 *
 * The command line alone often says nothing about which database a server
 * belongs to — `netldid gs64ldi -g` carries no paths at all — while
 * `GEMSTONE_SYS_CONF` and friends do. So the environment is read only for
 * servers that already matched by name, and the identity verdict is recomputed
 * afterwards rather than before: the extra paths can turn `unknown` into a
 * confirmation, which is the difference between offering to restart the server
 * and refusing to touch it.
 */
export function withServerEnvironment(
  server: ExternalServer,
  env: Record<string, string>,
  dbPath: string,
): ExternalServer {
  const proc = applyServerEnvironment(server.process, env);
  return { process: proc, identity: classifyServerIdentity(proc, dbPath) };
}

/** True when a finding names anything at all. */
export function hasExternalServer(finding: ExternalServerFinding | undefined): boolean {
  return finding !== undefined && (finding.stone !== undefined || finding.netldi !== undefined);
}

/** True when every external server found is confirmed to be this database's —
 *  the only case in which Jasper may stop them on the user's behalf. */
export function allExternalServersConfirmed(finding: ExternalServerFinding): boolean {
  const servers = [finding.stone, finding.netldi].filter(
    (s): s is ExternalServer => s !== undefined,
  );
  return servers.length > 0 && servers.every((s) => s.identity === 'confirmed');
}
