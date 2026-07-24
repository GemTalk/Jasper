import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

// Returns the Topaz file-out source for a class.
//
// When `dict` is omitted, resolves via the user's symbolList globally —
// `objectNamed:` returns the first match, which matches how the user's code
// binds the name. When `dict` is given (1-based index or dictionary name),
// targets that specific dictionary — necessary when walking dicts in order
// (e.g. exporting every class) because names can be shadowed across dicts.
export function fileOutClass(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ 'Class not found: ${escapeString(className)}'].
cls fileOutClass`;
  return execute(code);
}
