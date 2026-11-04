// PROTOTYPE: a counter of the test stone's sessions, shared by every test file.
//
// A file asks for the sessions it will use before logging in, and waits, first
// come first served, until they are free. A topaz session watches which user
// sessions are on the stone, so the counter also sees gems still leaving and
// sessions from outside the run. A session counts toward a running file only
// once that file has reported its login serial; every other session on the
// stone counts as taken. A login no file reports fails the file whose test
// worker made it, or the run, when it was too short for the watcher to see.
// So does a file that has more sessions logged in at once than it booked.
// The bookkeeping is in sessionGateLedger.ts; this is its sockets and watcher.
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SessionLedger } from './sessionGateLedger';

const LICENSE_LIMIT = 10;
// The watcher's own session takes one.
const CAPACITY = LICENSE_LIMIT - 1;
const WAIT_LIMIT_MS = 60_000;

interface TestProject {
  viteConfig: { env: Record<string, unknown> };
  provide: (key: string, value: unknown) => void;
}

export default async function setup(project: TestProject) {
  const env = project.viteConfig.env as Record<string, string>;
  const ledger = new SessionLedger<Socket>(CAPACITY);
  const waitTimers = new Map<Socket, NodeJS.Timeout>();
  const afterNextSample: (() => void)[] = [];

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
        const msg = JSON.parse(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (msg.op === 'acquire') {
          if (msg.n > CAPACITY) {
            reply(socket, {
              error: `${msg.file} declares ${msg.n} stone sessions; only ${CAPACITY} are available to tests`,
            });
            continue;
          }
          ledger.request(socket, { file: msg.file, pid: msg.pid, n: msg.n });
          waitTimers.set(
            socket,
            setTimeout(() => {
              if (!ledger.withdraw(socket)) return;
              reply(socket, {
                error: `waited ${WAIT_LIMIT_MS / 1000} s for ${msg.n} stone session(s); ${ledger.committed()} of ${CAPACITY} taken, held by ${ledger.describeHolders()}`,
              });
            }, WAIT_LIMIT_MS),
          );
          tryGrant();
        } else if (msg.op === 'opened') {
          ledger.opened(socket, String(msg.serial));
        } else if (msg.op === 'closed') {
          ledger.closed(socket, String(msg.serial));
        } else if (msg.op === 'refused') {
          ledger.refused();
        } else if (msg.op === 'check') {
          // A login made just before the check only shows in the next sample.
          afterNextSample.push(() =>
            reply(socket, {
              unreported: ledger.unreportedFrom(socket),
              overBudget: ledger.overBudgetOf(socket),
            }),
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

  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\jasper-session-gate-${process.pid}`
      : join(tmpdir(), `jasper-gate-${process.pid}.sock`);
  rmSync(socketPath, { force: true });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  let watcherSerial: number | undefined;
  const watcher = startWatcher(
    env,
    (serial) => (watcherSerial = serial),
    (sessions) => {
      const leftOver = ledger.sample(sessions);
      if (leftOver && leftOver.size > 0) {
        console.warn(
          `session gate: ${leftOver.size} session(s) were already on the test stone before the run started, and take slots for the whole run: ${[...leftOver].map(([serial, pid]) => `login serial ${serial} (client process ${pid})`).join(', ')}. Usually these are gems left behind by a test run that was killed; end them to free their slots.`,
        );
      }
      tryGrant();
      for (const done of afterNextSample.splice(0)) done();
    },
  );

  project.provide('sessionGateSocket', socketPath);

  return async () => {
    watcher.kill();
    const endSerial = await freshLoginSerial(env);
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
      overBudget: Object.fromEntries(ledger.overBudget()),
      grantsDetail: ledger.grants,
    };
    if (process.env.SESSION_GATE_STATS) {
      writeFileSync(process.env.SESSION_GATE_STATS, JSON.stringify(summary, null, 2));
    }
    console.log(
      `session gate: ${summary.grants} grants, ${summary.waited} waited, total ${total} ms, p50 ${summary.p50WaitMs} ms, p90 ${summary.p90WaitMs} ms, max ${summary.maxWaitMs} ms, peak committed ${summary.peakCommitted}/${CAPACITY}, peak live ${summary.peakLive}`,
    );
    const missed = ledger.loginsNeverSeen(watcherSerial, endSerial);
    if (missed.length > 0) {
      throw new Error(
        `session gate: ${missed.length} login(s) came and went between two looks at the stone, and no file reported them: ${missed.map((m) => `login serial ${m.serial}, while ${m.running.join(', ') || 'no file'} ran`).join('; ')}. A test, or app code it called, logged in without reporting it (see reportLogin in sessionGateClient.ts). A login from outside the run during it shows up here too.`,
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

const OWN_SERIAL = '((System descriptionOfSession: System session) at: 9) printString';

/** Logs in with topaz, runs `code`, and hands each line it logs to `onLine`. */
function runTopaz(
  env: Record<string, string>,
  code: string,
  onLine: (line: string) => void,
): ChildProcess {
  const gemstone = dirname(env.VITE_GEMSTONE_GLOBAL_DIR);
  const child = spawn(join(gemstone, 'bin', 'topaz'), ['-q'], {
    env: { ...process.env, GEMSTONE: gemstone, GEMSTONE_GLOBAL_DIR: env.VITE_GEMSTONE_GLOBAL_DIR },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  child.stdin
    .end(`set gemstone ${env.VITE_GEMSTONE_STONE_NRS} user ${env.VITE_GEMSTONE_USER} pass ${env.VITE_GEMSTONE_PASSWORD} gemnetid ${env.VITE_GEMSTONE_GEM_NRS}
login
run
${code}
%
logout
exit
`);
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      onLine(buffer.slice(0, nl).trim());
      buffer = buffer.slice(nl + 1);
    }
  });
  return child;
}

/** The serial of a login made now: higher than every login before it. */
function freshLoginSerial(env: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    let serial: number | undefined;
    runTopaz(env, `GsFile gciLogClient: 'SERIAL ', ${OWN_SERIAL}`, (line) => {
      if (line.startsWith('SERIAL ')) serial = Number(line.slice('SERIAL '.length));
    }).on('close', () =>
      serial === undefined
        ? reject(new Error('session gate: topaz gave no login serial'))
        : resolve(serial),
    );
  });
}

/**
 * Runs a topaz session that first reports its own login serial, then every
 * 50 ms each user session on the stone: its login serial and the process id of
 * its GCI client (fields 9 and 21 of `System descriptionOfSession:`).
 */
function startWatcher(
  env: Record<string, string>,
  onOwnSerial: (serial: number) => void,
  onSample: (sessions: Map<string, number>) => void,
): ChildProcess {
  return runTopaz(
    env,
    `| mine |
mine := System session.
GsFile gciLogClient: 'MINE ', ${OWN_SERIAL}.
[true] whileTrue: [ | ws |
  ws := WriteStream on: String new.
  ws nextPutAll: 'LIVE'.
  System currentSessions do: [:s |
    s ~= mine ifTrue: [
      [ | d | d := System descriptionOfSession: s.
        (#('GcUser' 'SymbolUser') includes: (d at: 1) userId)
          ifFalse: [ws space; print: (d at: 9); nextPut: $:; print: (d at: 21)] ]
        on: Error do: [:e | ]]].
  GsFile gciLogClient: ws contents.
  (Delay forMilliseconds: 50) wait]`,
    (line) => {
      if (line.startsWith('MINE ')) onOwnSerial(Number(line.slice('MINE '.length)));
      if (!line.startsWith('LIVE')) return;
      // Each entry is <login serial>:<GCI client process id>.
      const pairs = line
        .split(/\s+/)
        .slice(1)
        .map((entry) => entry.split(':'));
      onSample(new Map(pairs.map(([serial, pid]) => [serial, Number(pid)])));
    },
  );
}
