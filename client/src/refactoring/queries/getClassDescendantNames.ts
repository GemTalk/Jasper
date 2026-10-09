import { QueryExecutor } from '../../queries/types';
import { classOrganizerExpr, subclassesOfBlock } from '../../queries/classOrganizer';
import { classLookupExpr } from '../../queries/util';
import { classHomeIndexStatement } from '../../queries/classHomeIndex';

/** A descendant class of some class, with its immediate parent (for display context)
 *  and the dictionary that binds it. */
export interface DescendantClass {
  className: string;
  parentName: string;
  /** The symbol dictionary that binds this descendant CLASS OBJECT, resolved by
   *  object identity (not by name) so a caller acting on the descendant — e.g.
   *  deleting it — targets the right class even when the name is shadowed in another
   *  dictionary. `dictIndex` is the 1-based SymbolList position; it is 0 (and
   *  `dictName` empty) when the class is not bound in any dictionary in the list. */
  dictName: string;
  dictIndex: number;
}

// Every transitive subclass of a class, ordered top-down (a class always precedes its own
// subclasses), each with the name of its immediate superclass for display and the dictionary
// that binds the subclass. Drives the ▼ "move instance variable down" picker (destination may be
// any descendant, any depth) and the Explorer's Remove Class (which deletes the whole subtree).
// The class is resolved through `dict` (a 1-based SymbolList index, canonical for Jasper, or a
// name) via classLookupExpr, so the same class name in two dictionaries resolves to the object the
// caller means. Each descendant's binding dictionary is likewise resolved by OBJECT IDENTITY — a
// symbol-list scan mapping every class object to the first dictionary that binds it — so a
// descendant whose name is shadowed elsewhere still reports its own dictionary, not the global
// first match. A class the dictionary does not bind yields an empty list rather than an error.
export function getClassDescendantNames(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): DescendantClass[] {
  const code = `| organizer subsOf cls frontier seen out sl classDict |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ ''].
sl := System myUserProfile symbolList.
${classHomeIndexStatement('classDict', 'sl')}
organizer := ${classOrganizerExpr()}.
subsOf := ${subclassesOfBlock('organizer')}.
seen := IdentitySet new.
frontier := OrderedCollection new.
frontier addAll: ((subsOf value: cls) asSortedCollection: [:a :b | a name <= b name]).
out := WriteStream on: String new.
[frontier isEmpty] whileFalse: [ | c idx |
  c := frontier removeFirst.
  (seen includes: c) ifFalse: [
    seen add: c.
    idx := classDict at: c ifAbsent: [0].
    out nextPutAll: c name asString; tab;
      nextPutAll: (c superclass ifNil: [''] ifNotNil: [:s | s name asString]); tab;
      nextPutAll: idx printString; tab;
      nextPutAll: (idx = 0 ifTrue: [''] ifFalse: [(sl at: idx) name asString]); lf.
    frontier addAll: ((subsOf value: c) asSortedCollection: [:a :b | a name <= b name])]].
out contents`;
  const raw = execute(code);
  const results: DescendantClass[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 1 || parts[0].length === 0) continue;
    const dictIndex = parts[2] ? parseInt(parts[2], 10) : 0;
    results.push({
      className: parts[0],
      parentName: parts[1] ?? '',
      dictName: parts[3] ?? '',
      dictIndex: Number.isNaN(dictIndex) ? 0 : dictIndex,
    });
  }
  return results;
}
