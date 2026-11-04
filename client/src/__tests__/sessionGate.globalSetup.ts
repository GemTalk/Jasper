// PROTOTYPE: a counter of the test stone's sessions, shared by every test file.
//
// A file asks for the sessions it will use before logging in, and waits, first
// come first served, until they are free. A topaz session watches which user
// sessions are on the stone, so the counter also sees gems still leaving and
// sessions from outside the run. A session counts toward a running file only
// once that file has reported its login serial; every other session on the
// stone counts as taken.
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const LICENSE_LIMIT = 10;
// The watcher's own session takes one.
const CAPACITY = LICENSE_LIMIT - 1;
const WAIT_LIMIT_MS = 60_000;

interface TestProject {
  viteConfig: { env: Record<string, unknown> };
  provide: (key: string, value: unknown) => void;
}

type Holder = { file: string; n: number; serials: Set<string>; grantedAt: number };
type Waiter = { socket: Socket; file: string; n: number; askedAt: number; timer: NodeJS.Timeout };

export default async function setup(project: TestProject) {
  const env = project.viteConfig.env as Record<string, string>;
  const holders = new Map<Socket, Holder>();
  const queue: Waiter[] = [];
  let live: Set<string> | undefined;
  const grants: { file: string; n: number; waitMs: number; holdMs?: number }[] = [];
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
      holders.set(head.socket, { file: head.file, n: head.n, serials: new Set(), grantedAt: now });
      grants.push({ file: head.file, n: head.n, waitMs: now - head.askedAt });
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
          const waiter: Waiter = {
            socket,
            file: msg.file,
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

  const watcher = startWatcher(env, (serials) => {
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
  });

  project.provide('sessionGateSocket', socketPath);

  return async () => {
    watcher.kill();
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
  };
}

/** Runs a topaz session that reports the serials of user sessions on the stone every 50 ms. */
function startWatcher(
  env: Record<string, string>,
  onSample: (serials: Set<string>) => void,
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
| mine |
mine := System session.
[true] whileTrue: [ | ws |
  ws := WriteStream on: String new.
  ws nextPutAll: 'LIVE'.
  System currentSessions do: [:s |
    s ~= mine ifTrue: [
      [ | d | d := System descriptionOfSession: s.
        (#('GcUser' 'SymbolUser') includes: (d at: 1) userId) ifFalse: [ws space; print: (d at: 9)] ]
        on: Error do: [:e | ]]].
  GsFile gciLogClient: ws contents.
  (Delay forMilliseconds: 50) wait].
%
`);
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith('LIVE')) onSample(new Set(line.split(/\s+/).slice(1)));
    }
  });
  return child;
}
