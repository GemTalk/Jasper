import { describe, it, expect, vi } from 'vitest';
import {
  startRenameTemporaryPreview,
  pageRenameTemporaryPreview,
  applyRenameTemporary,
  clearRenameTemporaryPreview,
  renameTemporaryDeclineReason,
} from '../queries/previewRenameTemporary';

describe('rename-temporary preview queries', () => {
  it('builds a start query addressing the class, selector, side, offset, and names', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await startRenameTemporaryPreview(
      exec,
      'Account',
      'computeTemp',
      false,
      't',
      'sum',
      17,
      'tok',
      65536,
      2,
    );

    const [, code] = exec.mock.calls[0];
    expect(code).toContain('GsRenameTemporaryRefactoring');
    expect(code).toContain("selector: #'computeTemp'");
    expect(code).toContain('meta: false');
    expect(code).toContain("renameTemp: 't'");
    expect(code).toContain("to: 'sum'");
    expect(code).toContain('atOffset: 17');
    expect(code).toContain("startPreviewToken: 'tok' maxBytes: 65536");
  });

  it('emits meta: true for a class-side method', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await startRenameTemporaryPreview(exec, 'Account', 'reset', true, 't', 'sum', 3, 'tok', 1024);

    expect(exec.mock.calls[0][1]).toContain('meta: true');
  });

  it('quotes a keyword selector as a symbol literal', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await startRenameTemporaryPreview(exec, 'Account', 'at:put:', false, 'v', 'value', 5, 'tok', 1);

    expect(exec.mock.calls[0][1]).toContain("selector: #'at:put:'");
  });

  it('builds a page query by token and offset', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await pageRenameTemporaryPreview(exec, 'tok', 4, 2048);

    expect(exec.mock.calls[0][1]).toBe(
      "GsRenameTemporaryRefactoring pageForToken: 'tok' from: 4 maxBytes: 2048",
    );
  });

  it('builds an apply query that sends an empty deselected set (all-or-nothing)', async () => {
    const exec = vi.fn().mockResolvedValue('{}');

    await applyRenameTemporary(exec, 'tok', 'test undo');

    // Apply is routed through GsRefactoringUndo so the change is recorded (#434); the
    // engine's own all-or-nothing call is the fallback for a stone whose engine
    // predates undo.
    const code = exec.mock.calls[0][1] as string;
    expect(code).toContain("GsRenameTemporaryRefactoring applyForToken: 'tok' deselected: #()");
    expect(code).toContain('#recordAndApplyForToken:engine:deselected:label:');
    expect(code).toContain("with: 'test undo'");
  });

  it('builds a decline-reason pre-check addressing the class, selector, side, name, and offset', async () => {
    const exec = vi.fn().mockResolvedValue('');

    await renameTemporaryDeclineReason(exec, 'Account', 'readsCount', false, 'count', 9, 2);

    const [, code] = exec.mock.calls[0];
    expect(code).toContain('declineReasonForClass:');
    expect(code).toContain("selector: #'readsCount'");
    expect(code).toContain('meta: false');
    expect(code).toContain("name: 'count'");
    expect(code).toContain('atOffset: 9');
  });

  it('builds a clear query by token', () => {
    const exec = vi.fn().mockReturnValue('ok');

    clearRenameTemporaryPreview(exec, 'tok');

    expect(exec.mock.calls[0][0]).toBe("GsRenameTemporaryRefactoring clearToken: 'tok'");
  });
});
