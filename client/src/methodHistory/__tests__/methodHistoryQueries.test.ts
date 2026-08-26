import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../../queries/types';
import { getMethodHistory, removeMethodHistory } from '../queries/methodHistory';

describe('getMethodHistory', () => {
  it('asks GsMethodHistory for one method’s versions, encoding the side', () => {
    const execute = vi.fn<QueryExecutor>(() => '[]');
    getMethodHistory(execute, 'Foo', 'bar', false);
    const code = execute.mock.calls[0][0];
    expect(code).toContain("GsMethodHistory forClassNamed: 'Foo'");
    expect(code).toContain("selector: 'bar'");
    expect(code).toContain('meta: false');
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
  it('asks GsMethodHistory to forget one method’s versions', () => {
    const execute = vi.fn<QueryExecutor>(() => '{"removed":true}');
    removeMethodHistory(execute, 'Foo', 'bar', true);
    const code = execute.mock.calls[0][0];
    expect(code).toContain("GsMethodHistory removeHistoryForClassNamed: 'Foo'");
    expect(code).toContain("selector: 'bar'");
    expect(code).toContain('meta: true');
  });
});
