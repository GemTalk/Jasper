import { describe, it, expect } from 'vitest';
import {
  parseRenameChanges,
  orderChangesClassDefFirst,
  planRenameApply,
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

describe('planRenameApply', () => {
  const dictNames = ['UserGlobals', 'Globals', 'Published'];

  it('keeps only the selected changes, in the given (class-def-first) order', () => {
    const steps = planRenameApply(
      [
        classDefChange({ id: '3' }),
        methodChange({ id: '1' }),
        methodChange({ id: '2', selector: 'baz' }),
      ],
      ['1', '3'],
      dictNames,
      'UserGlobals',
    );

    expect(steps.map((s) => s.id)).toEqual(['3', '1']);
  });

  it('resolves each change dictionary to its 1-based symbol-list index', () => {
    const steps = planRenameApply(
      [methodChange({ id: '1', dictName: 'Globals' })],
      ['1'],
      dictNames,
      'UserGlobals',
    );

    expect(steps[0].dictIndex).toBe(2);
  });

  it('falls back to the current dictionary when the change names none', () => {
    const steps = planRenameApply(
      [methodChange({ id: '1', dictName: null })],
      ['1'],
      dictNames,
      'Published',
    );

    expect(steps[0].dictIndex).toBe(3);
  });

  it('leaves the dict index undefined when neither dictionary is known', () => {
    const steps = planRenameApply(
      [methodChange({ id: '1', dictName: 'Mystery' })],
      ['1'],
      dictNames,
      undefined,
    );

    expect(steps[0].dictIndex).toBeUndefined();
  });

  it('defaults a missing method category to "as yet unclassified"', () => {
    const steps = planRenameApply(
      [methodChange({ id: '1', category: null })],
      ['1'],
      dictNames,
      'UserGlobals',
    );

    expect(steps[0].category).toBe('as yet unclassified');
  });

  it('carries a label for reporting a per-change failure', () => {
    const steps = planRenameApply(
      [methodChange({ id: '1', selector: 'total' })],
      ['1'],
      dictNames,
      'UserGlobals',
    );

    expect(steps[0].label).toBe('Foo>>total');
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
    expect(validateNewIvarName('   ', 'count')).toBeTruthy();
  });

  it('rejects a name that is not a Smalltalk identifier', () => {
    expect(validateNewIvarName('2tally', 'count')).toBeTruthy();
    expect(validateNewIvarName('has-dash', 'count')).toBeTruthy();
    expect(validateNewIvarName('has space', 'count')).toBeTruthy();
  });
});
