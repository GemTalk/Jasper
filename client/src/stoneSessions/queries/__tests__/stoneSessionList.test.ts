import { describe, it, expect, vi } from 'vitest';

import { NO_PRIVILEGE_ERROR } from '../../../queries/sessionOfLogin';
import { NO_SESSION_ACCESS, stoneSessionList } from '../stoneSessionList';

describe('stoneSessionList', () => {
  it("answers the stone's text in one round trip", () => {
    const execute = vi.fn((_code: string) => '1793224302\t1\t20\ttrue\tuffda\t');
    expect(stoneSessionList(execute)).toBe('1793224302\t1\t20\ttrue\tuffda\t');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  // Every other error must still fail the read, rather than read as an empty list.
  it('turns only the missing-privilege error into the no-access answer', () => {
    const execute = vi.fn((_code: string) => NO_SESSION_ACCESS);
    stoneSessionList(execute);
    const code = execute.mock.calls[0][0];
    expect(code).toContain(`e number = ${NO_PRIVILEGE_ERROR} ifFalse: [e pass]`);
    expect(code).toContain(`noAccess ifTrue: [^ '${NO_SESSION_ACCESS}']`);
  });

  // A login's own host can't say: through a tunnel it is localhost for a stone elsewhere.
  it("asks the stone for its own machine's name", () => {
    const execute = vi.fn((_code: string) => '');
    stoneSessionList(execute);
    expect(execute.mock.calls[0][0]).toContain('System stoneVersionAt: #nodeName');
  });

  it('leaves out the session asking, and one already gone', () => {
    const execute = vi.fn((_code: string) => '');
    stoneSessionList(execute);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('id = me ifFalse:');
    expect(code).toContain('(d notNil and: [(d at: 10) = id])');
  });
});
