import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ActiveSession } from './sessionManager';
import { DEFAULT_GS_PW as DEFAULT_SYSTEMUSER_PW } from './loginTypes';

/** Default port the Seaside Zinc adaptor listens on. */
export const SEASIDE_DEFAULT_PORT = 8383;

/** Serving gems, keyed by port, so we can stop them and avoid double-starts. */
const servers = new Map<number, ChildProcess>();

export interface StartSeasideOptions {
  session: ActiveSession;
  /** GemStone install root (the `GemStone64Bit…` directory). */
  gemstonePath: string;
  /** GEMSTONE_GLOBAL_DIR — where the GCI library finds the NetLDI/stone locks. */
  globalDir: string;
  port?: number;
  /** SystemUser password (serving writes objectSecurityPolicyId 1). */
  systemUserPassword?: string;
  appPath?: string;
}

/** URL a served app is reachable at. */
export function seasideUrl(port = SEASIDE_DEFAULT_PORT, appPath = 'hello'): string {
  return `http://localhost:${port}/${appPath}`;
}

export function isSeasideServing(port = SEASIDE_DEFAULT_PORT): boolean {
  return servers.has(port);
}

/**
 * Start the Seaside Zinc adaptor in a detached GemStone gem and wait until it
 * serves the app. `WAGsZincAdaptor startOn:` runs a blocking listen loop, so it
 * cannot run in the extension's own GCI session — it lives in its own topaz
 * process (its own process group, so it survives and can be signalled to stop).
 * Requires the app's Rowan project to already be loaded (its load registers the
 * app); serving needs SystemUser (security policy 1).
 */
export async function startSeasideServer(opts: StartSeasideOptions): Promise<string> {
  const port = opts.port ?? SEASIDE_DEFAULT_PORT;
  const appPath = opts.appPath ?? 'hello';
  const url = seasideUrl(port, appPath);
  if (servers.has(port)) return url;

  const pw = opts.systemUserPassword ?? DEFAULT_SYSTEMUSER_PW;
  const stone = opts.session.login.stone;
  const script =
    [
      `set gemstone ${stone}`,
      'set user SystemUser',
      `set pass ${pw}`,
      'login',
      'run',
      `WAGsZincAdaptor startOn: ${port}.`,
      '%',
    ].join('\n') + '\n';

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GEMSTONE: opts.gemstonePath,
    GEMSTONE_GLOBAL_DIR: opts.globalDir,
    PATH: `${opts.gemstonePath}/bin:${process.env.PATH ?? ''}`,
  };
  if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = `${opts.gemstonePath}/lib`;
  else env.LD_LIBRARY_PATH = `${opts.gemstonePath}/lib`;

  const logPath = path.join(os.tmpdir(), `jasper-seaside-${port}.log`);
  const log = fs.openSync(logPath, 'w');
  const child = spawn(path.join(opts.gemstonePath, 'bin', 'topaz'), ['-l'], {
    env,
    detached: true,
    stdio: ['pipe', log, log],
  });
  child.stdin?.write(script);
  child.stdin?.end();
  child.unref();
  servers.set(port, child);
  child.once('exit', () => servers.delete(port));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok && (await res.text()).includes('Hello World')) return url;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }

  stopSeasideServer(port);
  const tail = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(-1200) : '';
  throw new Error(
    `Seaside server on port ${port} did not respond. Is the app loaded/committed? Log:\n${tail}`,
  );
}

/** Stop the serving gem on `port`. Returns true if one was running. */
export function stopSeasideServer(port = SEASIDE_DEFAULT_PORT): boolean {
  const child = servers.get(port);
  if (!child) return false;
  servers.delete(port);
  try {
    // Negative pid signals the whole detached process group.
    if (child.pid) process.kill(-child.pid, 'SIGTERM');
  } catch {
    // already gone
  }
  return true;
}

/** Stop every serving gem (used on extension deactivate). */
export function stopAllSeasideServers(): void {
  for (const port of [...servers.keys()]) stopSeasideServer(port);
}
