import { execSync, spawn, ChildProcess, exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface WslInfo {
  available: boolean;
  defaultDistro: string | undefined;
  homeDir: string | undefined;
  /** WSL Linux architecture, e.g. 'x86_64' or 'arm64' (mapped from 'aarch64') */
  arch: string | undefined;
  /** WSL version of the default distro: 1 or 2. GemStone requires 2. */
  wslVersion: number | undefined;
}

/**
 * Network-reachability details for connecting to services running inside WSL
 * (e.g. NetLDI) from Windows. These change across wsl restarts and across
 * edits to %USERPROFILE%\.wslconfig, so they're cached separately from WslInfo
 * and can be invalidated on their own.
 */
export interface WslNetworkInfo {
  /** True when %USERPROFILE%\.wslconfig enables `networkingMode=mirrored`,
   *  which makes `localhost` on Windows reach services bound inside WSL. */
  mirrored: boolean;
  /** First IPv4 address reported by `hostname -I` inside the default distro,
   *  or undefined if the probe failed. Unstable across `wsl --shutdown`. */
  ip: string | undefined;
  /** Best host string to use in a GemStone login when reaching a service
   *  inside WSL: `'localhost'` under mirrored mode, otherwise the WSL IP.
   *  Undefined only when both checks failed. */
  netldiHost: string | undefined;
  /** Parsed `wsl --version` → core WSL package version (not distro version).
   *  Mirrored networking requires core >= 2.0. Undefined on older WSL where
   *  `wsl --version` does not exist. */
  wslCoreVersion: string | undefined;
  /** True when the installed WSL core is >= 2.0 — the minimum that supports
   *  networkingMode=mirrored. */
  supportsMirrored: boolean;
}

let cachedWslInfo: WslInfo | undefined;
let cachedWslNetworkInfo: WslNetworkInfo | undefined;

/** Returns true if the extension is running on Windows */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/** Returns true if sysadmin commands need WSL bridging */
export function needsWsl(): boolean {
  return isWindows();
}

/**
 * Detect WSL availability and default distro.
 * Caches the result. Call invalidateWslCache() to re-check.
 */
export function getWslInfo(): WslInfo {
  if (cachedWslInfo) return cachedWslInfo;
  if (!isWindows()) {
    cachedWslInfo = {
      available: false,
      defaultDistro: undefined,
      homeDir: undefined,
      arch: undefined,
      wslVersion: undefined,
    };
    return cachedWslInfo;
  }
  try {
    const homeOutput = execSync('wsl.exe -e sh -c "echo $HOME"', {
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();

    let defaultDistro: string | undefined;
    let wslVersion: number | undefined;
    try {
      // --verbose gives us the default marker (*) and per-distro WSL version (1 or 2)
      const listOutput = execSync('wsl.exe --list --verbose', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      // wsl.exe output is UTF-16LE on most Windows builds; strip null bytes
      const lines = listOutput
        .replace(/\0/g, '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      // Find the line marked with '*' (default distro)
      // Format: "* Ubuntu   Running   2"  or  "  Debian   Stopped  1"
      for (const line of lines) {
        const match = line.match(/^\*\s+(\S+)\s+\S+\s+(\d+)/);
        if (match) {
          defaultDistro = match[1];
          wslVersion = parseInt(match[2], 10);
          break;
        }
      }
      // Fall back to first non-header line if no '*' found
      if (!defaultDistro) {
        for (const line of lines) {
          const match = line.match(/^\s*(\S+)\s+\S+\s+(\d+)/);
          if (match && !/^name$/i.test(match[1])) {
            defaultDistro = match[1];
            wslVersion = parseInt(match[2], 10);
            break;
          }
        }
      }
    } catch {
      // wsl --list may fail on older builds; distro name and version will be undefined
    }

    // Detect WSL Linux architecture (aarch64 → arm64, x86_64 stays as-is)
    let arch: string | undefined;
    try {
      const archOutput = execSync('wsl.exe -e sh -c "uname -m"', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      arch = archOutput === 'aarch64' ? 'arm64' : archOutput || undefined;
    } catch {
      // Fall back to undefined; caller will default to x86_64
    }

    cachedWslInfo = {
      available: true,
      defaultDistro,
      homeDir: homeOutput || undefined,
      arch,
      wslVersion,
    };
  } catch (err) {
    console.error('[wslBridge] getWslInfo failed:', err);
    cachedWslInfo = {
      available: false,
      defaultDistro: undefined,
      homeDir: undefined,
      arch: undefined,
      wslVersion: undefined,
    };
  }
  return cachedWslInfo;
}

export function invalidateWslCache(): void {
  cachedWslInfo = undefined;
}

/** Reset the WSL network-info cache. Call after a `wsl --shutdown` or after
 *  the user edits `.wslconfig`, since both invalidate mirrored/IP state. */
export function invalidateWslNetworkCache(): void {
  cachedWslNetworkInfo = undefined;
}

/**
 * Read the last cached network info, if any. Synchronous so tree-item
 * tooltips can consume it at render time. Returns undefined until the first
 * successful call to refreshWslNetworkInfo().
 */
export function getWslNetworkInfoCached(): WslNetworkInfo | undefined {
  return cachedWslNetworkInfo;
}

/**
 * Parse `%USERPROFILE%\.wslconfig` for `networkingMode=mirrored` in the
 * [wsl2] section. Mirrored networking is a Windows-side setting (not
 * /etc/wsl.conf), so this file is the authoritative source. Returns false
 * when the file doesn't exist, has no [wsl2] section, or sets a different
 * mode. Parser tolerates whitespace, comments (`#`/`;`), and case.
 */
export function parseWslConfigForMirrored(content: string): boolean {
  let inWsl2 = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      inWsl2 = section[1].trim().toLowerCase() === 'wsl2';
      continue;
    }
    if (!inWsl2) continue;
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*$/);
    if (kv && kv[1].toLowerCase() === 'networkingmode') {
      return kv[2].trim().toLowerCase() === 'mirrored';
    }
  }
  return false;
}

function readWslConfigMirrored(): boolean {
  try {
    const configPath = path.join(os.homedir(), '.wslconfig');
    const content = fs.readFileSync(configPath, 'utf-8');
    return parseWslConfigForMirrored(content);
  } catch {
    return false;
  }
}

/**
 * Probe `hostname -I` inside the default WSL distro and return the first
 * IPv4 address, or undefined if the probe fails. The address is unstable
 * across `wsl --shutdown`, so callers should refresh (not trust) it.
 */
export async function getWslIpAddressAsync(): Promise<string | undefined> {
  if (!isWindows()) return undefined;
  const stdout = await new Promise<string | undefined>((resolve) => {
    exec('wsl.exe -e hostname -I', { timeout: 10000, encoding: 'utf-8' }, (err, out) => {
      if (err) resolve(undefined);
      else resolve(String(out));
    });
  });
  if (stdout === undefined) return undefined;
  const tokens = stdout.replace(/\0/g, '').trim().split(/\s+/);
  for (const t of tokens) {
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(t)) return t;
  }
  return undefined;
}

/**
 * Parse the output of `wsl --version`. Returns the core package version
 * (e.g. `"2.0.9.0"`) or undefined when the header line is missing.
 * `wsl --version` was added in WSL core ~0.64; older installs produce an
 * error that this parser never sees — caller handles that case.
 *
 * wsl.exe writes in UTF-16LE on most Windows builds, so strip NUL bytes
 * before matching. The header line varies by locale, but the version
 * token always appears after the first colon on a line containing "WSL".
 */
export function parseWslCoreVersion(raw: string): string | undefined {
  const cleaned = String(raw).replace(/\0/g, '');
  for (const line of cleaned.split(/\r?\n/)) {
    // Match "WSL version: 2.0.9.0" (English) and localized equivalents.
    const match = line.match(/(\d+\.\d+(?:\.\d+){0,2})/);
    if (match && /WSL/i.test(line)) return match[1];
  }
  return undefined;
}

/** Return true when `version` is >= 2.0 — the minimum for mirrored mode. */
export function isMirroredCapable(version: string | undefined): boolean {
  if (!version) return false;
  const parts = version.split('.').map((n) => parseInt(n, 10));
  if (parts.length === 0 || Number.isNaN(parts[0])) return false;
  return parts[0] >= 2;
}

export async function getWslCoreVersionAsync(): Promise<string | undefined> {
  if (!isWindows()) return undefined;
  const stdout = await new Promise<string | undefined>((resolve) => {
    exec('wsl.exe --version', { timeout: 10000, encoding: 'utf-8' }, (err, out) => {
      if (err) resolve(undefined);
      else resolve(String(out));
    });
  });
  if (stdout === undefined) return undefined;
  return parseWslCoreVersion(stdout);
}

/**
 * Refresh and return the current WSL network info. Safe to call repeatedly;
 * each call re-probes. On non-Windows returns a disabled result.
 */
export async function refreshWslNetworkInfo(): Promise<WslNetworkInfo> {
  if (!isWindows()) {
    cachedWslNetworkInfo = {
      mirrored: false,
      ip: undefined,
      netldiHost: undefined,
      wslCoreVersion: undefined,
      supportsMirrored: false,
    };
    return cachedWslNetworkInfo;
  }
  const mirrored = readWslConfigMirrored();
  const [ip, wslCoreVersion] = await Promise.all([
    mirrored ? Promise.resolve(undefined) : getWslIpAddressAsync(),
    getWslCoreVersionAsync(),
  ]);
  const netldiHost = mirrored ? 'localhost' : ip;
  cachedWslNetworkInfo = {
    mirrored,
    ip,
    netldiHost,
    wslCoreVersion,
    supportsMirrored: isMirroredCapable(wslCoreVersion),
  };
  return cachedWslNetworkInfo;
}

/**
 * Pure `.wslconfig` rewriter that sets `networkingMode=mirrored` in the
 * [wsl2] section while preserving other keys, sections, comments, and line
 * endings. Used by the "Enable mirrored networking" action and covered
 * thoroughly by unit tests. Returns the new file content.
 *
 * Rules:
 *  - If the file is empty or has no [wsl2] section, append a new one.
 *  - If [wsl2] exists and already has `networkingMode=`, replace its value.
 *  - If [wsl2] exists without the key, insert the key as the first line of
 *    the section (directly under the [wsl2] header).
 */
export function updateWslConfigMirrored(content: string): string {
  const lines = content.split(/\r?\n/);
  // Preserve CRLF when the input used it; default to LF otherwise.
  const eol = content.includes('\r\n') ? '\r\n' : '\n';

  let wsl2Start = -1;
  let existingIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const section = trimmed.match(/^\[([^\]]+)\]$/);
    if (section) {
      if (wsl2Start !== -1) {
        break;
      }
      if (section[1].trim().toLowerCase() === 'wsl2') wsl2Start = i;
      continue;
    }
    if (wsl2Start !== -1) {
      if (trimmed.startsWith('#') || trimmed.startsWith(';') || trimmed === '') continue;
      const kv = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*.+$/);
      if (kv && kv[1].toLowerCase() === 'networkingmode') {
        existingIdx = i;
        break;
      }
    }
  }

  if (existingIdx !== -1) {
    lines[existingIdx] = 'networkingMode=mirrored';
    return lines.join(eol);
  }

  if (wsl2Start !== -1) {
    lines.splice(wsl2Start + 1, 0, 'networkingMode=mirrored');
    return lines.join(eol);
  }

  // No [wsl2] section anywhere — append. Preserve trailing newline when
  // the input ended with one (split produces a trailing '' entry).
  const hadTrailingNewline = content.length > 0 && /\r?\n$/.test(content);
  const prefix = content.length === 0 ? '' : hadTrailingNewline ? content : content + eol;
  return prefix + '[wsl2]' + eol + 'networkingMode=mirrored' + eol;
}

