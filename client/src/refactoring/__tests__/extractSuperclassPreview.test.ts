import { describe, it, expect } from 'vitest';
import {
  parseAnalysis,
  parseCandidates,
  parseStartPreview,
  parsePage,
  parseApplyResult,
  extractSuperChangeLabel,
  ExtractSuperChange,
} from '../extractSuperclassPreview';

/**
 * Unit-tests the pure extract-superclass parsers: the member-candidate classification, the
 * pre-flight analysis, the paginated preview envelope (including the new classAdd row), and the
 * apply result. Defensive parsing throws on malformed payloads. No mocks.
 */

describe('extract-superclass parsers', () => {
  it('reads the classified member candidates', () => {
    const json = JSON.stringify({
      decline: null,
      sharedParent: 'Animal',
      methods: [
        { selector: 'eat', kind: 'identical', defaultChecked: true, reason: null },
        { selector: 'describe', kind: 'divergent', defaultChecked: false, reason: null },
        { selector: 'greet', kind: 'unhoistable', defaultChecked: false, reason: 'sends super' },
      ],
      instVars: [{ name: 'name', kind: 'identical', defaultChecked: true }],
    });

    const c = parseCandidates(json);

    expect(c.sharedParent).toBe('Animal');
    expect(c.methods.map((m) => m.kind)).toEqual(['identical', 'divergent', 'unhoistable']);
    expect(c.methods[0].defaultChecked).toBe(true);
    expect(c.methods[2].reason).toBe('sends super');
    expect(c.instVars[0].name).toBe('name');
  });

  it('surfaces a candidates decline', () => {
    const c = parseCandidates(JSON.stringify({ decline: 'nope', methods: [], instVars: [] }));

    expect(c.decline).toBe('nope');
  });

  it('reads the pre-flight analysis', () => {
    const a = parseAnalysis(
      JSON.stringify({ decline: null, newClass: 'Pet', sharedParent: 'Animal', affectedCount: 4 }),
    );

    expect(a.decline).toBeNull();
    expect(a.newClass).toBe('Pet');
    expect(a.affectedCount).toBe(4);
  });

  it('surfaces a bare pre-start decline through outOfScope', () => {
    const s = parseStartPreview(JSON.stringify({ decline: 'Class not found: Dog' }));

    expect(s.token).toBe('');
    expect(s.outOfScope.decline).toBe('Class not found: Dog');
  });

  it('reads a start preview with a classAdd first page', () => {
    const s = parseStartPreview(
      JSON.stringify({
        token: 'tok',
        total: 2,
        newClass: 'Pet',
        sharedParent: 'Animal',
        outOfScope: { decline: null, note: 'instances not migrated' },
        page: {
          changes: [
            {
              id: '1',
              kind: 'classAdd',
              className: 'Pet',
              isMeta: false,
              selector: null,
              category: null,
              oldSource: '',
              newSource: "Animal subclass: 'Pet'",
            },
          ],
          nextOffset: 2,
          done: false,
        },
      }),
    );

    expect(s.newClass).toBe('Pet');
    expect(s.page.changes[0].kind).toBe('classAdd');
    expect(s.outOfScope.note).toContain('not migrated');
  });

  // An unrecognised classification must FAIL CLOSED. buildMemberPicks withholds 'unhoistable'
  // from the checklist but offers 'partial', so defaulting to 'partial' would put a member we
  // cannot classify in front of the user as opt-in-able without knowing whether it compiles.
  it('classifies an unknown member kind as unhoistable, not as offerable', () => {
    const c = parseCandidates(
      JSON.stringify({
        decline: null,
        methods: [
          { selector: 'mystery', kind: 'somethingNew', defaultChecked: true, reason: null },
          { selector: 'truncated', defaultChecked: false, reason: null },
        ],
        instVars: [{ name: 'odd', kind: 42, defaultChecked: true }],
      }),
    );

    expect(c.methods.map((m) => m.kind)).toEqual(['unhoistable', 'unhoistable']);
    expect(c.instVars[0].kind).toBe('unhoistable');
  });

  it('throws on a change with an unknown kind', () => {
    const page = JSON.stringify({ changes: [{ id: '1', kind: 'bogus', className: 'X' }] });

    expect(() => parsePage(page)).toThrow(/unknown kind/);
  });

  it('reads an apply result', () => {
    const r = parseApplyResult(JSON.stringify({ applied: 5, committed: false, failed: [] }));

    expect(r.applied).toBe(5);
    expect(r.committed).toBe(false);
    expect(r.failed).toEqual([]);
  });

  it('labels the new-superclass row and a hoisted method', () => {
    const add: ExtractSuperChange = {
      id: '1',
      kind: 'classAdd',
      dictName: null,
      className: 'Pet',
      isMeta: false,
      selector: null,
      category: null,
      oldSource: '',
      newSource: 'x',
    };
    const hoisted: ExtractSuperChange = { ...add, id: '2', kind: 'methodAdd', selector: 'eat' };

    expect(extractSuperChangeLabel(add)).toContain('new superclass');
    expect(extractSuperChangeLabel(hoisted)).toContain('hoisted up');
  });
});
