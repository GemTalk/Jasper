// A test file's side of the session gate (see sessionGate.globalSetup.ts).
import { createConnection, type Socket } from 'node:net';
import { inject } from 'vitest';
import type { ActiveSession } from '../activeSession';
import type { SessionManager } from '../sessionManager';
import { LOGIN_SERIAL_CODE } from './sessionGateLedger';
import { LOGIN_ERRORS } from '../loginFailureMessage';

declare module 'vitest' {
  export interface ProvidedContext {
    sessionGateSocket: string;
  }
}

/** Sends `message` to the gate and resolves with its one-line reply. */
function request<T>(socket: Socket, message: object): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      socket.off('data', onData);
      resolve(JSON.parse(buffer.slice(0, nl)) as T);
    };
    socket.on('data', onData);
    socket.once('error', reject);
    socket.write(JSON.stringify(message) + '\n');
  });
}

// One per useIntegrationTest call that is running; nested describes can hold several.
const held: Socket[] = [];

/** Waits until the stone has room for `n` sessions, then holds them until {@link releaseSessions}. */
export async function acquireSessions(file: string, n: number): Promise<Socket | undefined> {
  const path = inject('sessionGateSocket');
  if (!path) return undefined;
  const socket = createConnection(path);
  const answer = await request<{ granted?: boolean; error?: string }>(socket, {
    op: 'acquire',
    file,
    n,
    pid: process.pid,
  });
  if (answer.error) {
    socket.destroy();
    throw new Error(`Session gate: ${answer.error}`);
  }
  held.push(socket);
  return socket;
}

/**
 * Tells the gate that a session with login serial `serial` belongs to this file,
 * and when, by this worker's clock: the message can reach the gate late.
 */
export function reportSession(serial: string | bigint, socket = held.at(-1)): void {
  socket?.write(JSON.stringify({ op: 'opened', serial: String(serial), at: Date.now() }) + '\n');
}

/**
 * Tells the gate the session with login serial `serial` has logged out, or its
 * gem was ended. Its gem may linger on the stone a moment longer; the gate
 * still counts it as taken, but no longer against this file's booking.
 */
export function reportSessionClosed(serial: string | bigint, socket = held.at(-1)): void {
  socket?.write(JSON.stringify({ op: 'closed', serial: String(serial) }) + '\n');
}

/**
 * Tells the gate a login begun at `startedAt` (`Date.now()`) failed with
 * `error`. A login the stone refuses (see {@link deniedByStone}), such as one
 * with a wrong password, still uses up a login serial, which the gate would
 * otherwise read as a login it never saw. The serial is used when the login
 * begins, and the refusal can take seconds to come back, so the gate needs both
 * ends. Any other failure uses no serial; the gate only lists it if it blames
 * this file.
 */
export function reportFailedLogin(startedAt: number, error: unknown, socket = held.at(-1)): void {
  const { number, message } = (error ?? {}) as { number?: unknown; message?: unknown };
  socket?.write(
    JSON.stringify({
      op: 'loginFailed',
      denied: deniedByStone(error),
      startedAt,
      failedAt: Date.now(),
      number: typeof number === 'number' ? number : undefined,
      message: typeof message === 'string' ? message : String(error),
    }) + '\n',
  );
}

const { GS_ERR_LOGIN_DENIAL } = LOGIN_ERRORS;

/**
 * Whether `error` is the stone refusing a login, a wrong user or password,
 * which uses up a login serial. A login that never reached the stone, to an
 * unknown stone or NetLDI, uses none, nor does an error thrown before or after
 * the GCI login call itself.
 */
export function deniedByStone(error: unknown): boolean {
  return (error as { number?: unknown } | undefined)?.number === GS_ERR_LOGIN_DENIAL;
}

/** Runs `login`, telling the gate when it fails, and rethrows. */
export function reportingFailedLogin<T>(login: () => T, socket = held.at(-1)): T {
  const startedAt = Date.now();
  try {
    return login();
  } catch (error) {
    reportFailedLogin(startedAt, error, socket);
    throw error;
  }
}

function loginSerialOf(own: ActiveSession): string {
  return own.executeAndFetchString(`(${LOGIN_SERIAL_CODE}) printString`);
}

const serialOfReported = new WeakMap<ActiveSession, string>();

/** The login serial `own` was reported with, by {@link reportLogin}, without asking the stone again. */
export function reportedSerialOf(own: ActiveSession): string {
  const serial = serialOfReported.get(own);
  if (serial === undefined) {
    throw new Error('Session gate: this session was never reported; log it in through reportLogin');
  }
  return serial;
}

/**
 * Tells the gate that `own`, a login a test made itself, belongs to this file,
 * and has its logout tell the gate too. Every login in a test goes through
 * here, or a file's afterAll fails it.
 */
