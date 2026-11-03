import type { ActiveSession } from './activeSession';
import { GciLibraryError } from './gciLibraryError';
import { logInfo } from './gciLog';
import { isRunning, stoppedRunHolds } from './nbRunner';
import { stopSessionOfLogin } from './queries/sessionOfLogin';

/** The error a session raises when another session signals it (`InterSessionSignal`). */
export const SESSION_SIGNAL_ERROR = 6010;

/**
 * Lets the session be signalled from another one, answering its GemStone session
 * number and its login's serial number. GemStone switches this off each time a
 * signal arrives, so it is run again after every Force Stop.
 */
const ARM_CODE =
  'System enableSignaledGemStoneSessionError. System session printString, ' +
  "' ', ((System descriptionOfSession: System session) at: 9) printString";

/**
 * How long Force Stop waits for the run to end after the signal. The gem takes
 * the signal within milliseconds; the rest is collecting the stopped call, which
 * is polled every 500ms in the background.
 */
export const FORCE_STOP_WAIT_MS = 2000;
const FORCE_STOP_POLL_MS = 100;

/** GemStone's session number for each armed session, by Jasper session id. */
const serverSessions = new Map<number, string>();

/**
 * The serial number of each armed session's login. GemStone gives a session
 * number to the next login once its gem has gone; a serial number is never reused.
 */
const loginSerials = new Map<number, string>();

/** Sessions sent a signal that has not been answered by a re-arm yet. */
const signalled = new Set<number>();

/**
 * Get `session` ready for Force Stop. Run at login; a failure only means Force
 * Stop can't reach this session, so it is logged, never thrown.
 */
export function armForceStop(session: ActiveSession): void {
  try {
    const [serverSession, serial] = session.executeAndFetchString(ARM_CODE).split(' ');
    serverSessions.set(session.id, serverSession);
    loginSerials.set(session.id, serial);
  } catch (e) {
    logInfo(
      `[Session ${session.id}] Force Stop is not available: ` +
        (e instanceof Error ? e.message : String(e)),
    );
  }
}

/**
 * Arm `session` again after a Force Stop, once it is free. A signal that arrived
 * after its run had already ended is still waiting, and fails the next call made
 * on the session: that call is this one, so the user's next run never sees it.
 */
export function rearmAfterForceStop(session: ActiveSession): void {
  if (!signalled.has(session.id)) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      session.executeAndFetchString(ARM_CODE);
      signalled.delete(session.id);
      return;
    } catch (e) {
      if (!(e instanceof GciLibraryError && e.number === SESSION_SIGNAL_ERROR)) {
        logInfo(
          `[Session ${session.id}] Could not re-arm Force Stop: ` +
            (e instanceof Error ? e.message : String(e)),
        );
        return;
      }
    }
  }
}

/** GemStone's own number for an armed session, as `System stopSession:` takes it. */
export function serverSessionOf(sessionId: number): string | undefined {
  return serverSessions.get(sessionId);
}

/** The serial number of an armed session's login. */
export function loginSerialOf(sessionId: number): string | undefined {
  return loginSerials.get(sessionId);
}

/** Forget a session that has logged out. */
export function forgetForceStop(sessionId: number): void {
  serverSessions.delete(sessionId);
  loginSerials.delete(sessionId);
  signalled.delete(sessionId);
}

export interface ForceStopDeps {
  /** A short-lived login of `session`'s own, to send the signal from. */
  loginTransient(session: ActiveSession): { session: ActiveSession; logout: () => void };
}

/**
 * Stop the run `session` is still busy with, keeping the session and its
 * uncommitted changes: another session signals it, and the run ends at once
 * unless it catches every exception (`on: Exception do:`). Answers whether the
 * session is free again.
 */
export async function forceStop(session: ActiveSession, deps: ForceStopDeps): Promise<boolean> {
  const serverSession = serverSessions.get(session.id);
  if (serverSession === undefined) {
    throw new Error(`Force Stop is not available for session ${session.id}.`);
  }
  if (!stoppedRunHolds(session)) return true;
  sendStopSignal(session, serverSession, deps);

  const free = await pollUntil(
    () => !stoppedRunHolds(session),
    FORCE_STOP_WAIT_MS,
    FORCE_STOP_POLL_MS,
  );
  if (!free) return false;
  // A run started in the meantime holds the session: re-arming then waits for the
  // next stopped run to be collected.
  if (!isRunning(session)) rearmAfterForceStop(session);
  return true;
}

/** Whether `done` turns true within `timeoutMs`, asked every `everyMs`. */
export async function pollUntil(
  done: () => boolean,
  timeoutMs: number,
  everyMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  return true;
}

/** Signal `session` from a short-lived login, without waiting for its run to answer. */
export function sendStopSignal(
  session: ActiveSession,
  serverSession: string,
  deps: ForceStopDeps,
): void {
  const sender = deps.loginTransient(session);
  try {
    sender.session.executeAndFetchString(
      `System sendSignal: 1 to: ${serverSession} withMessage: 'Jasper: Force Stop'. 'ok'`,
    );
  } finally {
    sender.logout();
  }
  signalled.add(session.id);
  logInfo(`[Session ${session.id}] Force Stop signal sent.`);
}

/**
 * End `serverSession`'s gem from a short-lived login of `from`'s, which may
 * already be logged out: the last resort for a run that caught Force Stop, whose
 * gem a logout leaves running. Needs the SessionAccess and SystemControl
 * privileges (`NO_PRIVILEGE_ERROR` otherwise).
 *
 * Ends it only while the session number still belongs to `from`'s login: once
 * the gem has gone, the number can already be another login's. Force Stop's
 * signal needs no such check, being sent while `from` is still logged in, and
 * could not have it: looking up another session needs SessionAccess.
 */
export function endServerSession(
  from: ActiveSession,
  serverSession: string,
  deps: ForceStopDeps,
): void {
  const serial = loginSerials.get(from.id);
  if (serial === undefined) {
    throw new Error(`Session ${from.id}'s login is not known, so its gem can't be told apart.`);
  }
  const sender = deps.loginTransient(from);
  let ended: boolean;
  try {
    ended = stopSessionOfLogin(
      (code) => sender.session.executeAndFetchString(code),
      serverSession,
      serial,
    );
  } finally {
    sender.logout();
  }
  logInfo(
    ended
      ? `[Session ${from.id}] Ended its server session ${serverSession}.`
      : `[Session ${from.id}] Its server session ${serverSession} had already ended.`,
  );
}
