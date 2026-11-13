// THROWAWAY probe for GemTalk/Jasper#852, on a branch that is never merged. It logs gems out
// over and over, the ways the activeSession tests do, and when one doesn't leave the stone it
// collects everything the server host can tell about that gem before failing.
import { describe, it, vi } from 'vitest';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type { ActiveSession } from '../activeSession';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { runNbCall } from '../nbRunner';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';
import { stillOnStone } from './leftoverGem';
import { reportedSerialOf, reportedTransientLogin, reportSessionClosed } from './sessionGateClient';

const PROBE_SECONDS = Number(process.env.PROBE_SECONDS ?? 60);
const LANES = Number(process.env.PROBE_LANES ?? 4);
// Normal leave times on CI top out near 4.3 s; a gem still there at 20 s is in the failure mode.
const STUCK_MS = Number(process.env.PROBE_STUCK_MS ?? 20_000);
const OUT_DIR = process.env.PROBE_OUT_DIR ?? join(process.cwd(), 'probe852');
const LEG = process.env.PROBE_LEG ?? 'local';
const BUSY_CODE = '[[true] whileTrue: [nil]] on: Break do: [:e | e resume]';

// Run 43337129662 caught only idle gems stopped right after login, so the stop scenarios get most
// of the turns: right away, and again after LATE_MS, to test whether the early stop is the trigger.
type Scenario = 'busy-nblogout' | 'idle-stopsession' | 'idle-stopsession-late' | 'idle-logout';
const SCENARIOS: Scenario[] = [
  'idle-stopsession',
  'idle-stopsession-late',
  'busy-nblogout',
  'idle-stopsession',
  'idle-stopsession-late',
  'idle-logout',
];
const LATE_MS = Number(process.env.PROBE_LATE_MS ?? 3_000);

