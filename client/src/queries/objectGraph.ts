import { QueryExecutor } from './types';

/** One class of referrer, with how many of its instances point at the target object.
 *
 *  `referrerClass` is the class's own `name`, so a class-side reference reports as
 *  `'LibcFcntl class'` (a metaclass names itself that way) — which is the useful
 *  reading: the reference lives in a class variable, not an instance variable. */
export interface ReferrerGroup {
  referrerClass: string;
  /** When the group holds exactly ONE object, that object — resolved in the same scan
   *  rather than costing another. A group of one is just the object with a box around it,
   *  so callers draw the object itself and drop the group. */
  soleOop?: string;
  solePrintString?: string;
  /** The referrer class's OOP, decimal, as a string. Class VERSIONS share a name —
   *  `V2Cat class` can appear twice — so callers that key a map must key on this,
   *  not on `referrerClass`, or two versions silently merge into one row. Kept as a
   *  string rather than a number because OOPs outgrow a JS float. */
  referrerClassOop: string;
  /** How many distinct OBJECTS of this class point at the target — NOT how many
   *  references they hold. The kernel answers a `GsBitmap`, which is a set: an Array
   *  holding the same object three times appears in it once (measured). So a count of 1
   *  guarantees exactly one referring object, which is what makes {@link soleOop} safe. */
  count: number;
}

/** Why `referrersOf` can decline, so the caller can say something true about it.
 *
 *  `needsCommit` is the case that matters in practice: a repository-wide reference
 *  scan aborts the session, so GemStone refuses to run one while the session holds
 *  uncommitted work — it raises before doing anything rather than discarding edits.
 *  A workspace selection lands here constantly, because evaluating anything that
 *  CREATES an object (`Foo new`) dirties the session; and a brand-new uncommitted
 *  object has no referrers anyway, so there is nothing to draw even if it ran. */
export type ReferrersResult =
  | { kind: 'ok'; groups: ReferrerGroup[]; scanMillis: number }
  | { kind: 'needsCommit' }
  | { kind: 'unavailable'; reason: string };

/** Every class of object that points at `oop`, with a count per class — the question
 *  a relational database cannot answer about a row, because rows do not point at rows.
 *  Includes references nobody declared, references from inside collections, and
 *  references through untyped slots; GemStone has no declared schema, so this is the
 *  only account of what refers to what that exists.
 *
 *  Measured on a 3.6.2 stone as DataCurator: the class `Object` resolves to 277
 *  referrer classes in 24 ms, whole extent, exact counts — no sampling. Cost tracks
 *  the number of DISTINCT referrer classes (the size of the result), not the number
 *  of objects scanned.
 *
 *  Direct referrers only, one level. Going transitive would mean a fresh
 *  repository-wide pass per hop.
 *
 *  Not for immediates. A SmallInteger, Character, Boolean or nil has no identity to
 *  scan for and the kernel call raises; callers holding a live session should screen
 *  those out first with `isSpecialOop` so the user gets a specific message instead of
 *  the generic `unavailable`. Sent one anyway, this answers `unavailable` rather than
 *  letting the walkback escape.
 *
 *  Aggregates in the stone by design. The kernel answers `{class . GsBitmap}` pairs
 *  and a `GsBitmap` is a server-side object that cannot cross GCI, so the bitmaps are
 *  reduced to `size` before anything is returned. Never widen this to return the
 *  objects themselves. */
