/**
 * Pure, dependency-free matching + ranking for Omni Search (issue #378).
 *
 * One `match(query, target, opts)` entry point with three selectable modes — the "customizable,
 * savable search algorithm" the issue calls for (the mode is a user setting; see omniConfig.ts):
 *
 *   - `fuzzy`     — subsequence match (query chars appear in order, gaps allowed). The default;
 *                   this is the Quick-Open / Spotter feel a VS Code or Pharo user expects.
 *   - `substring` — the query appears as a contiguous run.
 *   - `prefix`    — the target starts with the query.
 *
 * A match returns a non-negative `score` (higher = better) and the matched `[start,end)` character
 * ranges in the ORIGINAL target, so a future renderer can highlight them. A non-match returns null.
 *
 * Scoring is tuned so that, all else equal: an earlier match beats a later one, a match at a word
 * start (string start, after a separator, or a camelCase hump) beats one mid-word, a contiguous run
 * beats a scattered one, and a shorter target beats a longer one. Tests assert the RELATIVE ordering
 * (via `compareMatches`), not exact scores, so the weights can be tuned without churn.
 *
 * ASCII assumption: GemStone selectors, class names and dictionary names are ASCII, so case folding
 * does not change string length and range indices stay aligned with the original target.
 */

export type MatchMode = 'fuzzy' | 'substring' | 'prefix';

export interface MatchOptions {
  mode: MatchMode;
  caseSensitive: boolean;
}

export interface MatchResult {
  /** Higher is better; only meaningful relative to other results (a very scattered match may be
   *  negative). An empty query yields exactly 0 (a neutral "match all"). */
  score: number;
  /** Matched `[start, end)` ranges in the original target, ascending and coalesced. */
  ranges: Array<[number, number]>;
}

// Scoring weights. Kept as named constants so the intent is legible and tuning is one place.
const W_CHAR = 1; // per matched character
const W_CONTIGUOUS = 4; // per char that immediately follows the previous match (a run)
const W_WORD_START = 6; // matched char sits at a word boundary
const W_STRING_START = 10; // the very first target char matched
const W_GAP = -1; // per unmatched char strictly between the first and last match
const W_SHORTNESS = 8; // scaled by how much of the target the match spans (prefer tight/short)

const SEPARATORS = new Set([' ', '_', '-', ':', '.', '/', '>']);

/** Does `target[i]` begin a word — string start, char after a separator, or a camelCase hump? */
export function isWordStart(target: string, i: number): boolean {
  if (i <= 0) return true;
  const prev = target[i - 1];
  const cur = target[i];
  if (SEPARATORS.has(prev)) return true;
  // camelCase hump: a lowercase/digit followed by an uppercase letter.
  if (/[a-z0-9]/.test(prev) && /[A-Z]/.test(cur)) return true;
  return false;
}

/** Coalesce a sorted list of matched indices into `[start,end)` ranges. */
function coalesce(indices: number[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const i of indices) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
  }
  return ranges;
}

function fold(s: string, caseSensitive: boolean): string {
  return caseSensitive ? s : s.toLowerCase();
}

/** Turn a set of matched indices in `target` into a MatchResult with a tuned score. */
function scoreFrom(target: string, indices: number[]): MatchResult {
  let score = indices.length * W_CHAR;
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    if (i === 0) score += W_STRING_START;
    else if (isWordStart(target, i)) score += W_WORD_START;
    if (k > 0 && indices[k - 1] === i - 1) score += W_CONTIGUOUS;
  }
  const first = indices[0];
  const last = indices[indices.length - 1];
  const span = last - first + 1;
  const gaps = span - indices.length; // unmatched chars inside the matched span
  score += gaps * W_GAP;
  // Reward a match that covers more of a short target (tight, high-signal hits rank first).
  score += Math.round((W_SHORTNESS * indices.length) / target.length);
  // NOT clamped to >= 0: a very scattered match may score below zero, and keeping the raw value
  // preserves the relative order between two poor matches (and never collides with the empty-query
  // neutral 0, which is returned on a separate path before we ever get here).
  return { score, ranges: coalesce(indices) };
}

function matchPrefix(q: string, t: string): number[] | null {
  if (!t.startsWith(q)) return null;
  return Array.from({ length: q.length }, (_, i) => i);
}

function matchSubstring(q: string, t: string): number[] | null {
  const at = t.indexOf(q);
  if (at < 0) return null;
  return Array.from({ length: q.length }, (_, i) => at + i);
}

/**
 * A CONTIGUOUS occurrence of `q` in `t` (a real substring), preferring one that begins at a word
 * boundary — returns its index run, or null if `q` isn't a substring. This runs BEFORE the greedy
 * subsequence so an exact run always wins: greedy-leftmost otherwise grabs a stray early character
 * (the `c` in "Colle**c**tions" / "Announ**c**ements") and misses a clean later "Core", letting a
 * scattered match that happens to start at index 0 outrank an exact mid-string one.
 */
function contiguousIndices(q: string, t: string): number[] | null {
  let firstAt = -1;
  let at = t.indexOf(q);
  while (at >= 0) {
    if (isWordStart(t, at)) {
      return Array.from({ length: q.length }, (_, i) => at + i); // word-start run — the best kind
    }
    if (firstAt < 0) firstAt = at;
    at = t.indexOf(q, at + 1);
  }
  return firstAt < 0 ? null : Array.from({ length: q.length }, (_, i) => firstAt + i);
}

/**
 * Fuzzy subsequence match. First prefers a contiguous occurrence (a real substring, see
 * `contiguousIndices`) so exact runs rank above scattered matches; only when `q` is not a substring
 * does it fall back to a greedy left-to-right subsequence (predictable and cheap).
 */
function matchFuzzy(q: string, t: string): number[] | null {
  const contiguous = contiguousIndices(q, t);
  if (contiguous) return contiguous;

  const indices: number[] = [];
  let ti = 0;
  for (const qc of q) {
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === qc) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    indices.push(found);
    ti = found + 1;
  }
  return indices;
}

/**
 * Match `query` against `target`. Returns null on no match, else a score (higher = better) and the
 * matched ranges. An empty (or whitespace-only) query is a neutral match: score 0, no ranges.
 */
export function match(query: string, target: string, opts: MatchOptions): MatchResult | null {
  const q = fold(query.trim(), opts.caseSensitive);
  if (q.length === 0) return { score: 0, ranges: [] };
  if (target.length === 0) return null;
  const t = fold(target, opts.caseSensitive);

  let indices: number[] | null;
  switch (opts.mode) {
    case 'prefix':
      indices = matchPrefix(q, t);
      break;
    case 'substring':
      indices = matchSubstring(q, t);
      break;
    case 'fuzzy':
    default:
      indices = matchFuzzy(q, t);
      break;
  }
  if (indices === null) return null;
  return scoreFrom(target, indices);
}

/**
 * Total order for ranking: higher score first, then shorter target, then case-insensitive
 * alphabetical — a stable, predictable sort for the result list.
 */
export function compareMatches(
  a: { score: number; label: string },
  b: { score: number; label: string },
): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.label.length !== b.label.length) return a.label.length - b.label.length;
  return a.label.localeCompare(b.label);
}
