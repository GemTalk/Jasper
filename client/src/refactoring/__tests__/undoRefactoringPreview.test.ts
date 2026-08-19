import { describe, it, expect } from 'vitest';
import {
  mirrorCaveat,
  deselectionNote,
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
      mechanism: 'changeSet',
      reverseKind: null,
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

  it('rejects a kind no undo can produce, rather than rendering it as something else', () => {
    // `classAdd` is a real engine kind that NO undo produces: a recorded inverse only ever
    // holds method kinds, and a reverse rename only ever holds classRename / classReparent /
    // classDefinitionEdit. If one showed up, rendering it as some other kind would be a lie
    // about what Undo is about to do — so it must be refused.
    expect(() =>
      parseUndoPage(
        `{"changes":[${JSON.stringify(change({ kind: 'classAdd' }))}],"nextOffset":0,"done":true}`,
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
    expect(undoActionLabel(c({ kind: 'methodAdd' }), 'changeSet')).toBe('Restore');
    expect(undoActionLabel(c({ kind: 'methodRemove' }), 'changeSet')).toBe('Delete');
    expect(undoActionLabel(c({ kind: 'methodRecompile' }), 'changeSet')).toBe('Revert');
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

describe('reverse-rename entries (#434)', () => {
  const classShape = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: '1',
    kind: 'classRename',
    dictName: 'UserGlobals',
    className: 'NewName',
    isMeta: false,
    selector: null,
    newName: 'OldName',
    category: null,
    oldSource: 'Object subclass: #NewName',
    newSource: 'Object subclass: #OldName',
    warning: null,
    ...over,
  });

  it('reads the mechanism and the mirrored kind from the status probe', () => {
    const s = parseUndoStatus(
      '{"available":true,"mechanism":"mirror","reverseKind":"instVarAdd","label":"x","total":3}',
    );
    expect(s.mechanism).toBe('mirror');
    expect(s.reverseKind).toBe('instVarAdd');
  });

  it('rejects a reverseKind it does not know, rather than passing it through', () => {
    expect(
      parseUndoStatus('{"available":true,"mechanism":"mirror","reverseKind":"wat","total":1}')
        .reverseKind,
    ).toBeNull();
  });

  it('defaults the mechanism to changeSet, so an older engine still reads correctly', () => {
    // An engine that predates the rename reversal answers no `mechanism` and only ever
    // records change-set entries.
    expect(parseUndoStatus('{"available":true,"label":"x","total":1}').mechanism).toBe('changeSet');
  });

  it('accepts a class-shape change, which only a reverse rename produces', () => {
    const page = parseUndoPage(
      `{"changes":[${JSON.stringify(classShape())}],"nextOffset":0,"done":true}`,
    );
    expect(page.changes[0].kind).toBe('classRename');
    expect(page.changes[0].selector).toBeNull();
    expect(page.changes[0].newName).toBe('OldName');
  });

  it('still rejects a METHOD change that arrives with no selector', () => {
    // Class-shape kinds legitimately have none; a method change with none is malformed and
    // would render as an unlabelled row.
    expect(() =>
      parseUndoPage(
        `{"changes":[${JSON.stringify(classShape({ kind: 'methodRecompile' }))}],"nextOffset":0,"done":true}`,
      ),
    ).toThrow(/no selector/);
  });

  it('labels a class-shape row by its class, showing both names for a rename', () => {
    const c = classShape() as unknown as UndoChange;
    expect(undoChangeLabel(c)).toBe('NewName → OldName');
    expect(undoChangeLabel({ ...c, newName: null })).toBe('NewName');
  });

  it('badges the class-shape kinds for what they do', () => {
    const at = (kind: string): string =>
      undoActionLabel(classShape({ kind }) as unknown as UndoChange, 'mirror');
    expect(at('classRename')).toBe('Rename back');
    expect(at('classReparent')).toBe('Re-version');
    expect(at('classDefinitionEdit')).toBe('Redefine');
  });

  it('reads a methodRecompile differently under each mechanism', () => {
    // Same kind, two meanings: restoring an earlier source vs rewriting a reference to
    // follow the name. The badge must not pick one and be wrong half the time.
    const c = classShape({ kind: 'methodRecompile', selector: 'foo' }) as unknown as UndoChange;
    expect(undoActionLabel(c, 'changeSet')).toBe('Revert');
    expect(undoActionLabel(c, 'mirror')).toBe('Rewrite');
  });

  it('states the caveat without claiming to be a rollback', () => {
    const c = mirrorCaveat('classRename');
    expect(c).toContain('not a rollback');
    expect(c).toContain('carried forward');
    expect(c).toContain('its own commit');
  });

  it('words the caveat per kind, because the honest one differs', () => {
    // Reversing an ADD deletes methods that use the variable; reversing a REMOVE cannot bring
    // values or dropped methods back. One generic sentence would misstate one of them.
    expect(mirrorCaveat('instVarAdd', 3)).toContain('DELETE 3 methods');
    expect(mirrorCaveat('instVarAdd', 1)).toContain('DELETE 1 method');
    expect(mirrorCaveat('instVarAdd', 0)).not.toContain('DELETE');
    expect(mirrorCaveat('instVarRemove')).toContain('does NOT restore the values');
    expect(mirrorCaveat('instVarRemove')).not.toContain('carried forward');
  });

  it('says what un-ticking actually does, per deselection semantics', () => {
    expect(deselectionNote('perChange')).toBeNull();
    expect(deselectionNote('ignored')).toContain('all-or-nothing');
    // The one that would otherwise read exactly backwards.
    expect(deselectionNote('dropsMethod')).toContain('DELETES it');
  });
});
