// The non-blocking SUnit run path, against a live stone.
//
// The blocking queries are covered next door in querySunit.integration.test.ts.
// What is different here is HOW the answer is waited for: GciTsNbExecute plus a
// poll, so the extension host stays free and the run can be interrupted. That
// difference is exactly where the bugs were — a run that could not be stopped, a
// break that wedged the session for every call after it — and none of them were
// visible against a mocked GCI.
//
// Fully transient: the probe fixture is installed inside each test's own
// transaction, so the harness's per-test abort cleans it up. Nothing commits.

import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { MIN_HARD_BREAK_GAP_MS, NbCancelledError } from '../../nbRunner';
import { runTestClassNb, runTestMethodNb } from '../../sunitQueries';
import { discoverTestClasses } from '../discoverTestClasses';
import { discoverTestMethods } from '../discoverTestMethods';
import { buildMethodUri, parseUri } from '../../gemstoneFileSystemProvider';
import {
  installSunitProbeFixture,
  SUNIT_PROBE_TEST_CLASS,
  SUNIT_PROBE_PASSING_SELECTOR,
  SUNIT_PROBE_FAILING_SELECTOR,
  SUNIT_PROBE_ERRORING_SELECTOR,
} from './sunitProbeFixture';

// Long enough that a stop has something to interrupt, short enough that a test
// which fails to stop still ends this file rather than hanging it. Sends a
// message every iteration, so the gem keeps reaching safe points and a soft break
// does land — though how long it takes to is the gem's business, not the test's.
const SLOW_SELECTOR = 'testRunsLongEnoughToStop';
const SLOW_SOURCE = `${SLOW_SELECTOR}
  | n |
  n := 0.
  1 to: 40 do: [:second |
    1 to: 177000000 do: [:k | n := n max: k]].
  self assert: n > 0`;

