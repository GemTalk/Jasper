import { describe, it, expect } from 'vitest';
import {
  parseStartPreview,
  parsePage,
  parseApplyResult,
  parseAnalysis,
  methodChangeLabel,
  isKeywordSelector,
  isBinarySelector,
  selectorParts,
  selectorArgCount,
  buildSelector,
  buildSignatureEdit,
  isIdentityPermutation,
  isNoOpChange,
  validateSignatureParts,
  duplicateArgName,
  SignatureRow,
} from '../changeSignaturePreview';

/**
 * The pure change-signature (M5) model: parsing the engine envelopes (including the
 * M5-specific collision/decline preconditions and the pre-flight analysis), the
 * selector-shape helpers, and the add/remove/reorder builders that turn editor rows
 * into the engine's (newParts, permutation, argNames, defaults). No vscode, so it
 * exercises directly.
 */

const startEnvelope = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    token: 'tok',
    total: 2,
    outOfScope: { implementors: 0, senders: 0, skipped: 0, collision: null, decline: null },
    skippedMethods: [],
    page: {
      changes: [
        {
          id: '1',
          kind: 'methodRename',
          className: 'Account',
          isMeta: false,
          selector: 'at:',
          newSelector: 'at:put:',
          oldSource: 'at: k',
          newSource: 'at: k put: v',
        },
      ],
      nextOffset: 2,
      done: true,
    },
    ...over,
  });

describe('change-signature envelope parsing', () => {
  it('reads the token, totals, and first page', () => {
    const start = parseStartPreview(startEnvelope());

    expect(start.token).toBe('tok');
    expect(start.total).toBe(2);
    expect(start.page.changes[0].newSelector).toBe('at:put:');
    expect(start.page.done).toBe(true);
  });

  it('carries the collision precondition through the out-of-scope object', () => {
    const start = parseStartPreview(
      startEnvelope({
        outOfScope: {
          implementors: 0,
          senders: 0,
          skipped: 0,
          collision: 'Account already implements at:put:.',
          decline: null,
        },
      }),
    );

    expect(start.outOfScope.collision).toBe('Account already implements at:put:.');
    expect(start.outOfScope.decline).toBeNull();
  });

  it('carries the decline precondition through the out-of-scope object', () => {
    const start = parseStartPreview(
      startEnvelope({
        outOfScope: {
          implementors: 1,
          senders: 2,
          skipped: 0,
          collision: null,
          decline: 'Parameter value is used in Account>>at:put:.',
        },
      }),
    );

    expect(start.outOfScope.decline).toContain('used in Account');
    expect(start.outOfScope.implementors).toBe(1);
    expect(start.outOfScope.senders).toBe(2);
  });

  it('defaults the preconditions to null when the engine omits them', () => {
    const start = parseStartPreview(
      startEnvelope({ outOfScope: { implementors: 0, senders: 0, skipped: 0 } }),
    );

    expect(start.outOfScope.collision).toBeNull();
    expect(start.outOfScope.decline).toBeNull();
  });

  it('throws on a payload that is not a preview envelope', () => {
    expect(() => parseStartPreview('"Class not found: Foo"')).toThrow();
  });

  it('parses a later page and reports done', () => {
    const page = parsePage(JSON.stringify({ changes: [], nextOffset: 5, done: true }));

    expect(page.changes).toEqual([]);
    expect(page.done).toBe(true);
  });

  it('surfaces an expired-session error envelope as a thrown error', () => {
    expect(() => parsePage(JSON.stringify({ error: 'preview expired' }))).toThrow(
      'preview expired',
    );
  });

  it('parses an apply result with its failures', () => {
    const result = parseApplyResult(
      JSON.stringify({
        applied: 3,
        failed: [{ id: '9', label: 'Foo>>bar:', error: 'boom' }],
      }),
    );

    expect(result.applied).toBe(3);
    expect(result.failed[0]).toEqual({ id: '9', label: 'Foo>>bar:', error: 'boom' });
  });
});

describe('change-signature pre-flight analysis parsing', () => {
  it('reads the selector kind, arity, and argument names', () => {
    const analysis = parseAnalysis(
      JSON.stringify({ selectorKind: 'keyword', arity: 2, argNames: ['k', 'v'], decline: null }),
    );

    expect(analysis.selectorKind).toBe('keyword');
    expect(analysis.arity).toBe(2);
    expect(analysis.argNames).toEqual(['k', 'v']);
    expect(analysis.decline).toBeNull();
  });

  it('surfaces a hard decline when the method cannot be analysed', () => {
    const analysis = parseAnalysis(
      JSON.stringify({
        selectorKind: null,
        arity: 0,
        argNames: [],
        decline: 'Class not found: Foo',
      }),
    );

    expect(analysis.decline).toBe('Class not found: Foo');
    expect(analysis.selectorKind).toBe('keyword');
  });
});

