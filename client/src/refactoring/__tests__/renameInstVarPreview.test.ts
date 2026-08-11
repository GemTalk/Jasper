import { describe, it, expect } from 'vitest';
import {
  parseRenameChanges,
  parseRenamePreview,
  parseRenameApplyResult,
  orderChangesClassDefFirst,
  deselectedIdsFrom,
  deselectedLabels,
  changeLabel,
  validateNewIvarName,
  isStructuralChange,
  RenameChange,
} from '../renameInstVarPreview';

const methodChange = (over: Partial<RenameChange> = {}): RenameChange => ({
  id: '1',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Foo',
  isMeta: false,
  selector: 'bar',
  category: 'accessing',
  oldSource: 'bar ^count',
  newSource: 'bar ^tally',
  ...over,
});

const classDefChange = (over: Partial<RenameChange> = {}): RenameChange => ({
  id: '9',
  kind: 'classDefinitionEdit',
  dictName: 'UserGlobals',
  className: 'Foo',
  isMeta: false,
  selector: null,
  category: null,
  oldSource: "Object subclass: 'Foo' instVarNames: #( count )",
  newSource: "Object subclass: 'Foo' instVarNames: #( tally )",
  ...over,
});

describe('parseRenameChanges', () => {
  it('parses a change set of method recompiles and a class-definition edit', () => {
    const json = JSON.stringify([methodChange(), classDefChange()]);

    const changes = parseRenameChanges(json);

    expect(changes).toHaveLength(2);
    expect(changes[0].kind).toBe('methodRecompile');
    expect(changes[0].selector).toBe('bar');
    expect(changes[0].category).toBe('accessing');
    expect(changes[1].kind).toBe('classDefinitionEdit');
    expect(changes[1].selector).toBeNull();
    expect(changes[1].category).toBeNull();
  });

  it('accepts an empty change set', () => {
    expect(parseRenameChanges('[]')).toEqual([]);
  });

  it('rejects a bare error string from the stone', () => {
    // The engine query returns a plain string (not JSON) when the class is absent.
    expect(() => parseRenameChanges('Class not found: Foo')).toThrow();
  });

  it('rejects a non-array payload', () => {
    expect(() => parseRenameChanges('{"id":"1"}')).toThrow();
  });

  it('rejects a change with an unknown kind', () => {
    const json = JSON.stringify([{ ...methodChange(), kind: 'deleteEverything' }]);
    expect(() => parseRenameChanges(json)).toThrow(/unknown kind/);
  });

  it('rejects a change missing required fields', () => {
    const json = JSON.stringify([{ id: '1', kind: 'methodRecompile' }]);
    expect(() => parseRenameChanges(json)).toThrow();
  });
});

describe('orderChangesClassDefFirst', () => {
  it('moves class-definition edits ahead of method recompiles', () => {
    const ordered = orderChangesClassDefFirst([
      methodChange({ id: '1' }),
      methodChange({ id: '2' }),
      classDefChange({ id: '3' }),
    ]);

    expect(ordered.map((c) => c.id)).toEqual(['3', '1', '2']);
  });

  it('preserves the relative order within each kind', () => {
    const ordered = orderChangesClassDefFirst([
      methodChange({ id: 'm1' }),
      classDefChange({ id: 'd1' }),
      methodChange({ id: 'm2' }),
      classDefChange({ id: 'd2' }),
    ]);

    expect(ordered.map((c) => c.id)).toEqual(['d1', 'd2', 'm1', 'm2']);
  });
});

describe('deselectedIdsFrom', () => {
  it('answers the ids the user unchecked', () => {
    const changes = [
      classDefChange({ id: '3' }),
      methodChange({ id: '1' }),
      methodChange({ id: '2', selector: 'baz' }),
    ];

    expect(deselectedIdsFrom(changes, ['3', '1'])).toEqual(['2']);
  });

  it('answers nothing when everything is still selected', () => {
    const changes = [classDefChange({ id: '3' }), methodChange({ id: '1' })];

    expect(deselectedIdsFrom(changes, ['3', '1'])).toEqual([]);
  });

  it('never reports the class-definition edit as dropped, even if the selection omits it', () => {
    // The panel renders it checked+disabled, so it cannot be unchecked; inverting a
    // stale selection must not turn the structural change into a deletion.
    const changes = [classDefChange({ id: '3' }), methodChange({ id: '1' })];

    expect(deselectedIdsFrom(changes, [])).toEqual(['1']);
  });
});