export function referrersOf(execute: QueryExecutor, oop: bigint): ReferrersResult {
  // `oop` is numeric, so it interpolates without escaping.
  //
  // Status arrives as the first line and the payload follows, rather than everything
  // being packed into one tab-separated row: a GemStone messageText is free text that
  // can carry tabs and newlines, and giving it the whole tail of the string means no
  // sanitising and no field that can shift a column over.
  //
  // `name asString` because `Class>>name` answers a Symbol, and a Symbol compared or
  // streamed against Unicode7-derived text misbehaves on 3.6.x (see the Unicode7 note
  // in ./util) — asString first is the safe idiom everywhere in this layer.
  //
  // `System needsCommit` is checked BEFORE the scan rather than catching the refusal
  // afterwards: it is the same precondition, it is the house idiom for "would this
  // abort lose work", and it does not depend on matching a GemStone error number.
  const code = `| ws obj pairs ms |
System needsCommit ifTrue: [^ 'needsCommit'].
obj := [Object objectForOop: ${oop}]
  on: Error do: [:ex | ^ 'unavailable
', (ex messageText ifNil: ['GemStone error ', ex number printString])].
pairs := nil.
ms := System millisecondsToRun: [
  pairs := [SystemRepository allReferencesByParentClass: (Array with: obj)]
    on: Error do: [:ex | ^ 'unavailable
', (ex messageText ifNil: ['GemStone error ', ex number printString])]].
ws := WriteStream on: String new.
ws nextPutAll: 'ok'; tab; nextPutAll: ms printString; lf.
pairs do: [:pair |
  | bm sole str |
  bm := pair at: 2.
  ws nextPutAll: (pair at: 1) name asString; tab;
     nextPutAll: (pair at: 1) asOop printString; tab;
     nextPutAll: bm size printString; tab.
  bm size = 1
    ifTrue: [
      sole := (bm enumerateWithLimit: 1 startingAfter: 0) at: 1.
      str := [sole printString] on: Error do: [:ex | ex return: '<printString failed>'].
      str size > ${PRINT_STRING_CAP} ifTrue: [str := str copyFrom: 1 to: ${PRINT_STRING_CAP}].
      ws nextPutAll: sole asOop printString; tab.
      1 to: str size do: [:i |
        | c |
        c := str at: i.
        ws nextPut: (c isSeparator ifTrue: [Character space] ifFalse: [c])]]
    ifFalse: [ws nextPutAll: '0'; tab].
  ws lf].
ws contents`;

  const parsed = splitStatus(execute(code));
  if (parsed.kind !== 'ok') return parsed;

  const groups: ReferrerGroup[] = [];
  for (const line of parsed.body.split('\n')) {
    if (!line) continue;
    // `class <TAB> classOop <TAB> count <TAB> soleOop <TAB> solePrintString`, with the
    // printString last and flattened server-side, so a plain split is unambiguous: a
    // class name holds no tab, and the free-text field cannot shift a column.
    const f = line.split('\t');
    if (f.length < 4) continue;
    const sole = f[3];
    groups.push({
      referrerClass: f[0],
      referrerClassOop: f[1],
      count: Number(f[2]),
      ...(sole && sole !== '0' ? { soleOop: sole, solePrintString: f.slice(4).join(' ') } : {}),
    });
  }

  // Biggest referrer group first — the useful reading order, and it keeps the eventual
  // picture's centre of gravity stable when the layout takes the first N.
  groups.sort((a, b) => b.count - a.count);
  return { kind: 'ok', groups, scanMillis: parsed.millis };
}

/** One class and how many instances of it the whole extent holds. */
export interface ClassPopulation {
  className: string;
  classOop: string;
  /** The SymbolDictionary the class is bound in; `'(unnamed)'` for a dictionary with no name. */
  dictionary: string;
  instanceCount: number;
}

export type ClassCensusResult =
  | { kind: 'ok'; classes: ClassPopulation[]; scanMillis: number }
  | { kind: 'needsCommit' }
  | { kind: 'unavailable'; reason: string };

/** Population per class across the whole extent — exact, not sampled.
 *
 *  Walks `System myUserProfile symbolList`, not `Globals`: a census of Globals
 *  alone misses every user class, which on a Rowan-style stone is all of the
 *  interesting ones.
 *
 *  A class bound in more than one dictionary is reported once, under the first
 *  dictionary that binds it, so the counts sum to the extent rather than
 *  double-counting a shared binding. Class VERSIONS are NOT collapsed — they are
 *  distinct class objects that share a name, and each gets its own row keyed by
 *  `classOop`.
 *
 *  Measured 43 ms for 593 classes on 3.6.2 and 160 ms for 769 on 3.7.5. */
