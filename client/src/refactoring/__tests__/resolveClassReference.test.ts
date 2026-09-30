import { describe, it, expect, vi } from 'vitest';
import { resolveClassReference } from '../queries/resolveClassReference';

/**
 * Unit-tests the class-reference resolver: it resolves a name across the whole
 * symbol list, answers it only when it names a Class, and reports the SymbolList
 * index binding it. No GCI: the executor is a spy returning a canned string.
 */

describe('class-reference resolver query', () => {
  it('parses the class name and its binding dictionary index', async () => {
    const exec = vi.fn().mockReturnValue('Path\n2');

    expect(await resolveClassReference(exec, 'Path')).toEqual({ className: 'Path', dictIndex: 2 });
  });

  it('resolves unscoped across the whole symbol list and requires a Class', async () => {
    const exec = vi.fn().mockReturnValue('Path\n2');

    await resolveClassReference(exec, 'Path');

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('symbolList objectNamed:');
    expect(code).toContain('isKindOf: Class');
  });

  it('reports index 0 when the class is not bound by its own name', async () => {
    const exec = vi.fn().mockReturnValue('Path\n0');

    expect(await resolveClassReference(exec, 'Path')).toEqual({ className: 'Path', dictIndex: 0 });
  });

  it('answers undefined when the name is not a class (a plain global or unbound)', async () => {
    const exec = vi.fn().mockReturnValue('');

    expect(await resolveClassReference(exec, 'Transcript')).toBeUndefined();
  });

  it("escapes a quote in the name so the probe can't be broken out of", async () => {
    const exec = vi.fn().mockReturnValue('');

    await resolveClassReference(exec, "od'd");

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("objectNamed: 'od''d' asSymbol");
  });
});
