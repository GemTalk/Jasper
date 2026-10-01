import { describe, it, expect, vi } from 'vitest';
import {
  refactoringUndoStatus,
  startUndoRefactoringPreview,
  pageUndoRefactoringPreview,
  applyUndoRefactoring,
  clearUndoRefactoringPreview,
  clearRefactoringUndo,
  recordReverseRename,
  captureClassHistory,
} from '../queries/previewUndoRefactoring';

/**
 * The undo query builders (#434). Every one of them must survive a stone whose
 * refactoring engine predates undo: they reach GsRefactoringUndo through
 * `objectNamed:` so the doit COMPILES there, and each carries the "nothing to undo"
 * answer for that case in its own nil branch — an undo query is never allowed to be
 * the thing that breaks a session.
 */
describe('undo refactoring queries', () => {
  const codeOf = (fn: (e: never) => unknown): string => {
    const exec = vi.fn().mockReturnValue('{}');
    fn(exec as never);
    return exec.mock.calls[0][exec.mock.calls[0].length - 1] as string;
  };

  it('probes the status without naming the class directly', () => {
    const code = codeOf((e) => refactoringUndoStatus(e));
    expect(code).toContain('objectNamed: #GsRefactoringUndo');
    expect(code).toContain('c statusJson');
    // The no-engine branch says WHICH kind of "nothing to undo" this is, so a stone whose
    // engine predates undo can be told apart from a session that has applied nothing.
    expect(code).toContain(`c isNil ifTrue: ['{"available":false,"supported":false}']`);
  });

  it('starts a paginated preview under a token and bounds the page', async () => {
    const exec = vi.fn().mockResolvedValue('{}');
    await startUndoRefactoringPreview(exec, 'tok', 4096);
    const code = exec.mock.calls[0][1] as string;
    expect(code).toContain("c startPreviewToken: 'tok' maxBytes: 4096");
    expect(code).toContain('"error"');
  });

  it('fetches a later page by token and offset', async () => {
    const exec = vi.fn().mockResolvedValue('{}');
    await pageUndoRefactoringPreview(exec, 'tok', 12, 4096);
    expect(exec.mock.calls[0][1]).toContain("c pageForToken: 'tok' from: 12 maxBytes: 4096");
  });

  it('applies skipping the deselected ids', async () => {
    const exec = vi.fn().mockResolvedValue('{}');
    await applyUndoRefactoring(exec, 'tok', ['2', '4']);
    expect(exec.mock.calls[0][1]).toContain("c applyForToken: 'tok' deselected: #('2' '4')");
  });

  it('applies everything when nothing is deselected', async () => {
    const exec = vi.fn().mockResolvedValue('{}');
    await applyUndoRefactoring(exec, 'tok', []);
    expect(exec.mock.calls[0][1]).toContain('deselected: #()');
  });

  it('drops only the PREVIEW when the panel closes, never the recorded entry', () => {
    const code = codeOf((e) => clearUndoRefactoringPreview(e, 'tok'));
    expect(code).toContain("c clearToken: 'tok'");
    expect(code).not.toContain('c clear.');
  });

  it('has a separate query for forgetting the entry itself', () => {
    expect(codeOf((e) => clearRefactoringUndo(e))).toContain('c clear');
  });

  it('escapes a quote in a token', async () => {
    const exec = vi.fn().mockResolvedValue('{}');
    await applyUndoRefactoring(exec, "to'k", []);
    expect(exec.mock.calls[0][1]).toContain("'to''k'");
  });
});

describe('the recorded reversal carries the class’s own dictionary', () => {
  /**
   * `classDictName:` is what keeps an undo on the class the refactoring touched. Without it the
   * reversal re-resolves the class by name and applies the opposite operation to whichever
   * same-named class the symbol list reaches first (#396).
   *
   * Only the integration suite covered this, and it runs locally against one stone version.
   */
  const record = (classDict?: number | string): string => {
    const exec = vi.fn().mockReturnValue('ok');
    recordReverseRename(
      exec,
      'instVarAdd',
      'Shadowed',
      'x',
      'x',
      'Add x to Shadowed',
      'GsInstVarRefactoring',
      undefined,
      classDict,
    );
    return exec.mock.calls[0][0] as string;
  };

  it('sends a SymbolList index as an Integer', () => {
    // Coerced to a String it became '10', matched no dictionary NAME, and fell back to the
    // first match — silently, because that fallback is legitimate for a record made without a
    // dictionary at all.
    expect(record(10)).toContain('classDictName: 10');
  });

  it('quotes and escapes a dictionary given by name', () => {
    expect(record("Di'ct")).toContain("classDictName: 'Di''ct'");
  });

  it('sends nil when the caller has no dictionary', () => {
    expect(record()).toContain('classDictName: nil');
  });

  it('scopes the pre-apply history capture the same way', () => {
    const exec = vi.fn().mockReturnValue('ok');
    captureClassHistory(exec, 'Shadowed', 3);
    expect(exec.mock.calls[0][0]).toContain("captureClassHistoryOf: 'Shadowed' inDictionary: 3");
  });
});
