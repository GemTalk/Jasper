// PROTOTYPE: a test file's side of the session gate (see sessionGate.globalSetup.ts).
import { createConnection, type Socket } from 'node:net';
import { inject } from 'vitest';
import type { ActiveSession } from '../activeSession';
import type { SessionManager } from '../sessionManager';

declare module 'vitest' {
  export interface ProvidedContext {
    sessionGateSocket: string;
  }
}

// PROTOTYPE ONLY: in the real design each file declares this through
// useIntegrationTest({ sessions: N }). A map keeps the prototype's diff small.
const BUDGETS: Record<string, number> = {
  'src/__tests__/forceStop.integration.test.ts': 3,
  'src/__tests__/forceStopSurfaces.integration.test.ts': 3,
  'src/__tests__/forceStopLogout.integration.test.ts': 3,
  'src/__tests__/clearStoppedRun.integration.test.ts': 3,
  'src/__tests__/conditionalBreakpointStop.integration.test.ts': 3,
  'src/stoneSessions/__tests__/stoneSessions.integration.test.ts': 3,
  'src/__tests__/browserQueries.integration.test.ts': 2,
  'src/__tests__/activeSession.integration.test.ts': 4,
  'src/__tests__/useIntegrationTest.integration.test.ts': 2,
  'src/__tests__/explorer/gemstoneExplorer.integration.test.ts': 2,
  'src/__tests__/transcriptSink.integration.test.ts': 2,
  'src/__tests__/gciLibrary.test.ts': 2,
  'src/gciLibrary/__tests__/gciAsync.integration.test.ts': 2,
  'src/gciLibrary/__tests__/gciSessionUtils.integration.test.ts': 2,
  'src/gciLibrary/__tests__/gciLogin.integration.test.ts': 2,
  'src/fileTransfer/__tests__/fileIn.integration.test.ts': 2,
  'src/refactoring/__tests__/refactoringInstallDecoy.integration.test.ts': 2,
};

const budgetKey = (testPath: string) =>
  testPath.slice(testPath.lastIndexOf('/client/') + '/client/'.length);

export function budgetFor(testPath: string): number {
  return BUDGETS[budgetKey(testPath)] ?? 1;
}

// One per useIntegrationTest call that is running; nested describes can hold several.
const held: Socket[] = [];
const fileOf = new Map<Socket, string>();

/** Waits until the stone has room for `n` sessions, then holds them until {@link releaseSessions}. */
export async function acquireSessions(file: string, n: number): Promise<Socket | undefined> {
  const path = inject('sessionGateSocket');
  if (!path) return undefined;
  const socket = createConnection(path);
  const answer = await new Promise<{ granted?: boolean; error?: string }>((resolve, reject) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf('\n');
      if (nl >= 0) resolve(JSON.parse(buffer.slice(0, nl)));
    });
    socket.on('error', reject);
    socket.write(JSON.stringify({ op: 'acquire', file, n, pid: process.pid }) + '\n');
  });
  if (answer.error) {
    socket.destroy();
    throw new Error(`Session gate: ${answer.error}`);
  }
  held.push(socket);
  fileOf.set(socket, file);
  return socket;
}

/** Tells the gate that a session with login serial `serial` belongs to this file. */
export function reportSession(serial: string | bigint, socket = held.at(-1)): void {
  socket?.write(JSON.stringify({ op: 'opened', serial: String(serial) }) + '\n');
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
 * Tells the gate a login was refused. A login the stone refuses, such as one
 * with a wrong password, still uses up a login serial, which the gate would
 * otherwise read as a login it never saw.
 */
export function reportRefusedLogin(socket = held.at(-1)): void {
  socket?.write(JSON.stringify({ op: 'refused' }) + '\n');
}

/** Runs `login`, telling the gate when it throws, and rethrows. */
export function reportingRefusal<T>(login: () => T, socket = held.at(-1)): T {
  try {
    return login();
  } catch (error) {
    reportRefusedLogin(socket);
    throw error;
  }
}

/** The login serial of `own`, which the gate tells sessions apart by. */
export function loginSerialOf(own: ActiveSession): string {
  return own.executeAndFetchString(
    '((System descriptionOfSession: System session) at: 9) printString',
  );
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
  unreported: { serial: string; firstSeen: number }[];
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
  const answer = await new Promise<GateVerdict>((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      socket.off('data', onData);
      resolve(JSON.parse(buffer.slice(0, nl)));
    };
    socket.on('data', onData);
    socket.once('error', reject);
    socket.write(JSON.stringify({ op: 'check' }) + '\n');
  });
  const problems: string[] = [];
  if (answer.unreported.length > 0) {
    const where = answer.unreported
      .map((u) => `login serial ${u.serial}, first seen during "${testRunningAt(u.firstSeen)}"`)
      .join('; ');
    problems.push(
      `this file logged in ${answer.unreported.length} session(s) it never reported: ${where}. ` +
        `The gate can't count a session it doesn't know is yours, so it may give that slot to another file, ` +
        `whose login the stone then refuses. Report each login with reportLogin (sessionGateClient.ts). ` +
        `If app code the test calls logs in for itself, the test has to report that login too.`,
    );
  }
  if (answer.overBudget) {
    const { booked, seen } = answer.overBudget;
    problems.push(
      `this file had ${seen} sessions logged in at once, but booked ${booked}. ` +
        `Book ${seen}: add '${budgetKey(fileOf.get(socket) ?? '')}': ${seen} to BUDGETS in sessionGateClient.ts.`,
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
  // eslint-disable-next-line no-restricted-syntax -- the one place a test's transientLogin is allowed: it reports the session
  const result = from.transientLogin(login);
  if (result.session) reportLogin(result.session);
  else reportRefusedLogin();
  return result;
}

/**
 * Has every login `manager` makes reported to the gate, including the ones it
 * makes for itself, such as the short login that ends a stopped run's gem at
 * logout. A test's own SessionManager goes through here.
 */
export function reportingLoginsOf(manager: SessionManager): SessionManager {
  const { login, loginAsync, loginTransient } = manager;
  manager.login = (...args) => reportLogin(reportingRefusal(() => login.apply(manager, args)));
  manager.loginAsync = async (...args) => {
    try {
      return reportLogin(await loginAsync.apply(manager, args));
    } catch (error) {
      reportRefusedLogin();
      throw error;
    }
  };
  manager.loginTransient = (...args) => {
    const result = reportingRefusal(() => loginTransient.apply(manager, args));
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
  fileOf.delete(socket);
  socket.end();
}
