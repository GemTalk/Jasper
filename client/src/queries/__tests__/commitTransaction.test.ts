import { describe, it, expect, vi } from 'vitest';

import { commitTransaction } from '../commitTransaction';
import { WRITE_WRITE_ANSWER as CONFLICTS } from './conflictFixtures';

/** An executor that answers each call from `answers`, in order. */
function executorFor(...answers: (string | Error)[]) {
  let call = 0;
  return vi.fn(async (_code: string) => {
    const answer = answers[call++];
    if (answer instanceof Error) throw answer;
    return answer ?? '';
  });
}

describe('commitTransaction', () => {
  it('reports a commit that landed', async () => {
    const execute = executorFor('committed');
    expect(await commitTransaction(execute)).toBe('Transaction committed');
  });

  // The conflict set is a second round trip; a successful commit must not pay
  // for it, which is the whole reason the commit itself answers a token.
  it('takes one round trip when the commit lands', async () => {
    const execute = executorFor('committed');
    await commitTransaction(execute);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('names what conflicted when the stone refuses', async () => {
    const text = await commitTransaction(executorFor('refused', CONFLICTS));
    expect(text).toContain('Commit refused — Write-Write on 2 objects');
    expect(text).toContain('Abort for a fresh view, then try again.');
  });

  // The point of the change: the caller — often Claude, through the MCP tool —
  // can see which objects to look at rather than being told "possible conflict".
  it('lists the conflicting objects under the refusal', async () => {
    const text = await commitTransaction(executorFor('refused', CONFLICTS));
    expect(text).toContain('12086785  SymbolDictionary');
    expect(text).toContain('12200449  Account');
  });

  it('reads the conflict set only after a refusal', async () => {
    const execute = executorFor('refused', CONFLICTS);
    await commitTransaction(execute);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toContain('System transactionConflicts');
  });

  // Losing the second round trip must not lose the refusal itself.
  it('still reports the refusal when the conflict set cannot be read', async () => {
    const text = await commitTransaction(executorFor('refused', new Error('session busy')));
    expect(text).toContain('Commit refused');
    expect(text).toContain('Abort for a fresh view, then try again.');
    expect(text).not.toContain('session busy');
  });

  it('treats an unrecognized answer as a refusal rather than a silent success', async () => {
    expect(await commitTransaction(executorFor('', ''))).toContain('Commit refused');
  });
});