export function classCensus(execute: QueryExecutor, dictionary?: string): ClassCensusResult {
  // The dictionary filter is compared as an interned Symbol (`asString asSymbol ==`)
  // rather than with `= 'literal'`: on 3.6.x a Unicode7 literal compared against an
  // image-derived Symbol silently answers false. `asString` first because an unnamed
  // SymbolDictionary answers nil for `name`, and `nil asSymbol` would not understand.
  const filter =
    dictionary === undefined
      ? 'true'
      : `(d name asString asSymbol == #'${dictionary.replace(/'/g, "''")}')`;
  const code = `| ws sl classes dicts seen counts ms |
System needsCommit ifTrue: [^ 'needsCommit'].
classes := OrderedCollection new.
dicts := OrderedCollection new.
seen := IdentityKeyValueDictionary new.
sl := System myUserProfile symbolList.
1 to: sl size do: [:i |
  | d dn |
  d := sl at: i.
  ${filter} ifTrue: [
    dn := (d name ifNil: ['(unnamed)']) asString.
    d keysAndValuesDo: [:k :v |
      (v isBehavior and: [(seen at: v ifAbsent: [nil]) isNil]) ifTrue: [
        seen at: v put: true.
        classes add: v.
        dicts add: dn]]]].
classes isEmpty ifTrue: [^ 'ok
'].
ms := System millisecondsToRun: [
  counts := [SystemRepository countInstances: classes asArray]
    on: Error do: [:ex | ^ 'unavailable
', (ex messageText ifNil: ['GemStone error ', ex number printString])]].
ws := WriteStream on: String new.
ws nextPutAll: 'ok'; tab; nextPutAll: ms printString; lf.
1 to: classes size do: [:i |
  | c |
  c := classes at: i.
  ws nextPutAll: (c name asString); tab;
     nextPutAll: c asOop printString; tab;
     nextPutAll: (dicts at: i); tab;
     nextPutAll: (counts at: i) printString; lf].
ws contents`;

  const raw = execute(code);
  const parsed = splitStatus(raw);
  if (parsed.kind !== 'ok') return parsed;

  const classes: ClassPopulation[] = [];
  for (const line of parsed.body.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (f.length < 4) continue;
    classes.push({
      className: f[0],
      classOop: f[1],
      dictionary: f[2],
      instanceCount: Number(f[3]),
    });
  }
  classes.sort((a, b) => b.instanceCount - a.instanceCount);
  return { kind: 'ok', classes, scanMillis: parsed.millis };
}

/** One class-to-class reference edge: instances of `from` hold `count` references to
 *  instances of `to`. */
export interface ReferenceEdge {
  from: string;
  fromOop: string;
  to: string;
  toOop: string;
  count: number;
}

/** References INTO a requested class from classes that were not requested — the
 *  remainder, reported rather than dropped, so a diagram drawn from `edges` can say
 *  how much of the inbound traffic it is not showing. */
export interface UnattributedReferences {
  to: string;
  toOop: string;
  count: number;
}

export type ReferenceEdgesResult =
  | {
      kind: 'ok';
      edges: ReferenceEdge[];
      unattributed: UnattributedReferences[];
      scanMillis: number;
    }
  | { kind: 'needsCommit' }
  | { kind: 'unavailable'; reason: string };

/** How many objects each `enumerateWithLimit:startingAfter:` call pulls off a bitmap.
 *  Server-side chunking inside one doit, so this is not a round-trip count — 5,000
 *  streams 30,918 referrers in 42 ms on 3.6.2. */
const STREAM_CHUNK = 5000;

/** Chunks any one bitmap will be streamed for before the scan gives up on it. A
 *  backstop against a cursor that stops advancing, not a real limit: at
 *  {@link STREAM_CHUNK} per chunk this allows ten million referrers to a single
 *  class, far past anything a stone holds. */
