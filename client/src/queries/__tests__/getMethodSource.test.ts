import { describe, it, expect, vi } from 'vitest';
import { getMethodSource } from '../getMethodSource';
import { QueryExecutor } from '../types';

describe('shared getMethodSource', () => {
  it('composes instance-side code without environmentId clause when env is 0', () => {
    const execute = vi.fn<QueryExecutor>(() => 'printOn: aStream');
    const result = getMethodSource(execute, 'Array', false, 'printOn:');

    const [code] = execute.mock.calls[0];
    expect(code).toContain("symbolList objectNamed: #'Array'");
    expect(code).toContain("cls compiledMethodAt: #'printOn:' otherwise: nil");
    expect(code).not.toContain('environmentId:');
    expect(code).toContain('m sourceString');
    expect(result).toBe('printOn: aStream');
  });

  it('composes class-side code via "<Class> class" receiver', () => {
    const execute = vi.fn<QueryExecutor>(() => 'new ^super new');
    getMethodSource(execute, 'Array', true, 'new');

    expect(execute.mock.calls[0][0]).toContain("cls class compiledMethodAt: #'new'");
  });

  it('includes environmentId clause when non-zero', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getMethodSource(execute, 'Array', false, 'size', 2);

    expect(execute.mock.calls[0][0]).toContain(
      "compiledMethodAt: #'size' environmentId: 2 otherwise: nil",
    );
  });

  it('escapes single quotes in selectors', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getMethodSource(execute, 'Array', false, "o'clock");

    expect(execute.mock.calls[0][0]).toContain("compiledMethodAt: #'o''clock'");
  });

  /**
   * A class can go between the moment a tab is opened and the moment VS Code
   * reads it — an abort discarding the transaction that defined it, or another
   * session removing it. Unguarded, `compiledMethodAt:` went to the nil the
   * lookup answered and raised into the GCI log with nothing in the UI to say so.
   */
  it('answers nothing rather than sending to a class that is gone', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getMethodSource(execute, 'Ghost', false, 'balance', 0, 1);

    const [code] = execute.mock.calls[0];
    expect(code).toContain("cls ifNil: [^ '']");
  });

  /**
   * Even unscoped, the class is resolved through the symbol list rather than
   * named directly. A bare class name is resolved by the COMPILER, so an unbound
   * one fails as `CompileError 1001, undefined symbol` before the doit runs —
   * which the guard cannot catch, because there is nothing to run. Caught by
   * browserQueries.integration.test.ts against a real stone.
   */
  it('resolves an unscoped class through the symbol list, not as a bare name', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getMethodSource(execute, 'Ghost', false, 'balance');

    const [code] = execute.mock.calls[0];
    expect(code).toContain("symbolList objectNamed: #'Ghost'");
    expect(code).toContain("cls ifNil: [^ '']");
  });

  it('answers nothing for a class that no longer implements the selector', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getMethodSource(execute, 'Account', false, 'gone');

    const [code] = execute.mock.calls[0];
    // `otherwise: nil` rather than a raise, then a nil check before sourceString.
    expect(code).toContain('otherwise: nil');
    expect(code).toContain("m ifNil: [^ '']");
  });

  it('propagates the executor return value unchanged', () => {
    const execute = vi.fn(() => 'abc\n\ndef');
    expect(getMethodSource(execute, 'X', false, 'y')).toBe('abc\n\ndef');
  });

  it('scopes the receiver to a SymbolList index when a dict is given', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getMethodSource(execute, 'object', false, 'printString', 0, 1);

    const [code] = execute.mock.calls[0];
    expect(code).toContain("(System myUserProfile symbolList at: 1) at: #'object' ifAbsent: [nil]");
    expect(code).toContain("compiledMethodAt: #'printString'");
  });

  it('scopes the class-side receiver to a SymbolList index', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getMethodSource(execute, 'object', true, 'new', 0, 1);
    const [code] = execute.mock.calls[0];
    expect(code).toContain("(System myUserProfile symbolList at: 1) at: #'object' ifAbsent: [nil]");
    expect(code).toContain('cls class compiledMethodAt:');
  });
});
