import { describe, it, expect, vi } from 'vitest';
import {
  refactoringUndoStatus,
  startUndoRefactoringPreview,
  pageUndoRefactoringPreview,
  applyUndoRefactoring,
  clearUndoRefactoringPreview,
  clearRefactoringUndo,
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
    expect(code).toContain(`c isNil ifTrue: ['{"available":false}']`);
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
