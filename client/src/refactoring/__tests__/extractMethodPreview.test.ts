import { describe, it, expect } from 'vitest';
import {
  parseAnalysis,
  parseStartPreview,
  parsePage,
  parseApplyResult,
  validateNewSelector,
  selectorArity,
  extractChangeLabel,
  isCoreChange,
} from '../extractMethodPreview';

describe('extractMethodPreview.parseAnalysis', () => {
  it('parses argument count/names, return var, and safe-void-shape', () => {
    const a = parseAnalysis(
      '{"argCount":2,"argNames":["rate","total"],"returnVar":"r","safeVoidShape":false,"decline":null}',
    );
    expect(a.argCount).toBe(2);
    expect(a.argNames).toEqual(['rate', 'total']);
    expect(a.returnVar).toBe('r');
    expect(a.safeVoidShape).toBe(false);
    expect(a.decline).toBeNull();
  });

  it('surfaces a hard decline reason', () => {
    const a = parseAnalysis(
      '{"argCount":0,"argNames":[],"returnVar":null,"safeVoidShape":false,"decline":"contains a ^ return"}',
    );
    expect(a.decline).toBe('contains a ^ return');
  });

  it('throws on a bare error string (not JSON)', () => {
    expect(() => parseAnalysis('Class not found: Foo')).toThrow();
  });
});

describe('extractMethodPreview.parseStartPreview', () => {
  const env = JSON.stringify({
    token: 'tok',
    total: 2,
    newSelector: 'applyRate:to:',
    outOfScope: { collision: null, decline: null },
    skippedMethods: [],
    page: {
      changes: [
        {
          id: '1',
          kind: 'methodAdd',
          dictName: 'UserGlobals',
          className: 'Foo',
          isMeta: false,
          selector: 'applyRate:to:',
          category: 'calc',
          oldSource: null,
          newSource: 'applyRate: rate to: total\n\t^total * rate',
        },
        {
          id: '2',
          kind: 'methodRecompile',
          dictName: 'UserGlobals',
          className: 'Foo',
          isMeta: false,
          selector: 'bill',
          category: 'calc',
          oldSource: 'bill\n\t^total * rate',
          newSource: 'bill\n\t^self applyRate: rate to: total',
        },
      ],
      nextOffset: 3,
      done: true,
    },
  });

  it('parses token, totals, selector, and both core change kinds', () => {
    const start = parseStartPreview(env);
    expect(start.token).toBe('tok');
    expect(start.total).toBe(2);
    expect(start.newSelector).toBe('applyRate:to:');
    expect(start.page.changes[0].kind).toBe('methodAdd');
    // a methodAdd has no old source → rendered as an all-added method
    expect(start.page.changes[0].oldSource).toBe('');
    expect(start.page.changes[1].kind).toBe('methodRecompile');
    expect(start.page.done).toBe(true);
  });

  it('carries collision/decline preconditions', () => {
    const withOos = JSON.parse(env);
    withOos.outOfScope = { collision: 'already in Bar', decline: null };
    const start = parseStartPreview(JSON.stringify(withOos));
    expect(start.outOfScope.collision).toBe('already in Bar');
    expect(start.outOfScope.decline).toBeNull();
  });

  it('rejects an unknown change kind', () => {
    const bad = JSON.parse(env);
    bad.page.changes[0].kind = 'classRename';
    expect(() => parseStartPreview(JSON.stringify(bad))).toThrow(/unknown kind/);
  });

  it('throws on a bare error string', () => {
    expect(() => parseStartPreview('Class not found: Foo')).toThrow();
  });
});

describe('extractMethodPreview.parsePage / parseApplyResult', () => {
  it('parses a page of duplicate replacements', () => {
    const page = parsePage(
      '{"changes":[{"id":"3","kind":"methodRecompile","className":"Sub","isMeta":false,"selector":"dup","oldSource":"a","newSource":"b"}],"nextOffset":4,"done":true}',
    );
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0].id).toBe('3');
    expect(page.done).toBe(true);
  });

  it('parses an apply envelope with failures', () => {
    const r = parseApplyResult(
      '{"applied":2,"failed":[{"id":"3","label":"Sub>>dup","error":"boom"}]}',
    );
    expect(r.applied).toBe(2);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].error).toBe('boom');
  });
});

describe('extractMethodPreview.selectorArity / validateNewSelector', () => {
  it('computes arity for unary, binary, keyword, and invalid', () => {
    expect(selectorArity('extractedMethod')).toBe(0);
    expect(selectorArity('+')).toBe(1);
    expect(selectorArity('at:')).toBe(1);
    expect(selectorArity('at:put:')).toBe(2);
    expect(selectorArity('rate:total:')).toBe(2);
    expect(selectorArity('not a selector')).toBe(-1);
    expect(selectorArity('123')).toBe(-1);
  });

  it('accepts a selector whose arity matches the arg count', () => {
    expect(validateNewSelector('extractedMethod', 0)).toBeUndefined();
    expect(validateNewSelector('scaled:', 1)).toBeUndefined();
    expect(validateNewSelector('+', 1)).toBeUndefined();
    expect(validateNewSelector('at:put:', 2)).toBeUndefined();
  });

  it('rejects empty, invalid, or arity-mismatched selectors', () => {
    expect(validateNewSelector('   ', 0)).toMatch(/Enter a selector/);
    expect(validateNewSelector('has space', 0)).toMatch(/not a valid/);
    expect(validateNewSelector('extractedMethod', 2)).toMatch(/needs 2 arguments/);
    expect(validateNewSelector('at:put:', 0)).toMatch(/no arguments/);
  });

  it('rejects reusing the source method’s own selector', () => {
    expect(validateNewSelector('doStuff', 0, 'doStuff')).toMatch(/different selector/);
    expect(validateNewSelector('somethingElse', 0, 'doStuff')).toBeUndefined();
  });
});

describe('extractMethodPreview.extractChangeLabel / isCoreChange', () => {
  it('tags the new method and labels others plainly', () => {
    expect(
      extractChangeLabel({
        id: '1',
        kind: 'methodAdd',
        dictName: null,
        className: 'Foo',
        isMeta: false,
        selector: 'helper',
        category: null,
        oldSource: '',
        newSource: '',
      }),
    ).toBe('Foo>>helper (new method)');
    expect(
      extractChangeLabel({
        id: '2',
        kind: 'methodRecompile',
        dictName: null,
        className: 'Foo',
        isMeta: true,
        selector: 'bar',
        category: null,
        oldSource: '',
        newSource: '',
      }),
    ).toBe('Foo class>>bar');
  });

  it('treats the first two changes as required core changes', () => {
    expect(isCoreChange(0)).toBe(true);
    expect(isCoreChange(1)).toBe(true);
    expect(isCoreChange(2)).toBe(false);
  });
});
