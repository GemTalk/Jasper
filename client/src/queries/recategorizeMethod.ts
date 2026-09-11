import { QueryExecutor } from './types';
import { escapeString, receiver } from './util';

// Move an existing method to a different category, CREATING the category if the class
// does not have it yet. Not committed automatically.
//
// The create is not a convenience: the Explorer's "+" button makes a category in the
// client overlay only, deliberately leaving the stone untouched until something is
// actually filed there, and `moveMethod:toCategory:` raises `classErrMethCatNotFound`
// on a category that does not exist. Compiling a method into such a category already
// creates it, so dropping one there is the same act and now behaves the same way.
//
// `addCategory:` itself raises `classErrMethCatExists` on a category that IS there, so
// it is guarded. `categoryNames` answers SYMBOLS and is compared as such — comparing
// `each asString` to a String literal raises "Unicode argument disallowed in String
// comparison" on a stone in legacy string mode.
export function recategorizeMethod(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  newCategory: string,
  dict?: number | string,
): string {
  const recv = receiver(className, isMeta, dict);
  const category = escapeString(newCategory);
  const code = `| target |
target := ${recv}.
(target categoryNames includes: #'${category}')
  ifFalse: [target addCategory: '${category}'].
target moveMethod: #'${escapeString(selector)}' toCategory: '${category}'.
'ok'`;
  return execute(code);
}
