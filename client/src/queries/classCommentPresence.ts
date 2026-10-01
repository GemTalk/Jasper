/**
 * The one rule for "does this class carry a REAL comment?", written once in each
 * of the two languages that have to ask it.
 *
 * `Class>>comment` cannot answer the question: since 3.1 it SYNTHESISES a
 * placeholder ("No class-specific documentation for X…", plus a rendered
 * hierarchy) when the class has no `#comment` key, so it never returns nil or
 * empty. The real question is the extra-dict key — and, because emptying the
 * editor can leave a lone newline behind (VS Code's insert-final-newline), a
 * stored value of pure whitespace counts as NO comment, the same as no key.
 *
 * Three callers ask it, and they must agree or the 📖 button on a class row
 * promises a document that opens empty (or withholds itself over a comment that
 * is really there): {@link getClassesWithCategory} builds the Explorer's
 * commented-classes set from the stone, the file-system provider decides what a
 * comment document opens on and what a save stores, and the Explorer flips one
 * class's flag when a comment is saved.
 */

/**
 * Smalltalk that answers `true`/`false` for whether the class in `clsVar` carries
 * a real comment. Errors (a class that has gone, a stone that refuses the read)
 * answer `false` rather than propagating: an unanswerable question is not a
 * comment.
 */
export function hasRealCommentExpr(clsVar: string): string {
  return `[(${clsVar} _extraDictAt: #comment)
    ifNil: [false]
    ifNotNil: [:c | (c detect: [:ch | ch isSeparator not] ifNone: [nil]) notNil]]
  on: Error do: [:e | false]`;
}

/** The same test over text already in hand — a comment document about to be saved. */
export function isRealClassComment(text: string): boolean {
  return /\S/.test(text);
}
