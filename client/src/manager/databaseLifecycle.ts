import { GemStoneDatabase } from '../sysadminTypes';
import { ExtentHolder } from '../extentHolders';

/** The node shape the per-server start/stop commands expect.
 *
 *  `sessionsCleared` tells `gemstone.stopStone` that the caller has already
 *  logged the database's sessions out and had the user answer for anything left
 *  attached, so it does not put the same question a second time. */
export type ServerTarget = {
  kind: 'stone' | 'netldi';
  db: GemStoneDatabase;
  sessionsCleared?: boolean;
};

/**
 * What a whole-database start or stop needs: which of the two servers are
 * already in the state being asked for, and how to act on one of them. The
 * work itself is left to the existing per-server commands, so this inherits
 * their prompts, escalation and error reporting rather than restating them.
 */
export interface DatabaseLifecycleDeps {
  isStoneRunning(name: string, version: string): boolean;
  isNetldiRunning(name: string, version: string): boolean;
  run(command: string, target: ServerTarget): Promise<void>;
}

/**
 * Start whichever of a database's servers is not already up. Each is checked
 * before it is acted on, so starting a database whose NetLDI is already running
 * does not try to start it a second time.
 *
 * If the stone does not come up, the NetLDI is left alone: the user cancelled
 * at the shared-memory prompt, or the start failed and said so, and a NetLDI
 * raised beside a stone that never started is not what "start this database"
 * was asked to do.
 */
export async function bringUpDatabase(
  db: GemStoneDatabase,
  deps: DatabaseLifecycleDeps,
): Promise<void> {
  const cfg = db.config;
  if (!deps.isStoneRunning(cfg.stoneName, cfg.version)) {
    await deps.run('gemstone.startStone', { kind: 'stone', db });
    if (!deps.isStoneRunning(cfg.stoneName, cfg.version)) return;
  }
  if (!deps.isNetldiRunning(cfg.ldiName, cfg.version)) {
    await deps.run('gemstone.startNetldi', { kind: 'netldi', db });
  }
}

/**
 * Stop whichever of a database's servers is up, for the same reason.
 *
 * Stopping the stone can be declined — it asks for the DataCurator password and
 * offers a force-stop, and Cancel is a real answer — and `gemstone.stopStone`
 * reports that by leaving the stone alone rather than by failing. So the stone
 * is re-read before the NetLDI is touched: taking the NetLDI down from under a
 * stone the user just chose to keep leaves the database unreachable, which is
 * the opposite of what cancelling asked for.
 */
export async function takeDownDatabase(
  db: GemStoneDatabase,
  deps: DatabaseLifecycleDeps,
  opts: { sessionsCleared?: boolean } = {},
): Promise<void> {
  const cfg = db.config;
  if (deps.isStoneRunning(cfg.stoneName, cfg.version)) {
    await deps.run('gemstone.stopStone', {
      kind: 'stone',
      db,
      sessionsCleared: opts.sessionsCleared,
    });
    if (deps.isStoneRunning(cfg.stoneName, cfg.version)) return;
  }
  if (deps.isNetldiRunning(cfg.ldiName, cfg.version)) {
    await deps.run('gemstone.stopNetldi', { kind: 'netldi', db });
  }
}

/** What clearing a database's sessions needs: a way to log Jasper's own out, a
 *  way to see what still holds the extents, and a clock. Injected so the wait
 *  can be tested without real time or real processes. */
export interface SessionClearDeps {
  /** Log out Jasper's sessions on the database; returns how many there were. */
  reapSessions(): number;
  /** Processes holding the extents, excluding the stone's own. Asynchronous
   *  because the probe shells out, and the extension host must stay responsive
   *  while it does. */
  attachedHolders(): Promise<ExtentHolder[]>;
  wait(ms: number): Promise<void>;
  now(): number;
}

/**
 * Log a database's sessions out and wait for their gems to actually go, then
 * report whatever is still attached.
 *
 * Two things keep this quick, both learned the slow way — each probe is a
 * shell-out costing up to a second and a half, and the user is watching a
 * progress notification for the whole of it.
 *
 * Nothing logged out means nothing is on its way out: whatever holds the
 * extents now is foreign and will still be foreign in ten seconds, so there is
 * no wait at all. And the wait ends when the holder list *stops changing*, not
 * when it empties — a foreign session never leaves, and polling for one that
 * was never going to go is the difference between a prompt appearing at once
 * and appearing to hang.
 */
export async function clearSessionsForStop(
  deps: SessionClearDeps,
  opts: { timeoutMs: number; pollMs: number },
): Promise<ExtentHolder[]> {
  if (deps.reapSessions() === 0) return await deps.attachedHolders();

  const deadline = deps.now() + opts.timeoutMs;
  let holders = await deps.attachedHolders();
  while (holders.length > 0 && deps.now() < deadline) {
    await deps.wait(opts.pollMs);
    const next = await deps.attachedHolders();
    const settled = samePids(holders, next);
    holders = next;
    if (settled) break;
  }
  return holders;
}

/** Whether two probes found the same holders, compared as sets: neither `fuser`
 *  nor `lsof -t` promises an order, so the same processes coming back shuffled
 *  is not a change, and treating it as one buys another poll — and another
 *  shell-out — for nothing. */
function samePids(a: ExtentHolder[], b: ExtentHolder[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a.map((h) => h.pid));
  return b.every((h) => seen.has(h.pid));
}
