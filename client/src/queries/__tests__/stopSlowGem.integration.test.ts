// Stopping a run whose gem goes on working after the break, against a live stone.
//
// A stopped call isn't over until its result is collected; until then GemStone
// refuses every call on the session. The runner gives a stopped call 2s to be
// collected before it lets the next run start. These tests cover the gem that
// takes longer than that. A paused gem (SIGSTOP) is the dependable stand-in for a
// machine too loaded to answer; a slow tearDown keeps the gem busy whichever break
// stops the test, since the test runner lets a tearDown finish.
//
// Fully transient, like sunitRunNb.integration.test.ts next door: the fixture is
// installed inside each test's own transaction, so the harness's per-test abort
// cleans it up. Nothing commits.

import { describe, it, expect, vi, beforeEach, afterEach, type TestContext } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as os from 'node:os';
import * as vscode from 'vscode';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { NbCancelledError, NbSessionBusyError } from '../../nbRunner';
import { runTestMethodNb } from '../../sunitQueries';
import { evalSmalltalk } from '../../smalltalkNotebookController';
import {
  installSunitProbeFixture,
  SUNIT_PROBE_TEST_CLASS,
  SUNIT_PROBE_PASSING_SELECTOR,
} from './sunitProbeFixture';
import { testActiveSession } from '../../__tests__/testActiveSession';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sends a message every iteration, so a break lands at once; see the same test in
// sunitRunNb.integration.test.ts.
const SLOW_SELECTOR = 'testRunsLongEnoughToStop';
const SLOW_SOURCE = `${SLOW_SELECTOR}
  | n |
  n := 0.
  1 to: 40 do: [:second |
    1 to: 177000000 do: [:k | n := n max: k]].
  self assert: n > 0`;

/** How long the slow tearDown runs when nothing breaks it: twice the drain's 2s budget. */
const SLOW_TEARDOWN_MS = 4000;

/** Generous: the gem only has to finish the tearDown, and the runner polls every 500ms. */
const FREED_WITHIN_MS = 20_000;

// SIGSTOP needs the gem on this machine. On Windows CI it runs inside WSL; a stone
// elsewhere is checked per test (localGemPid).
const canPauseGem = process.platform !== 'win32';

/** The names a gem started on this machine can report as its host. */
const THIS_MACHINE = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  os.hostname(),
  os.hostname().split('.')[0],
]);

