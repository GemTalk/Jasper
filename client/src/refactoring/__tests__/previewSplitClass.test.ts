import { describe, it, expect, vi } from 'vitest';
import {
  analyzeSplitClass,
  candidatesForSplitClass,
  startSplitClassPreview,
  pageSplitClassPreview,
  applySplitClass,
  clearSplitClassPreview,
} from '../queries/previewSplitClass';

/**
 * Unit-tests the split-class query builders: the Smalltalk they emit for the engine class-side API
 * (candidates / analysis / paginated preview / apply / clear), the dict-scoped class lookup, the
 * extract-set instance-variable array literal, name escaping, and the nil-class decline guard. No
 * GCI: the executor is a spy returning a canned string.
 */

const lastCode = (spy: ReturnType<typeof vi.fn>): string =>
  spy.mock.calls[spy.mock.calls.length - 1][1] as string;

describe('split-class query builders', () => {
  it('reads candidates via a dict-scoped class lookup and candidatesForClass:', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await candidatesForSplitClass(exec, 'Person', 3);

    const code = lastCode(exec);
    // Dict-scoped lookup (SymbolList index) via classLookupExpr.
    expect(code).toContain('at: 3');
    expect(code).toContain('GsSplitClassRefactoring candidatesForClass: cls');
    expect(code).toContain('cls isNil ifTrue:');
  });

  it('guards the analysis with a nil-class decline envelope and builds the split send', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await analyzeSplitClass(exec, 'Person', 'Address', ['street', 'city']);

    const code = lastCode(exec);
    expect(code).toContain('cls isNil ifTrue:');
    expect(code).toContain('"decline":"Class not found: Person"');
    expect(code).toContain('GsSplitClassRefactoring class: cls splitIntoClassNamed:');
    expect(code).toContain("splitIntoClassNamed: 'Address'");
    expect(code).toContain("extractingInstVars: #('street' 'city')");
    expect(code).toContain('analysisJsonString');
  });

  it('starts a paginated preview under a token, guarded by the nil-class decline', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await startSplitClassPreview(exec, 'Person', 'Address', ['street'], 'tok', 50000);

    const code = lastCode(exec);
    expect(code).toContain('cls isNil ifTrue:');
    expect(code).toContain("startPreviewToken: 'tok' maxBytes: 50000");
  });

  it('pages, applies (with an empty deselection), and clears by token', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await pageSplitClassPreview(exec, 'tok', 5, 1000);
    await applySplitClass(exec, 'tok');
    const clearExec = vi.fn().mockReturnValue('ok');
    clearSplitClassPreview(clearExec, 'tok');

    expect(exec.mock.calls[0][1]).toContain("pageForToken: 'tok' from: 5 maxBytes: 1000");
    expect(exec.mock.calls[1][1]).toContain("applyForToken: 'tok' deselected: #()");
    expect(clearExec.mock.calls[0][0]).toContain("clearToken: 'tok'");
  });

  it('escapes a quote in the new class name and in an instance-variable name', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await analyzeSplitClass(exec, 'Person', "Ad'dr", ["stre'et"]);

    const code = lastCode(exec);
    expect(code).toContain("splitIntoClassNamed: 'Ad''dr'");
    expect(code).toContain("#('stre''et')");
  });
});
