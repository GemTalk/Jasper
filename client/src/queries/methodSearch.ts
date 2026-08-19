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

// Methods that reference the VALUE of a user-typed, compilable literal expression — e.g. `#at:put:`,
// `42`, `$a`, `#{Globals.Object}`. The expression is compiled and evaluated on the server (it is
// intentionally raw, not escaped — it IS Smalltalk source), then `referencesToObject:` finds the
// literal frame. Interned literals (symbols, SmallIntegers, characters, specials, globals) match;
// a fresh String/Array literal is a distinct object each compile and so matches nothing. A
// malformed expression makes `execute` raise a compile error, which the caller handles.
export function referencesToLiteral(
  execute: QueryExecutor,
  literalExpr: string,
  environmentId: number = 0,
): MethodSearchResult[] {
  const code = `| methods stream limit classDict sl lit |
lit := ${literalExpr}.
methods := (ClassOrganizer new referencesToObject: lit).
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(execute(code));
}

// Methods that use a symbol as a DATA literal, NOT as a message send. `referencesToLiteral:` finds
// both — a selector send puts the symbol in the literal frame too — so it can't be used alone. The
// obvious "subtract the senders" (`reject: [:m | (sendersOf: symLit) includes: m]`) is unsound:
// `sendersOf:` under-reports for some selectors (notably `#not`, where it returns 0 while
// referencesToLiteral returns hundreds), so on those stones NOTHING is subtracted and every method
// that merely SENDS the selector leaks in as a bogus hit whose source never contains the symbol
// (Omni Search triage #9). Instead we mirror the string-literal branch: a fast source-substring
// pre-filter (`substringSearch:` for the literal's textual form `#...`) intersected with the
// literal-frame membership. A send like `x not` has source `not`, not `#not`, so it fails the
// substring filter; a real literal `#not` passes both. `symbolExpr` is a raw, compilable `#...`
// expression (evaluated on the server); `needle` is that same text matched literally in source.
//
// What that costs — the gate is textual, so a genuine literal use whose SOURCE doesn't spell `#not`
// is missed even though the symbol really is in the literal frame:
//   - inside a literal array — `#(not size)`, `#(at:put: foo)`: real symbols, but no `#` per element
//   - an equivalent different spelling — a search for `#not` won't find a method that wrote `#'not'`
// Accepted deliberately (reviewed on PR #443): both are rare next to the bogus every-sender flood the
// old query produced. If you are chasing a "missing" literal hit, this filter is the reason.
export function literalSymbolReferences(
  execute: QueryExecutor,
  symbolExpr: string,
  environmentId: number = 0,
): MethodSearchResult[] {
  const needle = escapeString(symbolExpr);
  const code = `| symLit lit candidates methods stream limit classDict sl |
symLit := ${symbolExpr}.
lit := (ClassOrganizer new referencesToLiteral: symLit) at: 1.
candidates := (ClassOrganizer new substringSearch: '${needle}' ignoreCase: false) at: 1.
methods := candidates select: [:m | lit includes: m].
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(execute(code));
}

// Methods that contain the text as an actual STRING LITERAL (not merely somewhere in source — a
// comment, a selector, a #symbol). We take the source-substring candidates (fast, indexed) and keep
// only those whose literal frame holds a matching String (excluding Symbols). `text` is the raw
// content (already unquoted by the caller).
export function stringLiteralReferences(
  execute: QueryExecutor,
  text: string,
  ignoreCase: boolean,
  environmentId: number = 0,
): MethodSearchResult[] {
  const esc = escapeString(text);
  // substringSearch is only a fast candidate pre-filter (methods whose source text contains the
  // characters); the literal-frame test is EXACT so `'name'` finds methods that use the literal
  // 'name' itself — not every string that merely CONTAINS "name" (className, filename, rename…),
  // which flooded the results and left nothing for the preview highlight to match.
  const code = `| ic needle candidates methods stream limit classDict sl |
ic := ${ignoreCase}.
needle := ic ifTrue: ['${esc}' asLowercase] ifFalse: ['${esc}'].
candidates := (ClassOrganizer new substringSearch: '${esc}' ignoreCase: ic) at: 1.
methods := candidates select: [:m |
  (m literals detect: [:l |
    (l isKindOf: String) and: [l isSymbol not and: [
      (ic ifTrue: [l asString asLowercase] ifFalse: [l asString]) = needle]]]
    ifNone: [nil]) notNil].
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(execute(code));
}
