import { describe, it, expect, vi } from 'vitest';
import {
  analyzeInstVar,
  startInstVarPreview,
  pageInstVarPreview,
  applyInstVar,
  clearInstVarPreview,
} from '../queries/previewInstVar';

// The async executor records the code it is handed so we can assert the generated
// Smalltalk. It returns a canned string.
function recorder(): { exec: (l: string, c: string) => Promise<string>; last: () => string } {
  let last = '';
  return {
    exec: (_label: string, code: string) => {
      last = code;
      return Promise.resolve('{}');
    },
    last: () => last,
  };
}

describe('instance-variable refactor query builders', () => {
  it('builds an add expression addressed by class + name, dict-scoped', async () => {
    const r = recorder();
    await analyzeInstVar(r.exec, 'add', 'Foo', 'tally', 3);
    expect(r.last()).toContain('addInstVar:');
    expect(r.last()).toContain("'tally'");
    expect(r.last()).toContain('at: 3'); // dict index lookup
    expect(r.last()).toContain('analysisJsonString');
  });

  it('guards a nil source class in analyze', async () => {
    const r = recorder();
    await analyzeInstVar(r.exec, 'remove', 'Missing', 'x');
    expect(r.last()).toContain('cls isNil ifTrue:');
    expect(r.last()).toContain('Class not found: Missing');
  });

  it('builds a remove expression', async () => {
    const r = recorder();
    await startInstVarPreview(r.exec, 'remove', 'Foo', 'count', 'tok', 1000);
    expect(r.last()).toContain('removeInstVar:');
    expect(r.last()).toContain("startPreviewToken: 'tok' maxBytes: 1000");
  });

  it('pages by token', async () => {
    const r = recorder();
    await pageInstVarPreview(r.exec, 'tok', 5, 2048);
    expect(r.last()).toContain("pageForToken: 'tok' from: 5 maxBytes: 2048");
  });

  it('applies with nil options when not edited, and false/false commit flags', async () => {
    const r = recorder();
    await applyInstVar(r.exec, 'tok', [], null, false, false);
    expect(r.last()).toContain('options: nil');
    expect(r.last()).toContain('migrate: false deleteHistory: false');
  });

  it('applies with an options array and commit flags', async () => {
    const r = recorder();
    await applyInstVar(r.exec, 'tok', [], ['logCreation', 'modifiable'], true, true);
    expect(r.last()).toContain("options: #('logCreation' 'modifiable')");
    expect(r.last()).toContain('migrate: true deleteHistory: true');
  });

  it('applies an empty (explicit) options set as #()', async () => {
    const r = recorder();
    await applyInstVar(r.exec, 'tok', [], [], false, false);
    expect(r.last()).toContain('options: #()');
  });

  it('clears a preview token', () => {
    const exec = vi.fn((code: string) => code);
    clearInstVarPreview(exec, 'tok');
    expect(exec).toHaveBeenCalledWith(expect.stringContaining("clearToken: 'tok'"));
  });

  it('escapes a quote in the variable name', async () => {
    const r = recorder();
    await analyzeInstVar(r.exec, 'add', 'Foo', "od'd");
    // escapeString doubles a single quote for a Smalltalk string literal.
    expect(r.last()).toContain("od''d");
  });
});
