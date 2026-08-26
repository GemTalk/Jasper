/**
 * A minimal unified line diff: given two multi-line strings, return the sequence
 * of context / deleted / added lines (Git-unified style). A shared client utility —
 * used to render before/after in the refactoring preview panels and in the method
 * history viewer.
 *
 * Kept pure (no vscode) so it unit-tests directly and can run in the webview too.
 * The algorithm is a classic longest-common-subsequence over lines — O(m·n) time
 * and space, which is ample for method-sized sources.
 */

export type DiffLineType = 'context' | 'add' | 'del';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const m = a.length;
  const n = b.length;

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', text: a[i] });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < m) {
    out.push({ type: 'del', text: a[i] });
    i++;
  }
  while (j < n) {
    out.push({ type: 'add', text: b[j] });
    j++;
  }
  return out;
}
