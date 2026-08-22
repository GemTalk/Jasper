import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { GciLibrary } from '../gciLibrary';
import * as queries from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
import { useIntegrationTest } from './useIntegrationTest';
import { testActiveSession } from './testActiveSession';

/**
 * Pins the GemStone breakpoint semantics the breakpoint manager is built on,
 * against a live stone. Every one of these is a decision the design depends on
 * and none of them is documented anywhere we control:
 *
 * - `disableBreakAtStepPoint:` is a **no-op** when nothing is set at that step
 *   point, which is why a disabled breakpoint has to be applied as
 *   set-then-disable rather than disable alone.
 * - `setBreakAtStepPoint:` is also the **enable**; there is no separate enable
 *   primitive on the instance side.
 * - An out-of-range step point is **silently ignored**, not an error — so step
 *   points must be validated client-side or a breakpoint vanishes without a word.
 * - Breakpoints are **per-gem** state, outside the repository entirely: they are
 *   invisible to `commit` and, as this test's own `beforeEach` has to allow for,
 *   they survive a transaction **abort** too.
 * - `_allMethodBreakpoints`' tuple stride differs across releases (3 fields on
 *   3.6.2, 4 on 3.7.5), which is why `getAllBreakpoints` reads the kernel's own
 *   `_breakReport:` rather than decoding that primitive itself. These tests are
 *   the guard on that: they run against whichever stone CI provides.
 *
 * Ungated: needs only a running stone. The harness aborts afterward, so the
 * throwaway class never reaches the repository, and the breakpoints go away with
 * the session regardless.
 */
