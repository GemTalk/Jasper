import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

/**
 * Topaz file-out source for every method in one method category (protocol) of a
 * class — GemStone's `Behavior>>fileOutCategory:`, which emits a `set compile_env:`
 * directive followed by one chunk per method. No class definition; like
 * {@link fileOutMethod}, this files back into a stone that already has the class.
 *
 * The category reaches GemStone as an already-interned Symbol
 * (`Symbol _existingWithAll:`), never as a string literal. Two reasons, both load-
 * bearing: a literal inside a GCI doit compiles to Unicode7, and on 3.6.x comparing
 * one against an image-derived Symbol silently answers false (issues #399/#400) — so
 * the category would match nothing and the file would come out empty. And looking the
 * symbol up rather than interning one keeps a failed lookup from writing to the image
 * (see removeCategory, which resolves categories the same way).
 *
 * Raises when the class doesn't resolve, or when no symbol exists for the category —
 * a name no symbol exists for cannot be any class's category, so the row is stale.
 */
export function fileOutMethodCategory(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  category: string,
  dict?: number | string,
): string {
  const esc = escapeString(category);
  const code = `| cls cat |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ Error signal: 'Class not found: ${escapeString(className)}'].
cat := Symbol _existingWithAll: '${esc}'.
cat ifNil: [^ Error signal: 'Method category not found: ${esc}'].
${isMeta ? 'cls class' : 'cls'} fileOutCategory: cat`;
  return execute(code);
}
