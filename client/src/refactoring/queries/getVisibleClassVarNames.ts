import { QueryExecutor } from '../../queries/types';
import { classLookupExpr, splitLines } from '../../queries/util';

// Class-variable names VISIBLE to methods of this class: its own classVarNames
// plus every superclass's (class variables are inherited by the whole subtree).
// The editor-triggered rename uses this to tell an inherited class variable
// (rename belongs to its defining class) apart from a name that is not a class
// variable at all. Compare getDefinedClassVarNames.ts, which lists only the
// class's OWN declarations.
//
// The class is resolved through `dict` (a 1-based SymbolList index, canonical for
// Jasper, or a name) via classLookupExpr; an unbound name yields an empty list.
export function getVisibleClassVarNames(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string[] {
  const code = `| ws cls chain |
cls := ${classLookupExpr(className, dict)}.
ws := WriteStream on: String new.
chain := cls ifNil: [#()] ifNotNil: [:c | (OrderedCollection with: c) addAll: c allSuperclasses; yourself].
chain do: [:c |
  c classVarNames do: [:each |
    ws nextPutAll: each asString; lf]].
ws contents`;
  return splitLines(execute(code));
}