describe('GemStone breakpoint semantics (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);

  const TEST_CLASS = 'VsCodeBreakpointTest';
  const TEST_SELECTOR = 'vsCodeBreakpointFixture';

  /**
   * A method with several step points on purpose — `^a` at the end plus the
   * assignments and the send — so a test can tell one step point from another.
   */
  const fixture = (): void => {
    const defined = queries.compileClassDefinition(
      session(),
      `Object subclass: '${TEST_CLASS}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
    );
    expect(defined).toBe(TEST_CLASS);

    queries.compileMethod(
      session(),
      TEST_CLASS,
      false,
      'test-vscode-extension',
      `${TEST_SELECTOR}\n  | a |\n  a := 1.\n  a := a + 2.\n  ^ a printString`,
    );
    expect(queries.getAllSelectors(session(), TEST_CLASS)).toContain(TEST_SELECTOR);
  };

  /** Breakpoints on the fixture method only, so a shared stone can't confuse us. */
  const onFixture = () =>
    queries
      .getAllBreakpoints(session())
      .filter((b) => b.className === TEST_CLASS && b.selector === TEST_SELECTOR);

  const setBreak = (stepPoint: number) =>
    queries.setBreakAtStepPoint(session(), TEST_CLASS, false, TEST_SELECTOR, stepPoint);
  const disableBreak = (stepPoint: number) =>
    queries.disableBreakAtStepPoint(session(), TEST_CLASS, false, TEST_SELECTOR, stepPoint);
  const clearBreak = (stepPoint: number) =>
    queries.clearBreakAtStepPoint(session(), TEST_CLASS, false, TEST_SELECTOR, stepPoint);

  beforeEach(() => {
    // Sweep the whole gem, not just this method. Breakpoints are gem state, so
    // they survive the harness's per-test transaction abort — while the fixture
    // class is rolled back and rebuilt as a *new* class object each test. A
    // per-method clear would therefore miss the previous test's breakpoints,
    // which are still reported under the same class name and selector.
    queries.removeAllBreakpoints(session());
    fixture();
  });

  it('the fixture method has step points to break at', () => {
    const offsets = queries.getSourceOffsets(session(), TEST_CLASS, false, TEST_SELECTOR);
    expect(offsets.length).toBeGreaterThan(2);
    // _sourceOffsets is 1-based — the whole model converts on the way in.
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(1);
  });

  it('reports a breakpoint it just set, resolved back to the step point', () => {
    setBreak(1);
    const found = onFixture();
    expect(found).toHaveLength(1);
    expect(found[0].stepPoint).toBe(1);
    expect(found[0].disabled).toBe(false);
    expect(found[0].isMeta).toBe(false);
    expect(found[0].dictName).toBe('UserGlobals');
  });

  it('disableBreakAtStepPoint: does nothing when no breakpoint is set there', () => {
    // The reason a disabled breakpoint must be applied as set-then-disable.
    disableBreak(2);
    expect(onFixture()).toHaveLength(0);
  });

  it('set-then-disable leaves a breakpoint that is present but disabled', () => {
    setBreak(2);
    disableBreak(2);
    const found = onFixture();
    expect(found).toHaveLength(1);
    expect(found[0].stepPoint).toBe(2);
    expect(found[0].disabled).toBe(true);
  });

  it('setBreakAtStepPoint: re-enables a disabled breakpoint', () => {
    setBreak(2);
    disableBreak(2);
    expect(onFixture()[0].disabled).toBe(true);

    setBreak(2);
    const found = onFixture();
    expect(found).toHaveLength(1);
    expect(found[0].disabled).toBe(false);
  });

  it('clearBreakAtStepPoint: removes it outright', () => {
    setBreak(1);
    clearBreak(1);
    expect(onFixture()).toHaveLength(0);
  });

  it('clearAllBreaks drops every breakpoint on the method', () => {
    setBreak(1);
    setBreak(2);
    expect(onFixture()).toHaveLength(2);

    queries.clearAllBreaks(session(), TEST_CLASS, false, TEST_SELECTOR);
    expect(onFixture()).toHaveLength(0);
  });

  it('silently ignores an out-of-range step point', () => {
    // No error is raised, so nothing downstream can notice — which is why step
    // points are resolved against _sourceOffsets before they are ever sent.
    const offsets = queries.getSourceOffsets(session(), TEST_CLASS, false, TEST_SELECTOR);
    setBreak(offsets.length + 500);
    expect(onFixture()).toHaveLength(0);
  });

  it('reports several breakpoints on one method separately', () => {
    setBreak(1);
    setBreak(2);
    const found = onFixture().sort((a, b) => a.stepPoint - b.stepPoint);
    expect(found.map((b) => b.stepPoint)).toEqual([1, 2]);
  });

  it('session-wide disable turns off a breakpoint without removing it', () => {
    setBreak(1);
    queries.disableAllBreakpoints(session());
    const found = onFixture();
    expect(found).toHaveLength(1);
    expect(found[0].disabled).toBe(true);
  });

  it('session-wide enable turns a disabled breakpoint back on', () => {
    setBreak(1);
    queries.disableAllBreakpoints(session());
    queries.enableAllBreakpoints(session());
    expect(onFixture()[0].disabled).toBe(false);
  });

  it('session-wide remove clears the gem', () => {
    setBreak(1);
    setBreak(2);
    queries.removeAllBreakpoints(session());
    expect(onFixture()).toHaveLength(0);
    expect(queries.hasBreakpoints(session())).toBe(false);
  });

  it('hasBreakpoints tracks whether the gem holds any', () => {
    queries.removeAllBreakpoints(session());
    expect(queries.hasBreakpoints(session())).toBe(false);

    setBreak(1);
    expect(queries.hasBreakpoints(session())).toBe(true);
  });

  it('reaches a breakpoint by method OOP, the way a doit has to be reached', () => {
    setBreak(1);
    const oop = onFixture()[0].methodOop;
    expect(oop).toMatch(/^\d+$/);

    queries.breakpointByOop(session(), oop, 'disableBreakAtStepPoint:', 1);
    expect(onFixture()[0].disabled).toBe(true);

    queries.breakpointByOop(session(), oop, 'clearBreakAtStepPoint:', 1);
    expect(onFixture()).toHaveLength(0);
  });

  it('reports a class-side breakpoint as isMeta with the base class name', () => {
    queries.compileMethod(
      session(),
      TEST_CLASS,
      true,
      'test-vscode-extension',
      'vsCodeBreakpointClassSide\n  ^ 3 + 4',
    );
    queries.setBreakAtStepPoint(session(), TEST_CLASS, true, 'vsCodeBreakpointClassSide', 1);

    const found = queries
      .getAllBreakpoints(session())
      .filter((b) => b.className === TEST_CLASS && b.selector === 'vsCodeBreakpointClassSide');
    expect(found).toHaveLength(1);
    expect(found[0].isMeta).toBe(true);
    // The base name, not 'VsCodeBreakpointTest class' — the manager matches it
    // against a method URI's className, which is always the base.
    expect(found[0].className).toBe(TEST_CLASS);
  });
});
