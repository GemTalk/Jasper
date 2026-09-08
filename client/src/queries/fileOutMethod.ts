import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

// Environment the Explorer's Methods pane addresses — its rows collapse a class's
// selectors across every environment into one row per selector, and opening or
// removing one addresses environment 0, so a file-out of that row does too.
const FILE_OUT_ENVIRONMENT = 0;

/**
 * Topaz file-out source for ONE method — the `category:` / `method:` (or
 * `classmethod:`) chunk Topaz files back in, with no class definition around it.
 * This is what Jadeite's "File Out Method(s)" writes, so a method filed out of
 * Jasper reads back into a stone that already has the class.
 *
 * Carries no header: {@link fileOutHeader} supplies one per FILE, so filing out a
 * multi-selection of methods concatenates several of these under a single header.
 *
 * Raises (surfacing as a thrown query) when the class no longer resolves, rather
 * than answering placeholder text — a file-out that can't read the method should
 * fail visibly instead of writing a `.gs` whose contents are an error message.
 */
export function fileOutMethod(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  dict?: number | string,
): string {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ Error signal: 'Class not found: ${escapeString(className)}'].
${isMeta ? 'cls class' : 'cls'} fileOutMethod: #'${escapeString(selector)}' environmentId: ${FILE_OUT_ENVIRONMENT}`;
  return execute(code);
}
