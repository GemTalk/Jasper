// A counter of the test stone's sessions, shared by every test file.
//
// A file asks for the sessions it will use before logging in, and waits, first
// come first served, until they are free. A GCI session of its own watches which user
// sessions are on the stone, so the counter also sees gems still leaving and
// sessions from outside the run. A session counts toward a running file only
// once that file has reported its login serial; every other session on the
// stone counts as taken. A login no file reports fails the file whose test
// worker made it, or the run, when it was too short for the watcher to see.
// So does a file that has more sessions logged in at once than it booked.
// If the watcher fails mid-run, every file still waiting on the gate, and the
// run itself, fails with that error rather than vitest crashing.
// The bookkeeping is in sessionGateLedger.ts; this is its sockets and watcher.
import { writeFileSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GciLibrary } from '../gciLibrary';
import { createNativeSocketLibrary } from '../sockets/factory';
import {
  LOGIN_SERIAL_CODE,
  REFUSAL_REPORT_SLACK_MS,
  SessionLedger,
  testFileName,
  type UnseenLogin,
} from './sessionGateLedger';

const WAIT_LIMIT_MS = 60_000;

interface TestProject {
  viteConfig: { env: Record<string, unknown> };
  provide: (key: string, value: unknown) => void;
}

export default async function setup(project: TestProject) {
  const env = project.viteConfig.env as Record<string, string>;
  const socketPath = gateSocketPath(`jasper-session-gate-${process.pid}`);
  const teardown = await startGate(socketPath, (onSample, onFail) =>
    startGciWatcher(env, onSample, onFail),
  );
  project.provide('sessionGateSocket', socketPath);
  return teardown;
}

/** Where a gate named `name` listens: a named pipe on Windows, which has no Unix sockets. */
export function gateSocketPath(name: string): string {
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
}

/**
 * Starts the watcher, the first look included; a failure in later looks goes to
 * `onFail` instead of being thrown, since nothing up the stack could catch it.
 */
export type StartWatcher = (
  onSample: (sessions: Map<string, number>) => void,
  onFail: (error: unknown) => void,
) => Watcher;

/**
 * Serves the gate on `socketPath`; answers the teardown, which fails the run if
 * a rule was broken. Tests get the stone's session limit less the watcher's
 * own session, unless `capacity` says otherwise.
 */
