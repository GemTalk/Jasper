import type { ActiveSession } from './activeSession';
import { logInfo } from './gciLog';
import { NO_PRIVILEGE_ERROR } from './forceStop';

/** One session logged in to a stone, as `System descriptionOfSession:` describes it. */
export interface StoneSession {
  /** GemStone's session number, as `System stopSession:` takes it. Reused once the session has gone. */
  id: number;
  /** The login's serial number, which is never reused. */
  serial: number;
  /** Empty while the session is still logging in, or already logging out. */
  user: string;
  gemPid: number;
  /** The gem's host as the stone sees it. */
  host: string;
  /** Seconds, by the stone's clock (`System timeGmt`). */
  loggedInAt: number;
  transaction: 'in' | 'out' | 'transactionless';
  /** What GemStone calls one of its own gems (`reclaimgcgem`, `symbolgem`, …); undefined for a user's. */
  systemGem?: string;
}

export type StoneSessionList =
  | { kind: 'sessions'; serverNow: number; sessions: StoneSession[] }
  /** The login lacks SessionAccess, without which another session can't be looked at. */
  | { kind: 'noAccess' };

const NO_ACCESS = 'noSessionAccess';

/**
 * Every session on the stone except the one asking, which is the short-lived
 * login the list is read through. One line per session, tab-separated; the
 * first line is the stone's clock. A session that logs out while the list is
 * read answers a session number of 0 and is left out.
 */
const LIST_CODE =
  '| out me noAccess | out := WriteStream on: String new. me := System session. ' +
  'noAccess := false. out print: System timeGmt. ' +
  'System currentSessions do: [:id | | d | id = me ifFalse: [' +
  'd := [System descriptionOfSession: id] on: Error do: [:e | ' +
  `e number = ${NO_PRIVILEGE_ERROR} ifFalse: [e pass]. noAccess := true. nil]. ` +
  '(d notNil and: [(d at: 10) = id]) ifTrue: [' +
  'out lf; print: id; tab; print: (d at: 9); tab; ' +
  "nextPutAll: ((d at: 1) ifNil: [''] ifNotNil: [:u | u userId]); tab; " +
  'print: (d at: 2); tab; nextPutAll: (d at: 3); tab; print: (d at: 15); tab; ' +
  "print: (d at: 7); tab; nextPutAll: ((d at: 17) ifNil: [''])]]]. " +
  `noAccess ifTrue: [^ '${NO_ACCESS}']. out contents`;

const TRANSACTION: Record<string, StoneSession['transaction']> = {
  '-1': 'transactionless',
  '0': 'out',
  '1': 'in',
};

export function parseStoneSessions(text: string): StoneSessionList {
  if (text === NO_ACCESS) return { kind: 'noAccess' };
  const [now, ...lines] = text.split(/\r?\n|\r/);
  const sessions = lines.map((line): StoneSession => {
    const [id, serial, user, gemPid, host, loggedInAt, transaction, systemGem] = line.split('\t');
    return {
      id: Number(id),
      serial: Number(serial),
      user,
      gemPid: Number(gemPid),
      host,
      loggedInAt: Number(loggedInAt),
      transaction: TRANSACTION[transaction] ?? 'out',
      systemGem: systemGem || undefined,
    };
  });
  return { kind: 'sessions', serverNow: Number(now), sessions };
}

/** A short-lived login to read through; the caller's `logout` ends it. */
export type TransientLogin = () => { session: ActiveSession; logout: () => void };

/**
 * Every other session on the stone, read through a login of its own: a session
 * still busy with a run could not answer, and the list is how such a session is
 * found.
 */
export function listStoneSessions(login: TransientLogin): StoneSessionList {
  const reader = login();
  try {
    return parseStoneSessions(reader.session.executeAndFetchString(LIST_CODE));
  } finally {
    reader.logout();
  }
}

/** How long Stop Session waits for the session to leave the stone. */
export const STOP_SESSION_WAIT_MS = 3000;
const STOP_SESSION_POLL_MS = 200;

/**
 * - `ended`  the session has left the stone.
 * - `gone`   it had already left; its number may belong to a newer login, which is untouched.
 * - `stuck`  asked to end, but still there: a gem frozen for good can't answer `stopSession:`.
 */
export type StopSessionOutcome = 'ended' | 'gone' | 'stuck';

/**
 * End `target` with `System stopSession:` from a short-lived login. Its
 * uncommitted work is lost. Checked against the login's serial number first, so
 * a session number that has since passed to another login is left alone.
 * Needs SessionAccess ({@link NO_PRIVILEGE_ERROR} otherwise).
 */
export async function stopStoneSession(
  target: Pick<StoneSession, 'id' | 'serial'>,
  login: TransientLogin,
): Promise<StopSessionOutcome> {
  const sender = login();
  try {
    const stillOnStone = () =>
      sender.session.executeAndFetchString(
        `(((System descriptionOfSessionSerialNum: ${target.serial}) at: 10) = ${target.id}) printString`,
      ) === 'true';
    const sent = sender.session.executeAndFetchString(
      `((System descriptionOfSessionSerialNum: ${target.serial}) at: 10) = ${target.id} ` +
        `ifTrue: [System stopSession: ${target.id}. 'sent'] ifFalse: ['gone']`,
    );
    if (sent === 'gone') return 'gone';
    logInfo(`Sent System stopSession: ${target.id} (login serial ${target.serial}).`);
    const deadline = Date.now() + STOP_SESSION_WAIT_MS;
    while (stillOnStone()) {
      if (Date.now() >= deadline) return 'stuck';
      await new Promise((resolve) => setTimeout(resolve, STOP_SESSION_POLL_MS));
    }
    return 'ended';
  } finally {
    sender.logout();
  }
}

/** How long ago `loggedInAt` was, in the largest whole unit: `45s`, `14m`, `3h`, `2d`. */
export function sessionAge(loggedInAt: number, serverNow: number): string {
  const seconds = Math.max(0, serverNow - loggedInAt);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
