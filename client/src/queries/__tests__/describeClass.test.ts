import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import { describeClass } from '../describeClass';

describe('describeClass', () => {
  it('defaults to first-match objectNamed: lookup and returns the raw text', () => {
    const sample = '=== Definition ===\nObject subclass: #Foo\n\n=== Comment ===\nhello\n';
    const execute = vi.fn<QueryExecutor>(() => sample);

    expect(describeClass(execute, 'Foo')).toBe(sample);
    const [code] = execute.mock.calls[0];
    expect(code).toContain("objectNamed: #'Foo'");
  });

  it('scopes lookup to a specific dictionary by name (disambiguates shadows)', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    describeClass(execute, 'Customer', 'UserGlobals');
    const [code] = execute.mock.calls[0];
    expect(code).toContain("objectNamed: #'UserGlobals'");
    expect(code).toContain("at: #'Customer' ifAbsent: [nil]");
  });

  it('scopes lookup to a dictionary by 1-based index when given a number', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    describeClass(execute, 'Customer', 2);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('(System myUserProfile symbolList at: 2) at: ');
    expect(code).toContain("#'Customer' ifAbsent: [nil]");
  });

  it('emits all five sections in the Smalltalk', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    describeClass(execute, 'X');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('=== Definition ===');
    expect(code).toContain('=== Comment ===');
    expect(code).toContain('=== Instance methods ===');
    expect(code).toContain('=== Class methods ===');
    expect(code).toContain('cls definition');
    expect(code).toContain('cls comment');
  });

  it('lists selectors via sortedSelectorsIn: (own, not inherited) for both sides', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    describeClass(execute, 'X');
    const code = execute.mock.calls[0][0];
    // Instance side
    expect(code).toMatch(/cls categoryNames asSortedCollection do:/);
    expect(code).toContain('cls sortedSelectorsIn: cat');
    // Class side
    expect(code).toContain('cls class categoryNames');
    expect(code).toContain('cls class sortedSelectorsIn: cat');
  });

  it('guards against nil (class not found) and non-class globals', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    describeClass(execute, 'Nope');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("cls ifNil: [^ 'Class not found: Nope']");
    expect(code).toContain("cls isBehavior ifFalse: [^ 'Not a class: Nope']");
  });

  it('escapes single quotes in the class name', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    describeClass(execute, "Foo'Bar");
    const code = execute.mock.calls[0][0];
    expect(code).toContain("#'Foo''Bar'");
    expect(code).toContain("'Class not found: Foo''Bar'");
  });
});
