import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

// Returns the Topaz file-out source for a class.
//
// When `dict` is omitted, resolves via the user's symbolList globally —
// `objectNamed:` returns the first match, which matches how the user's code
// binds the name. When `dict` is given (1-based index or dictionary name),
// targets that specific dictionary — necessary when walking dicts in order
// (e.g. exporting every class) because names can be shadowed across dicts.

// Answered (as the whole "source") when the class doesn't resolve. A sentinel
// rather than a raise because this query's other callers want a readable answer,
// not a thrown error: the MCP tool hands it straight back to the caller. The
// Explorer's File Out Class checks for it and refuses to write, so a stale tree
// row can't produce a `.gs` whose entire contents are an error message.
export const CLASS_NOT_FOUND_PREFIX = 'Class not found: ';

/** Whether `source` is {@link fileOutClass}'s not-found sentinel rather than real source. */
export function isClassNotFound(source: string): boolean {
  return source.startsWith(CLASS_NOT_FOUND_PREFIX);
}

export function fileOutClass(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ '${CLASS_NOT_FOUND_PREFIX}${escapeString(className)}'].
cls fileOutClass`;
  return execute(code);
}
