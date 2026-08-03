import { describe, it, expect } from 'vitest';
import {
  parseStartPreview,
  parsePage,
  parseApplyResult,
  methodChangeLabel,
  isStructuralChange,
  selectorParts,
  selectorArgCount,
  isKeywordSelector,
  isBinarySelector,
  buildSelector,
  validateNewParts,
  permutationFromOriginalIndices,
  parseArgNames,
} from '../renameMethodPreview';

const renameChange = {
  id: '1',
  kind: 'methodRename',
  dictName: 'UserGlobals',
  className: 'Foo',
  isMeta: false,
  selector: 'from:to:',
  newSelector: 'to:from:',
  category: 'accessing',
  oldSource: 'from: a to: b\n\t^a',
  newSource: 'to: b from: a\n\t^a',
};
const senderChange = {
  id: '2',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Bar',
  isMeta: true,
  selector: 'caller',
  newSelector: null,
  category: 'x',
  oldSource: '^self from: 1 to: 2',
  newSource: '^self to: 2 from: 1',
};

function startEnvelope(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    token: 'tok1',
    total: 2,
    outOfScope: { implementors: 0, senders: 0, skipped: 0 },
    skippedMethods: [],
    page: { changes: [renameChange, senderChange], nextOffset: 3, done: true },
    ...over,
  });
}

describe('parseStartPreview', () => {
  it('parses the token, totals, warnings, and first page', () => {
    const p = parseStartPreview(
      startEnvelope({
        outOfScope: { implementors: 3, senders: 5, skipped: 1 },
        skippedMethods: [{ class: 'AutoComplete', selector: 'strings:' }],
        page: { changes: [renameChange], nextOffset: 2, done: false },
      }),
    );

    expect(p.token).toBe('tok1');
    expect(p.total).toBe(2);
    expect(p.outOfScope).toEqual({ implementors: 3, senders: 5, skipped: 1 });
    expect(p.skippedMethods).toEqual([{ className: 'AutoComplete', selector: 'strings:' }]);
    expect(p.page.changes).toHaveLength(1);
    expect(p.page.changes[0].newSelector).toBe('to:from:');
    expect(p.page.nextOffset).toBe(2);
    expect(p.page.done).toBe(false);
  });

  it('throws on a bare error string from the stone', () => {
    expect(() => parseStartPreview('Class not found: Foo')).toThrow();
  });

  it('throws when no session token comes back', () => {
    expect(() => parseStartPreview(JSON.stringify({ total: 0 }))).toThrow(/session token/);
  });
});

describe('parsePage', () => {
  it('parses a page of changes with its next offset and done flag', () => {
    const page = parsePage(
      JSON.stringify({
        changes: [senderChange],
        nextOffset: 42,
        done: false,
      }),
    );

    expect(page.changes).toHaveLength(1);
    expect(page.changes[0].kind).toBe('methodRecompile');
    expect(page.nextOffset).toBe(42);
    expect(page.done).toBe(false);
  });

  it('throws when the preview session has expired', () => {
    expect(() =>
      parsePage(
        JSON.stringify({
          error: 'preview session expired',
          changes: [],
          nextOffset: 0,
          done: true,
        }),
      ),
    ).toThrow(/expired/);
  });
});

describe('parseApplyResult', () => {
  it('parses the applied count and failures', () => {
    const r = parseApplyResult(
      JSON.stringify({
        applied: 5,
        failed: [{ id: '9', label: 'Foo>>bar', error: 'boom' }],
      }),
    );

    expect(r.applied).toBe(5);
    expect(r.failed).toEqual([{ id: '9', label: 'Foo>>bar', error: 'boom' }]);
    expect(r.error).toBeUndefined();
  });

  it('surfaces an expired-session error', () => {
    const r = parseApplyResult(
      JSON.stringify({ applied: 0, failed: [], error: 'preview session expired' }),
    );

    expect(r.error).toBe('preview session expired');
  });
});

describe('methodChangeLabel', () => {
  it('renders instance and class side', () => {
    const [r, s] = parseStartPreview(startEnvelope()).page.changes;
    expect(methodChangeLabel(r)).toBe('Foo>>from:to:');
    expect(methodChangeLabel(s)).toBe('Bar class>>caller');
  });
});

describe('rename-method change classification', () => {
  it("treats an implementor's rename as structural (non-deselectable)", () => {
    const [implementor] = parseStartPreview(startEnvelope()).page.changes;
    expect(isStructuralChange(implementor)).toBe(true);
  });

  it("treats a sender's recompile as optional", () => {
    const [, sender] = parseStartPreview(startEnvelope()).page.changes;
    expect(isStructuralChange(sender)).toBe(false);
  });
});

describe('selector shape helpers', () => {
  it('classifies and splits keyword / unary / binary', () => {
    expect(isKeywordSelector('at:put:')).toBe(true);
    expect(isKeywordSelector('size')).toBe(false);
    expect(isBinarySelector('+')).toBe(true);
    expect(isBinarySelector('<=')).toBe(true);
    expect(isBinarySelector('size')).toBe(false);
    expect(selectorParts('at:put:')).toEqual(['at:', 'put:']);
    expect(selectorParts('size')).toEqual(['size']);
    expect(selectorParts('+')).toEqual(['+']);
    expect(selectorArgCount('at:put:')).toBe(2);
    expect(selectorArgCount('size')).toBe(0);
    expect(selectorArgCount('+')).toBe(1);
    expect(buildSelector(['copyTo:', 'from:'])).toBe('copyTo:from:');
  });
});

describe('validateNewParts', () => {
  it('accepts a valid keyword rename and reorder', () => {
    expect(validateNewParts(['copyTo:', 'from:'], 'copyFrom:to:')).toBeUndefined();
    expect(validateNewParts(['to:', 'from:'], 'from:to:')).toBeUndefined();
  });
  it('rejects arity change', () => {
    expect(validateNewParts(['at:'], 'at:put:')).toMatch(/2 selector parts/);
  });
  it('rejects a malformed keyword part', () => {
    expect(validateNewParts(['1bad:', 'to:'], 'from:to:')).toMatch(/keyword part/);
    expect(validateNewParts(['noColon', 'to:'], 'from:to:')).toMatch(/keyword part/);
  });
  it('validates unary and binary', () => {
    expect(validateNewParts(['renamed'], 'size')).toBeUndefined();
    expect(validateNewParts(['size'], 'size')).toMatch(/different selector/);
    expect(validateNewParts(['-'], '+')).toBeUndefined();
    expect(validateNewParts(['bad'], '+')).toMatch(/binary/);
  });
});

describe('permutationFromOriginalIndices', () => {
  it('is the original 1-based indices in row order', () => {
    expect(permutationFromOriginalIndices([2, 1])).toEqual([2, 1]);
    expect(permutationFromOriginalIndices([])).toEqual([]);
  });
});

describe('parseArgNames', () => {
  it('extracts keyword argument names from the signature', () => {
    expect(parseArgNames('from: a to: b\n\t^a', 'from:to:')).toEqual(['a', 'b']);
  });
  it('extracts the binary argument name', () => {
    expect(parseArgNames('+ other\n\t^self', '+')).toEqual(['other']);
  });
  it('returns no names for a unary selector', () => {
    expect(parseArgNames('size\n\t^n', 'size')).toEqual([]);
  });
  it('falls back to positional names when the signature cannot be parsed', () => {
    expect(parseArgNames('', 'from:to:')).toEqual(['arg1', 'arg2']);
  });
});
