import { QueryExecutor } from './types';
import { classLookupExpr } from './util';

// Return a class's comment. `dict` (a 1-based SymbolList index, or a name) scopes
// the lookup to a specific dictionary so the same key registered in two
// dictionaries resolves to the intended class; without it, the class name is
// resolved as a bare global (first match in the symbol list).
export async function getClassComment(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): Promise<string> {
  if (dict === undefined) {
    return await execute(`${className} comment`);
  }
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ ''].
cls comment`;
  return await execute(code);
}