export async function startGate(
  socketPath: string,
  startWatcher: StartWatcher,
  capacity?: number,
): Promise<() => Promise<void>> {
  const ledger = new SessionLedger<Socket>(capacity ?? 0);
  const waitTimers = new Map<Socket, NodeJS.Timeout>();
  const afterNextSample: (() => void)[] = [];
  let watcherFailure: string | undefined;

  const reply = (socket: Socket, msg: object) => {
    if (!socket.destroyed) socket.write(JSON.stringify(msg) + '\n');
  };

  const tryGrant = () => {
    for (const socket of ledger.grant()) {
      clearTimeout(waitTimers.get(socket));
      waitTimers.delete(socket);
      reply(socket, { granted: true });
    }
  };

  const server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        let msg;
        try {
          msg = JSON.parse(buffer.slice(0, nl));
        } catch {
          // Dropping the socket gives back any booking it held.
          socket.destroy();
          return;
        }
        buffer = buffer.slice(nl + 1);
        if (watcherFailure && (msg.op === 'acquire' || msg.op === 'check')) {
          reply(socket, { error: watcherFailure });
        } else if (msg.op === 'acquire') {
          if (msg.n > ledger.capacity) {
            reply(socket, {
              error: `${msg.file} declares ${msg.n} stone sessions; only ${ledger.capacity} are available to tests`,
            });
            continue;
          }
          ledger.request(socket, { file: msg.file, pid: msg.pid, n: msg.n });
          waitTimers.set(
            socket,
            setTimeout(() => {
              if (!ledger.withdraw(socket)) return;
              reply(socket, {
                error: `waited ${WAIT_LIMIT_MS / 1000} s for ${msg.n} stone session(s); ${ledger.committed()} of ${ledger.capacity} taken, held by ${ledger.describeHolders()}`,
              });
            }, WAIT_LIMIT_MS),
          );
          tryGrant();
        } else if (msg.op === 'opened') {
          ledger.opened(socket, String(msg.serial));
        } else if (msg.op === 'closed') {
          ledger.closed(socket, String(msg.serial));
        } else if (msg.op === 'refused') {
          ledger.refused(socket);
        } else if (msg.op === 'check') {
          // A login made just before the check only shows in the next sample.
          afterNextSample.push(() =>
            reply(
              socket,
              watcherFailure
                ? { error: watcherFailure }
                : {
                    unreported: ledger.unreportedFrom(socket),
                    overBudget: ledger.overBudgetOf(socket),
                  },
            ),
          );
        }
      }
    });
    socket.on('close', () => {
      clearTimeout(waitTimers.get(socket));
      waitTimers.delete(socket);
      ledger.release(socket);
      tryGrant();
    });
    socket.on('error', () => {});
  });

  rmSync(socketPath, { force: true });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  const failWaiting = (error: unknown) => {
    watcherFailure = `the session watching the test stone failed, so the gate can no longer tell which sessions are free: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`session gate: ${watcherFailure}`);
    for (const [socket, timer] of waitTimers) {
      clearTimeout(timer);
      if (ledger.withdraw(socket)) reply(socket, { error: watcherFailure });
    }
    waitTimers.clear();
    for (const done of afterNextSample.splice(0)) done();
  };

  const onSample = (sessions: Map<string, number>) => {
    const leftOver = ledger.sample(sessions);
    if (leftOver && leftOver.size > 0) {
      console.warn(
        `session gate: ${leftOver.size} session(s) were already on the test stone before the run started, and take slots for the whole run: ${[...leftOver].map(([serial, pid]) => `login serial ${serial} (client process ${pid})`).join(', ')}. Usually these are gems left behind by a test run that was killed; end them to free their slots.`,
      );
    }
    tryGrant();
    for (const done of afterNextSample.splice(0)) done();
  };

  let watcher: Watcher;
  try {
    watcher = startWatcher(onSample, failWaiting);
  } catch (error) {
    // Left listening, the server would hold vitest open for its 10 s close timeout.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
  // The watcher's own session takes one.
  ledger.capacity = capacity ?? watcher.sessionLimit - 1;

  return async () => {
    watcher.stop();
    // Files still connected are given their answer before the server closes.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (watcherFailure) throw new Error(`session gate: ${watcherFailure}`);
    const endSerial = watcher.freshLoginSerial();
    const waits = ledger.grants.map((g) => g.waitMs).sort((a, b) => a - b);
    const total = waits.reduce((a, b) => a + b, 0);
    const summary = {
      grants: ledger.grants.length,
      waited: waits.filter((w) => w > 0).length,
      totalWaitMs: total,
      p50WaitMs: waits[Math.floor(waits.length / 2)] ?? 0,
      p90WaitMs: waits[Math.floor(waits.length * 0.9)] ?? 0,
      maxWaitMs: waits.at(-1) ?? 0,
      peakCommitted: ledger.peakCommitted,
      peakLive: ledger.peakLive,
      watcherLookMs: percentiles(watcher.lookMs),
      overBudget: Object.fromEntries(ledger.overBudget()),
      grantsDetail: ledger.grants,
    };
    if (process.env.SESSION_GATE_STATS) {
      writeFileSync(process.env.SESSION_GATE_STATS, JSON.stringify(summary, null, 2));
    }
    console.log(
      `session gate: ${summary.grants} grants, ${summary.waited} waited, total ${total} ms, p50 ${summary.p50WaitMs} ms, p90 ${summary.p90WaitMs} ms, max ${summary.maxWaitMs} ms, peak committed ${summary.peakCommitted}/${ledger.capacity}, peak live ${summary.peakLive}; ${watcher.lookMs.length} looks at the stone, p50 ${summary.watcherLookMs.p50} ms, p99 ${summary.watcherLookMs.p99} ms, max ${summary.watcherLookMs.max} ms`,
    );
    const missed = ledger.loginsNeverSeen(watcher.serial, endSerial);
    if (missed.length > 0) {
      throw new Error(
        `session gate: ${missed.length} login(s) came and went between two looks at the stone, and no file reported them. A test, or app code it called, logged in without reporting it (see reportLogin in sessionGateClient.ts), or the stone refused a login whose refusal was not reported within ${REFUSAL_REPORT_SLACK_MS / 1000} s of it. A login from outside the run during it shows up here too.\n${missed.map((m) => describeUnseen(ledger, m)).join('\n')}`,
      );
    }
    // Files catch their own unreported logins in afterAll; this catches the rest,
    // such as a login made after a file gave its sessions back.
    const stray = ledger.stray();
    if (stray.length > 0) {
      throw new Error(
        `session gate: ${stray.length} login(s) from test workers were never reported to the gate, outside any file's booking: ${stray.map((x) => `login serial ${x.serial} (worker process ${x.pid})`).join(', ')}. Every login a test makes, or makes app code make, must be reported (see reportLogin in sessionGateClient.ts).`,
      );
    }
  };
}

function describeUnseen(ledger: SessionLedger<Socket>, m: UnseenLogin): string {
  const known = (k: UnseenLogin['after']) =>
    `${k.serial} (${k.how} ${ledger.secondsIn(k.at)} into the run)`;
  const refusals = m.refusalsNearby.length
    ? m.refusalsNearby
        .map(
          (r) =>
            `${ledger.secondsIn(r.at)} by worker ${r.pid ?? '?'}${r.file ? ` (${testFileName(r.file)})` : ''}, ${r.matchedTo ? `matched to ${r.matchedTo}` : 'unmatched'}`,
        )
        .join('; ')
    : 'none';
  return `  login serial ${m.serial}: between ${known(m.after)} and ${known(m.before)}, while ${m.running.join(', ') || 'no file'} ran. Refusals reported near it: ${refusals}.`;
}

