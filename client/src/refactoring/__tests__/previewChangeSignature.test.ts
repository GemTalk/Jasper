import { describe, it, expect, vi } from 'vitest';
import {
  analyzeChangeSignature,
  startChangeSignaturePreview,
  pageChangeSignaturePreview,
  applyChangeSignature,
  clearChangeSignaturePreview,
} from '../queries/previewChangeSignature';

/**
 * The change-signature (M5) query builders produce the expected Smalltalk snippets —
 * the frozen engine envelope with its argNames/defaults/meta literals — and route
 * them through the supplied executor. Pure: the executor is a vi.fn.
 */

const asyncExec = () => vi.fn(async (_label: string, code: string) => code);
const syncExec = () => vi.fn((code: string) => code);

describe('change-signature query builders', () => {
  it('builds a pre-flight that analyses the method by class, selector, and side', async () => {
    const exec = asyncExec();

    const code = await analyzeChangeSignature(exec, 'Account', 'at:', false, 2);

    expect(code).toContain('GsChangeSignatureRefactoring');
    expect(code).toContain('analyzeForClass:');
    expect(code).toContain("selector: 'at:'");
    expect(code).toContain('meta: false');
  });

  it('starts a preview carrying the parts, permutation, arg names, defaults, and side', async () => {
    const exec = asyncExec();

    const code = await startChangeSignaturePreview(
      exec,
      'Account',
      'at:',
      ['at:', 'put:'],
      [1, 0],
      ['k', 'v'],
      ['', 'nil'],
      { kind: 'hierarchy' },
      'tok',
      9000,
      false,
      2,
    );

    expect(code).toContain("changeSelector: 'at:'");
    expect(code).toContain("toParts: #('at:' 'put:')");
    expect(code).toContain('permutation: #(1 0)');
    expect(code).toContain("argNames: #('k' 'v')");
    expect(code).toContain("defaults: #('' 'nil')");
    expect(code).toContain('meta: false');
    expect(code).toContain('scope: #hierarchy');
    expect(code).toContain("startPreviewToken: 'tok' maxBytes: 9000");
  });

  it('scopes to a named dictionary when asked', async () => {
    const exec = asyncExec();

    const code = await startChangeSignaturePreview(
      exec,
      'Account',
      'at:',
      ['at:'],
      [1],
      ['k'],
      [''],
      { kind: 'dictionary', dictName: 'UserGlobals' },
      'tok',
      9000,
      true,
    );

    expect(code).toContain("dictionaryScope: 'UserGlobals'");
    expect(code).toContain('meta: true');
  });

  it('pages a started preview by token', async () => {
    const exec = asyncExec();

    const code = await pageChangeSignaturePreview(exec, 'tok', 3, 9000);

    expect(code).toContain("pageForToken: 'tok'");
    expect(code).toContain('from: 3 maxBytes: 9000');
  });

  it('applies a preview passing the deselected ids', async () => {
    const exec = asyncExec();

    const code = await applyChangeSignature(exec, 'tok', ['2', '5']);

    expect(code).toContain("applyForToken: 'tok'");
    expect(code).toContain("deselected: #('2' '5')");
  });

  it('clears a finished preview by token', () => {
    const exec = syncExec();

    const code = clearChangeSignaturePreview(exec, 'tok');

    expect(code).toContain("clearToken: 'tok'");
  });
});
