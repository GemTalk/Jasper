import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import { getClassDefinition } from '../getClassDefinition';
import { getClassComment } from '../getClassComment';
import { canClassBeWritten } from '../canClassBeWritten';
import { fileOutClass } from '../fileOutClass';

describe('getClassDefinition', () => {
  it('sends "<class> definition" and returns the raw result', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Object subclass: #Foo');
    expect(getClassDefinition(execute, 'Foo')).toBe('Object subclass: #Foo');
    expect(execute).toHaveBeenCalledWith('Foo definition');
  });

  it('scopes the lookup to a SymbolList index when a dict is given', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Object subclass: #Foo');
    getClassDefinition(execute, 'Foo', 9);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('System myUserProfile symbolList at: 9');
    expect(code).toContain("at: #'Foo' ifAbsent: [nil]");
    expect(code).toContain('cls definition');
  });
});

describe('getClassComment', () => {
  it('sends "<class> comment" and returns the raw result', () => {
    const execute = vi.fn<QueryExecutor>(() => 'a class for testing');
    expect(getClassComment(execute, 'Foo')).toBe('a class for testing');
    expect(execute).toHaveBeenCalledWith('Foo comment');
  });

  it('scopes the lookup to a SymbolList index when a dict is given', () => {
    const execute = vi.fn<QueryExecutor>(() => 'c');
    getClassComment(execute, 'Foo', 3);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('System myUserProfile symbolList at: 3');
    expect(code).toContain('cls comment');
  });
});

describe('canClassBeWritten', () => {
  it('returns true when Smalltalk prints "true"', () => {
    const execute = vi.fn<QueryExecutor>(() => 'true');
    expect(canClassBeWritten(execute, 'Foo')).toBe(true);
  });

  it('returns false for anything else (e.g. "false", whitespace)', () => {
    const execute = vi.fn<QueryExecutor>(() => 'false\n');
    expect(canClassBeWritten(execute, 'Foo')).toBe(false);
  });

  it('trims surrounding whitespace before comparing', () => {
    const execute = vi.fn<QueryExecutor>(() => '  true\n');
    expect(canClassBeWritten(execute, 'Foo')).toBe(true);
  });

  it('scopes the lookup to a SymbolList index when a dict is given', () => {
    const execute = vi.fn<QueryExecutor>(() => 'true');
    canClassBeWritten(execute, 'Foo', 5);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('System myUserProfile symbolList at: 5');
    expect(code).toContain('cls canBeWritten printString');
  });
});

describe('fileOutClass', () => {
  it('returns the Topaz source', () => {
    const execute = vi.fn<QueryExecutor>(() => '! class definition');
    expect(fileOutClass(execute, 'Foo')).toBe('! class definition');
  });

  it('defaults to global objectNamed: lookup when no dict is given', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    fileOutClass(execute, "Foo'Bar");
    const code = execute.mock.calls[0][0];
    expect(code).toContain("objectNamed: #'Foo''Bar'");
    expect(code).toContain('fileOutClass');
  });

  it('scopes to a specific dictionary by index when given a number', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    fileOutClass(execute, 'Foo', 3);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('(System myUserProfile symbolList at: 3) at: ');
    expect(code).toContain("#'Foo' ifAbsent: [nil]");
  });

  it('scopes to a specific dictionary by name when given a string', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    fileOutClass(execute, 'Foo', 'UserGlobals');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("symbolList objectNamed: #'UserGlobals'");
    expect(code).toContain("at: #'Foo' ifAbsent: [nil]");
  });

  it('returns "Class not found" when lookup yields nil', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Class not found: Bogus');
    expect(fileOutClass(execute, 'Bogus')).toBe('Class not found: Bogus');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("cls ifNil: [^ 'Class not found: Bogus']");
  });
});
