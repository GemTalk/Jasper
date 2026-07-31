import { QueryExecutor } from '../../queries/types';
import { classLookupExpr } from '../../queries/util';

/** A descendant class of some class, with its immediate parent (for display context). */
export interface DescendantClass {
  className: string;
  parentName: string;
}

// Every transitive subclass of a class, ordered top-down (a class always precedes its own
// subclasses), each with the name of its immediate superclass for display. Drives the ▼
// "move instance variable down" picker, where the destination may be any descendant (not just
// an immediate subclass — the engine handles any depth). The class is resolved through `dict`
// (a 1-based SymbolList index, canonical for Jasper, or a name) via classLookupExpr, so the
// same class name in two dictionaries resolves to the object the refactoring uses. A class the
// dictionary does not bind yields an empty list rather than an error.
export function getClassDescendantNames(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): DescendantClass[] {
  const code = `| organizer cls frontier seen out |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ ''].
organizer := ClassOrganizer new.
seen := IdentitySet new.
frontier := OrderedCollection new.
frontier addAll: ((organizer subclassesOf: cls) asSortedCollection: [:a :b | a name <= b name]).
out := WriteStream on: String new.
[frontier isEmpty] whileFalse: [ | c |
  c := frontier removeFirst.
  (seen includes: c) ifFalse: [
    seen add: c.
    out nextPutAll: c name asString; tab;
      nextPutAll: (c superclass ifNil: [''] ifNotNil: [:s | s name asString]); lf.
    frontier addAll: ((organizer subclassesOf: c) asSortedCollection: [:a :b | a name <= b name])]].
out contents`;
  const raw = execute(code);
  const results: DescendantClass[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 1 || parts[0].length === 0) continue;
    results.push({ className: parts[0], parentName: parts[1] ?? '' });
  }
  return results;
}
