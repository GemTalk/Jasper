import { describe, it, expect } from 'vitest';
import {
  parseAnalysis,
  parseStartPreview,
  parsePage,
  parseApplyResult,
  pushChangeLabel,
  PushChange,
} from '../pushMethodPreview';

describe('push-method preview parsing', () => {
  describe('parseAnalysis', () => {
    it('reads the resolved target, movable count, and per-selector declines', () => {
      const json = JSON.stringify({
        targetClass: 'Base',
        globalDecline: null,
        movableCount: 1,
        selectors: [
          { selector: 'foo', decline: null },
          { selector: 'bar', decline: 'Cannot push up #bar: it sends super.' },
        ],
      });

      const a = parseAnalysis(json);

      expect(a.targetClass).toBe('Base');
      expect(a.globalDecline).toBeNull();
      expect(a.movableCount).toBe(1);
      expect(a.selectors).toHaveLength(2);
      expect(a.selectors[1].decline).toContain('super');
    });

    it('accepts a null target (push-down lands in many subclasses)', () => {
      const a = parseAnalysis(
        JSON.stringify({ targetClass: null, globalDecline: null, movableCount: 2, selectors: [] }),
      );

      expect(a.targetClass).toBeNull();
      expect(a.movableCount).toBe(2);
    });

    it('surfaces a global decline', () => {
      const a = parseAnalysis(
        JSON.stringify({
          targetClass: null,
          globalDecline: 'Cannot push down: Leaf has no subclasses.',
          movableCount: 0,
          selectors: [],
        }),
      );

      expect(a.globalDecline).toContain('no subclasses');
    });

    it('reads a per-selector overwrite warning', () => {
      const a = parseAnalysis(
        JSON.stringify({
          targetClass: 'Base',
          globalDecline: null,
          movableCount: 1,
          selectors: [{ selector: 'foo', decline: null, warning: 'overwrites Base>>foo' }],
        }),
      );

      expect(a.selectors[0].warning).toBe('overwrites Base>>foo');
    });

    it('throws on a bare (non-JSON) engine error string', () => {
      expect(() => parseAnalysis('Source class not found: Foo')).toThrow();
    });
  });

  describe('parseStartPreview', () => {
    const base = {
      token: 'tok',
      total: 3,
      targetClass: 'Base',
      movableCount: 1,
      outOfScope: { references: 0, skipped: 0, scope: 'class', collision: null, decline: null },
      skippedMethods: [],
      page: { changes: [], nextOffset: 1, done: true },
    };

    it('reads totals, the target, and an empty page', () => {
      const s = parseStartPreview(JSON.stringify(base));

      expect(s.token).toBe('tok');
      expect(s.total).toBe(3);
      expect(s.targetClass).toBe('Base');
      expect(s.movableCount).toBe(1);
      expect(s.page.done).toBe(true);
    });

    it('reads skipped methods and a declining out-of-scope banner', () => {
      const s = parseStartPreview(
        JSON.stringify({
          ...base,
          outOfScope: { ...base.outOfScope, decline: 'Cannot push down: no subclasses.' },
          skippedMethods: [{ selector: 'bar', reason: 'sends super' }],
        }),
      );

      expect(s.outOfScope.decline).toContain('no subclasses');
      expect(s.skippedMethods).toEqual([{ selector: 'bar', reason: 'sends super' }]);
    });

    it('parses the changes in the first page', () => {
      const s = parseStartPreview(
        JSON.stringify({
          ...base,
          page: {
            changes: [
              {
                id: '1',
                kind: 'methodAdd',
                dictName: 'UserGlobals',
                className: 'Base',
                isMeta: false,
                selector: 'foo',
                category: 'accessing',
                newSource: 'foo ^ 1',
              },
            ],
            nextOffset: 2,
            done: false,
          },
        }),
      );

      expect(s.page.changes).toHaveLength(1);
      expect(s.page.changes[0].kind).toBe('methodAdd');
      expect(s.page.done).toBe(false);
    });

    it('throws when the token is missing', () => {
      expect(() => parseStartPreview(JSON.stringify({ total: 1 }))).toThrow(/token/);
    });
  });

  describe('parsePage', () => {
    it('parses a page of changes', () => {
      const p = parsePage(
        JSON.stringify({
          changes: [
            {
              id: '2',
              kind: 'methodRemove',
              className: 'Base',
              isMeta: false,
              oldSource: 'foo ^ 1',
            },
          ],
          nextOffset: 3,
          done: true,
        }),
      );

      expect(p.changes[0].kind).toBe('methodRemove');
      expect(p.changes[0].oldSource).toBe('foo ^ 1');
      expect(p.done).toBe(true);
    });

    it('reads a data-loss warning on an overwrite change and defaults it to null otherwise', () => {
      const p = parsePage(
        JSON.stringify({
          changes: [
            {
              id: '1',
              kind: 'methodAdd',
              className: 'Sub',
              isMeta: false,
              oldSource: 'foo ^ 99',
              newSource: 'foo ^ 1',
              warning: 'overwrites Sub>>foo',
            },
            { id: '2', kind: 'methodAdd', className: 'Other', isMeta: false, newSource: 'foo ^ 1' },
          ],
          nextOffset: 3,
          done: true,
        }),
      );

      expect(p.changes[0].warning).toBe('overwrites Sub>>foo');
      expect(p.changes[1].warning).toBeNull();
    });

    it('throws the engine error carried on an expired-session page', () => {
      expect(() =>
        parsePage(JSON.stringify({ error: 'preview session expired', changes: [] })),
      ).toThrow(/expired/);
    });

    it('rejects an unknown change kind', () => {
      expect(() =>
        parsePage(JSON.stringify({ changes: [{ id: '1', kind: 'nope', className: 'X' }] })),
      ).toThrow(/unknown kind/);
    });
  });

  describe('parseApplyResult', () => {
    it('reads the applied count and an empty failure list', () => {
      const r = parseApplyResult(JSON.stringify({ applied: 3, failed: [] }));

      expect(r.applied).toBe(3);
      expect(r.failed).toEqual([]);
    });

    it('reads a reported failure', () => {
      const r = parseApplyResult(
        JSON.stringify({ applied: 1, failed: [{ id: '2', label: 'Base', error: 'boom' }] }),
      );

      expect(r.failed).toHaveLength(1);
      expect(r.failed[0].error).toBe('boom');
    });
  });

  describe('pushChangeLabel', () => {
    const change = (over: Partial<PushChange>): PushChange => ({
      id: '1',
      kind: 'methodAdd',
      dictName: null,
      className: 'Base',
      isMeta: false,
      selector: 'foo',
      category: null,
      oldSource: '',
      newSource: '',
      warning: null,
      ...over,
    });

    it('tags a methodAdd as add-to-target', () => {
      expect(pushChangeLabel(change({ kind: 'methodAdd' }))).toBe('Base>>foo (add to target)');
    });

    it('tags an overwriting methodAdd as overwrite-existing', () => {
      expect(pushChangeLabel(change({ kind: 'methodAdd', warning: 'overwrites Base>>foo' }))).toBe(
        'Base>>foo (overwrite existing)',
      );
    });

    it('tags a methodRemove as remove-from-source and marks the class side', () => {
      expect(pushChangeLabel(change({ kind: 'methodRemove', isMeta: true }))).toBe(
        'Base class>>foo (remove from source)',
      );
    });
  });
});
