import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import { describeClass } from '../describeClass';

describe('describeClass', () => {
  it('defaults to first-match objectNamed: lookup and appends the method sections', () => {
    const sample = '=== Definition ===\nObject subclass: #Foo\n\n=== Comment ===\nhello\n\n';
    const execute = vi.fn<QueryExecutor>(() => sample);

    expect(describeClass(execute, 'Foo')).toBe(
      `${sample}=== Instance methods ===\n\n=== Class methods ===\n`,
    );
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

  it('emits the definition and comment sections in the Smalltalk', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    describeClass(execute, 'X');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('=== Definition ===');
    expect(code).toContain('=== Comment ===');
    expect(code).toContain('cls definition');
    expect(code).toContain('cls comment');
  });

  it('reads own selectors (not inherited) for both sides, unsorted', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    describeClass(execute, 'X');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("{ cls -> 'i'. cls class -> 'c' }");
    expect(code).toContain('side key categoryNames do:');
    expect(code).toContain('side key selectorsIn: cat');
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
