/**
 * Where a regex search's matches are, in the terms a JavaScript string uses.
 *
 * The stone counts characters (code points); a JS string counts UTF-16 units, and a character
 * outside the Basic Multilingual Plane (an emoji, say) takes two of them. So every match after such
 * a character would land one unit early per character. These are converted against the text they
 * will be placed on.
 *
 * Line endings are not adjusted: VS Code may normalise a method's mixed CRLF/LF line endings when it
 * opens it, and the text then no longer has the length the stone counted. Matches past such a line
 * shift by one per normalised line ending; a match that ends up past the end is dropped by its user.
 */

/** A match as 0-based offsets, `end` exclusive. */
export interface MatchRange {
  start: number;
  end: number;
}

/** `matches`, counted in code points of `text`, as UTF-16 offsets into it. A position past the end
 *  of `text` becomes one past its UTF-16 length, so a check for "fits" drops that match. */
export function codePointMatchesToUtf16(
  text: string,
  matches: readonly MatchRange[],
): MatchRange[] {
  // Nothing to convert unless the text has a surrogate pair: the usual case, and the cheap one.
  if (!/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text)) return matches.map((m) => ({ ...m }));
  const offsets: number[] = [];
  let unit = 0;
  for (const ch of text) {
    offsets.push(unit);
    unit += ch.length;
  }
  offsets.push(unit);
  const at = (codePoint: number): number =>
    codePoint < offsets.length ? offsets[codePoint] : unit + 1;
  return matches.map((m) => ({ start: at(m.start), end: at(m.end) }));
}
