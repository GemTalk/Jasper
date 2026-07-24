import { QueryExecutor } from './types';
import { escapeString } from './util';

export interface ClassHierarchyEntry {
  className: string;
  dictName: string;
  kind: 'superclass' | 'self' | 'subclass';
}

export function getClassHierarchy(
  execute: QueryExecutor,
  className: string,
): ClassHierarchyEntry[] {
  /**
   * In the Smalltalk code below, allSuperclassesOf: returns root-first ([Object, Collection, ...]),
   *  which is the order we want to render — Object at indent 0, the
   *  immediate parent right above the selected class. The earlier
   *  reverseDo: flipped it leaf-first and put Object at the deepest indent.
   */
  const code = `| organizer class supers subs stream classDict sl |
organizer := ClassOrganizer new.
class := System myUserProfile symbolList objectNamed: #'${escapeString(className)}'.
supers := organizer allSuperclassesOf: class.
subs := organizer subclassesOf: class.
sl := System myUserProfile symbolList.
classDict := IdentityDictionary new.
sl do: [:dict |
  dict keysAndValuesDo: [:k :v |
    (v isBehavior and: [(classDict includesKey: v) not])
      ifTrue: [classDict at: v put: dict name]]].
stream := WriteStream on: Unicode7 new.
supers do: [:each |
  stream nextPutAll: (classDict at: each ifAbsent: ['']); tab;
    nextPutAll: each name; tab; nextPutAll: 'superclass'; lf].
stream nextPutAll: (classDict at: class ifAbsent: ['']); tab;
  nextPutAll: class name; tab; nextPutAll: 'self'; lf.
(subs asSortedCollection: [:a :b | a name <= b name]) do: [:each |
  stream nextPutAll: (classDict at: each ifAbsent: ['']); tab;
    nextPutAll: each name; tab; nextPutAll: 'subclass'; lf].
stream contents`;

  const raw = execute(code);
  const results: ClassHierarchyEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    results.push({
      dictName: parts[0],
      className: parts[1],
      kind: parts[2] as 'superclass' | 'self' | 'subclass',
    });
  }
  return results;
}