/**
 * Parse `wsl.exe --list --verbose` output. Returns the default distro
 * (marked with '*') and its WSL version, or the first non-header row as
 * fallback. Returns an empty object if no rows are present.
 */
function parseWslListOutput(output: string): { distro?: string; version?: number } {
  const lines = output
    .replace(/\0/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (const line of lines) {
    const match = line.match(/^\*\s+(\S+)\s+\S+\s+(\d+)/);
    if (match) return { distro: match[1], version: parseInt(match[2], 10) };
  }
  for (const line of lines) {
    const match = line.match(/^\s*(\S+)\s+\S+\s+(\d+)/);
    if (match && !/^name$/i.test(match[1])) {
      return { distro: match[1], version: parseInt(match[2], 10) };
    }
  }
  return {};
}

function normalizeArch(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed === 'aarch64' ? 'arm64' : trimmed;
}

/**
 * Async variant of getWslInfo. Use this during extension activation (and on
 * any re-check) so the extension host event loop isn't blocked by wsl.exe
 * startup — which can take seconds when the WSL2 VM is cold.
 * Shares the same cache as getWslInfo().
 */
export async function getWslInfoAsync(): Promise<WslInfo> {
  if (cachedWslInfo) return cachedWslInfo;
  if (!isWindows()) {
    cachedWslInfo = {
      available: false,
      defaultDistro: undefined,
      homeDir: undefined,
      arch: undefined,
      wslVersion: undefined,
    };
    return cachedWslInfo;
  }
  try {
    const { stdout: homeStdout } = await execAsync('wsl.exe -e sh -c "echo $HOME"', {
      timeout: 15000,
      encoding: 'utf-8',
    });
    const homeDir = String(homeStdout).trim() || undefined;

    let defaultDistro: string | undefined;
    let wslVersion: number | undefined;
    try {
      const { stdout: listStdout } = await execAsync('wsl.exe --list --verbose', {
        timeout: 10000,
        encoding: 'utf-8',
      });
      const parsed = parseWslListOutput(String(listStdout));
      defaultDistro = parsed.distro;
      wslVersion = parsed.version;
    } catch {
      // wsl --list may fail on older builds; leave undefined
    }

    let arch: string | undefined;
    try {
      const { stdout: archStdout } = await execAsync('wsl.exe -e sh -c "uname -m"', {
        timeout: 10000,
        encoding: 'utf-8',
      });
      arch = normalizeArch(String(archStdout));
    } catch {
      // Fall back to undefined; caller will default to x86_64
    }

    cachedWslInfo = {
      available: true,
      defaultDistro,
      homeDir,
      arch,
      wslVersion,
    };
  } catch (err) {
    console.error('[wslBridge] getWslInfoAsync failed:', err);
    cachedWslInfo = {
      available: false,
      defaultDistro: undefined,
      homeDir: undefined,
      arch: undefined,
      wslVersion: undefined,
    };
  }
  return cachedWslInfo;
}

/**
 * Convert a WSL-side Linux path to a Windows UNC path.
 * e.g., /home/user/Documents -> \\wsl$\Ubuntu\home\user\Documents
 */
export function wslPathToWindows(wslPath: string, distro?: string): string {
  const info = getWslInfo();
  const d = distro || info.defaultDistro || 'Ubuntu';
  return `\\\\wsl$\\${d}${wslPath.replace(/\//g, '\\')}`;
}

/**
 * Convert a Windows UNC path (\\wsl$\...) back to a WSL Linux path.
 * e.g., \\wsl$\Ubuntu\home\user\Documents -> /home/user/Documents
 */
export function windowsPathToWsl(windowsPath: string): string {
  const match = windowsPath.match(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+(.*)$/i);
  if (match) {
    return match[1].replace(/\\/g, '/');
  }
  return windowsPath;
}

/**
 * Spawn a command, routing through wsl.exe on Windows.
 * On Linux, wraps the command with `ulimit -n 1024` to reset the open-file
 * limit inherited from Electron (~1 billion), which GemStone uses in its
 * shared page cache size calculations.
 * Environment variables are passed via the `env` command inside WSL.
 */
export function wslSpawn(cmd: string, args: string[], env?: Record<string, string>): ChildProcess {
  if (needsWsl()) {
    const envPairs = env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : [];
    const wslArgs = ['-e', 'env', ...envPairs, cmd, ...args];
    return spawn('wsl.exe', wslArgs, { env: process.env });
  }
  // BASH_ENV is the one way a non-interactive `bash -c` can still be made to
  // read a startup file, and a startup file is free to clobber the environment
  // Jasper just built. Users really do have `unset GEMSTONE` in their .bashrc —
  // and a GemStone command whose GEMSTONE has been unset out from under it
  // reports the variable as undefined, which reads as a broken install rather
  // than as someone else's shell rewriting Jasper's environment.
  const mergedEnv = { ...process.env, ...env, BASH_ENV: '' };
  if (process.platform === 'linux') {
    // --noprofile --norc for the same reason: the wrapper exists only to set
    // ulimit before exec, so it has no business running the user's rc files.
    //
    // cmd and args are passed as positional parameters to a *constant* -c
    // script (`exec "$@"`), never interpolated into it, so there is no shell
    // for them to inject into — and cmd is a Jasper-built binary path, not
    // user input. CodeQL's js/shell-command-injection-from-environment alert
    // here is a false positive.
    return spawn(
      '/bin/bash',
      ['--noprofile', '--norc', '-c', 'ulimit -n 1024; exec "$@"', '--', cmd, ...args],
      { env: mergedEnv },
    );
  }
  return spawn(cmd, args, { env: mergedEnv });
}

/**
 * Execute a command synchronously, routing through wsl.exe on Windows.
 */
export function wslExecSync(
  cmd: string,
  env?: Record<string, string>,
  options?: { timeout?: number },
): string {
  if (!needsWsl()) {
    // BASH_ENV: '' for the same reason wslSpawn blanks it — execSync runs
    // through /bin/sh, which is bash on many distros, so a BASH_ENV startup
    // file is free to `unset GEMSTONE` out from under gslist and friends.
    return execSync(cmd, {
      encoding: 'utf-8',
      env: { ...process.env, ...env, BASH_ENV: '' },
      timeout: options?.timeout,
    });
  }
  const envPrefix = env
    ? Object.entries(env)
        .map(([k, v]) => `${k}='${v}'`)
        .join(' ') + ' '
    : '';
  return execSync(`wsl.exe -e sh -c "${envPrefix}${cmd.replace(/"/g, '\\"')}"`, {
    encoding: 'utf-8',
    timeout: options?.timeout,
  });
}

/**
 * Execute a command without blocking the extension host, routing through
 * wsl.exe on Windows exactly as `wslExecSync` does.
 *
 * The sync variant stops the host's event loop for the whole run, which stalls
 * every other extension as well as Jasper's own rendering. That is tolerable
 * for a `gslist` measured in milliseconds; it is not for a probe that can take
 * a second and a half and may be repeated while waiting for gems to exit. Use
 * this wherever the command's duration is not known to be trivial.
 *
 * Rejects the way `execSync` throws — on a non-zero exit or a missing command —
 * so callers can keep the same error handling.
 */
export async function wslExec(
  cmd: string,
  env?: Record<string, string>,
  options?: { timeout?: number },
): Promise<string> {
  if (!needsWsl()) {
    // BASH_ENV: '' for the same reason wslExecSync blanks it — exec runs
    // through /bin/sh, which is bash on many distros, so a BASH_ENV startup
    // file is free to `unset GEMSTONE` out from under gslist and friends.
    const { stdout } = await execAsync(cmd, {
      encoding: 'utf-8',
      env: { ...process.env, ...env, BASH_ENV: '' },
      timeout: options?.timeout,
    });
    return stdout;
  }
  const envPrefix = env
    ? Object.entries(env)
        .map(([k, v]) => `${k}='${v}'`)
        .join(' ') + ' '
    : '';
  const { stdout } = await execAsync(`wsl.exe -e sh -c "${envPrefix}${cmd.replace(/"/g, '\\"')}"`, {
    encoding: 'utf-8',
    timeout: options?.timeout,
  });
  return stdout;
}
