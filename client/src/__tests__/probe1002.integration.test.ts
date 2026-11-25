// PROBE for issue 1002 (do not merge). Repeats the Force Stop tests' stop and
// records, for every run that does not end the way the test expects, what the
// gem had done. PROBE_SCENARIO picks the scenario, PROBE_N the repeat count,
// PROBE_PAR how many sessions run it at once, PROBE_OUT a file to append to.
import { describe, it, vi } from 'vitest';
import { appendFileSync } from 'fs';
import { execSync } from 'child_process';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
const t0 = Date.now();
const trace: string[] = [];
const note = (s: string) => trace.push(`${String(Date.now() - t0).padStart(7)} ${s}`);
vi.mock('../gciLog', async (orig) => ({
  ...(await orig()),
  logError: vi.fn((...args: unknown[]) => note(`logError ${args.join(' ')}`)),
  logInfo: vi.fn((...args: unknown[]) => note(`logInfo ${args.join(' ')}`)),
}));

import { useIntegrationTest } from './useIntegrationTest';
import { testActiveSession } from './testActiveSession';
import type { GciLibrary } from '../gciLibrary';
import type { ActiveSession } from '../activeSession';
import { NbCancelledError, runNbCall, stoppedRunHolds } from '../nbRunner';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { reportedTransientLogin, reportedSerialOf, reportSessionClosed } from './sessionGateClient';
import { armForceStop, forceStop } from '../forceStop';

const N = Number(process.env.PROBE_N ?? 20);
const PAR = Number(process.env.PROBE_PAR ?? 2);
const SCENARIOS = (process.env.PROBE_SCENARIO ?? 'break')
  .split(',')
  .filter((x) => !(x === 'press' && process.platform === 'win32'));