const STREAM_CHUNK_LIMIT = 2000;

/** The class-to-class reference graph among the named classes — an ERD assembled
 *  from real pointers, with true edge counts. GemStone has no declared schema (no
 *  instance-variable constraints are set on these stones), so this is not a more
 *  truthful rendering of a DDL; it is the only account of the shape that exists.
 *
 *  Both endpoints are restricted to the named classes, which is what keeps the
 *  picture legible: measured on Rowan's own package registry, 21 classes produced 15
 *  edges out of 441 possible — 3.4% density, hierarchical, no hairball. Inbound
 *  references from classes outside the set are NOT discarded silently; they are
 *  totalled per target in `unattributed`.
 *
 *  Kernel classes are a bad input set. `Array`'s referrers alone span 1,034 distinct
 *  classes; ask for user classes. */
export function referenceEdges(execute: QueryExecutor, classNames: string[]): ReferenceEdgesResult {
  if (classNames.length === 0) {
    return { kind: 'ok', edges: [], unattributed: [], scanMillis: 0 };
  }
  // Names go over as a Symbol array literal and are resolved server-side in a loop,
  // so the doit stays the same length whether the caller asks for 3 classes or 300 —
  // the shape that keeps clear of 3.6.x's CompileError 1001 on long doits.
  const nameLiterals = classNames.map((n) => `#'${n.replace(/'/g, "''")}'`).join(' ');
  const code = `| ws names classes want pairs ms |
System needsCommit ifTrue: [^ 'needsCommit'].
names := #( ${nameLiterals} ).
classes := OrderedCollection new.
want := IdentityKeyValueDictionary new.
names do: [:n |
  | c |
  c := System myUserProfile symbolList objectNamed: n.
  (c notNil and: [c isBehavior and: [(want at: c ifAbsent: [nil]) isNil]]) ifTrue: [
    want at: c put: true.
    classes add: c]].
classes isEmpty ifTrue: [^ 'unavailable
None of the named classes resolved to a class in this user''s symbol list'].
ms := System millisecondsToRun: [
  pairs := [SystemRepository allReferencesToInstancesOfClasses: classes asArray]
    on: Error do: [:ex | ^ 'unavailable
', (ex messageText ifNil: ['GemStone error ', ex number printString])]].
ws := WriteStream on: String new.
ws nextPutAll: 'ok'; tab; nextPutAll: ms printString; lf.
pairs do: [:pair |
  | target bm tally other cursor chunk guard |
  target := pair at: 1.
  bm := pair at: 2.
  tally := IdentityKeyValueDictionary new.
  other := 0.
  cursor := 0.
  guard := 0.
  [guard := guard + 1.
   chunk := bm enumerateWithLimit: ${STREAM_CHUNK} startingAfter: cursor.
   chunk size > 0 and: [guard <= ${STREAM_CHUNK_LIMIT}]] whileTrue: [
    chunk do: [:o |
      | c |
      c := o class.
      (want at: c ifAbsent: [nil]) isNil
        ifTrue: [other := other + 1]
        ifFalse: [tally at: c put: (tally at: c ifAbsent: [0]) + 1]].
    cursor := (chunk at: chunk size) asOop].
  tally keysAndValuesDo: [:from :n |
    ws nextPutAll: 'edge'; tab;
       nextPutAll: from name asString; tab; nextPutAll: from asOop printString; tab;
       nextPutAll: target name asString; tab; nextPutAll: target asOop printString; tab;
       nextPutAll: n printString; lf].
  other > 0 ifTrue: [
    ws nextPutAll: 'other'; tab;
       nextPutAll: target name asString; tab; nextPutAll: target asOop printString; tab;
       nextPutAll: other printString; lf]].
ws contents`;

  const raw = execute(code);
  const parsed = splitStatus(raw);
  if (parsed.kind !== 'ok') return parsed;

  const edges: ReferenceEdge[] = [];
  const unattributed: UnattributedReferences[] = [];
  for (const line of parsed.body.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (f[0] === 'edge' && f.length >= 6) {
      edges.push({
        from: f[1],
        fromOop: f[2],
        to: f[3],
        toOop: f[4],
        count: Number(f[5]),
      });
    } else if (f[0] === 'other' && f.length >= 4) {
      unattributed.push({ to: f[1], toOop: f[2], count: Number(f[3]) });
    }
  }
  edges.sort((a, b) => b.count - a.count);
  return { kind: 'ok', edges, unattributed, scanMillis: parsed.millis };
}

