import * as vscode from 'vscode';
import type { ActiveSession } from './activeSession';
import { loginLabel } from './loginTypes';

export const FORCE_STOP = 'Force Stop';
export const LOG_OUT = 'Log Out';
export const STOP = 'Stop';

export interface StillRunningDeps {
  /** Whether the session is one the user can see and log out. */
  isRegistered(sessionId: number): boolean;
  /** Answers whether the run ended; see forceStop.ts. */
  forceStop(session: ActiveSession): Promise<boolean>;
  logout(sessionId: number): Promise<unknown>;
}

/**
 * When each session's notice was last shown, so a burst of refused calls shows
 * one. Not "while one is up": a notice can sit unanswered in the notification
 * center, and every later refusal would then show nothing.
 */
const lastShown = new Map<string, number>();
const NOTICE_BURST_MS = 2000;

/** Whether `kind` of notice may show for `sessionId` now, recording that it does. */
function mayShow(kind: string, sessionId: number): boolean {
  const key = `${kind}:${sessionId}`;
  const now = Date.now();
  if (now - (lastShown.get(key) ?? -Infinity) < NOTICE_BURST_MS) return false;
  lastShown.set(key, now);
  return true;
}

export interface RunInProgressDeps {
  isRegistered(sessionId: number): boolean;
  /** Stops the run as its own Cancel does; answers false when it has already ended. */
  stop(session: ActiveSession): boolean;
}

/**
 * Tell the user a run nobody has stopped holds the session, and offer to stop
 * it. A run that ignores the stop then gets the Force Stop notice.
 */
export async function showRunInProgress(
  session: ActiveSession,
  deps: RunInProgressDeps,
): Promise<void> {
  if (!deps.isRegistered(session.id) || !mayShow('running', session.id)) return;
  const pick = await vscode.window.showWarningMessage(
    `Session ${session.id} — ${loginLabel(session.login)}: a run is still going on this ` +
      'session. Nothing else can run on it until that run ends.',
    STOP,
  );
  if (pick !== STOP || !deps.isRegistered(session.id)) return;
  if (!deps.stop(session)) {
    void vscode.window.showInformationMessage(`Session ${session.id}: that run has already ended.`);
  }
}

/**
 * Tell the user a stopped run is still running, and offer Force Stop. A run that
 * ignores that too can only be ended by logging out, which is offered next,
 * asking first. Jasper's own short-lived logins get no notice: they aren't the
 * user's to stop.
 */
export async function showStillRunning(
  session: ActiveSession,
  deps: StillRunningDeps,
): Promise<void> {
  if (!deps.isRegistered(session.id) || !mayShow('stopped', session.id)) return;
  const pick = await vscode.window.showWarningMessage(
    `Session ${session.id} — ${loginLabel(session.login)}: the stopped run is still running on ` +
      'the server. Nothing else can run on this session until it ends.',
    FORCE_STOP,
  );
  if (pick !== FORCE_STOP || !deps.isRegistered(session.id)) return;

  let why: string;
  try {
    const stopped = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Force-stopping session ${session.id}…`,
      },
      () => deps.forceStop(session),
    );
    if (stopped) {
      void vscode.window.showInformationMessage(
        `Session ${session.id}: the run is stopped. Uncommitted changes are kept.`,
      );
      return;
    }
    why = 'The run is ignoring Force Stop too.';
  } catch (e) {
    why = `Force Stop failed: ${(e instanceof Error ? e.message : String(e)).replace(/\.?$/, '.')}`;
  }
  if (!deps.isRegistered(session.id)) return;
  const confirmed = await vscode.window.showWarningMessage(
    `${why} Log out session ${session.id} to end it? Any uncommitted changes in this session ` +
      'are lost.',
    { modal: true },
    LOG_OUT,
  );
  if (confirmed !== LOG_OUT) return;
  try {
    await deps.logout(session.id);
  } catch (e) {
    void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
  }
}
