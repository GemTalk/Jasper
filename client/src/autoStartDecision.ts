import { GemStoneDatabase, GemStoneProcess } from './sysadminTypes';
import { versionsMatch } from './processManager';

/** Whether one of a database's two processes is up, and whether it is healthy.
 *  `running` mirrors what the Databases view shows; `responding` is the gslist
 *  Status column, which `ProcessManager.isStoneRunning` deliberately ignores. */
export interface ProcessHealth {
  running: boolean;
  responding: boolean;
}

export interface DatabaseProcessState {
  stone: ProcessHealth;
  netldi: ProcessHealth;
}

/** What, if anything, the login-failure recovery flow should do. */
export type StartNeed =
  /** Both processes are up and healthy — the login failed for some other
   *  reason (bad password, wrong user), so leave the original error alone. */
  | { kind: 'already-running' }
  /** A process exists but is not responding. `startstone` cannot fix this;
   *  the user needs the stale-lock tooling. */
  | { kind: 'not-responding'; what: 'stone' | 'netldi' }
  /** Something is down and can be started. */
  | { kind: 'can-start'; startStone: boolean; startNetldi: boolean };

function health(
  processes: GemStoneProcess[],
  type: GemStoneProcess['type'],
  name: string,
  version: string,
): ProcessHealth {
  const found = processes.find(
    (p) => p.type === type && p.name === name && versionsMatch(p.version, version),
  );
  return { running: found !== undefined, responding: found?.responding ?? false };
}

/**
 * The live state of a database's stone and NetLDI, given a process list from
 * `ProcessManager.refreshProcesses()`.
 *
 * Matches on name *and* version — the same stone name can exist under two
 * installed versions — using the same loose `versionsMatch` comparison the
 * Databases view uses, since gslist and database.yaml record versions at
 * different precisions.
 *
 * Pure (no vscode / ProcessManager) so every combination can be unit-tested.
 */
export function inspectDatabaseProcesses(
  db: GemStoneDatabase,
  processes: GemStoneProcess[],
): DatabaseProcessState {
  const { stoneName, ldiName, version } = db.config;
  return {
    stone: health(processes, 'stone', stoneName, version),
    netldi: health(processes, 'netldi', ldiName, version),
  };
}

/**
 * Decide what the recovery flow should do about a database's process state.
 *
 * A login needs both the stone and the NetLDI, and the two are started
 * independently, so anything that is *down* is offered first — a process that
 * is merely wedged on one side is no reason to leave a stopped process on the
 * other side stopped. Only when nothing can be started does an unresponsive
 * process get called out on its own: starting it would just fail, so that case
 * wants the stale-lock tooling, not a second `startstone`.
 */
export function classifyStartNeed(state: DatabaseProcessState): StartNeed {
  if (!state.stone.running || !state.netldi.running) {
    return {
      kind: 'can-start',
      startStone: !state.stone.running,
      startNetldi: !state.netldi.running,
    };
  }
  // Both are up; if one is wedged, starting cannot help it (stone first).
  if (!state.stone.responding) {
    return { kind: 'not-responding', what: 'stone' };
  }
  if (!state.netldi.responding) {
    return { kind: 'not-responding', what: 'netldi' };
  }
  return { kind: 'already-running' };
}
