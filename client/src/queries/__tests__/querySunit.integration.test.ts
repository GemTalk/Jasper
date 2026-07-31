// Integration tests for the SUnit-family queries against a live stone.
//
// Covers `runTestMethod`, `runTestClass`, `runFailingTests`, and
// `describeTestFailure`. Every one of these tools went through at least one
// round of "the unit tests passed but the live tool didn't work" — the
// `each testCase` DNU bug, the Utf8 stream growth failure, the missing
// `asUtf8` selector. With a real session, the test that proves the tool
// works is "ask it about a known fixture and check the output."
//
// Fully transient: the probe fixture is (re-)installed inside each test's own
// transaction, so the harness's per-test abort cleans it up
// automatically — no manual teardown.

import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { runTestMethod } from '../runTestMethod';
import { runTestClass } from '../runTestClass';
import { runFailingTests } from '../runFailingTests';
import { describeTestFailure } from '../describeTestFailure';
import { discoverAllTestClasses } from './discoverAllTestClasses';
import {
  installSunitProbeFixture,
  SUNIT_PROBE_TEST_CLASS,
  SUNIT_PROBE_PASSING_SELECTOR,
  SUNIT_PROBE_FAILING_SELECTOR,
  SUNIT_PROBE_ERRORING_SELECTOR,
} from './sunitProbeFixture';