function percentiles(ms: number[]): { p50: number; p99: number; max: number } {
  const sorted = [...ms].sort((a, b) => a - b);
  const at = (q: number) => Math.round((sorted[Math.floor(sorted.length * q)] ?? 0) * 10) / 10;
  return { p50: at(0.5), p99: at(0.99), max: Math.round((sorted.at(-1) ?? 0) * 10) / 10 };
}

const OWN_SERIAL = `(${LOGIN_SERIAL_CODE}) printString`;
const SESSION_LIMIT = '(System stoneConfigurationAt: #StnMaxSessions) printString';

// Each user session on the stone but this one, as "<login serial>:<GCI client
// process id> ...": fields 9 and 21 of `System descriptionOfSession:`. Aborts
// first, so the watcher never holds an old view of the repository. Only the
// lookup is guarded, for a session that ends mid-look. One logging in or out
// may have no user profile yet, or serial 0; it still takes a slot, so it
// counts once it has a serial to be told apart by. The literals are
// `asString` because GciLibrary sends code as Unicode, which a String refuses
// to be compared with.
const LIVE_SESSIONS = `| ws mine system |
System abortTransaction.
mine := System session. ws := WriteStream on: String new.
system := #('GcUser' 'SymbolUser') collect: [:u | u asString].
System currentSessions do: [:s | | d |
  d := s = mine ifFalse: [[System descriptionOfSession: s] on: Error do: [:e | nil]].
  (d notNil and: [((d at: 9) ifNil: [0]) > 0 and: [
      (d at: 1) isNil or: [(system includes: (d at: 1) userId asString) not]]])
    ifTrue: [ws print: (d at: 9); nextPut: $:; print: (d at: 21); space]].
ws contents`;

const LOOK_EVERY_MS = 50;

export type Watcher = {
  /** The watcher's own login serial: lower than every test login's. */
  serial: number;
  /** How many sessions the stone takes at once, the watcher's included. */
  sessionLimit: number;
  stop: () => void;
  /** The serial of a login made now: higher than every login before it. */
  freshLoginSerial: () => number;
  /** How long each look at the stone took, in ms: it blocks vitest's main process. */
  lookMs: number[];
};

/**
 * Logs in a GCI session of the gate's own, through the same GCI library the
 * tests use, and every 50 ms hands `onSample` the user sessions on the stone.
 * GCI rather than topaz: Windows has only the GCI library, with the stone in WSL.
 */
function startGciWatcher(
  env: Record<string, string>,
  onSample: (sessions: Map<string, number>) => void,
  onFail: (error: unknown) => void,
): Watcher {
  // The GCI reads GEMSTONE_GLOBAL_DIR; as useIntegrationTest does, from the VITE_ copy.
  process.env.GEMSTONE_GLOBAL_DIR = env.VITE_GEMSTONE_GLOBAL_DIR;
  const gci = new GciLibrary(env.VITE_GEMSTONE_GCI_LIBRARY_PATH, createNativeSocketLibrary());
  const login = () =>
    gci.login(
      env.VITE_GEMSTONE_STONE_NRS,
      env.VITE_GEMSTONE_GEM_NRS,
      env.VITE_GEMSTONE_USER,
      env.VITE_GEMSTONE_PASSWORD,
    );
  const session = login();
  const serial = Number(gci.executeAndFetchString(session, OWN_SERIAL));
  const limitText = gci.executeAndFetchString(session, SESSION_LIMIT);
  const sessionLimit = Number(limitText);
  if (!Number.isInteger(sessionLimit) || sessionLimit < 2) {
    gci.logout(session);
    throw new Error(
      `session gate: the test stone answered ${limitText} for its session limit (StnMaxSessions); expected a whole number of at least 2`,
    );
  }
  const lookMs: number[] = [];
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let failed = false;

  const look = () => {
    const started = performance.now();
    const listed = gci.executeAndFetchString(session, LIVE_SESSIONS);
    lookMs.push(performance.now() - started);
    const pairs = listed
      .split(/\s+/)
      .filter(Boolean)
      .map((entry) => entry.split(':'));
    onSample(new Map(pairs.map(([s, pid]) => [s, Number(pid)])));
  };
  // Thrown in a timer, a failure would crash vitest's main process.
  const lookAgain = () => {
    if (stopped) return;
    try {
      look();
    } catch (error) {
      failed = true;
      onFail(error);
      return;
    }
    timer = setTimeout(lookAgain, LOOK_EVERY_MS);
  };
  look();
  timer = setTimeout(lookAgain, LOOK_EVERY_MS);

  return {
    serial,
    sessionLimit,
    lookMs,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      try {
        gci.logout(session);
      } catch (error) {
        // After a failed look the session is usually already gone.
        if (!failed) throw error;
      }
    },
    freshLoginSerial: () => {
      const fresh = login();
      try {
        return Number(gci.executeAndFetchString(fresh, OWN_SERIAL));
      } finally {
        gci.logout(fresh);
      }
    },
  };
}
