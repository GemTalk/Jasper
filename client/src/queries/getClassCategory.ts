import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

// The class category of `className` (Class>>category), or '' if the class has none
// or cannot be found. `dict` scopes the lookup like getClassDefinition. The
// class-definition editor shows this on its own line (GemStone's own `definition`
// omits it); see classDefinitionText.ts.
export function getClassCategory(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ 'Class not found: ${escapeString(className)}'].
(cls category ifNil: ['']) asString`;
  const result = execute(code);
  return result.startsWith('Class not found:') ? '' : result;
}

// True when a class named `className` already exists in the given dictionary — used
// to refuse a new-class save that would silently redefine (override) an existing
// class. `dict` is a 1-based symbol-list index or a dictionary name.
export function classExistsInDictionary(
  execute: QueryExecutor,
  className: string,
  dict: number | string,
): boolean {
  // Resolve the class within the dictionary via the shared classLookupExpr (which
  // already handles both the index and the name form and the missing-dictionary
  // case), then confirm it's actually a class — a plain global of the same name
  // must not count as "exists". classLookupExpr is a keyword-message expression, so
  // parenthesize it before sending ifNil:ifNotNil:.
  const expr = `(${classLookupExpr(className, dict)}) ifNil: [false] ifNotNil: [:v | v isBehavior]`;
  return execute(`(${expr}) printString`).trim() === 'true';
}
