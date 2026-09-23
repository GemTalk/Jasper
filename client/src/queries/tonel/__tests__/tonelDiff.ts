// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement.
//
// A line diff for the churn tests. Test support, not shipped code.
//
// Why a real LCS diff and not a set difference
// ---------------------------------------------
// The property under test is "a one-method change produces a one-method diff" —
// the thing a developer sees in `git diff` after filing a class out twice. A
// multiset difference of lines would answer that question wrongly: it reports
// nothing when the same lines come back in a DIFFERENT ORDER, which is precisely
// the churn worth catching. An LCS diff shows a moved method as a removal plus an
// addition, so reordering cannot hide.
//
// Files here are a few hundred lines, so the O(n*m) table is irrelevant.

/** One changed line, and which side it is on. */
export interface DiffLine {
  kind: 'add' | 'remove';
  line: string;
}

/** Lines of `after` not in `before`, and vice versa, in file order. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const changes: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      changes.push({ kind: 'remove', line: a[i++] });
    } else {
      changes.push({ kind: 'add', line: b[j++] });
    }
  }
  while (i < a.length) changes.push({ kind: 'remove', line: a[i++] });
  while (j < b.length) changes.push({ kind: 'add', line: b[j++] });
  return changes;
}

/** The added lines only. */
export const added = (changes: DiffLine[]): string[] =>
  changes.filter((c) => c.kind === 'add').map((c) => c.line);

/** The removed lines only. */
export const removed = (changes: DiffLine[]): string[] =>
  changes.filter((c) => c.kind === 'remove').map((c) => c.line);

/** Changed lines with blank-only lines dropped — the signal, without the
 *  separator noise that carries no information in a Tonel file. */
export const meaningful = (changes: DiffLine[]): DiffLine[] =>
  changes.filter((c) => c.line.trim().length > 0);
