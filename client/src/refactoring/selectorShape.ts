/**
 * Shared Smalltalk selector-shape helpers, used by BOTH the rename-method (R2,
 * `renameMethodPreview.ts`) and change-signature (M5, `changeSignaturePreview.ts`)
 * refactorings. Extracted so the two can't drift (they previously carried
 * byte-identical copies); each module re-exports these for its own importers.
 */

/**
 * The GemStone binary-selector characters. Mirrors the server lexer's
 * `SELECTOR_CHARS` set (`server/src/lexer/lexer.ts`) — note it INCLUDES backslash
 * (`\`), a valid binary character (e.g. `\\`, integer remainder). Keep the two in
 * sync; the client and server are separate workspaces, so they can't share the
 * literal directly.
 */
export const BINARY_SELECTOR_CHARS = '-+*/\\~<>=&|@%,?!';

const BINARY_SELECTOR_RE = /^[-+*/\\~<>=&|@%,?!]+$/;

/** True if the selector is a keyword selector (contains a colon). */
export function isKeywordSelector(selector: string): boolean {
  return selector.includes(':');
}

/** True if the selector is a binary selector (one or more binary characters). */
export function isBinarySelector(selector: string): boolean {
  return BINARY_SELECTOR_RE.test(selector);
}

/**
 * Split a selector into its parts: a keyword selector into its colon-terminated
 * keywords (`at:put:` → ['at:', 'put:']), a unary or binary selector into the
 * single whole selector (['foo'] / ['+']). One part per parameter row of a
 * signature editor (for a keyword selector); a unary/binary selector has one part.
 */
export function selectorParts(selector: string): string[] {
  if (!isKeywordSelector(selector)) return [selector];
  return selector.match(/[^:]+:/g) ?? [selector];
}

/** The number of arguments a selector takes (keyword count, 1 for binary, 0 for unary). */
export function selectorArgCount(selector: string): number {
  if (isKeywordSelector(selector)) return selectorParts(selector).length;
  return isBinarySelector(selector) ? 1 : 0;
}

/** Join selector parts back into a selector symbol string. */
export function buildSelector(parts: string[]): string {
  return parts.join('');
}
