import { QueryExecutor } from './types';
import { classLookupExpr } from './util';

// Whether a class may be written (not in a read-only repository segment). `dict`
// (a 1-based SymbolList index, or a name) scopes the lookup to a specific
// dictionary so the same key registered in two dictionaries resolves to the
// intended class; a missing class is treated as not writable.
export function canClassBeWritten(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): boolean {
  const code =
    dict === undefined
      ? `${className} canBeWritten printString`
      : `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ 'false'].
cls canBeWritten printString`;
  const result = execute(code);
  return result.trim() === 'true';
}
