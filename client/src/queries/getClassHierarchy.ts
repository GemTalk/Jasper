import { QueryExecutor } from './types';
import { classOrganizerExpr } from './classOrganizer';
import { classLookupExpr } from './util';

export interface ClassHierarchyEntry {
  className: string;
  dictName: string;
  /** 1-based SymbolList position of the dictionary that binds this class object; undefined when
   *  none on the list does. Two dictionaries can share a name, so `dictName` alone cannot say which
   *  one this is. */
  dictIndex?: number;
  kind: 'superclass' | 'self' | 'subclass';
}

export function getClassHierarchy(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): ClassHierarchyEntry[] {
  /**
   * In the Smalltalk code below, allSuperclassesOf: returns root-first ([Object, Collection, ...]),
   *  which is the order we want to render — Object at indent 0, the
   *  immediate parent right above the selected class. The earlier
   *  reverseDo: flipped it leaf-first and put Object at the deepest indent.
   *
   * `dict` scopes the class lookup (a 1-based SymbolList index, canonical for Jasper, or a
   * name); omit it for the unscoped global first-match. Scoping matters when a class name is
   * shadowed across dictionaries — an unscoped lookup could offer the wrong class's lineage.
   */
  const code = `| organizer class supers subs stream classDict sl row |
organizer := ${classOrganizerExpr()}.
class := ${classLookupExpr(className, dict)}.
supers := organizer allSuperclassesOf: class.
subs := organizer subclassesOf: class.
sl := System myUserProfile symbolList.
classDict := IdentityDictionary new.
1 to: sl size do: [:i |
  (sl at: i) keysAndValuesDo: [:k :v |
    (v isBehavior and: [(classDict includesKey: v) not])
      ifTrue: [classDict at: v put: i]]].
row := [:each :kind | | idx |
  idx := classDict at: each ifAbsent: [0].
  stream nextPutAll: (idx = 0 ifTrue: [''] ifFalse: [(sl at: idx) name]); tab;
    nextPutAll: each name; tab; nextPutAll: kind; tab; nextPutAll: idx printString; lf].
stream := WriteStream on: Unicode7 new.
supers do: [:each | row value: each value: 'superclass'].
row value: class value: 'self'.
(subs asSortedCollection: [:a :b | a name <= b name]) do: [:each | row value: each value: 'subclass'].
stream contents`;

  const raw = execute(code);
  const results: ClassHierarchyEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const dictIndex = parts[3] ? parseInt(parts[3], 10) : NaN;
    results.push({
      dictName: parts[0],
      className: parts[1],
      kind: parts[2] as 'superclass' | 'self' | 'subclass',
      dictIndex: dictIndex > 0 ? dictIndex : undefined,
    });
  }
  return results;
}
