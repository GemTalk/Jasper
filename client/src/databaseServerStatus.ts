import { GemStoneDatabase, GemStoneProcess } from './sysadminTypes';
import { versionsMatch } from './manager/versionMatch';
import { ExternalServerFinding } from './externalServerScan';

/** Whether one of a database's two processes is up, and whether it is usable.
 *  `running` means Jasper's own `gslist` can see it; `responding` is the gslist
 *  Status column; `external` means the process is alive on the host but absent
 *  from that gslist, so Jasper can see it exists but cannot work with it. */
export interface ProcessHealth {
  running: boolean;
  responding: boolean;
  external: boolean;
}

export interface DatabaseProcessState {
  stone: ProcessHealth;
  netldi: ProcessHealth;
}

/**
 * What a Databases-view row should say about one server.
 *
 * The point of having more than Running/Stopped is that the tree used to
 * contradict what a connect would do: it said *Running* whenever a matching
 * process turned up in Jasper's `gslist`, so a stone with no reachable NetLDI —
 * or a server the login could not traverse at all — looked perfectly healthy
 * right up until the login failed. Everything short of `running` here is a
 * state in which a connect will not succeed, and says why.
 */
export type ServerStatus =
  /** Nothing of this server is running anywhere we can see. */
  | 'stopped'
  /** Visible to Jasper, responding, and its counterpart is usable too. */
  | 'running'
  /** Visible to Jasper but its gslist Status is not OK — a stale lock or a
   *  wedged process. Starting it again cannot help. */
  | 'not-responding'
  /** Healthy in itself, but a login still cannot get through: for a stone,
   *  its NetLDI is down, wedged, or registered outside Jasper. */
  | 'unreachable'
  /** Alive on the host but missing from Jasper's gslist — started outside
   *  Jasper's environment, and registered where Jasper does not look. */
  | 'external';

export interface DatabaseStatus {
  stone: ServerStatus;
  netldi: ServerStatus;
}

function health(
  processes: GemStoneProcess[],
  type: GemStoneProcess['type'],
  name: string,
  version: string,
  external: boolean,
): ProcessHealth {
  const found = processes.find(
    (p) => p.type === type && p.name === name && versionsMatch(p.version, version),
  );
  return { running: found !== undefined, responding: found?.responding ?? false, external };
}

/**
 * The live state of a database's stone and NetLDI, given a process list from
 * `ProcessManager.refreshProcesses()` and — optionally — what a host process
 * scan found running outside Jasper's environment.
 *
 * Matches on name *and* version — the same stone name can exist under two
 * installed versions — using the same loose `versionsMatch` comparison the
 * Databases view uses, since gslist and database.yaml record versions at
 * different precisions.
 *
 * `external` is passed in rather than derived here because finding it out costs
 * a scan of the host process table; callers that have not done one get the
 * pre-existing gslist-only picture.
 *
 * Pure (no vscode / ProcessManager) so every combination can be unit-tested.
 */
export function inspectDatabaseProcesses(
  db: GemStoneDatabase,
  processes: GemStoneProcess[],
  externalServers: ExternalServerFinding = {},
): DatabaseProcessState {
  const { stoneName, ldiName, version } = db.config;
  return {
    stone: health(processes, 'stone', stoneName, version, externalServers.stone !== undefined),
    netldi: health(processes, 'netldi', ldiName, version, externalServers.netldi !== undefined),
  };
}

/** True when Jasper can actually work with this server: its own gslist sees it
 *  and reports it healthy. A process that is merely *alive* does not qualify —
 *  that distinction is the whole point of the external state. */
function usable(h: ProcessHealth): boolean {
  return h.running && h.responding && !h.external;
}

function statusOf(h: ProcessHealth): ServerStatus {
  // External comes first: the process is alive, so calling it Stopped is the
  // misreport this whole state exists to end.
  if (h.external) return 'external';
  if (!h.running) return 'stopped';
  if (!h.responding) return 'not-responding';
  return 'running';
}

/**
 * What the Databases view should show for a database's two rows.
 *
 * The stone carries the extra `unreachable` case because a login has to
 * traverse the NetLDI to reach it: a stone that is up and responding while its
 * NetLDI is not usable is running and not connectable, and saying plain
 * *Running* there is exactly the contradiction users hit. The NetLDI needs no
 * such case — it does not depend on the stone.
 */
export function databaseStatus(state: DatabaseProcessState): DatabaseStatus {
  const stone = statusOf(state.stone);
  return {
    stone: stone === 'running' && !usable(state.netldi) ? 'unreachable' : stone,
    netldi: statusOf(state.netldi),
  };
}

/** True when a connect can be expected to succeed — both servers visible to
 *  Jasper and healthy.
 *
 *  `classifyStartNeed` leads with this, and `databaseStatus` derives its
 *  statuses from the same `usable` notion, so "the tree shows a plain Running on
 *  both rows" and "the login-failure recovery decides the database was already
 *  up" are the same condition rather than two that happen to agree. */
export function isConnectable(state: DatabaseProcessState): boolean {
  return usable(state.stone) && usable(state.netldi);
}

/** Which whole-database action a database can offer, from its two servers'
 *  statuses.
 *
 *  Running and Stopped follow the stone, the way the Databases & Versions
 *  panel's power button does — a database is up when its stone is. External
 *  gets neither: Jasper cannot stop a server started outside its environment,
 *  and starting the other half beside one would only collide with it.
 *
 *  Lives here, pure, because three surfaces have to agree on it: the Databases
 *  sidebar's row context value, the panel's power button, and the Command
 *  Palette's database picker — which has no row to read and so would otherwise
 *  be the one surface offering Stop on an already-stopped database. */
export type DatabaseAction = 'Running' | 'Stopped' | 'External';

export function databaseAction(status: DatabaseStatus): DatabaseAction {
  if (status.stone === 'external' || status.netldi === 'external') return 'External';
  return status.stone === 'stopped' ? 'Stopped' : 'Running';
}