describe('SUnit non-blocking runs (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  // One session object for the whole file, as the extension has: a fresh object per
  // call would look like a different session to anything tracking state per session.
  let theSession: ActiveSession;
  const session = (): ActiveSession =>
    (theSession ??= { id: 1, gci, handle } as unknown as ActiveSession);
  const exec = (code: string): string => q.executeFetchString(session(), code);

  beforeEach(() => {
    installSunitProbeFixture(exec);
  });

  function installSlowTest(): void {
    exec(
      `(UserGlobals at: #'${SUNIT_PROBE_TEST_CLASS}')
         compileMethod: '${SLOW_SOURCE.replace(/'/g, "''")}'
         dictionaries: System myUserProfile symbolList
         category: 'tests'. 'ok'`,
    );
  }

  /**
   * Start the slow test and hand back its promise plus the canceller, ready to
   * be pressed.
   *
   * Two waits are folded in here because both are about the run having actually
   * begun, and neither is a guess about how the gem will service a break:
   *
   * - `vi.waitFor` on the canceller, because a run that follows a break waits for
   *   the abandoned call to be drained before it starts, so `onStart` is not
   *   always synchronous.
   * - the short sleep, because a break that arrives before the gem has picked the
   *   call up is documented as ignored. 250ms is far more than it needs: the gem
   *   reports its own elapsed time as ~250ms when a break lands right after this
   *   wait, i.e. it started executing essentially at once.
   */
  async function startSlowRun(): Promise<{
    run: ReturnType<typeof runTestMethodNb>;
    cancel: () => void;
  }> {
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
    // Claimed here rather than at the assertion: a hard break rejects inside a
    // timer tick, and an unclaimed rejection that early is reported as unhandled.
    run.catch(() => {});
    await vi.waitFor(() => expect(cancel).toBeDefined());
    await new Promise((r) => setTimeout(r, 250));
    return { run, cancel: cancel! };
  }

  /**
   * How a stopped run settled, as one of two legal endings: `'stopped'` when the
   * hard break abandoned the call and the run rejected, or whatever verdict the
   * gem answered when it trapped the break instead. Which of the two happens
   * depends on the gem's break-delivery mode and is not the test's business.
   *
   * Only `NbCancelledError` is read as a stop. Every other rejection is rethrown
   * so it surfaces as itself: a poll failure, a session that went away, or a
   * follow-up call refused as busy are all bugs, and mapping them to 'stopped'
   * would let the exact failures these tests exist to catch read as a clean stop.
   */
  async function settledStatus(run: ReturnType<typeof runTestMethodNb>): Promise<string> {
    try {
      return (await run).status;
    } catch (e) {
      if (e instanceof NbCancelledError) return 'stopped';
      throw e;
    }
  }

  /**
   * The endings a stopped run may legally have — asserted as a set rather than
   * as "anything but passed", so a surprise verdict is a failure too.
   */
  const STOPPED_ENDINGS = ['stopped', 'error'];

  it('reports a passing, a failing and an erroring test the same way the blocking query does', async () => {
    await expect(
      runTestMethodNb(session(), SUNIT_PROBE_TEST_CLASS, SUNIT_PROBE_PASSING_SELECTOR),
    ).resolves.toMatchObject({ status: 'passed' });

    const failed = await runTestMethodNb(
      session(),
      SUNIT_PROBE_TEST_CLASS,
      SUNIT_PROBE_FAILING_SELECTOR,
    );
    expect(failed.status).toBe('failed');
    expect(failed.message).toContain('TestFailure');

    const errored = await runTestMethodNb(
      session(),
      SUNIT_PROBE_TEST_CLASS,
      SUNIT_PROBE_ERRORING_SELECTOR,
    );
    expect(errored.status).toBe('error');
    expect(errored.message).not.toBe('');
  });

  it('reports every test of a class in one run', async () => {
    const results = await runTestClassNb(session(), SUNIT_PROBE_TEST_CLASS);

    const bySelector = new Map(results.map((r) => [r.selector, r.status]));
    expect(bySelector.get(SUNIT_PROBE_PASSING_SELECTOR)).toBe('passed');
    expect(bySelector.get(SUNIT_PROBE_FAILING_SELECTOR)).toBe('failed');
    expect(bySelector.get(SUNIT_PROBE_ERRORING_SELECTOR)).toBe('error');
  });

  it('measures a duration on the stone rather than reporting zero', async () => {
    const result = await runTestMethodNb(
      session(),
      SUNIT_PROBE_TEST_CLASS,
      SUNIT_PROBE_PASSING_SELECTOR,
    );

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(result.durationMs)).toBe(false);
  });

  it('stops a running test, and leaves the session usable straight afterwards', async () => {
    // Both halves matter. Before the drain fix the break worked but left the call
    // "in progress" for good, so the NEXT run was refused as "session is busy" —
    // which reads as the run silently doing nothing.
    installSlowTest();

    const { run, cancel } = await startSlowRun();
    cancel(); // one press — soft break

    // A stopped test must report as stopped or errored — never as passed, and
    // never as something else that happens not to be 'passed'.
    expect(STOPPED_ENDINGS).toContain(await settledStatus(run));

    // The session is the real assertion, and its own synchronisation: the next run
    // waits for the abandoned call to be drained before it starts, so if this
    // resolves at all, the session came back without the caller knowing a break
    // happened.
    await expect(
      runTestMethodNb(session(), SUNIT_PROBE_TEST_CLASS, SUNIT_PROBE_PASSING_SELECTOR),
    ).resolves.toMatchObject({ status: 'passed' });
  }, 120_000);

  it('takes a second press without sending the two breaks back-to-back', async () => {
    // Pressing stop twice in a row is the gesture that once faulted the client
    // process outright, because the hard break went out on the heels of the soft
    // one. The runner defers it instead, and only a live GCI can show that the
    // deferral holds — a stubbed one cannot fault.
    //
    // Deliberately NOT asserted here: that a hard break is sent at all. Whether
    // it is depends on whether the gem services the soft break within the gap
    // (~80ms) or after it (~1.9s), which is not something the client controls.
    installSlowTest();

    // Time each break as it goes out, and still let the real one through — the
    // point is the gap between them on a live library, so this must not stub.
    const sent: { hard: boolean; at: number }[] = [];
    const realBreak = gci.GciTsBreak.bind(gci);
    const breaks = vi.spyOn(gci, 'GciTsBreak').mockImplementation((h, hard) => {
      sent.push({ hard, at: Date.now() });
      return realBreak(h, hard);
    });

    try {
      const { run, cancel } = await startSlowRun();
      cancel(); // soft
      cancel(); // hard, deferred internally past the safety gap — never slept for here

      expect(STOPPED_ENDINGS).toContain(await settledStatus(run));

      // The sequence as one string, so both legal endings can be named without
      // asserting inside a conditional: either the gem serviced the soft break
      // before the deferred hard one came due, or it did not and the hard break
      // went out — a full gap later. A `hard-too-soon` here is the client-faulting
      // sequence this test exists to catch.
      const shape = sent
        .map((brk, i) => {
          const soonEnough = i > 0 && brk.at - sent[i - 1].at < MIN_HARD_BREAK_GAP_MS;
          return `${brk.hard ? 'hard' : 'soft'}${soonEnough ? '-too-soon' : ''}`;
        })
        .join(',');
      expect(['soft', 'soft,hard']).toContain(shape);

      // And the session recovers, which is what the drain is for.
      await expect(
        runTestMethodNb(session(), SUNIT_PROBE_TEST_CLASS, SUNIT_PROBE_PASSING_SELECTOR),
      ).resolves.toMatchObject({ status: 'passed' });
    } finally {
      // Restored even on failure: the spy is on the shared library object, so a
      // leaked one would follow every later test in the file.
      breaks.mockRestore();
    }
  }, 120_000);

  it('discovers the probe class, and its methods carry the category the URI needs', () => {
    const found = discoverTestClasses(exec).find(
      (c) => c.className === SUNIT_PROBE_TEST_CLASS && c.dictName === 'UserGlobals',
    );
    expect(found).toBeDefined();
    expect(found!.testCount).toBeGreaterThan(0);
    // The dictionary index is what scopes the gemstone:// URI a gutter icon needs.
    expect(found!.dictIndex).toBeGreaterThan(0);

    const methods = discoverTestMethods(exec, SUNIT_PROBE_TEST_CLASS, 'UserGlobals');
    expect(methods.map((m) => m.selector)).toContain(SUNIT_PROBE_PASSING_SELECTOR);
  });

  it('round-trips a method whose category contains a slash', () => {
    // `initialize/release` is a stock GemStone category. Building a URI for a
    // method in one used to throw, which took the Methods pane down with it.
    exec(
      `(UserGlobals at: #'${SUNIT_PROBE_TEST_CLASS}')
         compileMethod: 'testInCategoryWithASlash  self assert: true'
         dictionaries: System myUserProfile symbolList
         category: 'initialize/release'. 'ok'`,
    );

    const method = discoverTestMethods(exec, SUNIT_PROBE_TEST_CLASS, 'UserGlobals').find(
      (m) => m.selector === 'testInCategoryWithASlash',
    );
    expect(method?.category).toBe('initialize/release');

    const parsed = parseUri(
      buildMethodUri({
        kind: 'method',
        sessionId: 1,
        dictName: 'UserGlobals',
        className: SUNIT_PROBE_TEST_CLASS,
        isMeta: false,
        category: method!.category,
        selector: method!.selector,
        environmentId: 0,
      }),
    );
    expect(parsed).toMatchObject({
      kind: 'method',
      category: 'initialize/release',
      selector: 'testInCategoryWithASlash',
    });
  });
});