/** Splits the shared `status[\tms]\n<body>` reply the three scans return.
 *
 *  Kept in one place because all three share the refusal contract: a
 *  repository-wide scan aborts the session, so GemStone declines to run one while
 *  the session holds uncommitted work. */
function splitStatus(
  raw: string,
):
  | { kind: 'ok'; body: string; millis: number }
  | { kind: 'needsCommit' }
  | { kind: 'unavailable'; reason: string } {
  const newline = raw.indexOf('\n');
  const statusLine = newline === -1 ? raw : raw.slice(0, newline);
  const body = newline === -1 ? '' : raw.slice(newline + 1);
  const [status, millis] = statusLine.split('\t');

  switch (status.trim()) {
    case 'needsCommit':
      return { kind: 'needsCommit' };
    case 'unavailable':
      return {
        kind: 'unavailable',
        reason: body.trim() || 'GemStone declined the reference scan',
      };
    case 'ok':
      return { kind: 'ok', body, millis: Number(millis) || 0 };
    default:
      return { kind: 'unavailable', reason: `Unrecognised reply from the stone: ${statusLine}` };
  }
}

/** The transient collection of referrers is inspected by OOP, so something in the stone
 *  has to hold a strong reference to it between the scan and the inspector's first read
 *  or it can be scavenged. `SessionTemps` is the right anchor: it is session-local, so
 *  storing into it does NOT set `needsCommit` (verified), and it survives the abort that
 *  a repository scan performs. One key, overwritten each time, so repeated drill-downs
 *  cannot accumulate. */
const REFERRER_TEMP_KEY = 'JasperObjectGraphReferrers';

/** Most referrers gathered into one collection. A cap rather than a limit anybody should
 *  hit: it exists so that drilling into a class with a million referrers cannot build an
 *  unbounded Array. `total` always reports the true count. */
export const REFERRER_COLLECTION_LIMIT = 5000;

export type ReferrerCollectionResult =
  | { kind: 'ok'; oop: string; total: number; returned: number; scanMillis: number }
  | { kind: 'needsCommit' }
  | { kind: 'unavailable'; reason: string };

/** Gather the objects of one class that point at `targetOop` into a transient
 *  collection, and answer its OOP so an inspector can be opened on it — the drill-down
 *  behind a row of {@link referrersOf}, which answers only counts.
 *
 *  `referrerClassOop` identifies the class BY OOP rather than by name, because class
 *  versions share a name and picking the wrong version would answer an empty collection
 *  while looking like a bug.
 *
 *  The collection is transient — created in the session, never committed, and holding it
 *  costs nothing persistent. Creating it does not dirty the session (only writes to
 *  *persistent* objects set `needsCommit`), so a drill-down does not block the next scan.
 *  The caller should still pin the returned OOP with `saveObjs` for the inspector's
 *  lifetime; the `SessionTemps` anchor covers the gap until then. */
