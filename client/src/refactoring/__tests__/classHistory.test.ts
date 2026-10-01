import { describe, it, expect, vi } from 'vitest';
import { getClassHistory, revertClassToVersion, removeClassVersion } from '../queries/classHistory';

describe('classHistory queries', () => {
  it('builds a read-only history query for a class', () => {
    const execute = vi.fn().mockReturnValue('[]');

    getClassHistory(execute, 'Account');

    expect(execute.mock.calls[0][0]).toContain("GsClassHistory forClassNamed: 'Account'");
  });

  it('builds a revert-to-version query', () => {
    const execute = vi.fn().mockReturnValue('{}');

    revertClassToVersion(execute, 'Account', 2);

    expect(execute.mock.calls[0][0]).toContain("revertClassNamed: 'Account' toIndex: 2");
  });

  it('builds a remove-version query', () => {
    const execute = vi.fn().mockReturnValue('{}');

    removeClassVersion(execute, 'Account', 1);

    expect(execute.mock.calls[0][0]).toContain("removeVersionOf: 'Account' index: 1");
  });
});

describe('the class-history queries are scoped to one dictionary', () => {
  /**
   * The history shown, and what Restore and Remove rewrite, belong to exactly ONE of the
   * classes that share a name. Unscoped, the engine answers the first binding on the symbol
   * list, so the panel described one class and Restore rewrote another (#396).
   *
   * Asserted on `inDictionary:` itself: the other tests in this file are substring checks that
   * never mention it, so dropping the argument left them all green.
   */
  const codeOf = (fn: (e: (code: string) => string) => unknown): string => {
    const exec = vi.fn().mockReturnValue('{}');
    fn(exec);
    return exec.mock.calls[0][0] as string;
  };

  it('sends the index for each of the three entry points', () => {
    expect(codeOf((e) => getClassHistory(e, 'Account', 4))).toContain('inDictionary: 4');
    expect(codeOf((e) => revertClassToVersion(e, 'Account', 2, 4))).toContain('inDictionary: 4');
    expect(codeOf((e) => removeClassVersion(e, 'Account', 1, 4))).toContain('inDictionary: 4');
  });

  it('quotes and escapes a dictionary given by name', () => {
    expect(codeOf((e) => getClassHistory(e, 'Account', "Di'ct"))).toContain(
      "inDictionary: 'Di''ct'",
    );
  });

  it('sends nil only when the caller has no dictionary at all', () => {
    expect(codeOf((e) => getClassHistory(e, 'Account'))).toContain('inDictionary: nil');
  });
});
