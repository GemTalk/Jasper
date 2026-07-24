import { describe, it, expect, vi } from 'vitest';
import {
  analyzeInlineTemporary,
  startInlineTemporaryPreview,
  pageInlineTemporaryPreview,
  applyInlineTemporary,
  clearInlineTemporaryPreview,
} from '../queries/previewInlineTemporary';

/**
 * The inline-temporary (M4) query builders produce the expected Smalltalk snippets
 * and route them through the supplied executor. Pure — the executor is a vi.fn.
 */

const asyncExec = () => vi.fn(async (_label: string, code: string) => code);
const syncExec = () => vi.fn((code: string) => code);

describe('inline-temporary query builders', () => {
  it('builds a pre-flight that analyses the temporary at the given offset', async () => {
    const exec = asyncExec();

    const code = await analyzeInlineTemporary(exec, 'Account', 'report', false, 42, 2);

    expect(code).toContain('GsInlineTemporaryRefactoring');
    expect(code).toContain('analyzeTempForClass:');
    expect(code).toContain('atOffset: 42');
    expect(code).toContain("selector: #'report'");
  });

  it('starts a preview addressed by class, selector, and offset under a token', async () => {
    const exec = asyncExec();

    const code = await startInlineTemporaryPreview(
      exec,
      'Account',
      'report',
      false,
      42,
      'tok',
      9000,
      2,
    );

    expect(code).toContain('GsInlineTemporaryRefactoring');
    expect(code).toContain('atOffset: 42');
    expect(code).toContain("startPreviewToken: 'tok' maxBytes: 9000");
  });

  it('pages a started preview by token', async () => {
    const exec = asyncExec();

    const code = await pageInlineTemporaryPreview(exec, 'tok', 3, 9000);

    expect(code).toContain("pageForToken: 'tok'");
    expect(code).toContain('from: 3 maxBytes: 9000');
  });

  it('applies a preview with an empty deselected set (single all-or-nothing change)', async () => {
    const exec = asyncExec();

    const code = await applyInlineTemporary(exec, 'tok');

    expect(code).toContain("applyForToken: 'tok'");
    expect(code).toContain('deselected: #()');
  });

  it('clears a finished preview by token', () => {
    const exec = syncExec();

    const code = clearInlineTemporaryPreview(exec, 'tok');

    expect(code).toContain("clearToken: 'tok'");
  });
});
