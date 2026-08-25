import { DatabaseProcessState, isConnectable } from './databaseServerStatus';

// The state model moved to databaseServerStatus.ts, which the Databases view
// shares, so the tree and this flow cannot disagree about what is running.
// Re-exported because this is where callers have always found them.
export {
  inspectDatabaseProcesses,
  isConnectable,
  type DatabaseProcessState,
  type ProcessHealth,
} from './databaseServerStatus';

/** What, if anything, the login-failure recovery flow should do. */
export type StartNeed =
  /** Both processes are up and healthy — the login failed for some other
   *  reason (bad password, wrong user), so leave the original error alone. */
  | { kind: 'already-running' }
  /** A server is alive on the host but registered outside Jasper's
   *  environment. Starting it would collide with the running one; it has to be
   *  stopped and restarted under Jasper's environment instead. Which of the two
   *  it was is not carried here — the recovery flow hands the whole scan finding
   *  to the reconcile, which needs the PIDs and directories anyway. */
  | { kind: 'external' }
  /** A process exists but is not responding. `startstone` cannot fix this;
   *  the user needs the stale-lock tooling. */
  | { kind: 'not-responding'; what: 'stone' | 'netldi' }
  /** Something is down and can be started. */
  | { kind: 'can-start'; startStone: boolean; startNetldi: boolean };

/**
 * Decide what the recovery flow should do about a database's process state.
 *
 * An external server is reported before anything else, because every other
 * answer is wrong while one is in the picture: the server is absent from
 * Jasper's gslist, so it looks stopped, and starting it collides with the
 * process already holding that name. That collision — plus the raw
 * `GEMSTONE environment variable is not defined` it can surface — is what used
 * to send users off debugging their shell profile.
 *
 * Otherwise a login needs both the stone and the NetLDI, and the two are
 * started independently, so anything that is *down* is offered first — a
 * process that is merely wedged on one side is no reason to leave a stopped
 * process on the other side stopped. Only when nothing can be started does an
 * unresponsive process get called out on its own: starting it would just fail,
 * so that case wants the stale-lock tooling, not a second `startstone`.
 */
export function classifyStartNeed(state: DatabaseProcessState): StartNeed {
  // Leading with the same predicate the Databases view uses for a plain
  // *Running* is what makes the two agree by construction: this flow decides
  // the login failed for some other reason exactly when the tree would have
  // shown both rows healthy. Everything below is the diagnosis of why not.
  if (isConnectable(state)) return { kind: 'already-running' };
  if (state.stone.external || state.netldi.external) {
    return { kind: 'external' };
  }
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
  // Only one way left to be unconnectable: both up, nothing external, the stone
  // responding — so it is the netldi that is wedged.
  return { kind: 'not-responding', what: 'netldi' };
}
