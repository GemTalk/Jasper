import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import { getClassDefinition } from '../getClassDefinition';
import { getClassComment } from '../getClassComment';
import { canClassBeWritten } from '../canClassBeWritten';
import { fileOutClass } from '../fileOutClass';

describe('getClassDefinition', () => {
  it('sends "<class> definition" and returns the raw result', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'Object subclass: #Foo');
    expect(await getClassDefinition(execute, 'Foo')).toBe('Object subclass: #Foo');
    expect(execute).toHaveBeenCalledWith('Foo definition');
  });

  it('scopes the lookup to a SymbolList index when a dict is given', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'Object subclass: #Foo');
    await getClassDefinition(execute, 'Foo', 9);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('System myUserProfile symbolList at: 9');
    expect(code).toContain("at: #'Foo' ifAbsent: [nil]");
    expect(code).toContain('cls definition');
  });
});

describe('getClassComment', () => {
  it('sends "<class> comment" and returns the raw result', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'a class for testing');
    expect(await getClassComment(execute, 'Foo')).toBe('a class for testing');
    expect(execute).toHaveBeenCalledWith('Foo comment');
  });

  it('scopes the lookup to a SymbolList index when a dict is given', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'c');
    await getClassComment(execute, 'Foo', 3);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('System myUserProfile symbolList at: 3');
    expect(code).toContain('cls comment');
  });
});

describe('canClassBeWritten', () => {
  it('returns true when Smalltalk prints "true"', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'true');
    expect(await canClassBeWritten(execute, 'Foo')).toBe(true);
  });

  it('returns false for anything else (e.g. "false", whitespace)', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'false\n');
    expect(await canClassBeWritten(execute, 'Foo')).toBe(false);
  });

  it('trims surrounding whitespace before comparing', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '  true\n');
    expect(await canClassBeWritten(execute, 'Foo')).toBe(true);
  });

  it('scopes the lookup to a SymbolList index when a dict is given', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'true');
    await canClassBeWritten(execute, 'Foo', 5);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('System myUserProfile symbolList at: 5');
    expect(code).toContain('cls canBeWritten printString');
  });
});

describe('fileOutClass', () => {
  it('returns the Topaz source', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '! class definition');
    expect(await fileOutClass(execute, 'Foo')).toBe('! class definition');
  });

  it('defaults to global objectNamed: lookup when no dict is given', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '');
    await fileOutClass(execute, "Foo'Bar");
    const code = execute.mock.calls[0][0];
    expect(code).toContain("objectNamed: #'Foo''Bar'");
    expect(code).toContain('fileOutClass');
  });

  it('scopes to a specific dictionary by index when given a number', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '');
    await fileOutClass(execute, 'Foo', 3);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('(System myUserProfile symbolList at: 3) at: ');
    expect(code).toContain("#'Foo' ifAbsent: [nil]");
  });

  it('scopes to a specific dictionary by name when given a string', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '');
    await fileOutClass(execute, 'Foo', 'UserGlobals');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("symbolList objectNamed: #'UserGlobals'");
    expect(code).toContain("at: #'Foo' ifAbsent: [nil]");
  });

  it('returns "Class not found" when lookup yields nil', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'Class not found: Bogus');
    expect(await fileOutClass(execute, 'Bogus')).toBe('Class not found: Bogus');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("cls ifNil: [^ 'Class not found: Bogus']");
  });
});
