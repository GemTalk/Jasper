import { QueryExecutor } from './types';
import { escapeString } from './util';

export interface MethodSearchResult {
  dictName: string;
  className: string;
  isMeta: boolean;
  selector: string;
  category: string;
}

// Shared Smalltalk snippet: build classDict mapping classes to their first
// dictionary name, then serialize an array of GsNMethods (bound as `methods`
// before this snippet runs) as tab-separated lines.
function methodSerialization(envId: number): string {
  return `sl := System myUserProfile symbolList.
classDict := IdentityDictionary new.
sl do: [:dict |
  dict keysAndValuesDo: [:k :v |
    "Only treat a dict as a class's home when it is stored under its own
     name. Otherwise an alias entry (e.g. Python's #object -> Object, which
     sorts before Globals) would mask the real home dictionary and break
     browser navigation, since the browser keys classes by their name."
    (v isBehavior and: [(classDict includesKey: v) not and: [k = v name asSymbol]])
      ifTrue: [classDict at: v put: dict name]]].
stream := WriteStream on: Unicode7 new.
limit := methods size min: 500.
1 to: limit do: [:i |
  | each cls baseClass |
  each := methods at: i.
  cls := each inClass.
  baseClass := cls theNonMetaClass.
  stream
    nextPutAll: (classDict at: baseClass ifAbsent: ['']); tab;
    nextPutAll: baseClass name; tab;
    nextPutAll: (cls isMeta ifTrue: ['1'] ifFalse: ['0']); tab;
    nextPutAll: each selector; tab;
    nextPutAll: ((cls categoryOfSelector: each selector environmentId: ${envId}) ifNil: ['']); lf.
].
stream contents`;
}

function parseMethodSearchResults(raw: string): MethodSearchResult[] {
  const results: MethodSearchResult[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    results.push({
      dictName: parts[0],
      className: parts[1],
      isMeta: parts[2] === '1',
      selector: parts[3],
      category: parts[4],
    });
  }
  return results;
}

export function searchMethodSource(
  execute: QueryExecutor,
  term: string,
  ignoreCase: boolean,
): MethodSearchResult[] {
  const code = `| results methods stream limit classDict sl |
results := ClassOrganizer new substringSearch: '${escapeString(term)}' ignoreCase: ${ignoreCase}.
methods := results at: 1.
${methodSerialization(0)}`;

  return parseMethodSearchResults(execute(code));
}

export function sendersOf(
  execute: QueryExecutor,
  selector: string,
  environmentId: number = 0,
): MethodSearchResult[] {
  const code = `| methods stream limit classDict sl |
methods := ((ClassOrganizer new environmentId: ${environmentId}; yourself)
  sendersOf: #'${escapeString(selector)}') at: 1.
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(execute(code));
}

export function implementorsOf(
  execute: QueryExecutor,
  selector: string,
  environmentId: number = 0,
): MethodSearchResult[] {
  const code = `| methods stream limit classDict sl |
methods := ((ClassOrganizer new environmentId: ${environmentId}; yourself)
  implementorsOf: #'${escapeString(selector)}') asArray.
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(execute(code));
}

// Implementations of `selector` in a class's hierarchy: the full superclass
// chain (direction 'up') or all subclasses (direction 'down'), on the
// instance or class side. One round trip; reuses the standard result format.
export function hierarchyImplementorsOf(
  execute: QueryExecutor,
  dictIndex: number,
  className: string,
  selector: string,
  isMeta: boolean,
  direction: 'up' | 'down',
  environmentId: number = 0,
): MethodSearchResult[] {
  const sel = escapeString(selector);
  const target = isMeta ? 'class class' : 'class';
  const collect =
    direction === 'up'
      ? `cur := (${target}) superclass.
[cur notNil] whileTrue: [
  (cur includesSelector: #'${sel}') ifTrue: [methods add: (cur compiledMethodAt: #'${sel}')].
  cur := cur superclass].`
      : `class allSubclasses do: [:sub | | tgt |
  tgt := ${isMeta ? 'sub class' : 'sub'}.
  (tgt includesSelector: #'${sel}') ifTrue: [methods add: (tgt compiledMethodAt: #'${sel}')]].`;
  const code = `| class methods stream limit classDict sl cur |
class := (System myUserProfile symbolList at: ${dictIndex}) at: #'${escapeString(className)}'.
methods := OrderedCollection new.
${collect}
methods := methods asArray.
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(execute(code));
}

export function referencesToObject(
  execute: QueryExecutor,
  objectName: string,
  environmentId: number = 0,
): MethodSearchResult[] {
  const code = `| methods stream limit classDict sl |
methods := (ClassOrganizer new referencesToObject:
  (System myUserProfile symbolList objectNamed: #'${escapeString(objectName)}')).
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(execute(code));
}
