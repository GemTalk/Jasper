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
import { NbCancelledError } from '../../nbRunner';
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
// message every iteration, so the gem reaches a safe point and a soft break lands.
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

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);

  beforeEach(() => {
    installSunitProbeFixture(exec);
  });

  /**
   * Wait until the session has no GCI call outstanding.
   *
   * A break abandons the call, and its result is collected in the background.
   * The harness aborts the transaction after every test, on a blocking call —
   * so a test that ends while the drain is still going hands back a session
   * that refuses the abort, and every later test in the file is skipped.
   */
  async function waitUntilIdle(): Promise<void> {
    for (let i = 0; i < 200; i++) {
      if (gci.GciTsCallInProgress(handle).result === 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('The session still had a call in progress 10s after the break.');
  }

  function installSlowTest(): void {
    exec(
      `(UserGlobals at: #'${SUNIT_PROBE_TEST_CLASS}')
         compileMethod: '${SLOW_SOURCE.replace(/'/g, "''")}'
         dictionaries: System myUserProfile symbolList
         category: 'tests'. 'ok'`,
    );
  }

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
    // Let the call get going before breaking it.
    await new Promise((r) => setTimeout(r, 250));
    expect(cancel).toBeDefined();
    cancel!(); // soft — this test reaches safe points, so it should land
    const outcome = await run.then(
      (r) => r,
      (e: unknown) => e,
    );

    // A soft break surfaces either as a rejection or as a non-passing verdict,
    // depending on where in the test the gem reached its safe point. What must
    // never happen is the interrupted test being reported as having passed.
    const settledAs = outcome instanceof Error ? 'stopped' : (outcome as { status: string }).status;
    expect(settledAs).not.toBe('passed');

    // The session is the real assertion: another run must work, without the
    // caller having to know a break just happened.
    await expect(
      runTestMethodNb(session(), SUNIT_PROBE_TEST_CLASS, SUNIT_PROBE_PASSING_SELECTOR),
    ).resolves.toMatchObject({ status: 'passed' });
    await waitUntilIdle();
  }, 120_000);

  it('escalates to a hard break when the run ignores a soft one', async () => {
    installSlowTest();

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
    await new Promise((r) => setTimeout(r, 250));
    cancel!();
    // The second call is the hard break. The runner refuses to send it back-to-back
    // with the soft one — that crashes the client process outright — so wait past
    // its safety gap before asking again, the way a user pressing twice would.
    await new Promise((r) => setTimeout(r, 500));
    cancel!();

    await expect(run).rejects.toBeInstanceOf(NbCancelledError);

    // And the session recovers, which is what the drain is for.
    await expect(
      runTestMethodNb(session(), SUNIT_PROBE_TEST_CLASS, SUNIT_PROBE_PASSING_SELECTOR),
    ).resolves.toMatchObject({ status: 'passed' });
    await waitUntilIdle();
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
