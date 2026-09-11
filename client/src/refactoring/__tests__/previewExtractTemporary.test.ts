import { describe, it, expect } from 'vitest';
import {
  analyzeExtractTemporary,
  startExtractTemporaryPreview,
  pageExtractTemporaryPreview,
  applyExtractTemporary,
  clearExtractTemporaryPreview,
} from '../queries/previewExtractTemporary';

/** Capture the generated Smalltalk for assertions. */
function spy(): { code: string; exec: (label: string, code: string) => Promise<string> } {
  const box = { code: '' };
  return {
    get code() {
      return box.code;
    },
    exec: (_label: string, code: string) => {
      box.code = code;
      return Promise.resolve('{}');
    },
  };
}

describe('previewExtractTemporary query builders', () => {
  it('analyzeExtractTemporary sends the selection interval to the pre-flight', async () => {
    const s = spy();

    await analyzeExtractTemporary(s.exec, 'Foo', 'bar', false, 10, 25, 3);

    expect(s.code).toContain('GsExtractTemporaryRefactoring');
    expect(s.code).toContain('analyzeSelectionForClass:');
    expect(s.code).toContain('selStart: 10');
    expect(s.code).toContain('selStop: 25');
    expect(s.code).toContain("selector: #'bar'");
    expect(s.code).toContain('meta: false');
  });

  it('startExtractTemporaryPreview passes selector, interval, new name, replaceAll, and token', async () => {
    const s = spy();

    await startExtractTemporaryPreview(
      s.exec,
      'Foo',
      'bar',
      true,
      10,
      25,
      't',
      true,
      'tok',
      4096,
      3,
    );

    expect(s.code).toContain('GsExtractTemporaryRefactoring');
    expect(s.code).toContain('meta: true');
    expect(s.code).toContain('selStart: 10');
    expect(s.code).toContain('selStop: 25');
    expect(s.code).toContain("newName: 't'");
    expect(s.code).toContain('replaceAll: true');
    expect(s.code).toContain("startPreviewToken: 'tok' maxBytes: 4096");
  });

  it('startExtractTemporaryPreview emits replaceAll: false when off', async () => {
    const s = spy();

    await startExtractTemporaryPreview(s.exec, 'Foo', 'bar', false, 1, 2, 't', false, 'tok', 4096);

    expect(s.code).toContain('replaceAll: false');
  });

  it('pageExtractTemporaryPreview fetches by token + offset', async () => {
    const s = spy();

    await pageExtractTemporaryPreview(s.exec, 'tok', 3, 4096);

    expect(s.code).toContain("pageForToken: 'tok' from: 3 maxBytes: 4096");
  });

  it('applyExtractTemporary sends an empty deselected set (single all-or-nothing change)', async () => {
    const s = spy();

    await applyExtractTemporary(s.exec, 'tok', 'test undo');

    expect(s.code).toContain("applyForToken: 'tok'");
    expect(s.code).toContain('deselected: #()');
  });

  it('clearExtractTemporaryPreview drops the token', () => {
    let captured = '';
    clearExtractTemporaryPreview((code) => {
      captured = code;
      return '';
    }, 'tok');

    expect(captured).toContain("clearToken: 'tok'");
  });
});
