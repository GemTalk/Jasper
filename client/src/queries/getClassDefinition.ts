import { NbQueryExecutor, QueryExecutor } from './types';
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
  return execute(classDefinitionCode(className, dict));
}

/**
 * A class's definition, read without blocking the extension host. `dict` (a
 * 1-based SymbolList index, or a name) scopes the lookup; without it, the name
 * resolves as a bare global.
 */
export function classDefinition(
  execute: NbQueryExecutor,
  className: string,
  dict?: number | string,
): Promise<string> {
  return execute(classDefinitionCode(className, dict));
}

function classDefinitionCode(className: string, dict: number | string | undefined): string {
  if (dict === undefined) {
    return `${className} definition`;
  }
  return `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ 'Class not found: ${escapeString(className)}'].
cls definition`;
}