export function referrerCollectionOf(
  execute: QueryExecutor,
  targetOop: bigint,
  referrerClassOop: bigint,
  limit: number = REFERRER_COLLECTION_LIMIT,
): ReferrerCollectionResult {
  const code = `| obj cls pairs bm total out cursor chunk guard ms coll |
System needsCommit ifTrue: [^ 'needsCommit'].
obj := [Object objectForOop: ${targetOop}]
  on: Error do: [:ex | ^ 'unavailable
', (ex messageText ifNil: ['GemStone error ', ex number printString])].
cls := [Object objectForOop: ${referrerClassOop}]
  on: Error do: [:ex | ^ 'unavailable
', (ex messageText ifNil: ['GemStone error ', ex number printString])].
ms := System millisecondsToRun: [
  pairs := [SystemRepository allReferencesByParentClass: (Array with: obj)]
    on: Error do: [:ex | ^ 'unavailable
', (ex messageText ifNil: ['GemStone error ', ex number printString])]].
bm := nil.
pairs do: [:pair | (pair at: 1) == cls ifTrue: [bm := pair at: 2]].
total := bm isNil ifTrue: [0] ifFalse: [bm size].
out := OrderedCollection new.
bm isNil ifFalse: [
  cursor := 0.
  guard := 0.
  [out size < ${limit} and: [
    guard := guard + 1.
    guard <= ${STREAM_CHUNK_LIMIT} and: [
      chunk := bm enumerateWithLimit: ${STREAM_CHUNK} startingAfter: cursor.
      chunk size > 0]]] whileTrue: [
    chunk do: [:o | out size < ${limit} ifTrue: [out add: o]].
    cursor := (chunk at: chunk size) asOop]].
coll := Array withAll: out.
SessionTemps current at: #'${REFERRER_TEMP_KEY}' put: coll.
'ok', (String with: Character tab), ms printString, (String with: Character lf),
  total printString, (String with: Character tab),
  coll size printString, (String with: Character tab),
  coll asOop printString`;

  const parsed = splitStatus(execute(code));
  if (parsed.kind !== 'ok') return parsed;

  const [total, returned, oop] = parsed.body.trim().split('\t');
  if (!oop) {
    return { kind: 'unavailable', reason: 'The stone did not answer a collection' };
  }
  return {
    kind: 'ok',
    oop,
    total: Number(total) || 0,
    returned: Number(returned) || 0,
    scanMillis: parsed.millis,
  };
}

/** One actual referrer object, identified well enough to recognise and to step to. */
export interface ReferrerObject {
  /** The referrer's OOP, decimal, as a string — the next target of a graph walk. */
  oop: string;
  /** `printString`, truncated server-side and flattened to one line. */
  printString: string;
  /** Whether this referrer is itself a class. A walk that reaches a class can offer the
   *  Explorer as well as another hop. */
  isClass: boolean;
}

export type ReferrerObjectsResult =
  | { kind: 'ok'; objects: ReferrerObject[]; total: number; scanMillis: number }
  | { kind: 'needsCommit' }
  | { kind: 'unavailable'; reason: string };

/** Longest `printString` kept per referrer. Enough to recognise one in a list without
 *  paying to ship the print of a large collection. */
const PRINT_STRING_CAP = 160;

/** How many referrers of one class are listed for stepping into. A walk needs recognisable
 *  choices, not an exhaustive dump; {@link referrerCollectionOf} is the exhaustive one. */
export const REFERRER_PAGE_SIZE = 100;

/** The individual objects of one class that point at `targetOop` — what makes the graph
 *  walkable, since a hop needs a single object and a row of {@link referrersOf} names a
 *  whole class.
 *
 *  `referrerClassOop` identifies the class BY OOP rather than by name, because class
 *  versions share a name and picking the wrong version would answer an empty list while
 *  looking like a bug.
 *
 *  `limit` bounds both the list and its cost: there is no `printStringLimitedTo:` on
 *  3.6.2 (nor `printString:`, nor `asStringLimitedTo:` — all four probed absent), so each
 *  label costs a full `printString` that is only truncated afterwards. A class whose
 *  instances are large collections is the expensive case, and the limit is what keeps a
 *  hop interactive. `total` always reports the true count so a caller can say what it is
 *  not showing. */
