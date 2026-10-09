import { describe, it, expect } from 'vitest';
import { getClassHierarchy } from '../getClassHierarchy';

/**
 * The hierarchy query says, per row, whether the symbol list still binds that class OBJECT.
 *
 * "No dictionary held it" is a symptom with more than one cause, so the stone compares the class
 * bound under the name against the class in hand: a different one means this row is an older
 * version, nothing at all means it was removed. Only that distinction lets the pane say something
 * a user can act on.
 */

/** The tab-separated line the stone emits per row. */
const line = (dictName: string, className: string, kind: string, idx: number, binding: string) =>
  [dictName, className, kind, String(idx), binding].join('\t');

describe('getClassHierarchy — what binds each row', () => {
  it('reads a placed class as bound', () => {
    const rows = getClassHierarchy(
      () => line('UserGlobals', 'Parent', 'superclass', 1, 'bound'),
      'Child',
    );

    expect(rows[0]).toMatchObject({ className: 'Parent', dictIndex: 1, binding: 'bound' });
  });

  it('reads an older version as superseded, with no dictionary', () => {
    const rows = getClassHierarchy(
      () => line('', 'Parent', 'superclass', 0, 'superseded'),
      'Child',
    );

    expect(rows[0]).toMatchObject({ className: 'Parent', binding: 'superseded' });
    expect(rows[0].dictIndex).toBeUndefined();
  });

  it('reads a removed class as unbound', () => {
    const rows = getClassHierarchy(() => line('', 'Parent', 'superclass', 0, 'unbound'), 'Child');

    expect(rows[0].binding).toBe('unbound');
  });

  it('reads a class held only under another name as aliased, with no dictionary', () => {
    // A dictionary holds it, but not under its own name, so no (dictionary, name) lookup reaches it.
    const rows = getClassHierarchy(() => line('', 'Parent', 'superclass', 0, 'aliased'), 'Child');

    expect(rows[0]).toMatchObject({ className: 'Parent', binding: 'aliased' });
    expect(rows[0].dictIndex).toBeUndefined();
  });

  it('asks the stone to compare the bound class by identity', () => {
    let code = '';
    getClassHierarchy((c) => {
      code = c;
      return '';
    }, 'Child');

    // Identity, not "was a dictionary found" — the whole point of the column.
    expect(code).toContain('objectNamed:');
    expect(code).toContain('cur ~~ each');
    expect(code).toContain("'superseded'");
  });

  it('falls back sanely on a stone whose payload predates the column', () => {
    // Four fields, no binding. A placed class is bound; an unplaced one is reported as unbound
    // rather than diagnosed as superseded, which would be a claim the payload never made.
    const older = (idx: number) => ['UserGlobals', 'Parent', 'superclass', String(idx)].join('\t');

    expect(getClassHierarchy(() => older(1), 'Child')[0].binding).toBe('bound');
    expect(getClassHierarchy(() => older(0), 'Child')[0].binding).toBe('unbound');
  });
});
