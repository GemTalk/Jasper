import { describe, it, expect } from 'vitest';
import {
  parseAnalysis,
  parseStartPreview,
  parsePage,
  parseApplyResult,
  validateNewTemporaryName,
  extractTemporaryChangeLabel,
  ExtractTemporaryChange,
} from '../extractTemporaryPreview';

/**
 * Pure parsing/validation/labelling for the extract-temporary (M3) preview model. No
 * vscode. M3 is method-local: a single methodRecompile change, an occurrence count,
 * and two preconditions the panel refuses on (decline / collision).
 */

const recompile: ExtractTemporaryChange = {
  id: '1',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'M3Demo',
  isMeta: false,
  selector: 'compute',
  category: 'calc',
  oldSource: 'compute\n\t^ self a + self a',
  newSource: 'compute\n\t| t |\n\tt := self a.\n\t^ t + t',
};

function startJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    token: 'tok',
    total: 1,
    newName: 't',
    occurrenceCount: 2,
    outOfScope: { references: 0, skipped: 0, collision: null, decline: null },
    skippedMethods: [],
    page: { changes: [recompile], nextOffset: 2, done: true },
    ...over,
  });
}

describe('extract-temporary analysis parsing', () => {
  it('reads how many occurrences are in scope', () => {
    const a = parseAnalysis(JSON.stringify({ occurrenceCount: 3, decline: null }));

    expect(a.occurrenceCount).toBe(3);
    expect(a.decline).toBeNull();
  });

  it('surfaces a hard decline reason when the selection cannot be extracted', () => {
    const a = parseAnalysis(
      JSON.stringify({
        occurrenceCount: 0,
        decline: 'The selection is not an extractable expression.',
      }),
    );

    expect(a.decline).toBe('The selection is not an extractable expression.');
  });

  it('throws on a bare error string that is not JSON', () => {
    expect(() => parseAnalysis('Class not found: M3Demo')).toThrow();
  });
});

describe('extract-temporary start-preview parsing', () => {
  it('reads the token, totals, new name, and occurrence count from the envelope', () => {
    const start = parseStartPreview(startJson());

    expect(start.token).toBe('tok');
    expect(start.total).toBe(1);
    expect(start.newName).toBe('t');
    expect(start.occurrenceCount).toBe(2);
    expect(start.page.changes).toHaveLength(1);
    expect(start.page.done).toBe(true);
  });

  it('parses the single method-recompile change with the temporary introduced', () => {
    const [change] = parseStartPreview(startJson()).page.changes;

    expect(change.kind).toBe('methodRecompile');
    expect(change.selector).toBe('compute');
    expect(change.newSource).toContain('t := self a');
  });

  it('carries a collision precondition when the new name is already taken', () => {
    const start = parseStartPreview(
      startJson({
        outOfScope: {
          references: 0,
          skipped: 0,
          collision: 'the name t is already an instance variable',
          decline: null,
        },
      }),
    );

    expect(start.outOfScope.collision).toContain('already an instance variable');
    expect(start.outOfScope.decline).toBeNull();
  });

  it('surfaces a decline precondition when the selection is not extractable', () => {
    const start = parseStartPreview(
      startJson({
        total: 0,
        outOfScope: {
          references: 0,
          skipped: 0,
          collision: null,
          decline: 'the selection is a whole return',
        },
        page: { changes: [], nextOffset: 0, done: true },
      }),
    );

    expect(start.outOfScope.decline).toContain('whole return');
    expect(start.total).toBe(0);
  });

  it('rejects a change of an unexpected kind', () => {
    expect(() =>
      parseStartPreview(
        startJson({
          page: {
            changes: [{ ...recompile, kind: 'classDefinitionEdit' }],
            nextOffset: 2,
            done: true,
          },
        }),
      ),
    ).toThrow(/unknown kind/);
  });

  it('reports a bare error string as a thrown error rather than a preview', () => {
    expect(() => parseStartPreview('Class not found: M3Demo')).toThrow();
  });

  it('defaults missing name, out-of-scope, and page fields defensively', () => {
    const start = parseStartPreview(JSON.stringify({ token: 'tok' }));

    expect(start.newName).toBe('');
    expect(start.occurrenceCount).toBe(0);
    expect(start.outOfScope).toEqual({ references: 0, skipped: 0, collision: null, decline: null });
    expect(start.page).toEqual({ changes: [], nextOffset: 0, done: true });
  });
});

describe('extract-temporary page and apply parsing', () => {
  it('parses a later page of changes', () => {
    const page = parsePage(JSON.stringify({ changes: [recompile], nextOffset: 3, done: false }));

    expect(page.changes).toHaveLength(1);
    expect(page.done).toBe(false);
  });

  it('throws when a page envelope carries a stale-token error', () => {
    expect(() => parsePage(JSON.stringify({ error: 'no preview for token' }))).toThrow(
      'no preview for token',
    );
  });

  it('reads the applied count and the failed list', () => {
    const r = parseApplyResult(
      JSON.stringify({
        applied: 1,
        failed: [{ id: '1', label: 'M3Demo>>compute', error: 'boom' }],
      }),
    );

    expect(r.applied).toBe(1);
    expect(r.failed[0].error).toBe('boom');
  });

  it('surfaces the error field on an apply result envelope', () => {
    const r = parseApplyResult(
      JSON.stringify({ applied: 0, failed: [], error: 'preview expired' }),
    );

    expect(r.error).toBe('preview expired');
  });
});

describe('extract-temporary change label', () => {
  it('labels a change on each side', () => {
    expect(extractTemporaryChangeLabel(recompile)).toBe('M3Demo>>compute');
    expect(extractTemporaryChangeLabel({ ...recompile, isMeta: true })).toBe(
      'M3Demo class>>compute',
    );
  });
});

describe('new temporary name validation', () => {
  it('accepts a valid identifier', () => {
    expect(validateNewTemporaryName('sum')).toBeUndefined();
    expect(validateNewTemporaryName('_scratch')).toBeUndefined();
  });

  it('rejects an empty name', () => {
    expect(validateNewTemporaryName('   ')).toBeDefined();
  });

  it('rejects a name that is not a valid identifier', () => {
    expect(validateNewTemporaryName('9x')).toBeDefined();
    expect(validateNewTemporaryName('has space')).toBeDefined();
    expect(validateNewTemporaryName('x:')).toBeDefined();
  });

  it('trims surrounding whitespace before validating', () => {
    expect(validateNewTemporaryName('  total  ')).toBeUndefined();
  });
});
