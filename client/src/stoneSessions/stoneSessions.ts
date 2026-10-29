import type { ActiveSession } from '../activeSession';
import { logInfo } from '../gciLog';
import { NO_PRIVILEGE_ERROR } from '../forceStop';
import { isLoopbackName } from '../thisMachine';

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
  /** Its view is the oldest commit record the stone keeps (`System sessionsReferencingOldestCr`). */
  holdsOldestCommitRecord: boolean;
}

export type StoneSessionList =
  | {
      kind: 'sessions';
      serverNow: number;
      /** Commit records the stone keeps for views still in use (`System commitRecordBacklog`). */
      commitRecordBacklog: number;
      /** The backlog at which the stone asks sessions to abort (`STN_SIGNAL_ABORT_CR_BACKLOG`). */
      abortThreshold: number;
      /** The login has SystemControl, which `System stopSession:` needs besides SessionAccess. */
      canStopSessions: boolean;
      sessions: StoneSession[];
    }
  /** The login lacks SessionAccess, without which another session can't be looked at. */
  | { kind: 'noAccess' };

const NO_ACCESS = 'noSessionAccess';

/**
 * Every session on the stone except the one asking, which is the short-lived
 * login the list is read through. One line per session, tab-separated; the
 * first line is the stone's clock, the commit-record backlog, the stone's abort
 * threshold, whether the login has SystemControl, and the sessions holding the
 * oldest commit record. A session that
 * logs out while the list is read answers a session number of 0 and is left out.
 */
const LIST_CODE =
  '| out me noAccess | out := WriteStream on: String new. me := System session. ' +
  'noAccess := false. out print: System timeGmt; tab; print: System commitRecordBacklog; tab; ' +
  'print: (System stoneConfigurationAt: #StnSignalAbortCrBacklog); tab; ' +
  'print: (System myUserProfile privileges includes: #SystemControl); tab. ' +
  'System sessionsReferencingOldestCr do: [:id | out print: id] separatedBy: [out space]. ' +
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
  const [header, ...lines] = text.split(/\r?\n|\r/);
  const [now, backlog, threshold, canStop, holders = ''] = header.split('\t');
  const holderIds = new Set(holders.split(' ').filter(Boolean).map(Number));
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
      holdsOldestCommitRecord: holderIds.has(Number(id)),
    };
  });
  return {
    kind: 'sessions',
    serverNow: Number(now),
    commitRecordBacklog: Number(backlog),
    abortThreshold: Number(threshold),
    canStopSessions: canStop === 'true',
    sessions,
  };
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

/** How long the Kill check may run: it runs inside every list read, which blocks the window. */
export const KILL_CHECK_TIMEOUT_MS = 5000;

/**
 * The gems among `sessions` that Kill can end: on this machine (inside WSL on
 * Windows), and ones this OS user may signal, as `kill -0` answers; another OS
 * user's gem refuses. Answers none when the check itself fails, so Kill is
 * never offered on a guess.
 *
 * The stone calls a gem on its own machine `localhost`, so such a gem is here
 * only when `stoneHost`, the host the stone was reached at, is.
 */
export function killableGems(
  sessions: StoneSession[],
  stoneHost: string,
  isThisMachine: (host: string) => boolean,
  shellSync: (command: string, timeoutMs: number) => string,
): Set<number> {
  const isHere = (host: string) => isThisMachine(isLoopbackName(host) ? stoneHost : host);
  const pids = sessions.filter((s) => !s.systemGem && isHere(s.host)).map((s) => s.gemPid);
  if (pids.length === 0) return new Set();
  try {
    const answer = shellSync(
      `for p in ${pids.join(' ')}; do kill -0 $p 2>/dev/null && echo $p; done; true`,
      KILL_CHECK_TIMEOUT_MS,
    );
    return new Set(answer.split(/\s+/).filter(Boolean).map(Number));
  } catch (e) {
    logInfo(
      `Could not tell which gems Kill can end: ${e instanceof Error ? e.message : String(e)}`,
    );
    return new Set();
  }
}

/** How long Stop Session, and each signal Kill sends, waits for the session to leave the stone. */
export const STOP_SESSION_WAIT_MS = 3000;
const STOP_SESSION_POLL_MS = 200;

/** Whether `stillOnStone` turns false within {@link STOP_SESSION_WAIT_MS}. */
async function leavesInTime(stillOnStone: () => boolean): Promise<boolean> {
  const deadline = Date.now() + STOP_SESSION_WAIT_MS;
  while (stillOnStone()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, STOP_SESSION_POLL_MS));
  }
  return true;
}

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
 * Needs SessionAccess and SystemControl ({@link NO_PRIVILEGE_ERROR} otherwise).
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
    return (await leavesInTime(stillOnStone)) ? 'ended' : 'stuck';
  } finally {
    sender.logout();
  }
}

/** Whether `command`, as `ps -o command=` prints it, is a GemStone gem (`$GEMSTONE/sys/gem`). */
export function isGemCommand(command: string): boolean {
  return /(^|\/)sys\/gem(\s|$)/.test(command.trim());
}

/**
 * Runs a shell command where the gems are: here on Linux and macOS, inside WSL
 * on Windows. Rejects on a non-zero exit.
 */
export type GemHostShell = (command: string) => Promise<string>;

/**
 * End `target` by ending its gem's process on this machine (inside WSL on
 * Windows): SIGTERM, which a busy gem obeys at once, then SIGKILL for a gem
 * frozen for good, which the stone cleans up after. Its uncommitted work is
 * lost. The stone is asked first that the login still has that session and
 * gem, and `ps` that the process is a gem, so a reused session number or
 * process id is left alone.
 *
 * @throws {Error} when the process isn't a gem here, or `kill` refuses
 *   (another OS user's gem); the message says which.
 */
export async function killStoneSession(
  target: Pick<StoneSession, 'id' | 'serial' | 'gemPid'>,
  login: TransientLogin,
  shell: GemHostShell,
): Promise<StopSessionOutcome> {
  const { id, serial, gemPid } = target;
  const sender = login();
  try {
    const stillOnStone = () =>
      sender.session.executeAndFetchString(
        `| d | d := System descriptionOfSessionSerialNum: ${serial}. ` +
          `((d at: 10) = ${id} and: [(d at: 2) = ${gemPid}]) printString`,
      ) === 'true';
    if (!stillOnStone()) return 'gone';
    const command = (await shell(`ps -p ${gemPid} -o command= 2>/dev/null || true`)).trim();
    if (!isGemCommand(command)) {
      throw new Error(
        command
          ? `Process ${gemPid} on this machine is not a GemStone gem (${command}).`
          : `There is no process ${gemPid} on this machine.`,
      );
    }
    for (const signal of ['TERM', 'KILL']) {
      // `|| true` keeps kill's complaint as output: an EPERM must not read as a
      // gem that ignored the signal.
      const complaint = (await shell(`kill -${signal} ${gemPid} 2>&1 || true`)).trim();
      // A gem that is already gone only needs the stone to let its session go.
      const gemGone = /no such process/i.test(complaint);
      if (complaint && !gemGone && stillOnStone()) throw new Error(complaint);
      logInfo(
        `Sent SIG${signal} to gem process ${gemPid} of session ${id} (login serial ${serial}).`,
      );
      if (await leavesInTime(stillOnStone)) return 'ended';
    }
    return 'stuck';
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
