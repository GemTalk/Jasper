/**
 * The canonical count coercion shared by every refactoring preview parser.
 *
 * This lived as thirteen byte-identical private copies across
 * `client/src/refactoring/*Preview.ts`. Only one was exported and only one was documented, so a
 * reader landing in any of the other twelve met an undocumented helper and had to re-derive the
 * clamping rules. One copy, one doc comment, one place to change the rules.
 */

/**
 * Coerce a JSON value from an engine payload to a non-negative integer count.
 *
 * Anything that is not a finite, non-negative number -- a non-number, a negative, `NaN`, or
 * `Infinity` -- clamps to `0` rather than throwing or answering `undefined`, so a malformed
 * payload degrades to a zero/empty count instead of crashing the parse.
 *
 * A finite non-negative NON-INTEGER is truncated toward zero (`2.5` -> `2`). These values feed
 * `total`, `applied`, `nextOffset` and friends straight into the preview UI and its pagination
 * arithmetic, where a fractional count has no meaning: half a change cannot be rendered, and a
 * fractional offset would ask the engine for a page boundary that does not exist. The engine
 * emits integers, so this only bites on a corrupted or hand-edited payload -- which is exactly
 * when degrading quietly beats propagating nonsense.
 */
export function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0;
}
