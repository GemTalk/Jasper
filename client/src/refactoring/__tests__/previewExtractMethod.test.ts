import { describe, it, expect } from 'vitest';
import {
  analyzeExtractSelection,
  startExtractMethodPreview,
  pageExtractMethodPreview,
  applyExtractMethod,
  clearExtractMethodPreview,
} from '../queries/previewExtractMethod';

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

describe('previewExtractMethod query builders', () => {
  it('analyzeExtractSelection sends the selection interval to the pre-flight', async () => {
    const s = spy();
    await analyzeExtractSelection(s.exec, 'Foo', 'bar', false, 10, 25, 3);
    expect(s.code).toContain('analyzeSelectionForClass:');
    expect(s.code).toContain('selStart: 10');
    expect(s.code).toContain('selStop: 25');
    expect(s.code).toContain("selector: #'bar'");
    expect(s.code).toContain('meta: false');
  });

  it('startExtractMethodPreview passes selector, interval, replaceSimilar, and token', async () => {
    const s = spy();
    await startExtractMethodPreview(
      s.exec,
      'Foo',
      'bar',
      true,
      10,
      25,
      'helper:with:',
      true,
      'tok',
      4096,
      3,
    );
    expect(s.code).toContain('GsExtractMethodRefactoring');
    expect(s.code).toContain('meta: true');
    expect(s.code).toContain('selStart: 10');
    expect(s.code).toContain('selStop: 25');
    expect(s.code).toContain("newSelector: 'helper:with:'");
    expect(s.code).toContain('replaceSimilar: true');
    expect(s.code).toContain("startPreviewToken: 'tok' maxBytes: 4096");
  });

  it('startExtractMethodPreview emits replaceSimilar: false when off', async () => {
    const s = spy();
    await startExtractMethodPreview(
      s.exec,
      'Foo',
      'bar',
      false,
      1,
      2,
      'helper',
      false,
      'tok',
      4096,
    );
    expect(s.code).toContain('replaceSimilar: false');
  });

  it('pageExtractMethodPreview fetches by token + offset', async () => {
    const s = spy();
    await pageExtractMethodPreview(s.exec, 'tok', 3, 4096);
    expect(s.code).toContain("pageForToken: 'tok' from: 3 maxBytes: 4096");
  });

  it('applyExtractMethod passes the deselected duplicate ids', async () => {
    const s = spy();
    await applyExtractMethod(s.exec, 'tok', ['3', '5'], 'test undo');
    expect(s.code).toContain("applyForToken: 'tok'");
    expect(s.code).toContain("deselected: #('3' '5')");
  });

  it('applyExtractMethod sends an empty set when nothing is deselected', async () => {
    const s = spy();
    await applyExtractMethod(s.exec, 'tok', [], 'test undo');
    expect(s.code).toContain('deselected: #()');
  });

  it('clearExtractMethodPreview drops the token', () => {
    let captured = '';
    clearExtractMethodPreview((code) => {
      captured = code;
      return '';
    }, 'tok');
    expect(captured).toContain("clearToken: 'tok'");
  });
});