export function referrerObjectsOf(
  execute: QueryExecutor,
  targetOop: bigint,
  referrerClassOop: bigint,
  limit: number = REFERRER_PAGE_SIZE,
): ReferrerObjectsResult {
  const code = `| ws obj cls pairs bm total out cursor chunk guard ms |
System needsCommit ifTrue: [^ 'needsCommit'].
obj := [Object objectForOop: ${targetOop}]
  on: Error do: [:ex | ^ 'unavailable
', (ex messageText ifNil: ['GemStone error ', ex number printString])].
cls := [Object objectForOop: ${referrerClassOop}]
  on: Error do: [:ex | ^ 'unavailable
', (ex messageText ifNil: ['GemStone error ', ex number printString])].
ms := System millisecondsToRun: [
  pairs := [SystemRepository allReferencesByParentClass: (Array with: obj)]
    on: Error do: [:ex | ^ 'unavailable
', (ex messageText ifNil: ['GemStone error ', ex number printString])]].
bm := nil.
pairs do: [:pair | (pair at: 1) == cls ifTrue: [bm := pair at: 2]].
total := bm isNil ifTrue: [0] ifFalse: [bm size].
out := OrderedCollection new.
bm isNil ifFalse: [
  cursor := 0.
  guard := 0.
  [out size < ${limit} and: [
    guard := guard + 1.
    guard <= ${STREAM_CHUNK_LIMIT} and: [
      chunk := bm enumerateWithLimit: ${STREAM_CHUNK} startingAfter: cursor.
      chunk size > 0]]] whileTrue: [
    chunk do: [:o | out size < ${limit} ifTrue: [out add: o]].
    cursor := (chunk at: chunk size) asOop]].
ws := WriteStream on: String new.
ws nextPutAll: 'ok'; tab; nextPutAll: ms printString; lf.
ws nextPutAll: total printString; lf.
out do: [:o |
  | str |
  str := [o printString] on: Error do: [:ex | ex return: '<printString failed>'].
  str size > ${PRINT_STRING_CAP} ifTrue: [str := str copyFrom: 1 to: ${PRINT_STRING_CAP}].
  ws nextPutAll: o asOop printString; tab;
     nextPutAll: (o isBehavior ifTrue: ['1'] ifFalse: ['0']); tab.
  1 to: str size do: [:i |
    | c |
    c := str at: i.
    ws nextPut: (c isSeparator ifTrue: [Character space] ifFalse: [c])].
  ws lf].
ws contents`;

  const parsed = splitStatus(execute(code));
  if (parsed.kind !== 'ok') return parsed;

  // First body line is the true total; the rest are `oop<TAB>isClass<TAB>printString`.
  // The printString is flattened server-side, so it holds no tab and no newline — the
  // first two tabs always end the OOP and the flag.
  const lines = parsed.body.split('\n');
  const total = Number(lines[0]) || 0;
  const objects: ReferrerObject[] = [];
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const oopTab = line.indexOf('\t');
    if (oopTab === -1) continue;
    const flagTab = line.indexOf('\t', oopTab + 1);
    if (flagTab === -1) continue;
    objects.push({
      oop: line.slice(0, oopTab),
      isClass: line.slice(oopTab + 1, flagTab) === '1',
      printString: line.slice(flagTab + 1),
    });
  }
  return { kind: 'ok', objects, total, scanMillis: parsed.millis };
}

/** One reference between two objects on the canvas, and the slot it lives in. */
export interface SlotEdge {
  fromOop: string;
  toOop: string;
  /** Where the reference sits in `from`: a named instance variable (`'product'`), an
   *  indexed slot (`'[7]'`), or `'(element)'` for a member of an unordered collection,
   *  whose storage has no addressable slot. This is the part that explains the object
   *  LAYOUT rather than merely the topology. */
  via: string;
}

export type SlotEdgesResult =
  { kind: 'ok'; edges: SlotEdge[] } | { kind: 'unavailable'; reason: string };

