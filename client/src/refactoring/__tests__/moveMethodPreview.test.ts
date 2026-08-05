import { describe, it, expect } from 'vitest';
import {
  parseAnalysis,
  parseStartPreview,
  parsePage,
  parseApplyResult,
  moveChangeLabel,
  MoveChange,
} from '../moveMethodPreview';

describe('move-method analysis parsing', () => {
  it('reads the target class, movable count, and per-selector verdicts', () => {
    const analysis = parseAnalysis(
      JSON.stringify({
        targetClass: 'Target',
        globalDecline: null,
        movableCount: 1,
        selectors: [
          { selector: 'pure', decline: null },
          { selector: 'usesIvar', decline: '#usesIvar accesses instance variable(s)…' },
        ],
      }),
    );

    expect(analysis.targetClass).toBe('Target');
    expect(analysis.globalDecline).toBeNull();
    expect(analysis.movableCount).toBe(1);
    expect(analysis.selectors).toHaveLength(2);
    expect(analysis.selectors[0].decline).toBeNull();
    expect(analysis.selectors[1].decline).toContain('instance variable');
  });

  it('surfaces a global decline when the target is missing', () => {
    const analysis = parseAnalysis(
      JSON.stringify({
        targetClass: null,
        globalDecline: 'Target class Nope was not found.',
        movableCount: 0,
        selectors: [],
      }),
    );

    expect(analysis.targetClass).toBeNull();
    expect(analysis.globalDecline).toContain('was not found');
    expect(analysis.movableCount).toBe(0);
  });

  it('throws when the analysis is not an envelope', () => {
    expect(() => parseAnalysis('"Class not found: X"')).toThrow();
  });
});

describe('move-method start-preview parsing', () => {
  const startJson = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({
      token: 'tok',
      total: 2,
      targetClass: 'Target',
      movableCount: 1,
      outOfScope: { references: 0, skipped: 1, scope: 'class', collision: null, decline: null },
      skippedMethods: [{ selector: 'usesIvar', reason: 'accesses an ivar the target lacks' }],
      page: {
        changes: [
          {
            id: '1',
            kind: 'methodAdd',
            dictName: 'UserGlobals',
            className: 'Target',
            isMeta: false,
            selector: 'pure',
            category: 'accessing',
            oldSource: '',
            newSource: 'pure\n\t^ 42',
          },
          {
            id: '2',
            kind: 'methodRemove',
            dictName: 'UserGlobals',
            className: 'Source',
            isMeta: false,
            selector: 'pure',
            category: 'accessing',
            oldSource: 'pure\n\t^ 42',
            newSource: '',
          },
        ],
        nextOffset: 3,
        done: true,
      },
      ...over,
    });

  it('reads totals, the target, the skipped list, and the first page', () => {
    const start = parseStartPreview(startJson());

    expect(start.token).toBe('tok');
    expect(start.total).toBe(2);
    expect(start.targetClass).toBe('Target');
    expect(start.movableCount).toBe(1);
    expect(start.skippedMethods).toEqual([
      { selector: 'usesIvar', reason: 'accesses an ivar the target lacks' },
    ]);
    expect(start.page.changes).toHaveLength(2);
    expect(start.page.changes[0].kind).toBe('methodAdd');
    expect(start.page.changes[1].kind).toBe('methodRemove');
    expect(start.page.done).toBe(true);
  });

  it('carries a global decline through outOfScope', () => {
    const start = parseStartPreview(
      startJson({
        outOfScope: {
          references: 0,
          skipped: 0,
          scope: 'class',
          collision: null,
          decline: 'nothing to move',
        },
      }),
    );

    expect(start.outOfScope.decline).toBe('nothing to move');
  });

  it('rejects an add change carrying an unknown kind', () => {
    expect(() =>
      parseStartPreview(
        startJson({
          page: {
            changes: [{ id: '1', kind: 'bogus', className: 'X' }],
            nextOffset: 2,
            done: true,
          },
        }),
      ),
    ).toThrow();
  });
});

describe('move-method page + apply parsing', () => {
  it('parses a page of changes', () => {
    const page = parsePage(
      JSON.stringify({
        changes: [
          {
            id: '3',
            kind: 'methodAdd',
            className: 'Target',
            isMeta: true,
            selector: 'foo',
            category: null,
            oldSource: '',
            newSource: 'foo\n\t^ 1',
          },
        ],
        nextOffset: 4,
        done: true,
      }),
    );

    expect(page.changes).toHaveLength(1);
    expect(page.changes[0].isMeta).toBe(true);
  });

  it('surfaces an expired-session error from a page', () => {
    expect(() => parsePage(JSON.stringify({ error: 'preview session expired' }))).toThrow(
      /expired/,
    );
  });

  it('parses an apply result with failures', () => {
    const result = parseApplyResult(
      JSON.stringify({
        applied: 1,
        failed: [{ id: '2', label: 'Source', error: 'boom' }],
      }),
    );

    expect(result.applied).toBe(1);
    expect(result.failed).toEqual([{ id: '2', label: 'Source', error: 'boom' }]);
  });
});

describe('move change labels', () => {
  const change = (over: Partial<MoveChange>): MoveChange => ({
    id: '1',
    kind: 'methodAdd',
    dictName: null,
    className: 'Target',
    isMeta: false,
    selector: 'foo',
    category: null,
    oldSource: '',
    newSource: '',
    ...over,
  });

  it('tags an add as going onto the target', () => {
    expect(moveChangeLabel(change({ kind: 'methodAdd' }))).toBe('Target>>foo (add to target)');
  });

  it('tags a remove as leaving the source, with the class side marked', () => {
    expect(
      moveChangeLabel(change({ kind: 'methodRemove', className: 'Source', isMeta: true })),
    ).toBe('Source class>>foo (remove from source)');
  });
});
