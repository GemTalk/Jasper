/**
 * Auto-commit's per-session state (issue #254). Free of `vscode` and GCI so the write path in
 * `browserQueries` can consult it; the design is in docs/explanation/auto-commit.md.
 */
import type { TransactionMode } from '../queries/transactionMode';

/** `failed`: asked for, but stopped after a refused commit — not `off`, which the user chose. */
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

export function markAutoCommitPending(sessionId: number): void {
  pending.add(sessionId);
}

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

/**
 * Auto-commit only works in Auto-Begin. In Manual and Transactionless a commit leaves the
 * session outside a transaction, where a change still lands but a commit is refused (error
 * 2030), and a Begin throws that change away — so after at most one commit, every change
 * would be stranded. Checked on 3.6.2 and 3.7.5 (`transactionMode.integration.test.ts`).
 * An unread mode does not block: the runner's 2030 handling still catches it.
 */
export function autoCommitBlockedByMode(mode: TransactionMode | undefined): boolean {
  return mode !== undefined && mode !== 'autoBegin';
}

export const AUTO_COMMIT_NEEDS_AUTO_BEGIN =
  'Auto-commit needs Auto-Begin mode: in Manual and Transactionless a commit leaves the ' +
  'session outside a transaction, where nothing can be committed.';

/** Armed and not paused: a write made now is committed at once. */
function commitsNow(sessionId: number): boolean {
  return isAutoCommitArmed(sessionId) && !isAutoCommitSuspended(sessionId);
}

/**
 * The end of a notice about a change that has just landed: `notCommitted` (the caller's own
 * wording) unless auto-commit committed it. Read after the commit, so a refused one, or one
 * held by a pause (a halted debugger), still says not committed.
 */
export function commitStateNote(sessionId: number, notCommitted: string): string {
  return commitsNow(sessionId) ? AUTO_COMMITTED_NOTE : notCommitted;
}

export const AUTO_COMMITTED_NOTE = 'Committed — this session has auto-commit on.';

/**
 * Added to the report of an operation that failed part-way on an armed session, and only when
 * part of it landed: that part is not committed, but the session's next change would commit it.
 */
export function heldBackNote(sessionId: number): string {
  return isAutoCommitArmed(sessionId)
    ? ' Nothing was committed. Abort to discard it — your next change would commit it.'
    : '';
}

/** For a confirmation shown BEFORE a change: what Abort can still do about it. */
export function beforeChangeCommitNote(sessionId: number, uncommitted: string): string {
  return commitsNow(sessionId)
    ? 'Auto-commit is on, so this is committed at once and Abort will not bring it back.'
    : uncommitted;
}
