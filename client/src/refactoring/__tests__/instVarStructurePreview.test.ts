import { describe, it, expect } from 'vitest';
import {
  parseAnalysis,
  parseStartPreview,
  parsePage,
  parseApplyResult,
  ivarChangeLabel,
  IvarChange,
} from '../instVarStructurePreview';

describe('instance-variable structure preview parsing', () => {
  describe('parseAnalysis', () => {
    it('reads a viable analysis with the top class and affected count', () => {
      const a = parseAnalysis(JSON.stringify({ decline: null, topClass: 'Mid', affectedCount: 3 }));

      expect(a.decline).toBeNull();
      expect(a.topClass).toBe('Mid');
      expect(a.affectedCount).toBe(3);
    });

    it('surfaces a decline reason', () => {
      const a = parseAnalysis(
        JSON.stringify({ decline: 'still uses it', topClass: null, affectedCount: 0 }),
      );

      expect(a.decline).toBe('still uses it');
    });

    it('throws on a bare (non-JSON) engine error string', () => {
      expect(() => parseAnalysis('Class not found: Foo')).toThrow();
    });
  });

  describe('parseStartPreview', () => {
    const base = {
      token: 'tok',
      total: 2,
      topClass: 'Base',
      outOfScope: { decline: null, note: 'Existing instances keep their prior version.' },
      page: { changes: [], nextOffset: 1, done: true },
    };

    it('reads totals, the top class, and the migration note', () => {
      const s = parseStartPreview(JSON.stringify(base));

      expect(s.token).toBe('tok');
      expect(s.total).toBe(2);
      expect(s.topClass).toBe('Base');
      expect(s.outOfScope.note).toContain('prior version');
    });

    it('carries a blocking decline in the banner', () => {
      const s = parseStartPreview(
        JSON.stringify({ ...base, outOfScope: { decline: 'no subclasses', note: null } }),
      );

      expect(s.outOfScope.decline).toBe('no subclasses');
    });

    it('parses a page of changes including a classDefinitionEdit', () => {
      const s = parseStartPreview(
        JSON.stringify({
          ...base,
          page: {
            changes: [
              {
                id: '1',
                kind: 'classDefinitionEdit',
                dictName: 'UserGlobals',
                className: 'Base',
                isMeta: false,
                oldSource: "Object subclass: 'Base' instVarNames: #( 'a')",
                newSource: "Object subclass: 'Base' instVarNames: #( 'a' 'b')",
              },
            ],
            nextOffset: 2,
            done: false,
          },
        }),
      );

      expect(s.page.changes[0].kind).toBe('classDefinitionEdit');
      expect(s.page.changes[0].newSource).toContain("'b'");
    });

    it('throws when the token is missing', () => {
      expect(() => parseStartPreview(JSON.stringify({ total: 1 }))).toThrow(/token/);
    });
  });

  describe('parsePage', () => {
    it('parses a reparent change (unchanged definition)', () => {
      const p = parsePage(
        JSON.stringify({
          changes: [
            {
              id: '2',
              kind: 'classReparent',
              className: 'Sub',
              isMeta: false,
              oldSource: 'x',
              newSource: 'x',
            },
          ],
          nextOffset: 3,
          done: true,
        }),
      );

      expect(p.changes[0].kind).toBe('classReparent');
    });

    it('throws the engine error on an expired-session page', () => {
      expect(() => parsePage(JSON.stringify({ error: 'preview session expired' }))).toThrow(
        /expired/,
      );
    });

    it('rejects an unknown change kind', () => {
      expect(() =>
        parsePage(JSON.stringify({ changes: [{ id: '1', kind: 'nope', className: 'X' }] })),
      ).toThrow(/unknown kind/);
    });
  });

  describe('parseApplyResult', () => {
    it('reads the applied count and failures', () => {
      const r = parseApplyResult(
        JSON.stringify({ applied: 3, failed: [{ id: '1', label: 'Base', error: 'boom' }] }),
      );

      expect(r.applied).toBe(3);
      expect(r.failed[0].error).toBe('boom');
    });
  });

  describe('ivarChangeLabel', () => {
    const change = (over: Partial<IvarChange>): IvarChange => ({
      id: '1',
      kind: 'classDefinitionEdit',
      dictName: null,
      className: 'Base',
      isMeta: false,
      selector: null,
      category: null,
      oldSource: '',
      newSource: '',
      ...over,
    });

    it('labels a definition edit', () => {
      expect(ivarChangeLabel(change({ kind: 'classDefinitionEdit' }))).toBe('Base (definition)');
    });

    it('labels a reparent', () => {
      expect(ivarChangeLabel(change({ kind: 'classReparent' }))).toBe('Base (recompiled)');
    });

    it('labels a method recompile', () => {
      expect(ivarChangeLabel(change({ kind: 'methodRecompile', selector: 'compute' }))).toBe(
        'Base>>compute',
      );
    });
  });
});
