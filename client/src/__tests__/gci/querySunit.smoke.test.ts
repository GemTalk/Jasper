// Smoke tests for the SUnit-family queries against a live stone.
//
// Covers `runTestMethod`, `runTestClass`, `runFailingTests`, and
// `describeTestFailure`. Every one of these tools went through at least one
// round of "the unit tests passed but the live tool didn't work" — the
// `each testCase` DNU bug, the Utf8 stream growth failure, the missing
// `asUtf8` selector. With a real session, the test that proves the tool
// works is "ask it about a known fixture and check the output."

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runTestMethod } from '../../queries/runTestMethod';
import { runTestClass } from '../../queries/runTestClass';
import {
  runFailingTests,
  DISCOVER_ALL_TEST_CLASSES,
  MAX_RUN_CLASSES,
} from '../../queries/runFailingTests';
import { describeTestFailure } from '../../queries/describeTestFailure';
import { splitLines } from '../../queries/util';
import { QueryExecutor } from '../../queries/types';
import { HarnessSession, login } from './queryHarness';
import {
  installProbeFixture,
  uninstallProbeFixture,
  PROBE_TEST_CLASS,
  PROBE_PASSING_SELECTOR,
  PROBE_FAILING_SELECTOR,
  PROBE_ERRORING_SELECTOR,
} from './probeFixture';

// Run the production discover-all fragment and return one row per discovered
// TestCase subclass — the exact class set the no-args path of runFailingTests
// feeds to `suite run`. Exercising it directly lets the round-2 (compiles) and
// round-5 (deduped + abstract-free) regressions be tested WITHOUT running the
// entire image's SUnit suite. That full run is the wrong tool for a smoke test:
// it's unbounded, grows as the image gains tests, and — because the GCI
// executor is a synchronous blocking call — can't be interrupted by a vitest
// timeout, so a single slow or blocking image test hangs the whole run.
function discoverAllTestClasses(exec: QueryExecutor): { name: string; isAbstract: boolean }[] {
  const code = `| classes ws |
classes := ${DISCOVER_ALL_TEST_CLASSES}.
ws := WriteStream on: Unicode7 new.
classes do: [:c |
  ws nextPutAll: c name; tab; nextPutAll: c isAbstract printString; lf].
ws contents encodeAsUTF8`;
  return splitLines(exec(code)).map((line) => {
    const [name, isAbstract] = line.split('\t');
    return { name: name || '', isAbstract: isAbstract === 'true' };
  });
}

