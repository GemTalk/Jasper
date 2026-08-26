import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../../queries/types';
import { getMethodHistory, removeMethodHistory } from '../queries/methodHistory';

describe('getMethodHistory', () => {
  it('asks the method-history helper for one method’s versions, encoding the side', () => {
    const execute = vi.fn<QueryExecutor>(() => '[]');
    getMethodHistory(execute, 'Foo', 'bar', false);
    const code = execute.mock.calls[0][0];
    expect(code).toContain("forClassNamed: 'Foo'");
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
    expect(code).toContain("forClassNamed: 'Foo'''");
    expect(code).toContain("selector: 'at:put:'''");
  });
});

describe('removeMethodHistory', () => {
  it('asks the method-history helper to forget one method’s versions', () => {
    const execute = vi.fn<QueryExecutor>(() => '{"removed":true}');
    removeMethodHistory(execute, 'Foo', 'bar', true);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('SessionTemps current at: #JasperMethodHistory');
    expect(code).toContain("removeHistoryForClassNamed: 'Foo'");
    expect(code).toContain("selector: 'bar'");
    expect(code).toContain('meta: true');
  });
});
