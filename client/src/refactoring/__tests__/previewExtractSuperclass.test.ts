import { describe, it, expect, vi } from 'vitest';
import {
  analyzeExtractSuperclass,
  candidatesForExtractSuperclass,
  startExtractSuperclassPreview,
  pageExtractSuperclassPreview,
  applyExtractSuperclass,
  clearExtractSuperclassPreview,
} from '../queries/previewExtractSuperclass';

/**
 * Unit-tests the extract-superclass query builders: the Smalltalk they emit for the engine
 * class-side API (candidates / analysis / paginated preview / apply / clear), the sibling and
 * hoist-set array literals, name/selector escaping, and the nil-class decline guard. No GCI: the
 * executor is a spy returning a canned string.
 */

const lastCode = (spy: ReturnType<typeof vi.fn>): string =>
  spy.mock.calls[spy.mock.calls.length - 1][1] as string;

describe('extract-superclass query builders', () => {
  it('classifies members via candidatesForClass:siblings: with a sibling array', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await candidatesForExtractSuperclass(exec, 'Dog', ['Cat', 'Fish']);

    const code = lastCode(exec);
    expect(code).toContain('GsExtractSuperclassRefactoring candidatesForClass: cls siblings:');
    expect(code).toContain("#('Cat' 'Fish')");
  });

  it('guards the analysis with a nil-class decline envelope', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await analyzeExtractSuperclass(exec, 'Dog', 'Pet', [], { methods: [], instVars: [] });

    const code = lastCode(exec);
    expect(code).toContain('cls isNil ifTrue:');
    expect(code).toContain('"decline":"Class not found: Dog"');
    expect(code).toContain('analysisJsonString');
  });

  it('builds the extract send with sibling, method, and instance-variable arrays', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await analyzeExtractSuperclass(exec, 'Dog', 'Pet', ['Cat'], {
      methods: ['eat', 'name:'],
      instVars: ['name', 'age'],
    });

    const code = lastCode(exec);
    expect(code).toContain("extractSuperclassNamed: 'Pet'");
    expect(code).toContain("siblings: #('Cat')");
    expect(code).toContain("hoistMethods: #(#'eat' #'name:')");
    expect(code).toContain("hoistInstVars: #('name' 'age')");
  });

  it('starts a paginated preview under a token', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await startExtractSuperclassPreview(
      exec,
      'Dog',
      'Pet',
      [],
      { methods: [], instVars: [] },
      'tok',
      50000,
    );

    const code = lastCode(exec);
    expect(code).toContain("startPreviewToken: 'tok' maxBytes: 50000");
  });

  it('pages, applies (with an empty deselection), and clears by token', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await pageExtractSuperclassPreview(exec, 'tok', 5, 1000);
    await applyExtractSuperclass(exec, 'tok');
    const clearExec = vi.fn().mockReturnValue('ok');
    clearExtractSuperclassPreview(clearExec, 'tok');

    expect(exec.mock.calls[0][1]).toContain("pageForToken: 'tok' from: 5 maxBytes: 1000");
    expect(exec.mock.calls[1][1]).toContain("applyForToken: 'tok' deselected: #()");
    expect(clearExec.mock.calls[0][0]).toContain("clearToken: 'tok'");
  });

  it('escapes a quote in the new class name', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await analyzeExtractSuperclass(exec, 'Dog', "Pe't", [], { methods: [], instVars: [] });

    expect(lastCode(exec)).toContain("extractSuperclassNamed: 'Pe''t'");
  });
});
