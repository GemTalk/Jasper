import { describe, it, expect, vi } from 'vitest';
import { resolveClassReference } from '../queries/resolveClassReference';

/**
 * Unit-tests the class-reference resolver: it resolves a name across the whole
 * symbol list, answers it only when it names a Class, and reports the SymbolList
 * index binding it. No GCI: the executor is a spy returning a canned string.
 */

describe('class-reference resolver query', () => {
  it('parses the class name and its binding dictionary index', () => {
    const exec = vi.fn().mockReturnValue('Path\n2');

    expect(resolveClassReference(exec, 'Path')).toEqual({ className: 'Path', dictIndex: 2 });
  });

  it('resolves unscoped across the whole symbol list and requires a Class', () => {
    const exec = vi.fn().mockReturnValue('Path\n2');

    resolveClassReference(exec, 'Path');

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('symbolList objectNamed:');
    expect(code).toContain('isKindOf: Class');
  });

  it('reports index 0 when the class is not bound by its own name', () => {
    const exec = vi.fn().mockReturnValue('Path\n0');

    expect(resolveClassReference(exec, 'Path')).toEqual({ className: 'Path', dictIndex: 0 });
  });

  it('answers undefined when the name is not a class (a plain global or unbound)', () => {
    const exec = vi.fn().mockReturnValue('');

    expect(resolveClassReference(exec, 'Transcript')).toBeUndefined();
  });

  it("escapes a quote in the name so the probe can't be broken out of", () => {
    const exec = vi.fn().mockReturnValue('');

    resolveClassReference(exec, "od'd");

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("objectNamed: 'od''d' asSymbol");
  });
});