describe('stopping a run while the gem is slow to answer (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((t) => {
    gci = t.gciLibrary;
    handle = t.session;
  });

  // One session object for the whole file, as the extension has.
  let theSession: ActiveSession;
  const session = (): ActiveSession => (theSession ??= testActiveSession(gci, handle));
  const exec = (code: string): string => q.executeFetchString(session(), code);

  beforeEach(() => {
    installSunitProbeFixture(exec);
    exec(
      `(UserGlobals at: #'${SUNIT_PROBE_TEST_CLASS}')
         compileMethod: '${SLOW_SOURCE.replace(/'/g, "''")}'
         dictionaries: System myUserProfile symbolList
         category: 'tests'. 'ok'`,
    );
  });

  // A test that fails half-way would leave the session refusing the harness's own
  // teardown, burying the one real failure under a cascade. Wait it out instead.
  afterEach(async () => {
    await vi.waitFor(() => expect(exec("'free'")).toBe('free'), {
      timeout: FREED_WITHIN_MS,
      interval: 250,
    });
  }, FREED_WITHIN_MS + 5000);

  /**
   * The gem's process id, to pause it with. Skips the test when the gem runs on
   * another host: the id would belong to an unrelated process here.
   */
  const localGemPid = (ctx: TestContext): number => {
    const host = exec('((System descriptionOfSession: System session) at: 3) asString');
    if (!THIS_MACHINE.has(host))
      ctx.skip(`the gem runs on ${host}, so it cannot be paused from here`);
    return Number(exec('((System descriptionOfSession: System session) at: 2) printString'));
  };

  /** Stop the slow test with two presses (a soft break, then stop waiting), and answer once the run has rejected. */
  async function stopSlowTest(beforeBreak: () => void = () => {}): Promise<void> {
    let cancel: (() => void) | undefined;
    const run = runTestMethodNb(
      session(),
      SUNIT_PROBE_TEST_CLASS,
      SLOW_SELECTOR,
      undefined,
      (c) => {
        cancel = c;
      },
    );
    run.catch(() => {});
    await vi.waitFor(() => expect(cancel).toBeDefined());
    await sleep(250); // a break before the gem has picked the call up is ignored
    beforeBreak();
    cancel!();
    cancel!();
    await expect(run).rejects.toBeInstanceOf(NbCancelledError);
  }

  const installSlowTearDown = (): void => {
    exec(
      `(UserGlobals at: #'${SUNIT_PROBE_TEST_CLASS}')
         compileMethod: 'tearDown
           | t |
           t := Time millisecondClockValue.
           [(Time millisecondClockValue - t) < ${SLOW_TEARDOWN_MS}] whileTrue: [].
           UserGlobals at: #JasperProbeTearDownDone put: true.
           super tearDown'
         dictionaries: System myUserProfile symbolList
         category: 'running'. 'ok'`,
    );
  };

  const passingRun = () =>
    runTestMethodNb(session(), SUNIT_PROBE_TEST_CLASS, SUNIT_PROBE_PASSING_SELECTOR);

  /** Run `cell` as a notebook cell, and press the progress notification's Cancel twice. */
  async function stopCell(cell: string, beforeBreak: () => void): Promise<void> {
    let cancel: (() => void) | undefined;
    const progress = vi.spyOn(vscode.window, 'withProgress').mockImplementation(((
      _opts: unknown,
      task: (p: unknown, t: unknown) => Promise<unknown>,
    ) => {
      const listeners: Array<() => void> = [];
      cancel = () => listeners.forEach((l) => l());
      return task(
        { report: () => {} },
        { onCancellationRequested: (l: () => void) => listeners.push(l) },
      );
    }) as never);
    try {
      const run = evalSmalltalk(session(), cell);
      run.catch(() => {});
      // The notification only appears once the cell has run for 2s.
      await vi.waitFor(() => expect(cancel).toBeDefined(), { timeout: 10_000 });
      beforeBreak();
      cancel!();
      cancel!();
      await expect(run).rejects.toBeInstanceOf(NbCancelledError);
    } finally {
      progress.mockRestore();
    }
  }

  it('leaves the session usable after a stop during a slow tearDown, without the user doing anything', async () => {
    // The gem stays busy for the rest of the 4s tearDown, but nothing here depends
    // on catching it busy; the paused-gem tests below hold it busy for certain.
    installSlowTearDown();

    await stopSlowTest();

    // A blocking query, which never collects anything itself, works again once the
    // gem is done: the runner collected the stopped call, in the background if the
    // drain's 2s were not enough.
    await vi.waitFor(() => expect(exec("'alive'")).toBe('alive'), {
      timeout: FREED_WITHIN_MS,
      interval: 250,
    });
    await expect(passingRun()).resolves.toMatchObject({ status: 'passed' });
  }, 120_000);

  it('lets a slow tearDown finish after one press, and says the run is still finishing meanwhile', async () => {
    // One press is a soft break, which the test runner catches; GemStone repeats it
    // every 2s. The tearDown must finish anyway: cut short, it leaves the test's
    // changes in the session.
    installSlowTearDown();
    let cancel: (() => void) | undefined;
    const run = runTestMethodNb(
      session(),
      SUNIT_PROBE_TEST_CLASS,
      SLOW_SELECTOR,
      undefined,
      (c) => {
        cancel = c;
      },
    );
    run.catch(() => {});
    await vi.waitFor(() => expect(cancel).toBeDefined());
    await sleep(250);
    cancel!();
    // Long enough for the break to land, and well inside the tearDown: GemStone
    // breaks it again by itself about 2s after the first.
    await sleep(300);

    const early = passingRun();

    await expect(early).rejects.toBeInstanceOf(NbSessionBusyError);
    await expect(early).rejects.toThrow(/still finishing/);
    // The runner stops waiting while the 4s tearDown is still running; the
    // tearDown carries on regardless.
    await expect(run).rejects.toBeInstanceOf(NbCancelledError);
    await vi.waitFor(() => expect(exec("'alive'")).toBe('alive'), {
      timeout: FREED_WITHIN_MS,
      interval: 250,
    });
    expect(exec(`(UserGlobals at: #JasperProbeTearDownDone ifAbsent: [false]) printString`)).toBe(
      'true',
    );
    await expect(passingRun()).resolves.toMatchObject({ status: 'passed' });
  }, 120_000);

  it.runIf(canPauseGem)(
    'frees the session after the gem was too slow to answer the break',
    async (ctx) => {
      // A paused gem is what a loaded machine looks like from here: the break is
      // sent, and the answer comes back long after the drain's budget.
      const pid = localGemPid(ctx);
      try {
        await stopSlowTest(() => process.kill(pid, 'SIGSTOP'));
        await sleep(3000); // past the drain's 2s budget
        await expect(passingRun()).rejects.toBeInstanceOf(NbSessionBusyError);
      } finally {
        process.kill(pid, 'SIGCONT');
      }

      await vi.waitFor(() => expect(exec("'alive'")).toBe('alive'), {
        timeout: FREED_WITHIN_MS,
        interval: 250,
      });
      await expect(passingRun()).resolves.toMatchObject({ status: 'passed' });
      await expect(evalSmalltalk(session(), '3 + 4')).resolves.toBe('7');
    },
    120_000,
  );

  for (const transcript of [false, true]) {
    it.runIf(canPauseGem)(
      `frees the session after a notebook cell ${transcript ? 'that writes to the Transcript ' : ''}was stopped on a slow gem`,
      async (ctx) => {
        const pid = localGemPid(ctx);
        try {
          await stopCell(
            `| n | ${transcript ? "Transcript show: 'hello'. " : ''}n := 0.
             1 to: 40 do: [:s | 1 to: 177000000 do: [:k | n := n max: k]]. n`,
            () => process.kill(pid, 'SIGSTOP'),
          );
          await sleep(3000);
          await expect(evalSmalltalk(session(), '3 + 4')).rejects.toBeInstanceOf(
            NbSessionBusyError,
          );
        } finally {
          process.kill(pid, 'SIGCONT');
        }

        await vi.waitFor(() => expect(exec("'alive'")).toBe('alive'), {
          timeout: FREED_WITHIN_MS,
          interval: 250,
        });
        await expect(evalSmalltalk(session(), '3 + 4')).resolves.toBe('7');
      },
      120_000,
    );
  }
});
