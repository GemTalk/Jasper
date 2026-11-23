/**
 * Shared Smalltalk selector-shape helpers, used by BOTH the rename-method
 * (`renameMethodPreview.ts`) and change-signature (`changeSignaturePreview.ts`)
 * refactorings. Extracted so the two can't drift (they previously carried
 * byte-identical copies); each module re-exports these for its own importers.
 */

import { isBinarySelector } from '../queries/util';

// Defined once in queries/util.ts, which the inspectors' selector check also uses.
export { isBinarySelector };

/** True if the selector is a keyword selector (contains a colon). */
export function isKeywordSelector(selector: string): boolean {
  return selector.includes(':');
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
