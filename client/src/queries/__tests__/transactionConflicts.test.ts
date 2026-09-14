import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import { transactionConflicts } from '../transactionConflicts';

/**
 * The conflict report a failed auto-commit offers (issue #254). The query does the shaping
 * server-side, so what is pinned here is the Smalltalk it sends — the parts a reader of the
 * report depends on and a careless edit could drop.
 */
describe('transactionConflicts', () => {
  const run = () => {
    const execute = vi.fn<QueryExecutor>(() => 'Write-Write (1):\n    an Account\n');
    const answer = transactionConflicts(execute);
    return { code: execute.mock.calls[0][0], answer };
  };

  it('asks the stone for its conflict report', () => {
    expect(run().code).toContain('System transactionConflicts');
  });

  it('hands back what the stone said, unmassaged', () => {
    expect(run().answer).toBe('Write-Write (1):\n    an Account\n');
  });

  it('groups by conflict CATEGORY, which is the part that says what to do about it', () => {
    const { code } = run();
    expect(code).toContain('conflicts keys asSortedCollection do:');
    expect(code).toContain('nextPutAll: key asString');
  });

  it('drops the empty categories', () => {
    // GemStone answers every key it knows, most of them empty, and listing them all buries
    // the one that matters.
    expect(run().code).toContain('objects isEmpty ifFalse:');
  });

  it('counts the objects in each category', () => {
    expect(run().code).toContain('print: objects size');
  });

  it('survives an object whose printString raises', () => {
    // A conflicted object can be half-built or from a class whose printOn: is broken, and a
    // report that dies trying to name it tells the user nothing at all.
    const { code } = run();
    expect(code).toContain('on: Error do:');
    expect(code).toContain('an unprintable object');
  });

  it('says so plainly when the stone reports no conflicting objects', () => {
    // A commit can fail for reasons that leave the conflict sets empty, and a blank report
    // reads as the query having failed.
    const { code } = run();
    expect(code).toContain('ws contents isEmpty');
    expect(code).toContain('no conflicting objects');
  });
});
