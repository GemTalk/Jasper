import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

// Return a class's definition. `dict` (a 1-based SymbolList index, or a name)
// scopes the lookup to a specific dictionary so the same key registered in two
// dictionaries resolves to the intended class; without it, the class name is
// resolved as a bare global (first match in the symbol list).
export function getClassDefinition(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string {
  if (dict === undefined) {
    return execute(`${className} definition`);
  }
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ 'Class not found: ${escapeString(className)}'].
cls definition`;
  return execute(code);
}
