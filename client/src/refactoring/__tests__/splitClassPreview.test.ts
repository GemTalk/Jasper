import { describe, it, expect } from 'vitest';
import {
  parseAnalysis,
  parseCandidates,
  parseStartPreview,
  parsePage,
  parseApplyResult,
  splitChangeLabel,
  SplitChange,
} from '../splitClassPreview';

/**
 * Unit-tests the pure split-class parsers: the source's instance-variable candidates, the
 * pre-flight analysis (viable + decline), the paginated preview envelope (including the pre-start
 * `{decline}` shape and the classAdd row), the page, and the apply result (success / error /
 * zero-applied). Defensive parsing throws on malformed payloads. No mocks.
 */

describe('split-class parsers', () => {
  it('reads the source instance-variable candidates', () => {
    const json = JSON.stringify({
      sourceClass: 'Person',
      instVars: [{ name: 'street' }, { name: 'city' }, { name: 'zip' }],
    });

    const c = parseCandidates(json);

    expect(c.sourceClass).toBe('Person');
    expect(c.instVars.map((v) => v.name)).toEqual(['street', 'city', 'zip']);
  });

  it('yields an empty candidate list when the source has no own ivars', () => {
    const c = parseCandidates(JSON.stringify({ sourceClass: 'Person', instVars: [] }));

    expect(c.instVars).toEqual([]);
  });

  it('reads a viable pre-flight analysis', () => {
    const a = parseAnalysis(
      JSON.stringify({
        decline: null,
        newClass: 'Address',
        sourceClass: 'Person',
        movableCount: 4,
        affectedCount: 7,
      }),
    );

    expect(a.decline).toBeNull();
    expect(a.newClass).toBe('Address');
    expect(a.sourceClass).toBe('Person');
    expect(a.movableCount).toBe(4);
    expect(a.affectedCount).toBe(7);
  });

  it('surfaces an analysis decline', () => {
    const a = parseAnalysis(
      JSON.stringify({ decline: 'a class named Address already exists', movableCount: 0 }),
    );

    expect(a.decline).toBe('a class named Address already exists');
  });

  it('surfaces a bare pre-start decline through outOfScope', () => {
    const s = parseStartPreview(JSON.stringify({ decline: 'Class not found: Person' }));

    expect(s.token).toBe('');
    expect(s.outOfScope.decline).toBe('Class not found: Person');
    expect(s.page.done).toBe(true);
  });

  it('reads a start preview with a classAdd first page', () => {
    const s = parseStartPreview(
      JSON.stringify({
        token: 'tok',
        total: 3,
        newClass: 'Address',
        sourceClass: 'Person',
        outOfScope: { decline: null, note: 'instances not migrated' },
        page: {
          changes: [
            {
              id: '1',
              kind: 'classAdd',
              className: 'Address',
              isMeta: false,
              selector: null,
              category: null,
              oldSource: '',
              newSource: "Object subclass: 'Address'",
            },
          ],
          nextOffset: 2,
          done: false,
        },
      }),
    );

    expect(s.token).toBe('tok');
    expect(s.newClass).toBe('Address');
    expect(s.sourceClass).toBe('Person');
    expect(s.page.changes[0].kind).toBe('classAdd');
    expect(s.outOfScope.note).toContain('not migrated');
  });

  it('throws on a change with an unknown kind', () => {
    const page = JSON.stringify({ changes: [{ id: '1', kind: 'bogus', className: 'X' }] });

    expect(() => parsePage(page)).toThrow(/unknown kind/);
  });

  it('reads a page and its next offset', () => {
    const p = parsePage(
      JSON.stringify({
        changes: [
          {
            id: '2',
            kind: 'methodAdd',
            className: 'Address',
            isMeta: false,
            selector: 'street',
            category: 'accessing',
            oldSource: '',
            newSource: 'street\n\t^street',
          },
        ],
        nextOffset: 4,
        done: true,
      }),
    );

    expect(p.changes).toHaveLength(1);
    expect(p.nextOffset).toBe(4);
    expect(p.done).toBe(true);
  });

  it('reads a successful apply result', () => {
    const r = parseApplyResult(JSON.stringify({ applied: 6, committed: false, failed: [] }));

    expect(r.applied).toBe(6);
    expect(r.committed).toBe(false);
    expect(r.failed).toEqual([]);
    expect(r.error).toBeUndefined();
  });

  it('reads an apply error envelope', () => {
    const r = parseApplyResult(JSON.stringify({ applied: 0, failed: [], error: 'engine blew up' }));

    expect(r.error).toBe('engine blew up');
    expect(r.applied).toBe(0);
  });

  it('reads a zero-applied apply with a failed change', () => {
    const r = parseApplyResult(
      JSON.stringify({
        applied: 0,
        failed: [{ id: '3', label: 'Person>>#foo', error: 'does not compile' }],
      }),
    );

    expect(r.applied).toBe(0);
    expect(r.failed[0].label).toBe('Person>>#foo');
    expect(r.failed[0].error).toBe('does not compile');
  });

  it('labels the new-class row, a moved method, a reparent, and a definition edit', () => {
    const add: SplitChange = {
      id: '1',
      kind: 'classAdd',
      dictName: null,
      className: 'Address',
      isMeta: false,
      selector: null,
      category: null,
      oldSource: '',
      newSource: 'x',
    };
    const method: SplitChange = { ...add, id: '2', kind: 'methodAdd', selector: 'street' };
    const reparent: SplitChange = { ...add, id: '3', kind: 'classReparent', className: 'Employee' };
    const defEdit: SplitChange = {
      ...add,
      id: '4',
      kind: 'classDefinitionEdit',
      className: 'Person',
    };

    expect(splitChangeLabel(add)).toContain('new class');
    expect(splitChangeLabel(method)).toContain('Address>>street');
    expect(splitChangeLabel(reparent)).toContain('recompiled');
    expect(splitChangeLabel(defEdit)).toContain('definition');
  });
});
