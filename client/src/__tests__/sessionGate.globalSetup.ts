// PROTOTYPE: a counter of the test stone's sessions, shared by every test file.
//
// A file asks for the sessions it will use before logging in, and waits, first
// come first served, until they are free. A topaz session watches which user
// sessions are on the stone, so the counter also sees gems still leaving and
// sessions from outside the run. A session counts toward a running file only
// once that file has reported its login serial; every other session on the
// stone counts as taken. A login no file reports fails the file whose test
// worker made it, or the run, when it was too short for the watcher to see.
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const LICENSE_LIMIT = 10;
// The watcher's own session takes one.
const CAPACITY = LICENSE_LIMIT - 1;
const WAIT_LIMIT_MS = 60_000;
// How long after its login a refusal's report can arrive (see loginsNeverSeen).
const REFUSAL_REPORT_SLACK_MS = 2_000;

interface TestProject {
  viteConfig: { env: Record<string, unknown> };
  provide: (key: string, value: unknown) => void;
}

type Holder = { file: string; pid: number; n: number; serials: Set<string>; grantedAt: number };
type Waiter = {
  socket: Socket;
  file: string;
  pid: number;
  n: number;
  askedAt: number;
  timer: NodeJS.Timeout;
};
/** A user session the watcher saw, and the test worker (GCI client process) that logged it in. */
type Sighting = { pid: number; firstSeen: number };

