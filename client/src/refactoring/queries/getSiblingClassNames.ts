import { QueryExecutor } from '../../queries/types';
import { classOrganizerExpr } from '../../queries/classOrganizer';
import { classLookupExpr } from '../../queries/util';

// The immediate SIBLINGS of a class: the other immediate subclasses of its superclass (the anchor
// itself excluded), sorted by name. Drives the Extract Superclass "which siblings to pull up too?"
// picker — extract only inserts a common parent above SAME-immediate-parent siblings, so this is
// exactly the candidate set. The class is resolved through `dict` (a 1-based SymbolList index,
// canonical for Jasper, or a name) via classLookupExpr. A class the dictionary does not bind, or
// one whose superclass is nil, yields an empty list rather than an error.
//
// The list is intersected with `sup subclasses` on purpose. The engine's `resolveSibling:`
// resolves a picked name by `detect:`-ing over `sharedParent subclasses` and DECLINES ("… is not
// a subclass of …") when it finds no match, so anything this picker offers that is not in that
// collection would be refused after the user had already picked members and named the class.
// ClassOrganizer scans the symbol list and can report a class the parent's own `subclasses` does
// not track (a stale version, a class reachable by a different route), so rather than assume the
// two agree we only offer names the engine's own lookup is guaranteed to find.
export function getSiblingClassNames(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string[] {
  const code = `| cls sup tracked out |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ ''].
sup := cls superclass.
sup isNil ifTrue: [^ ''].
tracked := sup subclasses ifNil: [#()].
out := WriteStream on: String new.
((${classOrganizerExpr()} subclassesOf: sup) asSortedCollection: [:a :b | a name <= b name]) do: [:c |
  (c == cls or: [(tracked detect: [:t | t == c] ifNone: [nil]) isNil])
    ifFalse: [out nextPutAll: c name asString; lf]].
out contents`;
  const raw = execute(code);
  const results: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.length > 0) results.push(line);
  }
  return results;
}