describe('selector shape helpers', () => {
  it('recognises keyword, binary, and unary selectors', () => {
    expect(isKeywordSelector('at:put:')).toBe(true);
    expect(isKeywordSelector('size')).toBe(false);
    expect(isBinarySelector('+')).toBe(true);
    expect(isBinarySelector('size')).toBe(false);
  });

  it('splits a keyword selector into its parts and a non-keyword into one', () => {
    expect(selectorParts('copyFrom:to:')).toEqual(['copyFrom:', 'to:']);
    expect(selectorParts('size')).toEqual(['size']);
    expect(selectorParts('+')).toEqual(['+']);
  });

  it('counts a selector arguments as keyword parts, one for binary, none for unary', () => {
    expect(selectorArgCount('at:put:')).toBe(2);
    expect(selectorArgCount('+')).toBe(1);
    expect(selectorArgCount('size')).toBe(0);
  });

  it('joins parts back into a selector', () => {
    expect(buildSelector(['copyTo:', 'from:'])).toBe('copyTo:from:');
  });

  it('labels an implementor row with its class and side', () => {
    expect(
      methodChangeLabel({
        id: '1',
        kind: 'methodRename',
        dictName: null,
        className: 'Account',
        isMeta: true,
        selector: 'at:',
        newSelector: 'at:put:',
        category: null,
        oldSource: '',
        newSource: '',
      }),
    ).toBe('Account class>>at:');
  });
});

describe('signature edit builders', () => {
  const row = (over: Partial<SignatureRow>): SignatureRow => ({
    part: 'at:',
    hasArg: true,
    argName: 'k',
    defaultValue: '',
    originalIndex: 1,
    ...over,
  });

  it('reorders parameters by carrying each row original index into the permutation', () => {
    const edit = buildSignatureEdit([
      row({ part: 'to:', argName: 'stop', originalIndex: 2 }),
      row({ part: 'copyFrom:', argName: 'start', originalIndex: 1 }),
    ]);

    expect(edit.newParts).toEqual(['to:', 'copyFrom:']);
    expect(edit.permutation).toEqual([2, 1]);
    expect(edit.newArgNames).toEqual(['stop', 'start']);
    expect(edit.defaults).toEqual(['', '']);
  });

  it('adds a parameter as a zero permutation entry carrying its default', () => {
    const edit = buildSignatureEdit([
      row({ part: 'at:', argName: 'k', originalIndex: 1 }),
      row({ part: 'put:', argName: 'v', originalIndex: 0, defaultValue: 'nil' }),
    ]);

    expect(edit.newParts).toEqual(['at:', 'put:']);
    expect(edit.permutation).toEqual([1, 0]);
    expect(edit.newArgNames).toEqual(['k', 'v']);
    expect(edit.defaults).toEqual(['', 'nil']);
  });

  it('removes a parameter by dropping its row entirely', () => {
    const edit = buildSignatureEdit([row({ part: 'at:', argName: 'k', originalIndex: 1 })]);

    expect(edit.newParts).toEqual(['at:']);
    expect(edit.permutation).toEqual([1]);
    expect(edit.newArgNames).toEqual(['k']);
  });

  it('keeps an argument-free unary part out of the argument arrays', () => {
    const edit = buildSignatureEdit([
      row({ part: 'size', hasArg: false, argName: '', originalIndex: 0 }),
    ]);

    expect(edit.newParts).toEqual(['size']);
    expect(edit.permutation).toEqual([]);
    expect(edit.newArgNames).toEqual([]);
    expect(edit.defaults).toEqual([]);
  });

  it('emits an empty default for a reused parameter even if its row carries one', () => {
    const edit = buildSignatureEdit([
      row({ part: 'at:', argName: 'k', originalIndex: 1, defaultValue: 'garbage' }),
    ]);

    expect(edit.defaults).toEqual(['']);
  });
});

describe('permutation and no-op detection', () => {
  it('recognises the identity permutation', () => {
    expect(isIdentityPermutation([1, 2, 3])).toBe(true);
    expect(isIdentityPermutation([2, 1])).toBe(false);
    expect(isIdentityPermutation([1, 0])).toBe(false);
  });

  it('treats an unchanged selector with an identity permutation as a no-op', () => {
    expect(isNoOpChange(['at:', 'put:'], [1, 2], 'at:put:')).toBe(true);
  });

  it('is not a no-op when the selector changes or the arguments move', () => {
    expect(isNoOpChange(['put:', 'at:'], [2, 1], 'at:put:')).toBe(false);
    expect(isNoOpChange(['at:', 'value:'], [1, 0], 'at:')).toBe(false);
  });
});

describe('signature validation', () => {
  it('accepts a well-formed keyword rename', () => {
    expect(validateSignatureParts(['copyTo:', 'from:'], 'copyFrom:to:')).toBeUndefined();
  });

  it('rejects an empty part', () => {
    expect(validateSignatureParts(['at:', ''], 'at:put:')).toMatch(/empty/);
  });

  it('rejects a keyword part missing its colon', () => {
    expect(validateSignatureParts(['at', 'put:'], 'at:put:')).toMatch(/colon/);
  });

  it('rejects a multi-part non-keyword selector', () => {
    expect(validateSignatureParts(['foo', 'bar'], 'foo')).toMatch(/keyword parts/);
  });

  it('accepts adding a parameter to a unary selector', () => {
    expect(validateSignatureParts(['foo:'], 'foo')).toBeUndefined();
  });

  it('rejects an unchanged single-part selector as no change', () => {
    expect(validateSignatureParts(['foo'], 'foo')).toMatch(/Change the selector/);
  });

  it('finds a duplicate argument name', () => {
    expect(duplicateArgName(['k', 'v', 'k'])).toBe('k');
    expect(duplicateArgName(['k', 'v'])).toBeUndefined();
  });

  it('ignores blank argument names when checking for duplicates', () => {
    expect(duplicateArgName(['', ''])).toBeUndefined();
  });
});
