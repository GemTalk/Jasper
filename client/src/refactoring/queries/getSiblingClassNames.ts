import { QueryExecutor } from '../../queries/types';
import { classLookupExpr } from '../../queries/util';

// The immediate SIBLINGS of a class: the other immediate subclasses of its superclass (the anchor
// itself excluded), sorted by name. Drives the Extract Superclass "which siblings to pull up too?"
// picker — extract only inserts a common parent above SAME-immediate-parent siblings, so this is
// exactly the candidate set. The class is resolved through `dict` (a 1-based SymbolList index,
// canonical for Jasper, or a name) via classLookupExpr. A class the dictionary does not bind, or
// one whose superclass is nil, yields an empty list rather than an error.
export function getSiblingClassNames(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string[] {
  const code = `| cls sup out |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ ''].
sup := cls superclass.
sup isNil ifTrue: [^ ''].
out := WriteStream on: String new.
((ClassOrganizer new subclassesOf: sup) asSortedCollection: [:a :b | a name <= b name]) do: [:c |
  c == cls ifFalse: [out nextPutAll: c name asString; lf]].
out contents`;
  const raw = execute(code);
  const results: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.length > 0) results.push(line);
  }
  return results;
}
