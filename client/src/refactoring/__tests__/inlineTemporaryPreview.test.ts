import { describe, it, expect } from 'vitest';
import {
  parseAnalysis,
  parseStartPreview,
  parsePage,
  parseApplyResult,
  inlineTemporaryChangeLabel,
  InlineTemporaryChange,
} from '../inlineTemporaryPreview';

/**
 * Pure parsing/labelling for the inline-temporary (M4) preview model. No vscode. M4
 * is method-local: a single methodRecompile change and one precondition the panel
 * refuses on (decline). Inlining introduces no shadowing, so collision is always
 * null.
 */

const recompile: InlineTemporaryChange = {
  id: '1',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'M4Demo',
  isMeta: false,
  selector: 'report',
  category: 'printing',
  oldSource: 'report\n\t| t |\n\tt := self total.\n\t^ t',
  newSource: 'report\n\t^ self total',
};

function startJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    token: 'tok',
    total: 1,
    name: 't',
    outOfScope: { references: 0, skipped: 0, collision: null, decline: null },
    skippedMethods: [],
    page: { changes: [recompile], nextOffset: 2, done: true },
    ...over,
  });
}

describe('inline-temporary analysis parsing', () => {
  it("reads the temporary's name", () => {
    const a = parseAnalysis(JSON.stringify({ name: 't', decline: null }));

    expect(a.name).toBe('t');
    expect(a.decline).toBeNull();
  });

  it('carries a decline reason when the target cannot be inlined', () => {
    const a = parseAnalysis(
      JSON.stringify({ name: null, decline: 'the target is an argument, not a temporary' }),
    );

    expect(a.decline).toContain('an argument');
    expect(a.name).toBeNull();
  });

  it('throws on a bare error string that is not JSON', () => {
    expect(() => parseAnalysis('Class not found: M4Demo')).toThrow();
  });
});

describe('inline-temporary start-preview parsing', () => {
  it('reads the token, totals, name, and first page', () => {
    const start = parseStartPreview(startJson());

    expect(start.token).toBe('tok');
    expect(start.total).toBe(1);
    expect(start.name).toBe('t');
    expect(start.page.changes).toHaveLength(1);
    expect(start.page.done).toBe(true);
  });

  it('parses the single method-recompile change with the temporary inlined', () => {
    const [change] = parseStartPreview(startJson()).page.changes;

    expect(change.kind).toBe('methodRecompile');
    expect(change.selector).toBe('report');
    expect(change.newSource).not.toContain('t :=');
  });

  it('surfaces a hard decline in the out-of-scope payload', () => {
    const start = parseStartPreview(
      startJson({
        total: 0,
        outOfScope: {
          references: 0,
          skipped: 0,
          collision: null,
          decline: 'the temporary is assigned more than once',
        },
        page: { changes: [], nextOffset: 0, done: true },
      }),
    );

    expect(start.outOfScope.decline).toContain('assigned more than once');
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
    expect(() => parseStartPreview('Class not found: M4Demo')).toThrow();
  });

  it('defaults missing name, out-of-scope, and page fields defensively', () => {
    const start = parseStartPreview(JSON.stringify({ token: 'tok' }));

    expect(start.name).toBe('');
    expect(start.outOfScope).toEqual({ references: 0, skipped: 0, collision: null, decline: null });
    expect(start.page).toEqual({ changes: [], nextOffset: 0, done: true });
  });
});

describe('inline-temporary page and apply parsing', () => {
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
      JSON.stringify({ applied: 1, failed: [{ id: '1', label: 'M4Demo>>report', error: 'boom' }] }),
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

describe('inline-temporary change label', () => {
  it('labels a change on each side', () => {
    expect(inlineTemporaryChangeLabel(recompile)).toBe('M4Demo>>report');
    expect(inlineTemporaryChangeLabel({ ...recompile, isMeta: true })).toBe('M4Demo class>>report');
  });
});