describe('SUnit queries (live GCI)', () => {
  let s: HarnessSession;

  beforeAll(() => {
    s = login();
    installProbeFixture(s.exec);
  });
  afterAll(() => {
    if (s) {
      try {
        uninstallProbeFixture(s.exec);
      } catch {
        /* keep going */
      }
      s.logout();
    }
  });

  describe('runTestMethod', () => {
    // Round-1 (round-3-revisited) ask: the message column on a failing
    // test should carry the live exception text, not the SUnit debug
    // recipe. The probe's `testFails` does `self assert: 1 = 2`, so we
    // expect a TestFailure with an "Assertion failed"-style messageText.
    it('reports the live exception class and messageText for a failing test', () => {
      const result = runTestMethod(s.exec, PROBE_TEST_CLASS, PROBE_FAILING_SELECTOR);
      expect(result.status).toBe('failed');
      expect(result.message).toContain('TestFailure');
      // The classic round-3 regression: every failing test came back as
      // "Receiver: anUtf8(). Selector: #'at:put:'". Pin its absence.
      expect(result.message).not.toContain("Selector:  #'at:put:'");
      expect(result.message).not.toContain('\0');
    });

    it('reports MessageNotUnderstood with the bad selector for an erroring test', () => {
      const result = runTestMethod(s.exec, PROBE_TEST_CLASS, PROBE_ERRORING_SELECTOR);
      expect(result.status).toBe('error');
      expect(result.message).toContain('MessageNotUnderstood');
      expect(result.message).toContain('doesNotUnderstandWHATEVER');
      expect(result.message).not.toContain('\0');
    });

    it('reports a passing test with no message', () => {
      const result = runTestMethod(s.exec, PROBE_TEST_CLASS, PROBE_PASSING_SELECTOR);
      expect(result.status).toBe('passed');
      expect(result.message).toBe('');
    });
  });

  describe('runTestClass', () => {
    it('reports per-method results for the probe class', () => {
      const results = runTestClass(s.exec, PROBE_TEST_CLASS);
      const bySel = new Map(results.map((r) => [r.selector, r]));

      expect(bySel.get(PROBE_PASSING_SELECTOR)?.status).toBe('passed');
      expect(bySel.get(PROBE_FAILING_SELECTOR)?.status).toBe('failed');
      expect(bySel.get(PROBE_ERRORING_SELECTOR)?.status).toBe('error');

      // The pre-fix output looked like `JasperProbeTest debug: #testFails`
      // (the SUnit debug recipe). The post-fix output carries
      // `TestFailure: ...`. Either way it must not be a wrapper error.
      const failing = bySel.get(PROBE_FAILING_SELECTOR)!;
      expect(failing.message).not.toContain("Selector:  #'at:put:'");
      expect(failing.message).not.toContain('\0');
    });
  });

  describe('runFailingTests', () => {
    // The classNames path bypasses the discover-all branch; the no-args
    // path tests it. Round-2 had a CompileError on the no-args path
    // because the discover-all fragment had un-wrapped temps.
    it('with explicit classNames returns only failed/errored entries', () => {
      const results = runFailingTests(s.exec, [PROBE_TEST_CLASS]);
      const sels = new Set(results.map((r) => r.selector));
      expect(sels.has(PROBE_FAILING_SELECTOR)).toBe(true);
      expect(sels.has(PROBE_ERRORING_SELECTOR)).toBe(true);
      expect(sels.has(PROBE_PASSING_SELECTOR)).toBe(false);

      // None of the messages should be a Utf8 wrapper error or a NUL leak.
      for (const r of results) {
        expect(r.message).not.toContain("Selector:  #'at:put:'");
        expect(r.message).not.toContain("Selector:  #'copyFrom:to:'");
        expect(r.message).not.toContain('\0');
      }
    });

    it('with classNamePattern filters the discovered TestCase set', () => {
      const results = runFailingTests(s.exec, undefined, 'JasperProbe*');
      // Pattern matches our probe class. We expect both failures from it.
      const probeFailures = results.filter((r) => r.className === PROBE_TEST_CLASS);
      expect(probeFailures.length).toBeGreaterThanOrEqual(2);
    });

    // The no-args path walks every TestCase subclass in the symbolList
    // (DISCOVER_ALL_TEST_CLASSES) and runs each one's suite. We deliberately
    // do NOT exercise that end-to-end here — running the whole stone's suite
    // hangs the smoke run (see discoverAllTestClasses above for why). The
    // round-2 and round-5 regressions both live in the discovery fragment, so
    // we test it directly: fast, bounded, and immune to a blocking image test.

    it('the discover-all fragment compiles and runs (the round-2 regression)', () => {
      // Round-2 was a CompileError ("expected a primary expression") from
      // un-wrapped temp declarations in expression position. Running the exact
      // production fragment proves it still compiles; a regression throws here.
      expect(() => discoverAllTestClasses(s.exec)).not.toThrow();
    });

    it('discovers our probe class among the TestCase subclasses', () => {
      // Confirms discovery returns a real, non-empty set (and sees our
      // installed fixture), so the dedup/abstract assertions below have teeth.
      const names = discoverAllTestClasses(s.exec).map((c) => c.name);
      expect(names).toContain(PROBE_TEST_CLASS);
    });

    // Round-5: duplicate (className, selector) pairs in the no-args output.
    // Root cause: an abstract TestCase's `suite` cascades into its concrete
    // subclasses, so when discover-all ALSO included those subclasses
    // directly, every leaf test ran twice. Fix: dedup the class set
    // (IdentitySet) and skip abstract classes. Both invariants live at the
    // discovery level — the duplicate *pairs* were just the downstream
    // symptom — so we assert them on the discovered set directly.
    it('discovers a deduped, abstract-free class set (the round-5 regression)', () => {
      const classes = discoverAllTestClasses(s.exec);

      const counts = new Map<string, number>();
      for (const c of classes) {
        counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
      }
      const dupes = [...counts.entries()].filter(([, n]) => n > 1);
      expect(dupes).toEqual([]);

      const abstract = classes.filter((c) => c.isAbstract).map((c) => c.name);
      expect(abstract).toEqual([]);
    });

    // The blocking-call guard, end-to-end. The no-args path runs every
    // discovered TestCase subclass through one synchronous, un-interruptible
    // GCI call — before the cap, THIS is the call that ran the entire image and
    // hung the smoke run. Correct behavior depends on image size, so the test
    // asks the live stone how many classes there are and checks the matching
    // guarantee: a large image (over the cap) must fail fast with a "narrow it"
    // error rather than wedge the session; a small image (within the cap, e.g.
    // a freshly provisioned test stone) simply runs what's there and returns
    // results.
    it('limits how many test classes a single run executes', () => {
      const classCount = discoverAllTestClasses(s.exec).length;

      if (classCount > MAX_RUN_CLASSES) {
        expect(() => runFailingTests(s.exec)).toThrow(/too many to run|Narrow the run/);
      } else {
        const results = runFailingTests(s.exec);

        expect(Array.isArray(results)).toBe(true);
      }
    });
  });

  describe('describeTestFailure', () => {
    it('returns structured fields for a TestFailure', () => {
      const details = describeTestFailure(s.exec, PROBE_TEST_CLASS, PROBE_FAILING_SELECTOR);
      expect(details.status).toBe('failed');
      expect(details.exceptionClass).toBe('TestFailure');
      expect(details.messageText).toBeDefined();
      expect(details.messageText).not.toContain('\0');
    });

    it('returns mnuReceiver and mnuSelector for a MessageNotUnderstood', () => {
      const details = describeTestFailure(s.exec, PROBE_TEST_CLASS, PROBE_ERRORING_SELECTOR);
      expect(details.status).toBe('error');
      expect(details.exceptionClass).toBe('MessageNotUnderstood');
      expect(details.mnuSelector).toBe('doesNotUnderstandWHATEVER');
      expect(details.mnuReceiver).toBeDefined();
    });

    // GemExceptionSignalCapturesStack is toggled inside the query and
    // restored. Stack capture is non-deterministic across GS versions, so
    // we only assert on shape: stackReport is either present and non-empty
    // or absent (the toggle wasn't honored on this stone).
    it('includes a stackReport when the gem-config toggle is honored', () => {
      const details = describeTestFailure(s.exec, PROBE_TEST_CLASS, PROBE_FAILING_SELECTOR);
      if (details.stackReport !== undefined) {
        expect(details.stackReport.length).toBeGreaterThan(0);
        expect(details.stackReport).not.toContain('\0');
      }
    });
  });
});
