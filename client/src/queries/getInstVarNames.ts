import { QueryExecutor } from './types';
import { classLookupExpr, splitLines } from './util';

// All instance-variable names VISIBLE to this class — its own plus every
// superclass's (`allInstVarNames`). The class is resolved through `dict` (a 1-based
// SymbolList index, canonical for Jasper, or a name) via classLookupExpr, so a class
// name shadowed across dictionaries resolves the SAME object the other membership
// probes use — and the name is quoted/escaped there. A class the dictionary does not
// bind yields an empty list rather than a compile/runtime error.
export function getInstVarNames(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string[] {
  const code = `| ws cls |
cls := ${classLookupExpr(className, dict)}.
ws := WriteStream on: String new.
(cls ifNil: [#()] ifNotNil: [:c | c allInstVarNames]) do: [:each |
  ws nextPutAll: each asString; lf].
ws contents`;
  return splitLines(execute(code));
}
