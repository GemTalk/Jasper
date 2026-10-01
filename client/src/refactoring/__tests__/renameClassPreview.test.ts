import { describe, it, expect } from 'vitest';
import {
  parseStartPreview,
  parsePage,
  parseApplyResult,
  isStructuralChange,
  classChangeLabel,
  validateNewClassName,
  ClassRenameChange,
} from '../renameClassPreview';

const renameChange = {
  id: '1',
  kind: 'classRename',
  dictName: 'UserGlobals',
  className: 'Foo',
  isMeta: false,
  selector: null,
  newName: 'Bar',
  newSelector: null,
  category: null,
  oldSource: "Object subclass: 'Foo'",
  newSource: "Object subclass: 'Bar'",
};
const reparentChange = {
  id: '2',
  kind: 'classReparent',
  dictName: 'UserGlobals',
  className: 'Sub',
  isMeta: false,
  selector: null,
  newName: null,
  category: null,
  oldSource: "Foo subclass: 'Sub'",
  newSource: "Bar subclass: 'Sub'",
};
const refChange = {
  id: '3',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Other',
  isMeta: false,
  selector: 'usesFoo',
  newName: null,
  category: 'making',
  oldSource: 'usesFoo ^Foo new',
  newSource: 'usesFoo ^Bar new',
};

function startJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    token: 'tok',
    total: 3,
    oldName: 'Foo',
    newName: 'Bar',
    outOfScope: { references: 2, descendants: 1, skipped: 0, collision: null },
    skippedMethods: [],
    page: { changes: [renameChange, reparentChange, refChange], nextOffset: 4, done: true },
    ...over,
  });
}

describe('rename-class preview parsing', () => {
  it('reads the totals, names, and out-of-scope warnings from the start envelope', () => {
    const start = parseStartPreview(startJson());

    expect(start.token).toBe('tok');
    expect(start.total).toBe(3);
    expect(start.oldName).toBe('Foo');
    expect(start.newName).toBe('Bar');
    expect(start.outOfScope.references).toBe(2);
    expect(start.outOfScope.descendants).toBe(1);
    expect(start.outOfScope.collision).toBeNull();
  });

  it('parses all three change kinds with the new class name on the rename', () => {
    const start = parseStartPreview(startJson());

    expect(start.page.changes.map((c) => c.kind)).toEqual([
      'classRename',
      'classReparent',
      'methodRecompile',
    ]);
    expect(start.page.changes[0].newName).toBe('Bar');
  });

  it('surfaces a name-collision reason when the new name is in use', () => {
    const start = parseStartPreview(
      startJson({
        outOfScope: {
          references: 0,
          descendants: 0,
          skipped: 0,
          collision: 'the name Bar is already in use',
        },
      }),
    );

    expect(start.outOfScope.collision).toBe('the name Bar is already in use');
  });

  it('throws when the stone returns a bare error string instead of an envelope', () => {
    expect(() => parseStartPreview('Class not found: Foo')).toThrow();
  });

  it('reads a later page and its done flag', () => {
    const page = parsePage(JSON.stringify({ changes: [refChange], nextOffset: 5, done: false }));

    expect(page.changes).toHaveLength(1);
    expect(page.done).toBe(false);
  });

  it('throws on an expired-session page envelope', () => {
    expect(() =>
      parsePage(JSON.stringify({ error: 'preview session expired', changes: [] })),
    ).toThrow('preview session expired');
  });

  it('reads the applied count and failures from an apply result', () => {
    const result = parseApplyResult(
      JSON.stringify({
        applied: 2,
        failed: [{ id: '3', label: 'Other', error: 'boom' }],
      }),
    );

    expect(result.applied).toBe(2);
    expect(result.failed[0].error).toBe('boom');
  });

  it('reads whether the rename itself failed, apart from a failed re-parent after it', () => {
    // A re-parent that fails after the rename landed is a partial apply the client arms an
    // Undo for; only a failed #classRename leaves nothing to undo.
    const landed = parseApplyResult(
      JSON.stringify({
        applied: 1,
        failed: [{ id: '2', label: 'Sub', error: 'x' }],
        renameFailed: false,
      }),
    );
    const failed = parseApplyResult(
      JSON.stringify({
        applied: 0,
        failed: [{ id: '1', label: 'Base', error: 'x' }],
        renameFailed: true,
      }),
    );

    expect(landed.renameFailed).toBe(false);
    expect(failed.renameFailed).toBe(true);
    expect(parseApplyResult(JSON.stringify({ applied: 1, failed: [] })).renameFailed).toBe(false);
  });
});

describe('rename-class change classification and labels', () => {
  it('treats the class rename and reparent as structural (non-deselectable)', () => {
    expect(isStructuralChange(renameChange as ClassRenameChange)).toBe(true);
    expect(isStructuralChange(reparentChange as ClassRenameChange)).toBe(true);
  });

  it('treats a reference recompile as optional', () => {
    expect(isStructuralChange(refChange as ClassRenameChange)).toBe(false);
  });

  it('labels a reference recompile with its class and selector', () => {
    expect(classChangeLabel(refChange as ClassRenameChange)).toBe('Other>>usesFoo');
  });

  it('labels a class change with just the class name', () => {
    expect(classChangeLabel(renameChange as ClassRenameChange)).toBe('Foo');
  });
});

describe('new class name validation', () => {
  it('accepts a capitalised identifier that differs from the old name', () => {
    expect(validateNewClassName('BankAccount', 'Account')).toBeUndefined();
  });

  it('rejects an empty name', () => {
    expect(validateNewClassName('   ', 'Account')).toMatch(/enter a new class name/i);
  });

  it('rejects a name that is not a valid class identifier', () => {
    expect(validateNewClassName('2Bad', 'Account')).toMatch(/must be a letter/i);
  });

  it('rejects renaming to the same name', () => {
    expect(validateNewClassName('Account', 'Account')).toMatch(/different/i);
  });
});
