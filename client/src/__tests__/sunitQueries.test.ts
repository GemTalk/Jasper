import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as sunit from '../sunitQueries';

function createMockSession(executeFetchData = ''): ActiveSession {
  const mockGci = {
    executeAndFetchString: vi.fn(() => executeFetchData),
    GciTsCallInProgress: vi.fn(() => ({ result: 0 })),
  };

  return {
    id: 1,
    gci: mockGci as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
}

describe('sunitQueries', () => {
  describe('discoverTestClasses', () => {
    it('parses tab-separated dictName/className/testCount rows', () => {
      const session = createMockSession('UserGlobals\tMyTestCase\t7\nGlobals\tOtherTest\t19\n');
      const results = sunit.discoverTestClasses(session);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        dictName: 'UserGlobals',
        className: 'MyTestCase',
        testCount: 7,
      });
      expect(results[1]).toEqual({ dictName: 'Globals', className: 'OtherTest', testCount: 19 });
    });

    it('emits the per-class test count from the query', () => {
      const session = createMockSession('');
      sunit.discoverTestClasses(session);
      const code = (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(code).toContain('testSelectors size');
    });

    it('keeps a genuine zero count distinct from a missing one', () => {
      const session = createMockSession('UserGlobals\tEmptyTest\t0\n');
      const results = sunit.discoverTestClasses(session);
      expect(results[0].testCount).toBe(0);
    });

    it('parses a bad/missing/negative test count as null (never negative or NaN)', () => {
      const session = createMockSession(
        'A\tMissing\t\n' + // empty count field
          'B\tNonNumeric\tabc\n' + // not a number
          'C\tNegative\t-5\n' + // negative (impossible for a real count)
          'D\tFraction\t3.9\n', // non-integer
      );
      const results = sunit.discoverTestClasses(session);
      expect(results.map((r) => r.testCount)).toEqual([null, null, null, null]);
    });

    it('parses the dictionary index so callers can build ?dict=N URIs', () => {
      const session = createMockSession('UserGlobals\tMyTestCase\t7\t3\n');
      expect(sunit.discoverTestClasses(session)[0].dictIndex).toBe(3);
    });

    it('leaves the dictionary index undefined when the stone sends no usable one', () => {
      const session = createMockSession(
        'A\tMissing\t1\t\n' + // empty index field
          'B\tNonNumeric\t1\tabc\n' + // not a number
          'C\tZero\t1\t0\n', // 0 — SymbolList indexes are 1-based
      );
      const results = sunit.discoverTestClasses(session);
      expect(results.map((r) => r.dictIndex)).toEqual([undefined, undefined, undefined]);
    });

    it('reads the dictionary index from the symbol list position', () => {
      const session = createMockSession('');
      sunit.discoverTestClasses(session);
      const code = (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(code).toContain('1 to: sl size do:');
    });

    it('returns empty array when no test classes exist', () => {
      const session = createMockSession('');
      expect(sunit.discoverTestClasses(session)).toEqual([]);
    });

    it('executes Smalltalk code that finds TestCase subclasses', () => {
      const session = createMockSession('');
      sunit.discoverTestClasses(session);
      const code = (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(code).toContain('TestCase');
      expect(code).toContain('isSubclassOf');
    });
  });

  describe('discoverTestMethods', () => {
    it('parses selector and category', () => {
      const session = createMockSession('testAdd\tunit tests\ntestRemove\ttesting\n');
      const results = sunit.discoverTestMethods(session, 'MyTestCase');
      expect(results).toEqual([
        { selector: 'testAdd', category: 'unit tests' },
        { selector: 'testRemove', category: 'testing' },
      ]);
    });

    it('returns empty array when no test methods', () => {
      const session = createMockSession('');
      expect(sunit.discoverTestMethods(session, 'MyTestCase')).toEqual([]);
    });

    it('handles missing category gracefully', () => {
      const session = createMockSession('testFoo\t\n');
      const results = sunit.discoverTestMethods(session, 'MyTestCase');
      expect(results).toEqual([{ selector: 'testFoo', category: '' }]);
    });

    // Run for both dictionaries of the duplicate-name case: the dict is a
    // pure passthrough into the lookup, so this is symmetry coverage, and it
    // also pins the nil-guard that protects against a missing class.
    it.each(['UserGlobals', 'Globals'])(
      'resolves the class dictionary-scoped (%s) and guards a missing class',
      (dict) => {
        const session = createMockSession('');
        sunit.discoverTestMethods(session, 'AnnouncerTest', dict);
        const code = (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock
          .calls[0][1];
        expect(code).toContain(`objectNamed: #'${dict}'`);
        expect(code).toContain("at: #'AnnouncerTest'");
        expect(code).toContain('cls isNil ifTrue:');
        // Methods are read off the resolved class, not a bare-name receiver.
        expect(code).toContain('cls testSelectors');
      },
    );
  });

  describe('runTestMethod', () => {
    it('parses a passing test result', () => {
      const session = createMockSession('passed\t\t42');
      const result = sunit.runTestMethod(session, 'MyTestCase', 'testAdd');
      expect(result).toEqual({
        className: 'MyTestCase',
        selector: 'testAdd',
        status: 'passed',
        message: '',
        durationMs: 42,
      });
    });

    it('parses a failed test result', () => {
      const session = createMockSession('failed\tExpected 3 but got 4\t15');
      const result = sunit.runTestMethod(session, 'MyTestCase', 'testAdd');
      expect(result).toEqual({
        className: 'MyTestCase',
        selector: 'testAdd',
        status: 'failed',
        message: 'Expected 3 but got 4',
        durationMs: 15,
      });
    });

    it('parses an error test result', () => {
      const session = createMockSession('error\tMessageNotUnderstood: #foo\t8');
      const result = sunit.runTestMethod(session, 'MyTestCase', 'testBad');
      expect(result).toEqual({
        className: 'MyTestCase',
        selector: 'testBad',
        status: 'error',
        message: 'MessageNotUnderstood: #foo',
        durationMs: 8,
      });
    });

    it('handles malformed response gracefully', () => {
      const session = createMockSession('');
      const result = sunit.runTestMethod(session, 'MyTestCase', 'testBad');
      expect(result.status).toBe('error');
      expect(result.durationMs).toBe(0);
    });

    // Round-3 fix: bypass `testCase run` and run setUp / perform / tearDown
    // manually with our own AbstractException handler, so the message column
    // carries the live exception's class + messageText (not the SUnit
    // post-run debug recipe). Build through a String-class WriteStream and
    // call encodeAsUTF8 at the boundary; that's the canonical GemStone pattern
    // for "internal storage → transfer protocol."
    it('captures live exception class + messageText (no testCase run framework)', () => {
      const session = createMockSession('');
      sunit.runTestMethod(session, 'MyTestCase', 'testBad');
      const code = (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(code).toContain('on: AbstractException');
      expect(code).toContain('testCase setUp');
      expect(code).toContain('testCase perform:');
      expect(code).toContain('testCase tearDown');
      expect(code).toContain('captured class name');
      expect(code).toContain('captured messageText');
      expect(code).toContain('WriteStream on: Unicode7 new');
      expect(code).toContain('encodeAsUTF8');
      // Negative guards: every prior misfire must stay out.
      expect(code).not.toMatch(/result := testCase run\b/);
      expect(code).not.toContain('WriteStream on: Utf8 new');
      expect(code).not.toContain('asInteger < 128');
    });

    it.each(['UserGlobals', 'Globals'])(
      'resolves dictionary-scoped (%s) and raises if the class is absent there',
      (dict) => {
        const session = createMockSession('passed\t\t1');
        sunit.runTestMethod(session, 'AnnouncerTest', 'testFoo', dict);
        const code = (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock
          .calls[0][1];
        expect(code).toContain(`objectNamed: #'${dict}'`);
        expect(code).toContain("at: #'AnnouncerTest'");
        expect(code).toContain('cls isNil ifTrue:');
        // The test instance is built from the resolved class, not a bare name.
        expect(code).toContain('cls selector:');
      },
    );
  });

  describe('runTestClass', () => {
    it('parses multiple test results', () => {
      const payload =
        [
          'MyTestCase\ttestAdd\tpassed\t',
          'MyTestCase\ttestRemove\tfailed\tAssert failed',
          'MyTestCase\ttestBad\terror\tMessageNotUnderstood',
        ].join('\n') + '\n';
      const session = createMockSession(payload);
      const results = sunit.runTestClass(session, 'MyTestCase');
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({
        className: 'MyTestCase',
        selector: 'testAdd',
        status: 'passed',
        message: '',
        durationMs: 0,
      });
      expect(results[1]).toEqual({
        className: 'MyTestCase',
        selector: 'testRemove',
        status: 'failed',
        message: 'Assert failed',
        durationMs: 0,
      });
      expect(results[2]).toEqual({
        className: 'MyTestCase',
        selector: 'testBad',
        status: 'error',
        message: 'MessageNotUnderstood',
        durationMs: 0,
      });
    });

    it('returns empty array when no results', () => {
      const session = createMockSession('');
      expect(sunit.runTestClass(session, 'MyTestCase')).toEqual([]);
    });

    // Bug guard: probe of GemStone's SUnit revealed that `result failures`
    // and `result errors` contain TestCase instances (only `testSelector`
    // ivar) — they don't respond to `#testCase`. The query must not send it
    // (would silently DNU on real failures).
    it('does not send #testCase to failure/error wrappers', () => {
      const session = createMockSession('');
      sunit.runTestClass(session, 'MyTestCase');
      const code = (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(code).not.toMatch(/testCase\s+class\s+name/);
      expect(code).not.toMatch(/testCase\s+selector/);
    });

    // Round-3 fix: failures and errors trigger a per-test re-run with our
    // own AbstractException handler so the message column carries the live
    // exception's class + messageText, not `each printString` (the SUnit
    // debug recipe). Passed tests don't re-run.
    it('captures live exception class + messageText for failures and errors via re-run', () => {
      const session = createMockSession('');
      sunit.runTestClass(session, 'MyTestCase');
      const code = (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(code).toContain('captureMessage');
      expect(code).toContain('on: AbstractException');
      expect(code).toContain('t setUp');
      expect(code).toContain('t perform: t selector');
      expect(code).toContain('t tearDown');
      expect(code).toContain('captured class name');
      expect(code).toContain('captured messageText');
      expect(code).toContain('WriteStream on: Unicode7 new');
      expect(code).toContain('encodeAsUTF8');
      // Negative guards: the old printString-of-the-test fallback must
      // not survive (round-3 feedback called it out as the SUnit debug
      // recipe leaking), nor should either of the prior misfires.
      expect(code).not.toMatch(/each printString copyFrom:/);
      expect(code).not.toContain('WriteStream on: Utf8 new');
      expect(code).not.toContain('asInteger < 128');
    });

    it('runs the suite of the dictionary-scoped class, not a bare name', () => {
      const session = createMockSession('');
      sunit.runTestClass(session, 'AnnouncerTest', 'Globals');
      const code = (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(code).toContain("objectNamed: #'Globals'");
      expect(code).toContain("at: #'AnnouncerTest'");
      expect(code).toContain('suite := cls suite');
      expect(code).toContain('cls isNil ifTrue:');
      // Must NOT send `suite` to a bare class-name receiver.
      expect(code).not.toMatch(/suite := AnnouncerTest suite/);
    });

    it('falls back to bare-name lookup when no dictionary is given', () => {
      const session = createMockSession('');
      sunit.runTestClass(session, 'MyTestCase');
      const code = (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(code).toContain("objectNamed: #'MyTestCase'");
    });
  });

  describe('runFailingTests', () => {
    it('parses failed/errored tab-separated rows', () => {
      const session = createMockSession(
        'MyTestCase\ttestFails\tfailed\tTestFailure: nope\n' +
          'MyTestCase\ttestBad\terror\tMessageNotUnderstood: boom\n',
      );
      const results = sunit.runFailingTests(session);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        className: 'MyTestCase',
        selector: 'testFails',
        status: 'failed',
        message: 'TestFailure: nope',
        durationMs: 0,
      });
      expect(results[1].status).toBe('error');
    });

    // Blocking-call guard: the GCI executor holds the session for the entire
    // doit, so an unbounded suite — most dangerously the no-args path, which on
    // a full image is hundreds of base-library TestCases — can wedge a live
    // session. The query must refuse oversized selections in Smalltalk *before*
    // running any suite, on every selection path (an explicit list or a wide
    // glob can be just as large as discover-all).
    const lastCode = (session: ActiveSession) =>
      (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;

    it.each<[string, (s: ActiveSession) => void]>([
      ['no-args (discover-all)', (s) => sunit.runFailingTests(s)],
      ['explicit classNames', (s) => sunit.runFailingTests(s, ['A', 'B'])],
      ['classNamePattern', (s) => sunit.runFailingTests(s, undefined, 'Foo*')],
    ])('caps the number of classes run in one call (%s)', (_label, run) => {
      const session = createMockSession('');
      run(session);
      const code = lastCode(session);
      expect(code).toContain('classes size > 100');
      expect(code).toContain('Error signal:');
      // The guard must precede the suite-running loop, or it can't prevent the
      // wedge it exists to stop.
      expect(code.indexOf('classes size > 100')).toBeLessThan(code.indexOf('cls suite run'));
    });
  });

  describe('error handling', () => {
    it('throws SunitQueryError on GCI error', () => {
      const session = createMockSession('');
      (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('TestCase not found');
      });
      expect(() => sunit.discoverTestClasses(session)).toThrow('TestCase not found');
    });

    it('throws SunitQueryError when session is busy', () => {
      const session = createMockSession('');
      (session.gci.GciTsCallInProgress as ReturnType<typeof vi.fn>).mockReturnValue({ result: 1 });
      expect(() => sunit.discoverTestClasses(session)).toThrow('Session is busy');
    });
  });
});