/** Raw slots examined per object. A guard, not a real limit: it stops one large
 *  collection on the canvas from turning an interactive redraw into a full traversal
 *  of it. Anything beyond is not reported as an edge — see the truncation note the
 *  caller shows. */
const SLOT_SCAN_LIMIT = 20000;

/** Every reference that runs BETWEEN the given objects, with the slot it occupies.
 *
 *  This is the outbound direction, and it needs no repository scan at all — it reads
 *  each object's own slots and keeps whatever lands inside the set. That is why the
 *  accumulating canvas can be recomputed from scratch on every add and remove instead
 *  of maintaining incremental edge bookkeeping that could drift: a full redraw costs
 *  slot reads, not a scan, so it is always consistent and always cheap.
 *
 *  It also means this one does NOT require a clean session. Reading slots neither
 *  aborts nor commits.
 *
 *  Three storage shapes have to be covered or edges silently vanish: named instance
 *  variables (`instVarAt:`), indexed and hashed storage (`_basicAt:`, which reaches a
 *  Dictionary's internal table — 85 raw slots for 20 entries), and unordered
 *  collections, whose elements live outside the object body and are only reachable by
 *  enumeration (`isNsc` / `do:`). */
export function slotEdgesAmong(execute: QueryExecutor, oops: string[]): SlotEdgesResult {
  if (oops.length < 2) return { kind: 'ok', edges: [] };
  const literals = oops.map((o) => o.trim()).filter((o) => /^\d+$/.test(o));
  if (literals.length < 2) return { kind: 'ok', edges: [] };

  const code = `| ws oops want objs |
oops := #( ${literals.join(' ')} ).
want := IdentityKeyValueDictionary new.
objs := OrderedCollection new.
oops do: [:n |
  | o |
  o := [Object objectForOop: n] on: Error do: [:ex | ex return: nil].
  o ifNotNil: [want at: o put: n. objs add: o]].
ws := WriteStream on: String new.
ws nextPutAll: 'ok'; tab; nextPutAll: '0'; lf.
objs do: [:o |
  | emit names limit |
  emit := [:target :via |
    | hit |
    hit := want at: target ifAbsent: [nil].
    (hit notNil and: [target ~~ o]) ifTrue: [
      ws nextPutAll: (want at: o) printString; tab;
         nextPutAll: hit printString; tab;
         nextPutAll: via; lf]].
  names := [o class allInstVarNames] on: Error do: [:ex | ex return: #()].
  1 to: ([o class instSize] on: Error do: [:ex | ex return: 0]) do: [:i |
    emit value: ([o instVarAt: i] on: Error do: [:ex | ex return: nil])
         value: (i <= names size ifTrue: [(names at: i) asString] ifFalse: ['ivar', i printString])].
  ([o class isNsc] on: Error do: [:ex | ex return: false])
    ifTrue: [
      limit := 0.
      [o do: [:each |
        limit := limit + 1.
        limit > ${SLOT_SCAN_LIMIT} ifTrue: [^ ws contents].
        emit value: each value: '(element)']] on: Error do: [:ex | ex return: nil]]
    ifFalse: [
      limit := ([o _basicSize] on: Error do: [:ex | ex return: 0]) min: ${SLOT_SCAN_LIMIT}.
      1 to: limit do: [:i |
        emit value: ([o _basicAt: i] on: Error do: [:ex | ex return: nil])
             value: '[', i printString, ']']]].
ws contents`;

  const parsed = splitStatus(execute(code));
  if (parsed.kind === 'needsCommit') {
    // Not reachable: nothing here aborts. Mapped rather than left to fall through, so a
    // future change that does introduce a scan cannot silently answer an empty graph.
    return { kind: 'unavailable', reason: 'the session has uncommitted changes' };
  }
  if (parsed.kind !== 'ok') return parsed;

  const edges: SlotEdge[] = [];
  for (const line of parsed.body.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (f.length < 3) continue;
    edges.push({ fromOop: f[0], toOop: f[1], via: f[2] });
  }
  return { kind: 'ok', edges };
}
