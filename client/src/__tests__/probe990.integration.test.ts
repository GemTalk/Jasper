// PROBE for issue 990 (do not merge): stop a run that streams to the Transcript,
// many times, and print the timeline of every stop the gem ignored.
import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
const lines: string[] = [];
const t0 = Date.now();
const note = (s: string) => lines.push(`${String(Date.now() - t0).padStart(6)} ${s}`);
vi.mock('../gciLog', async (orig) => ({
  ...(await orig()),
  logError: vi.fn((...args: unknown[]) => note(`logError ${args.join(' ')}`)),
  logInfo: vi.fn((...args: unknown[]) => note(`logInfo ${args.join(' ')}`)),
}));

import { useIntegrationTest } from './useIntegrationTest';
import { testActiveSession } from './testActiveSession';
import { GciLibrary } from '../gciLibrary';
import type { ActiveSession } from '../sessionManager';
import { installTranscriptSink, startClientForwarderMode, settleNbResult } from '../transcriptSink';
import { runNbCall, stopCallsOn } from '../nbRunner';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { reportedTransientLogin } from './sessionGateClient';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Pause = 'none' | 'beforeResume' | 'whileLooping' | 'beforeResumeContBeforeStop';

let scenarioNo = 0;
describe('probe 990', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest(
    (ctx) => {
      gci = ctx.gciLibrary;
      handle = ctx.session;
    },
    { sessions: 2 },
  );
  const session = (): ActiveSession => testActiveSession(gci, handle);

  async function scenario(pause: Pause): Promise<string> {
    lines.length = 0;
    const { session: busy, err } = reportedTransientLogin(session());
    if (!busy) throw new Error(`login failed ${err.message}`);
    const pid = Number(busy.executeAndFetchString('System gemProcessId printString'));
    const before = Date.now();
    const gemNow = Number(busy.executeAndFetchString('System _timeMs printString'));
    const offset = gemNow - Math.round((before + Date.now()) / 2);
    note(`gem clock offset ${offset}ms`);
    expect(installTranscriptSink(busy)).toBe(true);
    let tracer: import('child_process').ChildProcess | undefined;
    const traceFile = `${process.env.PROBE_OUT}.strace.${++scenarioNo}`;
    if (process.env.PROBE_STRACE) {
      const cp = await import('child_process');
      tracer = cp.spawn(
        'strace',
        [
          '--seccomp-bpf',
          '-f',
          '-tt',
          '-p',
          String(pid),
          '-o',
          traceFile,
          '-e',
          'trace=recvfrom,recvmsg,read,sendto,poll,tgkill',
        ],
        { stdio: 'ignore' },
      );
      await sleep(400);
      note(`strace attached pid ${pid} -> ${traceFile}`);
    }
    let wroteOnce: () => void = () => {};
    const onWorker = new Promise<void>((r) => (wroteOnce = r));
    const code =
      "Transcript nextPutAll: 'streaming'. SessionTemps current at: #r990 put: System _timeMs. " +
      '200 timesRepeat: [(Delay forMilliseconds: 50) wait]. 42';
    startClientForwarderMode(busy, code);
    let ended: { result: bigint; errNo: number; at: number } | undefined;
    const run = runNbCall(
      busy,
      () => busy.GciTsNbExecute(code, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, 0, 0),
      async (signal) => {
        const r = await settleNbResult(
          busy,
          () => {
            note('write seen');
            if (pause === 'beforeResume' || pause === 'beforeResumeContBeforeStop') {
              process.kill(pid, 'SIGSTOP');
              note('gem SIGSTOP (before resume is sent)');
            }
            wroteOnce();
          },
          signal,
        );
        ended = { result: r.result, errNo: r.err.number, at: Date.now() - t0 };
        note(`worker read done: err=${r.err.number} result=${r.result}`);
        return r;
      },
      { suppressNotification: true, disposableProcess: true },
    );
    run.catch(() => {});
    let firstLogout: boolean | undefined;
    let retry: boolean | undefined;
    try {
      await onWorker;
      await sleep(200);
      if (pause === 'whileLooping') {
        process.kill(pid, 'SIGSTOP');
        note('gem SIGSTOP (while looping)');
      }
      if (pause === 'beforeResumeContBeforeStop') {
        process.kill(pid, 'SIGCONT');
        note('gem SIGCONT (before stop)');
        await sleep(100);
      }
      firstLogout = busy.logout();
      note(`first logout ${firstLogout}`);
      if (pause === 'beforeResume' || pause === 'whileLooping') {
        setTimeout(() => {
          process.kill(pid, 'SIGCONT');
          note('gem SIGCONT');
        }, 100);
      }
      const s = Date.now();
      await stopCallsOn(busy);
      note(`stopCallsOn returned after ${Date.now() - s}ms`);
      retry = busy.logout();
      note(`retry logout ${retry}`);
      if (!retry && process.env.PROBE_LATE_BREAKS !== '0') {
        for (let k = 0; k < 4 && !ended; k++) {
          await sleep(1000);
          const { success, err: e } = busy.GciTsBreak(false);
          note(`late soft break ${k + 1}: success=${success} err=${e?.number}`);
        }
      }
    } finally {
      try {
        process.kill(pid, 'SIGCONT');
      } catch {
        /* gone */
      }
      for (let i = 0; i < 150 && !ended; i++) await sleep(100);
      try {
        const r = Number(
          busy.executeAndFetchString('(SessionTemps current at: #r990 ifAbsent: [0]) printString'),
        );
        note(`gem resumed the call at ${r - offset - t0} (client clock)`);
      } catch (e) {
        note(`could not read resume time: ${String(e)}`);
      }
      // Wait for the worker so the gem doesn't outlive the probe.
      for (let i = 0; i < 150 && !busy.isLoggedOut(); i++) {
        if (busy.logout()) break;
        await sleep(100);
      }
      tracer?.kill('SIGINT');
      note(
        `final: loggedOut=${busy.isLoggedOut()} ended=${JSON.stringify(ended, (_k, v) => (typeof v === 'bigint' ? String(v) : v))}`,
      );
    }
    return `${pause}: first=${firstLogout} retry=${retry}\n` + lines.join('\n');
  }

  const N = Number(process.env.PROBE_N ?? 150);
  const which = (process.env.PROBE_PAUSES ?? 'none').split(',') as Pause[];
  it('runs the scenarios', async () => {
    const out: string[] = [];
    for (const p of which) {
      for (let i = 0; i < N; i++) {
        out.push(await scenario(p));
      }
    }
    if (process.env.PROBE_OUT)
      (await import('fs')).writeFileSync(process.env.PROBE_OUT, out.join('\n----\n') + '\n');
    const failed = out.filter((o) => o.includes('retry=false'));
    console.error(`PROBE990 ${failed.length} of ${out.length} stops ignored`);
    for (const f of failed) console.error(`PROBE990 FAILURE\n${f}`);
    expect(failed.length).toBe(0);
  }, 900_000);
});