const SCENARIO = SCENARIOS.join(',');
const BUDGET_MS = Number(process.env.PROBE_BUDGET_MS ?? 0);
const OUT = process.env.PROBE_OUT;
const forceStopMs: number[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (s: string) => {
  console.log(`[probe1002] ${s}`);
  if (OUT) appendFileSync(OUT, s + '\n');
};

// The "ignores the stop" test's run, with marks: A before the handler is set
// up, B once its protected block runs, H for each time the handler runs.
const MARKED =
  'SessionTemps current at: #pA put: System _timeMs. ' +
  '[SessionTemps current at: #pB put: System _timeMs. [true] whileTrue: [nil]] ' +
  'on: Break do: [:e | SessionTemps current at: #pH put: (SessionTemps current at: #pH ifAbsent: [0]) + 1. e resume]';
const MARKS =
  '| t | t := SessionTemps current. ((Array with: (t at: #pA ifAbsent: [nil]) with: (t at: #pB ifAbsent: [nil]) with: (t at: #pH ifAbsent: [0])) collect: [:x | x printString]) asArray printString';
const CLEAR =
  "SessionTemps current removeKey: #pA ifAbsent: []; removeKey: #pB ifAbsent: []; removeKey: #pH ifAbsent: []. 'ok'";

// What the OS says a gem process is doing: state, CPU, and its threads' stacks.
function gemDiagnostics(pid: string | undefined): string {
  if (!pid || !/^\d+$/.test(pid)) return `  no pid (${pid})`;
  const cmds =
    process.platform === 'darwin'
      ? [`ps -o pid,stat,%cpu,time,wchan -p ${pid}`, `sudo -n sample ${pid} 1 2>&1 | head -150`]
      : process.platform === 'win32'
        ? []
        : [
            `ps -L -o pid,lwp,stat,%cpu,time,wchan:30 -p ${pid}`,
            `sudo -n gdb -p ${pid} -batch -ex 'thread apply all bt 25' 2>&1 | grep -v '^\\[New LWP' | head -150`,
          ];
  if (process.platform === 'win32') return '  (no process tools on Windows: the gem runs in WSL)';
  // The NetLDI starts gems with their log directory as working directory (-D).
  const cwd =
    process.platform === 'darwin'
      ? `$(lsof -a -p ${pid} -d cwd -Fn | sed -n 's/^n//p')`
      : `$(readlink /proc/${pid}/cwd)`;
  cmds.push(
    `d=${cwd}; grep -l "${pid}" "$d"/*.log 2>/dev/null | head -3 | while read f; do echo "== $f"; tail -40 "$f"; done`,
  );
  return cmds
    .map((c) => {
      try {
        return `  $ ${c}\n${execSync(c, { encoding: 'utf8', shell: '/bin/bash', timeout: 30_000 })}`;
      } catch (e) {
        return `  $ ${c}\n  failed: ${(e as Error).message.slice(0, 200)}`;
      }
    })
    .join('\n');
}

describe('probe 1002', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest(
    (ctx) => {
      gci = ctx.gciLibrary;
      handle = ctx.session;
    },
    { sessions: 2 * PAR + 1 },
  );
  const admin = (): ActiveSession => testActiveSession(gci, handle);

  // Times each part of a Force Stop: the login (session gate wait included) and the signal.
  let phases: { login?: number; signal?: number; logout?: number } = {};
  const deps = {
    loginTransient: (from: ActiveSession) => {
      const t = Date.now();
      const { session: sender, err } = reportedTransientLogin(from);
      phases.login = Date.now() - t;
      if (!sender) throw new Error(`Login failed: ${err.message}`);
      const exec = sender.executeAndFetchString.bind(sender);
      sender.executeAndFetchString = (...a: Parameters<typeof exec>) => {
        const t2 = Date.now();
        try {
          return exec(...a);
        } finally {
          phases.signal = Date.now() - t2;
        }
      };
      return { session: sender, logout: () => void sender.logout() };
    },
  };

  function login(): ActiveSession {
    const { session: s, err } = reportedTransientLogin(admin());
    if (!s) throw new Error(`login failed ${err.message}`);
    armForceStop(s);
    return s;
  }

  async function endGem(s: ActiveSession): Promise<number> {
    const serial = reportedSerialOf(s);
    admin().executeAndFetchString(
      `| now | now := (System descriptionOfSessionSerialNum: ${serial}) at: 10. now > 0 ifTrue: [System stopSession: now]. 'ok'`,
    );
    reportSessionClosed(serial);
    const start = Date.now();
    while (Date.now() - start < 15_000) {
      const on = admin().executeAndFetchString(
        `(((System descriptionOfSessionSerialNum: ${serial}) at: 10) > 0) printString`,
      );
      if (on === 'false') return Date.now() - start;
      await sleep(25);
    }
    const desc = admin().executeAndFetchString(
      `(System descriptionOfSessionSerialNum: ${serial}) printString`,
    );
    say(`LINGER serial ${serial}: ${desc}\n${gemDiagnostics(desc.split(',')[1]?.trim())}`);
    return -1;
  }

  // One stop as stopAndAbandon makes it, then Force Stop as the test does.
  async function breakOnce(s: ActiveSession, i: number, w: number): Promise<string> {
    s.executeAndFetchString(CLEAR);
    trace.length = 0;
    let cancel: (() => void) | undefined;
    const started = Date.now();
    const run = runNbCall(
      s,
      () =>
        s.GciTsNbExecute(
          process.env.PROBE_REAL
            ? '[[true] whileTrue: [nil]] on: Break do: [:e | e resume]'
            : MARKED,
          OOP_CLASS_UTF8,
          OOP_ILLEGAL,
          OOP_NIL,
          0,
          0,
        ),
      () => s.GciTsNbResult(),
      { suppressNotification: true, disposableProcess: true, onStart: (c) => (cancel = c) },
    );
    cancel!();
    let outcome: string;
    try {
      const r = (await run) as { result: bigint; err: { number: number; context?: unknown } };
      outcome = `ANSWERED err=${r.err?.number} after ${Date.now() - started}ms`;
      let stack = '';
      try {
        if (r.err?.context) {
          stack = s.executeAndFetchString(
            `| s | s := WriteStream on: String new. ((Object _objectForOop: ${BigInt(r.err.context as bigint)}) _reportOfSize: 30) do: [:l | s nextPutAll: l asString; lf]. s contents`,
          );
        }
      } catch (e) {
        stack = `stack unavailable: ${(e as Error).message}`;
      }
      const marks = s.executeAndFetchString(MARKS);
      say(
        `w${w} #${i} ${outcome} marks(A,B,H)=${marks}\n  stack: ${stack.replace(/\n/g, '\n    ')}\n  trace:\n    ${trace.join('\n    ')}`,
      );
      return 'answered';
    } catch (e) {
      if (!(e instanceof NbCancelledError)) throw e;
      outcome = 'abandoned';
    }
    phases = {};
    note('forceStop begins');
    const fsStart = Date.now();
    const free = await forceStop(s, deps);
    const fsMs = Date.now() - fsStart;
    forceStopMs.push(fsMs);
    if (fsMs > 1200)
      say(
        `w${w} #${i} SLOW forceStop ${fsMs}ms: login ${phases.login}ms, signal ${phases.signal}ms, logout ${phases.logout}ms, rest (poll) ${fsMs - (phases.login ?? 0) - (phases.signal ?? 0) - (phases.logout ?? 0)}ms\n    ${trace.join('\n    ')}`,
      );
    const deadline = Date.now() + 10_000;
    while (stoppedRunHolds(s) && Date.now() < deadline) await sleep(50);
    if (!free || fsMs > 1500)
      say(`w${w} #${i} forceStop free=${free} took ${fsMs}ms holds=${stoppedRunHolds(s)}`);
    return outcome;
  }

  // The "Cancel reached the gem before the run had started (one press)" test.
  // PROBE_CODE=marked runs the "ignores the stop" test's code with marks instead of
  // the bare loop. PROBE_OFFSETS (ms, comma-separated, cycled) moves the Cancel:
  // -1 sends it while the gem is held (as the test does), n >= 0 releases the gem
  // and sends it n ms later.
  const OFFSETS = (process.env.PROBE_OFFSETS ?? '-1').split(',').map(Number);
  const MARKED_CODE = process.env.PROBE_CODE === 'marked';
  async function pressBeforeStart(s: ActiveSession, i: number, w: number): Promise<string> {
    const offset = OFFSETS[i % OFFSETS.length];
    if (MARKED_CODE) s.executeAndFetchString(CLEAR);
    trace.length = 0;
    const pid = s.executeAndFetchString('System gemProcessId printString').trim();
    let tracer: import('child_process').ChildProcess | undefined;
    const traceFile = `${OUT}.strace.${w}.${i}`;
    if (process.env.PROBE_STRACE) {
      const cp = await import('child_process');
      tracer = cp.spawn(
        'strace',
        [
          '-f',
          '-tt',
          '-p',
          pid,
          '-o',
          traceFile,
          '-e',
          'trace=recvfrom,recvmsg,read,sendto,poll,ppoll,tgkill,kill,rt_sigreturn,exit_group',
        ],
        { stdio: 'ignore' },
      );
      await sleep(400);
    }
    let cancel: (() => void) | undefined;

    execSync(`kill -STOP ${pid}`);
    let run!: Promise<unknown>;
    try {
      run = runNbCall(
        s,
        () =>
          s.GciTsNbExecute(
            MARKED_CODE ? MARKED : '[true] whileTrue: [nil]',
            OOP_CLASS_UTF8,
            OOP_ILLEGAL,
            OOP_NIL,
            0,
            0,
          ),
        () => s.GciTsNbResult(),
        { suppressNotification: true, disposableProcess: true, onStart: (c) => (cancel = c) },
      );
      run.catch(() => {});
      if (offset < 0) {
        cancel!();
        await sleep(500);
      } else {
        await sleep(300);
      }
    } finally {
      execSync(`kill -CONT ${pid}`);
    }
    if (offset >= 0) {
      const until = performance.now() + offset;
      while (performance.now() < until) {
        /* spin: a timer is too coarse for a few ms */
      }
      cancel!();
    }
    let how = 'abandoned';
    try {
      const r = (await run) as { err?: { number: number } };
      how = `answered err=${r?.err?.number}`;
      if (MARKED_CODE) how += ` marks(A,B,H)=${s.executeAndFetchString(MARKS)}`;
    } catch (e) {
      if (!(e instanceof NbCancelledError)) how = `threw ${(e as Error).message.slice(0, 60)}`;
    }
    const deadline = Date.now() + 10_000;
    while (stoppedRunHolds(s) && Date.now() < deadline) await sleep(100);
    const held = stoppedRunHolds(s);
    if (tracer) {
      tracer.kill('SIGINT');
      await sleep(200);
    }
    how = `offset ${offset}: ${how}`;
    if (held && MARKED_CODE) {
      execSync(`kill -9 ${pid}`);
      return `${how} (held: catches the stop)`;
    }
    if (held) {
      say(
        `w${w} #${i} STILL HELD after 10s (${how}); pid ${pid}${tracer ? ` strace ${traceFile}` : ''}\n    ${trace.join('\n    ')}`,
      );
      // Let the endless loop go: a gem that ignores every stop stays until killed.
      execSync(`kill -9 ${pid}`);
      return `held(${how})`;
    }
    if (tracer) (await import('fs')).rmSync(traceFile, { force: true });
    return how;
  }

  it('repeats the scenario', async () => {
    const counts: Record<string, number> = {};
    const linger: number[] = [];
    await Promise.all(
      Array.from({ length: PAR }, async (_, w) => {
        for (let i = 0; i < Math.ceil(N / PAR); i++) {
          if (BUDGET_MS && Date.now() - t0 > BUDGET_MS) break;
          const s = login();
          let o: string;
          try {
            o =
              SCENARIOS[i % SCENARIOS.length] === 'press'
                ? await pressBeforeStart(s, i, w)
                : await breakOnce(s, i, w);
          } catch (e) {
            o = `threw ${(e as Error).message.slice(0, 80)}`;
            say(`w${w} #${i} ${o}`);
          }
          counts[o] = (counts[o] ?? 0) + 1;
          const left = await endGem(s);
          linger.push(left);
        }
      }),
    );
    const slow = linger.filter((x) => x < 0 || x > 2000).length;
    const q = (p: number) =>
      [...forceStopMs].sort((a, b) => a - b)[Math.floor(p * (forceStopMs.length - 1))];
    if (forceStopMs.length)
      say(
        `forceStop ms p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${q(1)} n ${forceStopMs.length}`,
      );
    say(
      `SUMMARY scenario=${SCENARIO} n=${linger.length} ${JSON.stringify(counts)} lingering=${linger.filter((x) => x < 0).length} slowLeave=${slow} maxLeave=${Math.max(...linger)}ms`,
    );
  }, 3_600_000);
});