describe('deselectedLabels', () => {
  it('labels the methods a deselection will delete', () => {
    const changes = [
      classDefChange({ id: '3' }),
      methodChange({ id: '1', selector: 'bar' }),
      methodChange({ id: '2', selector: 'baz' }),
    ];

    expect(deselectedLabels(changes, ['3', '1'])).toEqual(['Foo>>baz']);
  });
});

describe('parseRenamePreview', () => {
  it('reads the token and the staged changes from the envelope', () => {
    const json = JSON.stringify({ token: 'tok1', changes: [methodChange(), classDefChange()] });

    const preview = parseRenamePreview(json);

    expect(preview.token).toBe('tok1');
    expect(preview.changes.map((c) => c.kind)).toEqual(['methodRecompile', 'classDefinitionEdit']);
  });

  it('rejects an envelope with no token rather than applying against nothing', () => {
    expect(() => parseRenamePreview(JSON.stringify({ changes: [] }))).toThrow(/token/);
  });

  it('rejects a bare change array, which would leave the apply unaddressable', () => {
    expect(() => parseRenamePreview('[]')).toThrow(/envelope/);
  });
});

describe('parseRenameApplyResult', () => {
  it('reads how many classes were re-versioned', () => {
    const result = parseRenameApplyResult(JSON.stringify({ applied: 2, failed: [] }));

    expect(result.applied).toBe(2);
    expect(result.failed).toEqual([]);
  });

  it('reads the methods that did not recompile onto the new version', () => {
    const result = parseRenameApplyResult(
      JSON.stringify({
        applied: 1,
        failed: [{ id: 'x', label: 'Foo>>bar', error: 'did not recompile' }],
      }),
    );

    expect(result.failed[0].label).toBe('Foo>>bar');
    expect(result.failed[0].error).toBe('did not recompile');
  });

  it('surfaces an expired preview session as an error', () => {
    const result = parseRenameApplyResult(
      JSON.stringify({ applied: 0, failed: [], error: 'preview session expired' }),
    );

    expect(result.error).toBe('preview session expired');
  });
});

describe('changeLabel', () => {
  it('labels a class-definition edit', () => {
    expect(changeLabel(classDefChange())).toBe('Foo (class definition)');
  });

  it('labels an instance method', () => {
    expect(changeLabel(methodChange({ selector: 'total' }))).toBe('Foo>>total');
  });

  it('labels a class-side method', () => {
    expect(changeLabel(methodChange({ isMeta: true, selector: 'new' }))).toBe('Foo class>>new');
  });
});

describe('rename-instance-variable change classification', () => {
  it('treats the class-definition edit as structural (non-deselectable)', () => {
    expect(isStructuralChange(classDefChange())).toBe(true);
  });

  it('treats a method recompile as optional', () => {
    expect(isStructuralChange(methodChange())).toBe(false);
  });
});

describe('validateNewIvarName', () => {
  it('accepts a valid, changed identifier', () => {
    expect(validateNewIvarName('tally', 'count')).toBeUndefined();
  });

  it('accepts the unchanged name (treated as no-op by the caller)', () => {
    expect(validateNewIvarName('count', 'count')).toBeUndefined();
  });

  it('rejects an empty name', () => {
    expect(validateNewIvarName('   ', 'count')).toBeDefined();
  });

  it('rejects a name that is not a Smalltalk identifier', () => {
    expect(validateNewIvarName('2tally', 'count')).toBeDefined();
    expect(validateNewIvarName('has-dash', 'count')).toBeDefined();
    expect(validateNewIvarName('has space', 'count')).toBeDefined();
  });
});
