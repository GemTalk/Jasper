import { posix } from 'path';
import { GemStoneProcess } from './sysadminTypes';
import { versionsMatch } from './manager/versionMatch';

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
 * Parse `ps -Ao pid=,command=` output into the `stoned` / `netldid` processes
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

/** True when `candidate` is `dir` or lies inside it.
 *
 *  Both sides are normalized first, so a path carrying `/./` or a doubled
 *  slash — which a hand-typed `startstone -e` easily produces — still matches
 *  the directory it is actually in. Symlinks are *not* resolved: doing so needs
 *  the filesystem, and a database reached through a symlinked root therefore
 *  reads as unrecognized rather than as a different database (see
 *  classifyServerIdentity, which only downgrades to `unknown` for that). */
function isInside(candidate: string, dir: string): boolean {
  const base = posix.normalize(dir).replace(/\/+$/, '');
  const target = posix.normalize(candidate);
  return target === base || target.startsWith(`${base}/`);
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
 * Only *absolute* paths can say where a process was pointed. A relative one
 * (`startstone -e gs64stone.conf`, run from inside the database directory) is
 * no evidence either way, and reading it as evidence *against* produced the
 * worst answer available: a confident "this is probably a different database"
 * built from nothing. Relative hints are therefore ignored, and a process with
 * none left is `unknown`.
 *
 * `unknown` and `different` are both "not confirmed" to callers: nothing gets
 * stopped on a guess.
 */
export function classifyServerIdentity(proc: HostServerProcess, dbPath: string): ServerIdentity {
  const absolute = proc.dbPathHints.filter((p) => p.startsWith('/'));
  if (absolute.length === 0) return 'unknown';
  return absolute.some((p) => isInside(p, dbPath)) ? 'confirmed' : 'different';
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
/** A database, as much of one as the cross-check needs. */
export type ScanTarget = {
  path: string;
  config: { stoneName: string; ldiName: string; version: string };
};

/** Every host process that could be a database's external stone or netldi. */
export interface ExternalServerCandidates {
  stone: ExternalServer[];
  netldi: ExternalServer[];
}

/** Best-identified first: a server we can place beats one we cannot, which
 *  beats one we can place somewhere else. */
const IDENTITY_RANK: Record<ServerIdentity, number> = { confirmed: 0, unknown: 1, different: 2 };

/**
 * Every candidate for one database's stone and netldi: alive as a process but
 * missing from `gslist` — started outside Jasper's environment and registered
 * where Jasper does not look.
 *
 * Returns *all* matches rather than the first, because the same name can belong
 * to more than one live server and picking before judging throws away the only
 * evidence that can tell them apart. With two `stoned gs64stone` running, one
 * pointed at this database and one elsewhere, taking the first listed reports
 * "probably a different database" about a server that is running right there.
 *
 * Matches on name *and* version, the same pairing the Databases view uses, so
 * a stone name shared by two installed versions cannot make one version's
 * server look like the other's. A host process whose version could not be
 * parsed is accepted on name alone: refusing it would hide exactly the
 * unusual-install case this detection exists for. (Once the environment has
 * been read, ProcessManager re-checks any version learned that way.)
 */
export function findExternalServerCandidates(
  db: ScanTarget,
  gslistProcesses: GemStoneProcess[],
  hostProcesses: HostServerProcess[],
): ExternalServerCandidates {
  const { version } = db.config;

  const candidates = (type: 'stone' | 'netldi', name: string): ExternalServer[] => {
    const inGslist = gslistProcesses.some(
      (p) => p.type === type && p.name === name && versionsMatch(p.version, version),
    );
    if (inGslist) return [];
    return hostProcesses
      .filter(
        (p) =>
          p.type === type && p.name === name && (!p.version || versionsMatch(p.version, version)),
      )
      .map((p) => ({ process: p, identity: classifyServerIdentity(p, db.path) }));
  };

  return {
    stone: candidates('stone', db.config.stoneName),
    netldi: candidates('netldi', db.config.ldiName),
  };
}

/** The candidate to act on: the one whose identity is best established. */
export function pickExternalServer(candidates: ExternalServer[]): ExternalServer | undefined {
  return [...candidates].sort((a, b) => IDENTITY_RANK[a.identity] - IDENTITY_RANK[b.identity])[0];
}

/**
 * The cross-check, reduced to one server per kind.
 *
 * Judges identity from command lines alone. ProcessManager goes the longer way
 * round — candidates, then each one's environment, then the pick — because a
 * server the command line cannot place is often placed by its environment, and
 * that can change which candidate wins.
 */
export function findExternalServers(
  db: ScanTarget,
  gslistProcesses: GemStoneProcess[],
  hostProcesses: HostServerProcess[],
): ExternalServerFinding {
  const candidates = findExternalServerCandidates(db, gslistProcesses, hostProcesses);
  const finding: ExternalServerFinding = {};
  const stone = pickExternalServer(candidates.stone);
  if (stone) finding.stone = stone;
  const netldi = pickExternalServer(candidates.netldi);
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

/** The servers a finding actually names, in the order they are acted on. */
export function externalServersOf(finding: ExternalServerFinding): ExternalServer[] {
  return [finding.stone, finding.netldi].filter((s): s is ExternalServer => s !== undefined);
}

/** True when every external server found is confirmed to be this database's.
 *  Drives what the dialog *says*; what it may *do* is `mayStopExternalServers`,
 *  which is deliberately less strict. */
export function allExternalServersConfirmed(finding: ExternalServerFinding): boolean {
  const servers = externalServersOf(finding);
  return servers.length > 0 && servers.every((s) => s.identity === 'confirmed');
}

/**
 * Whether Jasper may stop what it found, given how bad it would be to stop the
 * wrong thing.
 *
 * A **stone** must be positively identified. Stopping a stranger's stone drops
 * whatever its sessions had not committed, and no warning makes that
 * recoverable — so an unconfirmed stone is simply not touched.
 *
 * A **netldi** is a different risk. It holds no data: stopping the wrong one
 * drops connections, which is disruptive and recoverable, not destructive. And
 * a netldi started without `-l` carries nothing that could ever identify it —
 * no conf, no log path — so demanding confirmation there does not make Jasper
 * careful, it makes the restart permanently unreachable in the most ordinary
 * case this feature exists for. The dialog still warns; the user still decides.
 *
 * This is the distinction the issue drew and this code first missed: its
 * criterion is about "a different **stone** that merely shares the name".
 */
export function mayStopExternalServers(finding: ExternalServerFinding): boolean {
  const servers = externalServersOf(finding);
  if (servers.length === 0) return false;
  return servers.every((s) => s.process.type !== 'stone' || s.identity === 'confirmed');
}
