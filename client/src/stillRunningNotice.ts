import * as vscode from 'vscode';
import type { ActiveSession } from './activeSession';
import { loginLabel } from './loginTypes';

export const FORCE_STOP = 'Force Stop';
export const LOG_OUT = 'Log Out';

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
const lastShown = new Map<number, number>();
const NOTICE_BURST_MS = 2000;

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
  if (!deps.isRegistered(session.id)) return;
  const now = Date.now();
  if (now - (lastShown.get(session.id) ?? -Infinity) < NOTICE_BURST_MS) return;
  lastShown.set(session.id, now);
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
