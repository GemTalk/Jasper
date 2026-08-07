import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { SysadminStorage } from './sysadminStorage';
import { GemStoneDatabase, GemStoneProcess } from './sysadminTypes';
import { DEFAULT_GS_PW } from './loginTypes';
import { appendSysadmin, showSysadmin } from './sysadminChannel';
import { needsWsl, windowsPathToWsl, wslSpawn, wslExecSync } from './wslBridge';

/** Decide whether a gslist-reported version matches a database's configured
 *  version. They usually come from different sources (the gslist Version column
 *  vs. the version parsed out of the product directory name), so we treat them
 *  as matching when the shorter one is a dotted-component prefix of the longer
 *  (e.g. "3.7.4" matches "3.7.4.3"). This keeps genuinely different installs —
 *  "3.6.2" vs "3.7.5" — distinct, which is what lets the Databases panel tie a
 *  running stone to the version that actually started it. */
export function versionsMatch(a: string, b: string): boolean {
  const as = a.split('.');
  const bs = b.split('.');
  const shared = Math.min(as.length, bs.length);
  for (let i = 0; i < shared; i++) {
    if (as[i] !== bs[i]) return false;
  }
  return shared > 0;
}

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

export class ProcessManager {
  private cachedProcesses: GemStoneProcess[] = [];

  constructor(private storage: SysadminStorage) {}

  getProcesses(): GemStoneProcess[] {
    return this.cachedProcesses;
  }

  /** Run gslist -cvl and parse output */
  refreshProcesses(): GemStoneProcess[] {
    const gslistPath = this.findGslist();
    if (!gslistPath) {
      this.cachedProcesses = [];
      return [];
    }
    try {
      const gsPath = gslistPath.replace(/\/bin\/gslist$/, '');
      const rootPath = needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath();
      const env = this.versionEnvironment(gsPath, rootPath);
      const output = wslExecSync(`"${gslistPath}" -cvl`, env);
      this.cachedProcesses = parseGslist(output);
    } catch {
      this.cachedProcesses = [];
    }
    return this.cachedProcesses;
  }

  /** Determine whether the .LCK file for a stale process appears safe to remove.
   *  Safe = recorded PID is gone, or has been reused by some non-GemStone process.
   *  Unsafe = a real stoned/netldid is still running under that PID (a genuinely
   *  hung server that the operator should investigate, not auto-clean). */
  inspectStaleLock(proc: GemStoneProcess): StaleLockReport {
    const rootPath = needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath();
    const lockPath = `${rootPath}/locks/${proc.name}..LCK`;
    let psOutput = '';
    try {
      // `|| echo GONE` collapses the "no such pid" exit into stdout so we get
      // one branch to parse instead of catching and decoding errno strings.
      psOutput = wslExecSync(`ps -p ${proc.pid} -o command= 2>/dev/null || echo GONE`).trim();
    } catch {
      // execSync threw before producing output — likely no shell or ps. Treat
      // as inconclusive; the safer default is to refuse.
      return {
        lockPath,
        safe: false,
        reason: `Could not check PID ${proc.pid} (ps unavailable). Refusing to delete the lock.`,
      };
    }
    const ownership = classifyPidOwnership(psOutput);
    if (ownership.pidGone) {
      return {
        lockPath,
        safe: true,
        reason: `PID ${proc.pid} no longer exists. The lock file is orphaned.`,
      };
    }
    if (ownership.isGemStoneServer) {
      return {
        lockPath,
        safe: false,
        reason: `PID ${proc.pid} is still a running GemStone server (${ownership.command}). Use stopstone instead.`,
        currentPidOwner: ownership.command,
      };
    }
    return {
      lockPath,
      safe: true,
      reason: `PID ${proc.pid} has been reused by an unrelated process (${ownership.command}). The lock file is orphaned.`,
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
   */
  private versionEnvironment(gsPath: string, rootPath: string): Record<string, string> {
    const env: Record<string, string> = {
      GEMSTONE: gsPath,
      GEMSTONE_GLOBAL_DIR: rootPath,
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

  private getEnvironment(db: GemStoneDatabase): Record<string, string> {
    const gsPath = needsWsl()
      ? this.storage.getWslGemstonePath(db.config.version)
      : this.storage.getGemstonePath(db.config.version);
    if (!gsPath)
      throw new Error(`GemStone ${db.config.version} not found. Please extract it first.`);
    const dbPath = needsWsl() ? windowsPathToWsl(db.path) : db.path;
    const rootPath = needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath();
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
    return this.runCommand(
      `${gsPath}/bin/startstone`,
      ['-l', logPath, db.config.stoneName],
      env,
      `Starting stone ${db.config.stoneName}`,
      opts,
    );
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

    try {
      wslExecSync(`kill ${proc.pid} 2>/dev/null || true`);
      const graceMs = opts.graceMs ?? 800;
      if (graceMs > 0) await new Promise((r) => setTimeout(r, graceMs));
      if (classifyPidOwnership(psFor(proc.pid)).isGemStoneServer) {
        wslExecSync(`kill -9 ${proc.pid} 2>/dev/null || true`);
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
    return this.runCommand(
      `${gsPath}/bin/startnetldi`,
      ['-a', user, '-g', '-l', logPath, db.config.ldiName],
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
    if (!gsPath) throw new Error(`GemStone ${version} not found. Please extract it first.`);
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

  /** Open a terminal with GemStone environment */
  openTerminal(db: GemStoneDatabase): void {
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
    } else {
      const terminal = vscode.window.createTerminal({
        name: `GemStone: ${db.config.stoneName}`,
        env,
        cwd: db.path,
      });
      terminal.show();
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
        // the message is all the user gets. macOS does this under memory
        // pressure (jetsam), which is easy to mistake for a broken database.
        if (signal) {
          reject(
            new Error(
              `${label} was killed by the operating system (${signal}) before it could report ` +
                `anything. This is usually memory pressure rather than a problem with the ` +
                `database; free some memory and try again. Check the log in the database's ` +
                `log directory if it persists.${output ? `\n${output}` : ''}`,
            ),
          );
          return;
        }
        reject(new Error(`${label} failed (exit code ${code})\n${output}`));
      });

      proc.on('error', (err) => {
        reject(new Error(`${label} failed: ${err.message}`));
      });
    });
  }

  /** Check if a stone is running for the given version. Name alone is ambiguous
   *  when two installed versions share a stone name, so the version must match
   *  too (see versionsMatch). */
  isStoneRunning(stoneName: string, version: string): boolean {
    return this.cachedProcesses.some(
      (p) => p.type === 'stone' && p.name === stoneName && versionsMatch(p.version, version),
    );
  }

  /** Check if a netldi is running for the given version. See isStoneRunning. */
  isNetldiRunning(ldiName: string, version: string): boolean {
    return this.cachedProcesses.some(
      (p) => p.type === 'netldi' && p.name === ldiName && versionsMatch(p.version, version),
    );
  }
}
