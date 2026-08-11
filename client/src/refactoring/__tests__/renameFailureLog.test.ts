import { describe, it, expect } from 'vitest';
import { formatRenameFailureLog } from '../renameFailureLog';

const fail = (label: string, error: string) => ({ id: label, label, error });

describe('formatRenameFailureLog', () => {
  it('returns undefined when nothing failed', () => {
    expect(formatRenameFailureLog('Rename', [])).toBeUndefined();
  });

  it('lists every failed method, not just the first', () => {
    const line = formatRenameFailureLog('Rename', [
      fail('Account>>balance', 'undeclared variable'),
      fail('Account>>deposit:', 'parse error'),
      fail('Account class>>new', 'undeclared variable'),
    ]);

    expect(line).toContain('3 method(s) did not recompile');
    expect(line).toContain('Account>>balance: undeclared variable');
    expect(line).toContain('Account>>deposit:: parse error');
    expect(line).toContain('Account class>>new: undeclared variable');
    // One line per failure (plus the header line).
    expect(line!.split('\n')).toHaveLength(4);
  });

  it('carries the action label and the not-committed caveat', () => {
    const line = formatRenameFailureLog("Rename 'count' → 'tally'", [fail('Foo>>bar', 'boom')])!;

    expect(line).toContain("Rename 'count' → 'tally'");
    expect(line).toContain('compiled but NOT committed');
  });
});
