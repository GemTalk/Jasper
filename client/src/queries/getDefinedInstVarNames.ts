import { QueryExecutor } from './types';
import { classLookupExpr, splitLines } from './util';

// Instance variables DEFINED in this class only (not inherited) — GemStone's
// `instVarNames`, unlike `allInstVarNames` (see getInstVarNames.ts) which walks
// the whole superclass chain. Used by the GemStone Explorer's per-class ivar
// sub-tree, where renaming an inherited ivar belongs to its defining class.
//
// The class is resolved through `dict` (a 1-based SymbolList index, canonical for
// Jasper, or a name) via classLookupExpr — so the same class name in two
// dictionaries resolves to the SAME object the count/rename queries use — and the
// name is quoted/escaped there. A class the dictionary does not bind yields an
// empty list rather than a compile/runtime error.
export function getDefinedInstVarNames(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string[] {
  const code = `| ws cls |
cls := ${classLookupExpr(className, dict)}.
ws := WriteStream on: String new.
(cls ifNil: [#()] ifNotNil: [:c | c instVarNames]) do: [:each |
  ws nextPutAll: each asString; lf].
ws contents`;
  return splitLines(execute(code));
}
