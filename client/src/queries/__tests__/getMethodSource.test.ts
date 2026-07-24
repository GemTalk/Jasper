import { describe, it, expect, vi } from 'vitest';
import { getMethodSource } from '../getMethodSource';
import { QueryExecutor } from '../types';

describe('shared getMethodSource', () => {
  it('composes instance-side code without environmentId clause when env is 0', () => {
    const execute = vi.fn(() => 'printOn: aStream');
    const result = getMethodSource(execute, 'Array', false, 'printOn:');

    expect(execute).toHaveBeenCalledWith("(Array compiledMethodAt: #'printOn:') sourceString");
    expect(result).toBe('printOn: aStream');
  });

  it('composes class-side code via "<Class> class" receiver', () => {
    const execute = vi.fn(() => 'new ^super new');
    getMethodSource(execute, 'Array', true, 'new');

    expect(execute).toHaveBeenCalledWith("(Array class compiledMethodAt: #'new') sourceString");
  });

  it('includes environmentId clause when non-zero', () => {
    const execute = vi.fn(() => '');
    getMethodSource(execute, 'Array', false, 'size', 2);

    expect(execute).toHaveBeenCalledWith(
      "(Array compiledMethodAt: #'size' environmentId: 2) sourceString",
    );
  });

  it('escapes single quotes in selectors', () => {
    const execute = vi.fn(() => '');
    getMethodSource(execute, 'Array', false, "o'clock");

    expect(execute).toHaveBeenCalledWith("(Array compiledMethodAt: #'o''clock') sourceString");
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
    expect(execute.mock.calls[0][0]).toContain(
      "(System myUserProfile symbolList at: 1) at: #'object' ifAbsent: [nil]) class",
    );
  });
});
