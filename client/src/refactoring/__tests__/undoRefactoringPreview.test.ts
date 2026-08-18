import { describe, it, expect } from 'vitest';
import {
  parseUndoStatus,
  parseUndoStartPreview,
  parseUndoPage,
  undoChangeLabel,
  undoActionLabel,
  undoSummary,
  UndoChange,
} from '../undoRefactoringPreview';

/**
 * The pure undo-preview model (#434). Two things matter most here and neither is
 * obvious from the types:
 *
 *  - the STATUS probe drives a menu's visibility, so a malformed or hostile payload
 *    has to read as "nothing to undo" rather than throw and take the menu with it;
 *  - the change KINDS read backwards in an inverse change set (a `methodAdd` is the
 *    undo putting back a method the refactoring DELETED), so the action label is the
 *    thing the user sees and it must not just echo the kind.
 */

// Deliberately typed loosely: some cases feed the parser a kind it must REJECT, which
// UndoChange's own union would not let us express.
const change = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '1',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: 'total',
  category: 'computing',
  oldSource: 'total ^ self sum',
  newSource: 'total ^ 40 + 2',
  warning: null,
  ...over,
});

describe('undo status', () => {
  it('reports what would be undone', () => {
    const s = parseUndoStatus(
      '{"available":true,"label":"Rename #total to #sum","engine":"GsRenameMethodRefactoring","sequence":3,"total":7}',
    );
    expect(s).toEqual({
      available: true,
      label: 'Rename #total to #sum',
      engine: 'GsRenameMethodRefactoring',
      sequence: 3,
      total: 7,
    });
  });

  it('reads an explicit "nothing recorded" as unavailable', () => {
    expect(parseUndoStatus('{"available":false}').available).toBe(false);
  });

  it('reads a non-JSON payload as unavailable rather than throwing', () => {
    // The probe runs on every session switch and drives a context key; a stone that
    // answers an error string must not break the menu.
    expect(parseUndoStatus('a MessageNotUnderstood occurred').available).toBe(false);
    expect(parseUndoStatus('[]').available).toBe(false);
    expect(parseUndoStatus('null').available).toBe(false);
  });

  it('falls back to a generic label when the stone recorded none', () => {
    expect(parseUndoStatus('{"available":true}').label).toBe('the last refactoring');
  });
});

describe('undo preview envelope', () => {
  const envelope = (over = ''): string =>
    `{"token":"t1","label":"Rename #total to #sum","engine":"GsRenameMethodRefactoring",` +
    `"sequence":2,"drifted":1,"total":3,` +
    `"page":{"changes":[${JSON.stringify(change())}],"nextOffset":2,"done":false}${over}}`;

  it('parses the start of a paginated preview', () => {
    const start = parseUndoStartPreview(envelope());
    expect(start.token).toBe('t1');
    expect(start.label).toBe('Rename #total to #sum');
    expect(start.total).toBe(3);
    expect(start.drifted).toBe(1);
    expect(start.page.changes).toHaveLength(1);
    expect(start.page.done).toBe(false);
    expect(start.page.nextOffset).toBe(2);
  });

  it('throws with the stone wording when there is nothing to undo', () => {
    expect(() =>
      parseUndoStartPreview('{"error":"There is no refactoring to undo in this session."}'),
    ).toThrow('There is no refactoring to undo in this session.');
  });

  it('carries a per-change drift warning through', () => {
    const page = parseUndoPage(
      `{"changes":[${JSON.stringify(change({ warning: 'Edited since the refactoring; undoing DISCARDS those edits.' }))}],"nextOffset":2,"done":true}`,
    );
    expect(page.changes[0].warning).toContain('DISCARDS');
  });

  it('rejects an unknown change kind rather than rendering it as something else', () => {
    // A class-shape kind can never appear in an inverse set; if one ever did, showing
    // it as a method change would be a lie about what Undo is about to do.
    expect(() =>
      parseUndoPage(
        `{"changes":[${JSON.stringify(change({ kind: 'classDefinitionEdit' }))}],"nextOffset":0,"done":true}`,
      ),
    ).toThrow(/unknown kind/);
  });

  it('throws on an error envelope from a later page', () => {
    expect(() => parseUndoPage('{"error":"preview session expired","changes":[]}')).toThrow(
      'preview session expired',
    );
  });

  it('keeps a null source as null (a restore has nothing on the left)', () => {
    const page = parseUndoPage(
      `{"changes":[${JSON.stringify(change({ kind: 'methodAdd', oldSource: null }))}],"nextOffset":0,"done":true}`,
    );
    expect(page.changes[0].oldSource).toBeNull();
    expect(page.changes[0].newSource).not.toBeNull();
  });
});

describe('labels', () => {
  const c = (over: Partial<UndoChange>): UndoChange =>
    ({ ...change(), ...over }) as unknown as UndoChange;

  it('names the method, with the side', () => {
    expect(undoChangeLabel(c({}))).toBe('Account>>total');
    expect(undoChangeLabel(c({ isMeta: true }))).toBe('Account class>>total');
  });

  it('names the ACTION undoing takes, not the change kind', () => {
    expect(undoActionLabel(c({ kind: 'methodAdd' }))).toBe('Restore');
    expect(undoActionLabel(c({ kind: 'methodRemove' }))).toBe('Delete');
    expect(undoActionLabel(c({ kind: 'methodRecompile' }))).toBe('Revert');
  });
});

describe('summary line', () => {
  it('says nothing about drift when there is none', () => {
    expect(undoSummary(3, 0)).toBe('3 changes will be reversed.');
    expect(undoSummary(1, 0)).toBe('1 change will be reversed.');
  });

  it('warns, in the plural or singular, when some changes are not a clean reversal', () => {
    expect(undoSummary(3, 1)).toContain('1 of them is');
    expect(undoSummary(3, 2)).toContain('2 of them are');
    expect(undoSummary(3, 2)).toContain('un-tick');
  });
});