export function reportLogin(own: ActiveSession): ActiveSession {
  const serial = loginSerialOf(own);
  const socket = held.at(-1);
  reportSession(serial, socket);
  serialOfReported.set(own, serial);
  const logout = own.logout.bind(own);
  own.logout = () => {
    const freed = logout();
    if (freed) reportSessionClosed(serial, socket);
    return freed;
  };
  return own;
}

const testsStarted: { name: string; at: number }[] = [];

/** Notes when each test starts, so an unreported login can be traced to its test. */
export function noteTestStarted(name: string): void {
  testsStarted.push({ name, at: Date.now() });
}

function testRunningAt(time: number): string {
  return testsStarted.findLast((t) => t.at <= time)?.name ?? "the file's beforeAll";
}

type GateVerdict = {
  error?: string;
  unreported: { serial: string; firstSeen: number }[];
  /** What the gate knew of this file's logins, when it blames it for any. */
  loginsAround?: string[];
  overBudget?: { booked: number; seen: number };
};

/**
 * Throws if this file broke the gate's rules: its worker logged in a session
 * the gate was never told about (the watcher saw it on the stone, but no
 * `reportSession` named it; a login made by app code the test called counts
 * too), or it had more sessions logged in at once than it booked.
 */
export async function assertBookingKept(socket: Socket | undefined): Promise<void> {
  if (!socket) return;
  const answer = await request<GateVerdict>(socket, { op: 'check' });
  if (answer.error) throw new Error(`Session gate: ${answer.error}`);
  const problems: string[] = [];
  if (answer.unreported.length > 0) {
    const where = answer.unreported
      .map((u) => `login serial ${u.serial}, first seen during "${testRunningAt(u.firstSeen)}"`)
      .join('; ');
    problems.push(
      `this file logged in ${answer.unreported.length} session(s) it never reported: ${where}. ` +
        `The gate can't count a session it doesn't know is yours, so it may give that slot to another file, ` +
        `whose login the stone then refuses. Report each login with reportLogin (sessionGateClient.ts). ` +
        `If app code the test calls logs in for itself, the test has to report that login too.` +
        (answer.loginsAround?.length
          ? `\nWhat the gate knew of the logins from this test worker (seconds into the run):\n${answer.loginsAround.map((l) => `  ${l}`).join('\n')}`
          : ''),
    );
  }
  if (answer.overBudget) {
    const { booked, seen } = answer.overBudget;
    problems.push(
      `this file had ${seen} sessions logged in at once, but booked ${booked}. ` +
        `Book ${seen}: pass { sessions: ${seen} } to the useIntegrationTest call that holds them.`,
    );
  }
  if (problems.length > 0) throw new Error(`Session gate: ${problems.join(' Also, ')}`);
}

/**
 * `from.transientLogin(login)`, with the new session reported to the gate. Tests
 * log in a second session through here; lint bans calling transientLogin directly.
 */
export function reportedTransientLogin(
  from: ActiveSession,
  login = from.login,
): ReturnType<ActiveSession['transientLogin']> {
  const startedAt = Date.now();
  // eslint-disable-next-line no-restricted-syntax -- the one place a test's transientLogin is allowed: it reports the session
  const result = from.transientLogin(login);
  if (result.session) reportLogin(result.session);
  else reportFailedLogin(startedAt, result.err);
  return result;
}

/**
 * Has every login `manager` makes reported to the gate, including the ones it
 * makes for itself, such as the short login that ends a stopped run's gem at
 * logout. A test's own SessionManager goes through here. SessionManager
 * rethrows a refused login without its error number, so the gate can't tell a
 * refusal through it from any other failure, and its end-of-run check would
 * name the serial the refusal used.
 */
export function reportingLoginsOf(manager: SessionManager): SessionManager {
  const { login, loginAsync, loginTransient } = manager;
  manager.login = (...args) => reportLogin(reportingFailedLogin(() => login.apply(manager, args)));
  manager.loginAsync = async (...args) => {
    const startedAt = Date.now();
    try {
      return reportLogin(await loginAsync.apply(manager, args));
    } catch (error) {
      reportFailedLogin(startedAt, error);
      throw error;
    }
  };
  manager.loginTransient = (...args) => {
    const result = reportingFailedLogin(() => loginTransient.apply(manager, args));
    reportLogin(result.session);
    return result;
  };
  return manager;
}

/** Gives the file's sessions back; the gate frees them once their gems have left the stone. */
export function releaseSessions(socket: Socket | undefined): void {
  if (!socket) return;
  const i = held.indexOf(socket);
  if (i >= 0) held.splice(i, 1);
  socket.end();
}