describe('SUnit queries (integration)', () => {
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

  describe('runTestMethod', () => {
    // Round-1 (round-3-revisited) ask: the message column on a failing
    // test should carry the live exception text, not the SUnit debug
    // recipe. The probe's `testFails` does `self assert: 1 = 2`, so we
    // expect a TestFailure with an "Assertion failed"-style messageText.
    it('reports the live exception class and messageText for a failing test', () => {
      const result = runTestMethod(exec, SUNIT_PROBE_TEST_CLASS, SUNIT_PROBE_FAILING_SELECTOR);
      expect(result.status).toBe('failed');
      expect(result.message).toContain('TestFailure');
      // The classic round-3 regression: every failing test came back as
      // "Receiver: anUtf8(). Selector: #'at:put:'". Pin its absence.
      expect(result.message).not.toContain("Selector:  #'at:put:'");
      expect(result.message).not.toContain('\0');
    });

    it('reports MessageNotUnderstood with the bad selector for an erroring test', () => {
      const result = runTestMethod(exec, SUNIT_PROBE_TEST_CLASS, SUNIT_PROBE_ERRORING_SELECTOR);
      expect(result.status).toBe('error');
      expect(result.message).toContain('MessageNotUnderstood');
      expect(result.message).toContain('doesNotUnderstandWHATEVER');
      expect(result.message).not.toContain('\0');
    });

    it('reports a passing test with no message', () => {
      const result = runTestMethod(exec, SUNIT_PROBE_TEST_CLASS, SUNIT_PROBE_PASSING_SELECTOR);
      expect(result.status).toBe('passed');
      expect(result.message).toBe('');
    });
  });

  describe('runTestClass', () => {
    it('reports per-method results for the probe class', () => {
      const results = runTestClass(exec, SUNIT_PROBE_TEST_CLASS);
      const bySel = new Map(results.map((r) => [r.selector, r]));

      expect(bySel.get(SUNIT_PROBE_PASSING_SELECTOR)?.status).toBe('passed');
      expect(bySel.get(SUNIT_PROBE_FAILING_SELECTOR)?.status).toBe('failed');
      expect(bySel.get(SUNIT_PROBE_ERRORING_SELECTOR)?.status).toBe('error');

      // The pre-fix output looked like `JasperProbeTest debug: #testFails`
      // (the SUnit debug recipe). The post-fix output carries
      // `TestFailure: ...`. Either way it must not be a wrapper error.
      const failing = bySel.get(SUNIT_PROBE_FAILING_SELECTOR)!;
      expect(failing.message).not.toContain("Selector:  #'at:put:'");
      expect(failing.message).not.toContain('\0');
    });
  });

  describe('runFailingTests', () => {
    // The classNames path bypasses the discover-all branch; the no-args
    // path tests it. Round-2 had a CompileError on the no-args path
    // because the discover-all fragment had un-wrapped temps.
    it('with explicit classNames returns only failed/errored entries', () => {
      const results = runFailingTests(exec, [SUNIT_PROBE_TEST_CLASS]);
      const sels = new Set(results.map((r) => r.selector));
      expect(sels.has(SUNIT_PROBE_FAILING_SELECTOR)).toBe(true);
      expect(sels.has(SUNIT_PROBE_ERRORING_SELECTOR)).toBe(true);
      expect(sels.has(SUNIT_PROBE_PASSING_SELECTOR)).toBe(false);

      // None of the messages should be a Utf8 wrapper error or a NUL leak.
      for (const r of results) {
        expect(r.message).not.toContain("Selector:  #'at:put:'");
        expect(r.message).not.toContain("Selector:  #'copyFrom:to:'");
        expect(r.message).not.toContain('\0');
      }
    });

    it('with classNamePattern filters the discovered TestCase set', () => {
      const results = runFailingTests(exec, undefined, 'JasperProbe*');
      // Pattern matches our probe class. We expect both failures from it.
      const probeFailures = results.filter((r) => r.className === SUNIT_PROBE_TEST_CLASS);
      expect(probeFailures.length).toBeGreaterThanOrEqual(2);
    });

    // The no-args path walks every TestCase subclass in the symbolList
    // (DISCOVER_ALL_TEST_CLASSES) and runs each one's suite. We deliberately
    // do NOT exercise that end-to-end here — running the whole stone's suite
    // hangs the integration run (see discoverAllTestClasses.ts for why). The
    // round-2 and round-5 regressions both live in the discovery fragment, so
    // we test it directly: fast, bounded, and immune to a blocking image test.

    it('the discover-all fragment compiles and runs (the round-2 regression)', () => {
      // Round-2 was a CompileError ("expected a primary expression") from
      // un-wrapped temp declarations in expression position. Running the exact
      // production fragment proves it still compiles; a regression throws here.
      expect(() => discoverAllTestClasses(exec)).not.toThrow();
    });

    it('discovers our probe class among the TestCase subclasses', () => {
      // Confirms discovery returns a real, non-empty set (and sees our
      // installed fixture), so the dedup/abstract assertions below have teeth.
      const names = discoverAllTestClasses(exec).map((c) => c.name);
      expect(names).toContain(SUNIT_PROBE_TEST_CLASS);
    });

    // Round-5: duplicate (className, selector) pairs in the no-args output.
    // Root cause: an abstract TestCase's `suite` cascades into its concrete
    // subclasses, so when discover-all ALSO included those subclasses
    // directly, every leaf test ran twice. Fix: dedup the class set
    // (IdentitySet) and skip abstract classes. Both invariants live at the
    // discovery level — the duplicate *pairs* were just the downstream
    // symptom — so we assert them on the discovered set directly.
    it('discovers a deduped, abstract-free class set (the round-5 regression)', () => {
      const classes = discoverAllTestClasses(exec);

      const counts = new Map<string, number>();
      for (const c of classes) {
        counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
      }
      const dupes = [...counts.entries()].filter(([, n]) => n > 1);
      expect(dupes).toEqual([]);

      const abstract = classes.filter((c) => c.isAbstract).map((c) => c.name);
      expect(abstract).toEqual([]);
    });

    // The blocking-call guard (MAX_RUN_CLASSES) is NOT covered here. Asserting
    // it end-to-end means branching on the live image's size, and the
    // within-cap branch runs every discovered suite in one un-interruptible GCI
    // call — too slow for CI on some stones, and unkillable by a vitest
    // timeout. It's parked in the on-demand gci project
    // (src/__tests__/gci/querySunitRunLimit.smoke.test.ts) pending a redesign
    // that trips the guard deterministically; see that file's header.
  });

  describe('describeTestFailure', () => {
    it('returns structured fields for a TestFailure', () => {
      const details = describeTestFailure(
        exec,
        SUNIT_PROBE_TEST_CLASS,
        SUNIT_PROBE_FAILING_SELECTOR,
      );
      expect(details.status).toBe('failed');

      expect(details.exceptionClass).toBe('TestFailure');

      expect(details.messageText).toBeDefined();
      expect(details.messageText).not.toContain('\0');

      expect(details.stackReport).toBeDefined();
      expect(details.stackReport!.length).toBeGreaterThan(0);
      expect(details.stackReport).not.toContain('\0');
    });

    it('returns mnuReceiver and mnuSelector for a MessageNotUnderstood', () => {
      const details = describeTestFailure(
        exec,
        SUNIT_PROBE_TEST_CLASS,
        SUNIT_PROBE_ERRORING_SELECTOR,
      );
      expect(details.status).toBe('error');
      expect(details.exceptionClass).toBe('MessageNotUnderstood');
      expect(details.mnuSelector).toBe('doesNotUnderstandWHATEVER');
      expect(details.mnuReceiver).toBeDefined();
    });
  });
});