export default async function setup(project: TestProject) {
  const env = project.viteConfig.env as Record<string, string>;
  const holders = new Map<Socket, Holder>();
  const queue: Waiter[] = [];
  let live: Set<string> | undefined;
  // Sessions already on the stone when the run started belong to no test file.
  let before: Set<string> | undefined;
  const sightings = new Map<string, Sighting>();
  // When files reported logins the stone refused, each of which used up a serial.
  const refusals: number[] = [];
  // Login serial -> when a file reported it.
  const reported = new Map<string, number>();
  const blamed = new Set<string>();
  const workerPids = new Set<number>();
  const afterNextSample: (() => void)[] = [];
  const grants: { file: string; n: number; at: number; waitMs: number; holdMs?: number }[] = [];
  let peakCommitted = 0;
  let peakLive = 0;
  const overBudget = new Map<string, { declared: number; seen: number }>();

  const committed = () => {
    if (!live) return Infinity;
    let reserved = 0;
    const owned = new Set<string>();
    for (const h of holders.values()) {
      reserved += h.n;
      for (const s of h.serials) owned.add(s);
    }
    let unowned = 0;
    for (const s of live) if (!owned.has(s)) unowned++;
    return reserved + unowned;
  };

  const reply = (socket: Socket, msg: object) => {
    if (!socket.destroyed) socket.write(JSON.stringify(msg) + '\n');
  };

  const describeHolders = () =>
    [...holders.values()].map((h) => `${h.file} (${h.n})`).join(', ') || 'no running file';

  const tryGrant = () => {
    while (queue.length > 0) {
      const head = queue[0];
      const used = committed();
      if (used + head.n > CAPACITY) return;
      queue.shift();
      clearTimeout(head.timer);
      const now = Date.now();
      holders.set(head.socket, {
        file: head.file,
        pid: head.pid,
        n: head.n,
        serials: new Set(),
        grantedAt: now,
      });
      grants.push({ file: head.file, n: head.n, at: now, waitMs: now - head.askedAt });
      peakCommitted = Math.max(peakCommitted, used + head.n);
      reply(head.socket, { granted: true });
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
          workerPids.add(msg.pid);
          const waiter: Waiter = {
            socket,
            file: msg.file,
            pid: msg.pid,
            n: msg.n,
            askedAt: Date.now(),
            timer: setTimeout(() => {
              const i = queue.indexOf(waiter);
              if (i >= 0) queue.splice(i, 1);
              reply(socket, {
                error: `waited ${WAIT_LIMIT_MS / 1000} s for ${msg.n} stone session(s); ${committed()} of ${CAPACITY} taken, held by ${describeHolders()}`,
              });
            }, WAIT_LIMIT_MS),
          };
          queue.push(waiter);
          tryGrant();
        } else if (msg.op === 'opened') {
          holders.get(socket)?.serials.add(String(msg.serial));
          reported.set(String(msg.serial), Date.now());
        } else if (msg.op === 'refused') {
          refusals.push(Date.now());
        } else if (msg.op === 'check') {
          // A login made just before the check only shows in the next sample.
          afterNextSample.push(() => {
            const h = holders.get(socket);
            reply(socket, { unreported: h ? unreportedFrom(h.pid, h.grantedAt) : [] });
          });
        }
      }
    });
    socket.on('close', () => {
      const h = holders.get(socket);
      if (h) {
        const g = grants.findLast((x) => x.file === h.file && x.holdMs === undefined);
        if (g) g.holdMs = Date.now() - h.grantedAt;
      }
      holders.delete(socket);
      const i = queue.findIndex((w) => w.socket === socket);
      if (i >= 0) {
        clearTimeout(queue[i].timer);
        queue.splice(i, 1);
      }
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

  /** Sessions worker `pid` logged in since `since` that no file reported, each blamed once. */
  const unreportedFrom = (pid: number, since: number) => {
    const found: { serial: string; firstSeen: number }[] = [];
    for (const [serial, s] of sightings) {
      if (s.pid !== pid || s.firstSeen < since || reported.has(serial) || blamed.has(serial))
        continue;
      blamed.add(serial);
      found.push({ serial, firstSeen: s.firstSeen });
    }
    return found;
  };

  /**
   * Login serials go up by one per login on the stone, so a serial between two
   * the gate knows of that it never saw nor was told about is a login too short
   * for the watcher's 50 ms look. Answers each with the files that held
   * bookings in the time it can have happened. Reported refusals account for
   * serials too.
   */
  const loginsNeverSeen = (endSerial: number) => {
    const when = new Map<number, number>();
    // The watcher's login and one made at the end bound the run's logins.
    if (watcherSerial !== undefined) when.set(watcherSerial, 0);
    when.set(endSerial, Date.now());
    for (const [serial, s] of sightings) when.set(Number(serial), s.firstSeen);
    for (const [serial, at] of reported) {
      const n = Number(serial);
      when.set(n, Math.min(at, when.get(n) ?? Infinity));
    }
    const known = [...when.keys()].sort((a, b) => a - b);
    const missed: { serial: number; from: number; to: number; running: string[] }[] = [];
    for (let i = 1; i < known.length; i++) {
      for (let serial = known[i - 1] + 1; serial < known[i]; serial++) {
        const from = when.get(known[i - 1])!;
        const to = when.get(known[i])!;
        const running = grants
          .filter((g) => g.at <= to && (g.holdMs === undefined || g.at + g.holdMs >= from))
          .map((g) => g.file.split('/client/')[1] ?? g.file);
        missed.push({ serial, from, to, running: [...new Set(running)] });
      }
    }
    // Each reported refusal accounts for one serial in the gap nearest its time.
    // Nearest, not containing: a refusal is reported once the stone answers,
    // which can be after the next login was already seen.
    const distance = (m: { from: number; to: number }, at: number) =>
      at < m.from ? m.from - at : at > m.to ? at - m.to : 0;
    for (const at of refusals) {
      let best = -1;
      for (let i = 0; i < missed.length; i++) {
        if (best < 0 || distance(missed[i], at) < distance(missed[best], at)) best = i;
      }
      if (best >= 0 && distance(missed[best], at) <= REFUSAL_REPORT_SLACK_MS)
        missed.splice(best, 1);
    }
    return missed;
  };

  let watcherSerial: number | undefined;
  const watcher = startWatcher(
    env,
    (serial) => (watcherSerial = serial),
    (sessions) => {
      const serials = new Set(sessions.keys());
      if (!before) {
        before = serials;
        if (before.size > 0) {
          console.warn(
            `session gate: ${before.size} session(s) were already on the test stone before the run started, and take slots for the whole run: ${[...sessions].map(([serial, pid]) => `login serial ${serial} (client process ${pid})`).join(', ')}. Usually these are gems left behind by a test run that was killed; end them to free their slots.`,
          );
        }
      }
      const now = Date.now();
      for (const [serial, pid] of sessions) {
        if (!before.has(serial) && !sightings.has(serial))
          sightings.set(serial, { pid, firstSeen: now });
      }
      live = serials;
      peakLive = Math.max(peakLive, serials.size);
      for (const h of holders.values()) {
        let seen = 0;
        for (const sn of h.serials) if (serials.has(sn)) seen++;
        if (seen > h.n) {
          const prev = overBudget.get(h.file);
          overBudget.set(h.file, { declared: h.n, seen: Math.max(seen, prev?.seen ?? 0) });
        }
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
    const waits = grants.map((g) => g.waitMs).sort((a, b) => a - b);
    const total = waits.reduce((a, b) => a + b, 0);
    const summary = {
      grants: grants.length,
      waited: waits.filter((w) => w > 0).length,
      totalWaitMs: total,
      p50WaitMs: waits[Math.floor(waits.length / 2)] ?? 0,
      p90WaitMs: waits[Math.floor(waits.length * 0.9)] ?? 0,
      maxWaitMs: waits.at(-1) ?? 0,
      peakCommitted,
      peakLive,
      overBudget: Object.fromEntries(overBudget),
      grantsDetail: grants,
    };
    if (process.env.SESSION_GATE_STATS) {
      writeFileSync(process.env.SESSION_GATE_STATS, JSON.stringify(summary, null, 2));
    }
    console.log(
      `session gate: ${summary.grants} grants, ${summary.waited} waited, total ${total} ms, p50 ${summary.p50WaitMs} ms, p90 ${summary.p90WaitMs} ms, max ${summary.maxWaitMs} ms, peak committed ${peakCommitted}/${CAPACITY}, peak live ${peakLive}`,
    );
    for (const [file, o] of overBudget) {
      console.log(
        `session gate: OVER BUDGET ${file.split('/client/')[1]}: declared ${o.declared}, had ${o.seen} of its own sessions on the stone at once`,
      );
    }
    // Files catch their own unreported logins in afterAll; this catches the rest,
    // such as a login made after a file gave its sessions back.
    const stray = [...sightings].filter(
      ([serial, s]) => workerPids.has(s.pid) && !reported.has(serial) && !blamed.has(serial),
    );
    const missed = loginsNeverSeen(endSerial);
    if (missed.length > 0) {
      throw new Error(
        `session gate: ${missed.length} login(s) came and went between two looks at the stone, and no file reported them: ${missed.map((m) => `login serial ${m.serial}, while ${m.running.join(', ') || 'no file'} ran`).join('; ')}. A test, or app code it called, logged in without reporting it (see reportLogin in sessionGateClient.ts). A login from outside the run during it shows up here too.`,
      );
    }
    if (stray.length > 0) {
      throw new Error(
        `session gate: ${stray.length} login(s) from test workers were never reported to the gate, outside any file's booking: ${stray.map(([serial, s]) => `login serial ${serial} (worker process ${s.pid})`).join(', ')}. Every login a test makes, or makes app code make, must be reported (see reportLogin in sessionGateClient.ts).`,
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
