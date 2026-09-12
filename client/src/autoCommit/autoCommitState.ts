/**
 * Auto-commit's per-session state (issue #254).
 *
 * Auto-commit belongs to a SESSION, not to the window and not to the workspace: a
 * transaction is a session's, so "commit everything I do" can only mean "commit
 * everything THIS session does". Two sessions against the same stone can sensibly want
 * different answers — one driving a long refactoring it wants to abort as a unit, one
 * poking at objects it wants persisted — and a single window-wide switch could not give
 * them one. The window-wide setting (`gemstone.autoCommit.enableForNewSessions`) only
 * seeds what a NEW session starts at; from then on the session owns its own answer.
 *
 * State lives here, in a module, for the same reason the undo stack does: the write path
 * that has to consult it (`browserQueries`) is a module of free functions taking a
 * session, with nowhere to hang an injected service, and threading a controller through
 * every mutation signature would be a far larger change than the feature.
 *
 * Deliberately free of `vscode` and of GCI. The status bar, the toggle command and the
 * failure prompt are built on top (`autoCommitStatusBar.ts`, `autoCommitUi.ts`); the
 * committing itself is `autoCommitRunner.ts`. Keeping this layer plain means the write
 * path can consult it without pulling the workbench into `browserQueries`, whose tests
 * mock barely any of it.
 */

/**
 * What auto-commit is doing for one session.
 *
 * `failed` is a third state rather than a flag beside `on` because it is neither: the
 * session asked for auto-commit and is not getting it. A commit that fails is nearly
 * always a conflict with another session, which the very next write would hit again — so
 * auto-commit stops trying (it does NOT fall back to `off`, which would say the user
 * turned it off) and says so loudly until the transaction is sorted out. `Jadeite` draws
 * the same three-state distinction, and for the same reason.
 */
export type AutoCommitStatus = 'off' | 'on' | 'failed';

/** Told whenever any session's status changes, so the displays can redraw. */
export type AutoCommitListener = () => void;

const statuses = new Map<number, AutoCommitStatus>();

/** How many nested `runWithAutoCommitDeferred` calls are open on a session. */
const suspensions = new Map<number, number>();

/** Sessions that wrote something while suspended, and so owe a commit when the
 *  outermost suspension lifts. */
const pending = new Set<number>();

const listeners = new Set<AutoCommitListener>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* a display that throws must not break the edit that triggered the change */
    }
  }
}

/** Subscribe to status changes. */
export function onAutoCommitChanged(listener: AutoCommitListener): { dispose: () => void } {
  listeners.add(listener);
  return {
    dispose: () => {
      listeners.delete(listener);
    },
  };
}

export function getAutoCommitStatus(sessionId: number): AutoCommitStatus {
  return statuses.get(sessionId) ?? 'off';
}

/** Whether writes on this session should commit — true only in the plain `on` state. */
export function isAutoCommitArmed(sessionId: number): boolean {
  return getAutoCommitStatus(sessionId) === 'on';
}

export function setAutoCommitStatus(sessionId: number, status: AutoCommitStatus): void {
  if (getAutoCommitStatus(sessionId) === status) return;
  statuses.set(sessionId, status);
  notify();
}

/**
 * Seed a newly logged-in session from the window-wide default. Called once per session,
 * after the post-login abort has cleared the spurious uncommitted state a fresh login
 * carries — arming before that would commit that noise as the session's first act.
 */
export function registerSessionAutoCommit(sessionId: number, enabled: boolean): void {
  statuses.set(sessionId, enabled ? 'on' : 'off');
  suspensions.delete(sessionId);
  pending.delete(sessionId);
  notify();
}

/** Drop a logged-out session's state, so a later session reusing the id starts clean. */
export function forgetSessionAutoCommit(sessionId: number): void {
  const had = statuses.has(sessionId);
  statuses.delete(sessionId);
  suspensions.delete(sessionId);
  pending.delete(sessionId);
  if (had) notify();
}

/** Whether a multi-step operation currently holds off this session's commits. */
export function isAutoCommitSuspended(sessionId: number): boolean {
  return (suspensions.get(sessionId) ?? 0) > 0;
}

/** Open one level of suspension. */
export function suspendAutoCommit(sessionId: number): void {
  suspensions.set(sessionId, (suspensions.get(sessionId) ?? 0) + 1);
}

/** Close one level of suspension; answers whether that was the outermost one. */
export function resumeAutoCommit(sessionId: number): boolean {
  const depth = suspensions.get(sessionId) ?? 0;
  if (depth <= 1) {
    suspensions.delete(sessionId);
    return depth === 1;
  }
  suspensions.set(sessionId, depth - 1);
  return false;
}

/** Record that a write happened while suspended, so the outermost level commits it. */
export function markAutoCommitPending(sessionId: number): void {
  pending.add(sessionId);
}

/** Whether a write happened while this session was suspended. */
export function hasAutoCommitPending(sessionId: number): boolean {
  return pending.has(sessionId);
}

export function clearAutoCommitPending(sessionId: number): void {
  pending.delete(sessionId);
}

/** Wipe every session's state. Tests only. */
export function _resetAutoCommitStateForTests(): void {
  statuses.clear();
  suspensions.clear();
  pending.clear();
  listeners.clear();
}
