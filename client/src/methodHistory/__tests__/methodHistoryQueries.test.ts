import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../../queries/types';
import { getMethodHistory, removeMethodHistory } from '../queries/methodHistory';

describe('getMethodHistory', () => {
  it('asks the method-history helper for one method’s versions, encoding the side', () => {
    const execute = vi.fn<QueryExecutor>(() => '[]');
    getMethodHistory(execute, 'Foo', 'bar', false);
    const code = execute.mock.calls[0][0];
    expect(code).toContain("named: 'Foo'");
    expect(code).toContain("selector: 'bar'");
    expect(code).toContain('meta: false');
  });

  it('resolves the helper from SessionTemps and degrades gracefully when it is absent', () => {
    const execute = vi.fn<QueryExecutor>(() => '[]');
    getMethodHistory(execute, 'Foo', 'bar', false);
    const code = execute.mock.calls[0][0];
    // The helper lives in SessionTemps (installed at login, no plugin), not the
    // symbol list — resolving it there keeps the query valid on a bare stone and
    // lets it answer an error envelope instead of a raw CompileError.
    expect(code).toContain('SessionTemps current at: #JasperMethodHistory');
    expect(code).toContain('"error"');
  });

  it('requests the class side when isMeta is set', () => {
    const execute = vi.fn<QueryExecutor>(() => '[]');
    getMethodHistory(execute, 'Foo', 'new', true);
    expect(execute.mock.calls[0][0]).toContain('meta: true');
  });

  it('escapes quotes in the class name and selector', () => {
    const execute = vi.fn<QueryExecutor>(() => '[]');
    getMethodHistory(execute, "Foo'", "at:put:'", false);
    const code = execute.mock.calls[0][0];
    expect(code).toContain("named: 'Foo'''");
    expect(code).toContain("selector: 'at:put:'''");
  });
});

describe('removeMethodHistory', () => {
  it('asks the method-history helper to forget one method’s versions', () => {
    const execute = vi.fn<QueryExecutor>(() => '{"removed":true}');
    removeMethodHistory(execute, 'Foo', 'bar', true);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('SessionTemps current at: #JasperMethodHistory');
    expect(code).toContain('removeHistoryForClass: ');
    expect(code).toContain("named: 'Foo'");
    expect(code).toContain("selector: 'bar'");
    expect(code).toContain('meta: true');
  });
});

// A class name alone does not identify a class: a user's symbolList is an ordered list
// of SymbolDictionaries and `objectNamed:` answers the FIRST match, shadowing later
// ones. Restore already scoped its recompile by dictionary, so a read that did not
// would resolve a different class than the one being restored — the read/write
// split-brain these tests guard against.
describe('dictionary scoping', () => {
  it('scopes the class lookup to a SymbolList index when given one', () => {
    const execute = vi.fn<QueryExecutor>(() => '[]');
    getMethodHistory(execute, 'Foo', 'bar', false, 3);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('System myUserProfile symbolList at: 3');
    expect(code).toContain("at: #'Foo' ifAbsent: [nil]");
  });

  it('scopes the class lookup to a dictionary name when given one', () => {
    const execute = vi.fn<QueryExecutor>(() => '[]');
    getMethodHistory(execute, 'Foo', 'bar', false, 'MyDict');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("objectNamed: #'MyDict'");
    expect(code).toContain("at: #'Foo' ifAbsent: [nil]");
  });

  it('falls back to an unscoped global lookup when no dictionary is known', () => {
    const execute = vi.fn<QueryExecutor>(() => '[]');
    getMethodHistory(execute, 'Foo', 'bar', false);
    const code = execute.mock.calls[0][0];
    expect(code).toContain("symbolList objectNamed: #'Foo'");
    expect(code).not.toContain('symbolList at: ');
  });

  it('scopes forgetting by dictionary too, so read and write agree', () => {
    const execute = vi.fn<QueryExecutor>(() => '{"removed":true}');
    removeMethodHistory(execute, 'Foo', 'bar', false, 3);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('System myUserProfile symbolList at: 3');
    expect(code).toContain("at: #'Foo' ifAbsent: [nil]");
  });

  it('escapes a dictionary name carrying a quote', () => {
    const execute = vi.fn<QueryExecutor>(() => '[]');
    getMethodHistory(execute, 'Foo', 'bar', false, "My'Dict");
    expect(execute.mock.calls[0][0]).toContain("objectNamed: #'My''Dict'");
  });
});