function out(line: string): void {
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(join(OUT_DIR, `${LEG}.txt`), line + '\n');
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const st = (s: string) => s.replace(/'/g, "''");

/** Everything the gem's host can say about gem process `pid`, gathered from `admin`'s gem. */
function hostReport(admin: ActiveSession, pid: string): string {
  const script = [
    `P=${pid}`,
    'echo "== uname"; uname -a',
    'echo "== ps"; ps -o pid,ppid,stat,etime,wchan,command -p $P 2>&1',
    'echo "== threads (linux)"; for t in /proc/$P/task/*; do [ -d "$t" ] && echo "tid=$(basename $t) state=$(cut -d" " -f3 $t/stat) wchan=$(cat $t/wchan 2>/dev/null) comm=$(cat $t/comm 2>/dev/null) syscall=$(cat $t/syscall 2>/dev/null)"; done',
    'echo "== threads (mac)"; ps -M -p $P 2>/dev/null',
    'echo "== fds"; ls -l /proc/$P/fd 2>/dev/null || lsof -p $P 2>/dev/null',
    'echo "== tcp peers (linux)"; ss -tanpe 2>/dev/null | grep -E "pid=$P[,)]"',
    'EXT=$(readlink /proc/$P/fd/* 2>/dev/null | grep extent0.dbf | head -1); [ -z "$EXT" ] && EXT=$(lsof -p $P -Fn 2>/dev/null | sed -n "s/^n//p" | grep extent0.dbf | head -1)',
    'for f in $(dirname "$EXT")/*stone.log; do echo "== stone log $f (tail)"; tail -n 40 "$f"; done',
    'LOG=$(readlink /proc/$P/fd/1 2>/dev/null || lsof -a -p $P -d 1 -Fn 2>/dev/null | sed -n "s/^n//p")',
    'echo "== gem log $LOG"; [ -n "$LOG" ] && cat "$LOG" | sed -n "/RPC client/,\\$p"',
    'echo "== native stacks"',
    'if command -v gdb >/dev/null 2>&1; then (sudo -n gdb -p $P -batch -ex "thread apply all bt" 2>&1 || gdb -p $P -batch -ex "thread apply all bt" 2>&1) | grep -v "^\\[New LWP" | tail -n 200;',
    'elif command -v sample >/dev/null 2>&1; then sample $P 2 2>&1 | head -n 250; else echo "no gdb or sample"; fi',
    'echo "== SIGUSR1, then gem log tail"; kill -USR1 $P; sleep 3; [ -n "$LOG" ] && tail -n 150 "$LOG"',
  ].join('\n');
  try {
    return admin.executeAndFetchString(`System performOnServer: '${st(script)}'`);
  } catch (error) {
    return `performOnServer failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

describe('stuck logout probe (integration)', () => {
  let session: ActiveSession;
  useIntegrationTest(
    (ctx) => {
      session = testActiveSession(ctx.gciLibrary, ctx.session);
    },
    { sessions: LANES + 1 },
  );

  const describeLogin = (serial: string) =>
    session.executeAndFetchString(`(System descriptionOfSessionSerialNum: ${serial}) printString`);
  const gemPidOf = (serial: string) =>
    session.executeAndFetchString(
      `((System descriptionOfSessionSerialNum: ${serial}) at: 2) printString`,
    );

  function transient(): { t: ActiveSession; serial: string } {
    const { session: t, err } = reportedTransientLogin(session);
    if (!t) throw new Error(`Transient login failed: ${err.message}`);
    return { t, serial: reportedSerialOf(t) };
  }

  /** Waits for `serial` to leave; answers ms taken, or -1 once it has stayed past STUCK_MS. */
  async function leaveTime(serial: string, from: number): Promise<number> {
    while (stillOnStone(session, serial)) {
      if (Date.now() - from > STUCK_MS) return -1;
      await pause(100);
    }
    return Date.now() - from;
  }

  async function runOnce(
    scenario: Scenario,
  ): Promise<{ serial: string; ms: number; pid: string; t: ActiveSession }> {
    const { t, serial } = transient();
    const pid = gemPidOf(serial);
    let from: number;
    if (scenario === 'busy-nblogout') {
      const call = runNbCall(
        t,
        () => t.GciTsNbExecute(BUSY_CODE, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, 0, 0),
        () => t.GciTsNbResult(),
        { suppressNotification: true },
      );
      call.catch(() => {});
      from = Date.now();
      if (!t.logout()) throw new Error(`logout refused for ${serial}`);
      await call.catch(() => {});
    } else if (scenario === 'idle-stopsession' || scenario === 'idle-stopsession-late') {
      const id = t.executeAndFetchString('System session printString');
      if (scenario === 'idle-stopsession-late') await pause(LATE_MS);
      from = Date.now();
      session.executeAndFetchString(`System stopSession: ${id}. 'ok'`);
    } else {
      from = Date.now();
      if (!t.logout()) throw new Error(`logout refused for ${serial}`);
    }
    const ms = await leaveTime(serial, from);
    if (scenario.startsWith('idle-stopsession') && ms >= 0) t.logout();
    return { serial, ms, pid, t };
  }

  it(
    'logs gems out until one stays on the stone',
    async () => {
      const deadline = Date.now() + PROBE_SECONDS * 1000;
      const stats: Record<Scenario, number[]> = {
        'busy-nblogout': [],
        'idle-stopsession': [],
        'idle-stopsession-late': [],
        'idle-logout': [],
      };
      const stuckCount: Record<Scenario, number> = {
        'busy-nblogout': 0,
        'idle-stopsession': 0,
        'idle-stopsession-late': 0,
        'idle-logout': 0,
      };
      let stuck: string | undefined;
      out(`# ${LEG} start ${new Date().toISOString()} lanes=${LANES} seconds=${PROBE_SECONDS}`);

      const lane = async (n: number) => {
        for (let i = n; Date.now() < deadline; i++) {
          const scenario = SCENARIOS[i % SCENARIOS.length];
          const { serial, ms, pid, t } = await runOnce(scenario);
          if (ms >= 0) {
            stats[scenario].push(ms);
            if (ms > 5_000) out(`slow: ${scenario} serial ${serial} pid ${pid} ${ms} ms`);
            reportSessionClosed(serial);
            continue;
          }
          const lines = [
            `##### STUCK ${LEG} ${new Date().toISOString()} scenario=${scenario} serial=${serial} pid=${pid} lane=${n} iteration=${i}`,
            `== stone description: ${describeLogin(serial)}`,
            hostReport(session, pid),
            `== stone description after report: ${describeLogin(serial)}`,
          ];
          stuck = lines.join('\n');
          stuckCount[scenario]++;
          out(stuck);
          console.warn(stuck);
          // Has the stop reached the gem? A request from its own client makes an idle gem look
          // at its state: if the stop was delivered but never woke it, this request fails with the
          // stop and the gem leaves; if the stone never delivered it, the request just answers.
          if (scenario.startsWith('idle-stopsession')) {
            let poke: string;
            try {
              poke = `answered ${t.executeAndFetchString('3 + 4')}`;
            } catch (error) {
              poke = `failed: ${error instanceof Error ? error.message : String(error)}`;
            }
            const afterPoke = await leaveTime(serial, Date.now());
            out(
              `poke from its own client ${poke}; the gem then ${afterPoke >= 0 ? `left in ${afterPoke} ms` : 'is still there'}`,
            );
            out(`== stone description after poke: ${describeLogin(serial)}`);
          }
          session.executeAndFetchString(
            `| n | n := (System descriptionOfSessionSerialNum: ${serial}) at: 10. n > 0 ifTrue: [System stopSession: n]. 'ok'`,
          );
          const gone = await leaveTime(serial, Date.now());
          out(`after stopSession the gem ${gone >= 0 ? `left in ${gone} ms` : 'is still there'}`);
          if (gone < 0) {
            out(`killing gem ${pid}`);
            try {
              session.executeAndFetchString(`System performOnServer: 'kill -9 ${pid}'`);
            } catch {
              // Best effort: the leg is already failing on this gem.
            }
            out(
              `after kill the gem ${(await leaveTime(serial, Date.now())) >= 0 ? 'left' : 'is still listed'}`,
            );
          }
          try {
            t.logout();
          } catch {
            // The session may already be gone.
          }
          reportSessionClosed(serial);
        }
      };
      await Promise.all(Array.from({ length: LANES }, (_, n) => lane(n)));

      for (const scenario of new Set(SCENARIOS)) {
        const v = [...stats[scenario]].sort((a, b) => a - b);
        const at = (q: number) => v[Math.min(v.length - 1, Math.floor(v.length * q))];
        out(
          `${scenario}: n=${v.length} stuck=${stuckCount[scenario]} p50=${at(0.5)} p99=${at(0.99)} max=${v.at(-1)}`,
        );
      }
      if (stuck) throw new Error(`A gem stayed on the stone; see ${join(OUT_DIR, `${LEG}.txt`)}`);
    },
    (PROBE_SECONDS + 180) * 1000,
  );
});
