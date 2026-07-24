import { QueryExecutor } from '../../queries/types';
import { classLookupExpr, splitLines } from '../../queries/util';

// Class variables DEFINED in this class only (not inherited) — GemStone's
// `classVarNames`, which lists a class's own class-variable names (a subclass
// reports only the ones it declares, not those inherited). Used by the GemStone
// Explorer's per-class class-variable sub-tree, where renaming a class variable
// belongs to its defining class.
//
// The class is resolved through `dict` (a 1-based SymbolList index, canonical for
// Jasper, or a name) via classLookupExpr — so the same class name in two
// dictionaries resolves to the SAME object the count/rename queries use — and the
// name is quoted/escaped there. A class the dictionary does not bind yields an
// empty list rather than a compile/runtime error.
export function getDefinedClassVarNames(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string[] {
  const code = `| ws cls |
cls := ${classLookupExpr(className, dict)}.
ws := WriteStream on: String new.
(cls ifNil: [#()] ifNotNil: [:c | c classVarNames]) do: [:each |
  ws nextPutAll: each asString; lf].
ws contents`;
  return splitLines(execute(code));
}
