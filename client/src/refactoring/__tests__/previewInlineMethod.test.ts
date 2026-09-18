import { describe, it, expect, vi } from 'vitest';
import {
  analyzeInlineSend,
  startInlineMethodPreview,
  pageInlineMethodPreview,
  applyInlineMethod,
  clearInlineMethodPreview,
} from '../queries/previewInlineMethod';

/**
 * The inline-method (M2) query builders produce the expected Smalltalk snippets and
 * route them through the supplied executor. Pure — the executor is a vi.fn.
 */

const asyncExec = () => vi.fn(async (_label: string, code: string) => code);
const syncExec = () => vi.fn((code: string) => code);

describe('inline-method query builders', () => {
  it('builds a pre-flight that analyses the send at the given offset', async () => {
    const exec = asyncExec();

    const code = await analyzeInlineSend(exec, 'Account', 'report', false, 42, 2);

    expect(code).toContain('analyzeSendForClass:');
    expect(code).toContain('atOffset: 42');
    expect(code).toContain("selector: #'report'");
  });

  it('starts a preview addressed by class, selector, and offset under a token', async () => {
    const exec = asyncExec();

    const code = await startInlineMethodPreview(
      exec,
      'Account',
      'report',
      false,
      42,
      'tok',
      9000,
      2,
    );

    expect(code).toContain('GsInlineMethodRefactoring');
    expect(code).toContain('atOffset: 42');
    expect(code).toContain("startPreviewToken: 'tok' maxBytes: 9000");
  });

  it('pages a started preview by token', async () => {
    const exec = asyncExec();

    const code = await pageInlineMethodPreview(exec, 'tok', 3, 9000);

    expect(code).toContain("pageForToken: 'tok'");
    expect(code).toContain('from: 3 maxBytes: 9000');
  });

  it('applies a preview passing the deselected ids', async () => {
    const exec = asyncExec();

    const code = await applyInlineMethod(exec, 'tok', ['2'], 'test undo');

    expect(code).toContain("applyForToken: 'tok'");
    expect(code).toContain("deselected: #('2')");
  });

  it('clears a finished preview by token', () => {
    const exec = syncExec();

    const code = clearInlineMethodPreview(exec, 'tok');

    expect(code).toContain("clearToken: 'tok'");
  });
});
