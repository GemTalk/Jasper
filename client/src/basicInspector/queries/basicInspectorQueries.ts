/**
 * Every query the basic tabbed Inspector makes.
 *
 * The constraint that shapes all of them: **no server-side support classes, and
 * GemStone 3.6.2 or later.** That is the whole point of this inspector — it is
 * what a session gets when the Enhanced Inspector's payload isn't installed, or
 * when the stone is below the payload's 3.7.5 floor. So:
 *
 *  - No `STONJSON`. It ships *with* the Enhanced Inspector payload
 *    (`resources/enhancedInspector/STON.gs`), so it is exactly as unavailable as
 *    the thing we're standing in for. Every query here streams the escaped
 *    tab/newline payload defined in `queries/dumpPayload.ts` instead.
 *  - No class named in a doit unless it is certainly present in a bare image.
 *    Where a class might be absent, look it up with `Globals at:otherwise:` and
 *    fall back, rather than naming it directly — an undefined variable is a
 *    *compile* error, which fails the whole doit rather than raising something
 *    catchable.
 *  - String literals in a GCI-compiled doit are `Unicode7` on 3.6.x, so
 *    `aSymbol = 'lit'` silently answers false. Compare symbols with
 *    `asString asSymbol == #Lit`. See `queries/util.ts`.
 *
 * Each function is written against `QueryExecutor` (a plain
 * `(code: string) => string`) so it can be unit-tested without a stone.
 */
import { QueryExecutor } from '../../queries/types';
import { escapeString } from '../../queries/util';
import {
  DUMP_PAYLOAD_TEMPS,
  dumpPayloadPrelude,
  splitDumpRows,
  unescapeDumpField,
} from '../../queries/dumpPayload';

/** Rows fetched per page of Items, Entries or Bytes. */
export const PAGE_SIZE = 100;

const VALID_SELECTOR =
  /^[a-zA-Z_][a-zA-Z0-9_]*:?$|^([a-zA-Z_][a-zA-Z0-9_]*:)+$|^[+\-*/<>=~&|@%?,]{1,2}$/;

/** Guards a selector before it is interpolated into a doit as `#'...'`. */
export function isValidSelector(selector: string): boolean {
  return VALID_SELECTOR.test(selector);
}

/**
 * Run a doit, returning null rather than throwing when the stone refuses it.
 * Every tab in this inspector degrades to "nothing to show" on failure — one
 * unprintable object must not cost the user the whole column.
 */
function inspectorExecute(execute: QueryExecutor, code: string): string | null {
  const wrapped = `[${code}] on: AbstractException do: [:e | 'BIError:', e messageText asString]`;
  try {
    const result = execute(wrapped);
    return result.startsWith('BIError:') ? null : result;
  } catch {
    return null;
  }
}

// ── Object header: what tabs does this object get? ─────

/** The cheap facts that decide a column's tab set, fetched in one round trip. */
export interface ObjectHeader {
  className: string;
  superclassName: string;
  /** Number of named instance variables — drives the Slots tab. */
  namedSize: number;
  /**
   * Element count — drives the Items tab. Semantic where it can be: a
   * Collection's `size` (its real elements), otherwise the physical indexable
   * slot count.
   */
  itemCount: number;
  /** Entry count for a dictionary — drives the Entries tab. */
  entryCount: number;
  /** Byte-format object (String, Symbol, ByteArray, …) — drives the Bytes tab. */
  isBytes: boolean;
  /** Understands `keys` + `keysAndValuesDo:` — routed to Entries, not Items. */
  isDictionary: boolean;
  /** printString, capped. The full text lives on the Print tab. */
  printString: string;
  /**
   * What {@link itemCount} counts, for the two classes where the count is the
   * headline fact about the object: `'characters'`, `'bytes'`, or `''`. Jadeite
   * puts exactly this in its inspector caption, and the tabbed Inspector's
   * editor-tab title follows it.
   */
  sizeUnit: string;
}

/**
 * The dictionary test, as Smalltalk. `AbstractDictionary` is the precise answer
 * but is looked up through `Globals` rather than named, so a bare image that
 * lacks it falls back to duck-typing instead of failing to compile.
 */
const IS_DICTIONARY = `(dictCls isNil
    ifTrue: [(obj respondsTo: #keys) and: [obj respondsTo: #keysAndValuesDo:]]
    ifFalse: [obj isKindOf: dictCls])`;

/**
 * One round trip per column: class, superclass, slot counts, format flags and a
 * capped printString. The webview derives the tab set from this alone, so a tab
 * never appears for structure the object doesn't have — the tabbed equivalent of
 * the old tree's "expandable only when it has slots" rule.
 */
export function fetchObjectHeader(execute: QueryExecutor, oop: bigint): ObjectHeader | null {
  const code = `| obj cls dictCls out ${DUMP_PAYLOAD_TEMPS} isDict named items entries bytes unit |
obj := Object _objectForOop: ${oop}.
cls := obj class.
dictCls := Globals at: #AbstractDictionary otherwise: nil.
out := WriteStream on: String new.
${dumpPayloadPrelude()}isDict := [${IS_DICTIONARY}] on: Error do: [:e | false].
named := [cls allInstVarNames size] on: Error do: [:e | 0].
entries := isDict ifTrue: [[obj size] on: Error do: [:e | 0]] ifFalse: [0].
items := isDict
  ifTrue: [0]
  ifFalse: [[(obj isKindOf: Collection)
      ifTrue: [obj size]
      ifFalse: [obj _basicSize]] on: Error do: [:e | [obj _basicSize] on: Error do: [:e2 | 0]]].
bytes := [cls isBytes] on: Error do: [:e | false].
unit := [(obj isKindOf: CharacterCollection)
  ifTrue: ['characters']
  ifFalse: [(obj isKindOf: ByteArray) ifTrue: ['bytes'] ifFalse: ['']]]
    on: Error do: [:e | ''].
out nextPutAll: (esc value: cls name asString); nextPutAll: tab;
    nextPutAll: (esc value: (cls superclass ifNil: [''] ifNotNil: [:s | s name asString])); nextPutAll: tab;
    nextPutAll: named printString; nextPutAll: tab;
    nextPutAll: items printString; nextPutAll: tab;
    nextPutAll: entries printString; nextPutAll: tab;
    nextPutAll: bytes printString; nextPutAll: tab;
    nextPutAll: isDict printString; nextPutAll: tab;
    nextPutAll: (psOf value: obj); nextPutAll: tab;
    nextPutAll: unit.
out contents`;
  const data = inspectorExecute(execute, code);
  if (data === null) return null;
  return parseObjectHeader(data);
}

/** Exported for unit testing. */
export function parseObjectHeader(data: string): ObjectHeader | null {
  const [f] = splitDumpRows(data, 9);
  if (!f) return null;
  return {
    className: unescapeDumpField(f[0]),
    superclassName: unescapeDumpField(f[1]),
    namedSize: toCount(f[2]),
    itemCount: toCount(f[3]),
    entryCount: toCount(f[4]),
    isBytes: f[5] === 'true',
    isDictionary: f[6] === 'true',
    printString: unescapeDumpField(f[7]),
    sizeUnit: f[8] === 'characters' || f[8] === 'bytes' ? f[8] : '',
  };
}

function toCount(s: string): number {
  const n = parseInt(s, 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

// ── Rows: Slots, Items, Entries ────────────────────────

/** One row of the Slots, Items or Entries table. */
export interface InspectorRow {
  /** Slot name, `[index]`, or a dictionary key's printString. */
  label: string;
  /** The value's printString, capped. */
  value: string;
  /** The value's OOP, as a decimal string (how OOPs cross the webview wire). */
  oop: string;
  /** The value's class name — the table's third column. */
  className: string;
  /**
   * 1-based write index for the slot, or 0 when it can't be written. Named
   * instance variables use `instVarAt:put:`, indexed elements `at:put:`.
   */
  index: number;
  /** A dictionary key's OOP, for `at:put:` on an Entries row. Absent otherwise. */
  keyOop?: string;
  /**
   * For a Slots row, the class that declares this instance variable — which is
   * a superclass for most of them on any real class. Absent on other tabs.
   */
  definingClass?: string;
  /**
   * The user has edited this slot and its original value is still recorded, so
   * the row offers a revert. Stamped by the panel on the way out, not by the
   * query — the stone knows nothing about the edit history.
   */
  revertible?: boolean;
}

/** Emits one `label \t value \t oop \t class \t index` record. Needs `out`, `tab`, `esc`, `psOf`. */
const ROW_BLOCK = `row := [:lbl :obj2 :idx |
  out nextPutAll: (esc value: lbl); nextPutAll: tab;
      nextPutAll: (psOf value: obj2); nextPutAll: tab;
      nextPutAll: obj2 asOop printString; nextPutAll: tab;
      nextPutAll: (esc value: ([obj2 class name asString] on: Error do: [:e | '?'])); nextPutAll: tab;
      nextPutAll: idx printString; nextPut: Character lf].
`;

/**
 * A Slots row: the shared five fields plus the class that declares the slot.
 */
const SLOT_ROW_BLOCK = `row := [:lbl :obj2 :idx :owner |
  out nextPutAll: (esc value: lbl); nextPutAll: tab;
      nextPutAll: (psOf value: obj2); nextPutAll: tab;
      nextPutAll: obj2 asOop printString; nextPutAll: tab;
      nextPutAll: (esc value: ([obj2 class name asString] on: Error do: [:e | '?'])); nextPutAll: tab;
      nextPutAll: idx printString; nextPutAll: tab;
      nextPutAll: (esc value: owner); nextPut: Character lf].
`;

/**
 * Which class declares each instance variable, positionally.
 *
 * `allInstVarNames` is the root of the hierarchy first, then each subclass's
 * own in turn — exactly the order produced by walking the chain from `Object`
 * down and taking each class's `instVarNames`. So consuming the chain in that
 * order assigns every name its declaring class without asking the stone
 * anything further. The bounds check is there because a class reshaped while
 * this runs would otherwise walk off the end.
 */
const SLOT_OWNERS = `owners := Array new: names size.
1 to: names size do: [:j | owners at: j put: ''].
chain := OrderedCollection new.
k := [obj class] on: Error do: [:e | nil].
[k notNil] whileTrue: [chain addFirst: k. k := [k superclass] on: Error do: [:e | nil]].
i := 1.
chain do: [:c |
  ([c instVarNames] on: Error do: [:e | #()]) do: [:n |
    i <= names size ifTrue: [owners at: i put: ([c name asString] on: Error do: [:e | '']).
      i := i + 1]]].
`;

/** Exported for unit testing. */
export function parseSlotRows(data: string): InspectorRow[] {
  return splitDumpRows(data, 6).map((f) => ({
    label: unescapeDumpField(f[0]),
    value: unescapeDumpField(f[1]),
    oop: f[2],
    className: unescapeDumpField(f[3]),
    index: parseInt(f[4], 10) || 0,
    definingClass: unescapeDumpField(f[5]),
  }));
}

/** Exported for unit testing. */
export function parseRows(data: string): InspectorRow[] {
  return splitDumpRows(data, 5).map((f) => ({
    label: unescapeDumpField(f[0]),
    value: unescapeDumpField(f[1]),
    oop: f[2],
    className: unescapeDumpField(f[3]),
    index: parseInt(f[4], 10) || 0,
  }));
}

/**
 * Named instance variables, by name. Unpaged — a class with more named slots
 * than fit in one payload doesn't exist in practice.
 */
export function fetchSlots(execute: QueryExecutor, oop: bigint): InspectorRow[] {
  const code = `| obj out ${DUMP_PAYLOAD_TEMPS} row names owners chain k i |
obj := Object _objectForOop: ${oop}.
out := WriteStream on: String new.
${dumpPayloadPrelude()}${SLOT_ROW_BLOCK}names := [obj class allInstVarNames] on: Error do: [:e | #()].
${SLOT_OWNERS}1 to: names size do: [:j |
  row value: (names at: j) asString
      value: ([obj instVarAt: j] on: Error do: [:e | nil])
      value: j
      value: (owners at: j)].
out contents`;
  const data = inspectorExecute(execute, code);
  return data === null ? [] : parseSlotRows(data);
}

/**
 * One page of indexed elements, labelled `[i]`. `from` is 1-based.
 *
 * Access is semantic where it can be. A SequenceableCollection is read with
 * `at:`, so a String's page shows Characters rather than the byte values
 * `_basicAt:` would give. An unordered Collection (Set, Bag) has no index, so it
 * is enumerated with `do:` and a counter — random access isn't available, but
 * the page is still one round trip. Anything else falls back to the physical
 * indexable region, read with `_basicAt:`.
 */
export function fetchItems(
  execute: QueryExecutor,
  oop: bigint,
  from: number,
  count: number,
): InspectorRow[] {
  if (!Number.isInteger(from) || from < 1) return [];
  if (!Number.isInteger(count) || count < 1) return [];
  const code = `| obj out ${DUMP_PAYLOAD_TEMPS} row last n |
obj := Object _objectForOop: ${oop}.
out := WriteStream on: String new.
${dumpPayloadPrelude()}${ROW_BLOCK}last := ${from} + ${count} - 1.
(obj isKindOf: SequenceableCollection)
  ifTrue: [
    ${from} to: (last min: obj size) do: [:i |
      row value: '[', i printString, ']'
          value: ([obj at: i] on: Error do: [:e | nil])
          value: i]]
  ifFalse: [
    (obj isKindOf: Collection)
      ifTrue: [
        n := 0.
        obj do: [:each |
          n := n + 1.
          (n >= ${from} and: [n <= last])
            ifTrue: [row value: '[', n printString, ']' value: each value: 0]]]
      ifFalse: [
        ${from} to: (last min: obj _basicSize) do: [:i |
          row value: '[', i printString, ']'
              value: ([obj _basicAt: i] on: Error do: [:e | nil])
              value: i]]].
out contents`;
  const data = inspectorExecute(execute, code);
  return data === null ? [] : parseRows(data);
}

/**
 * One page of dictionary entries, labelled by key. `from` is 1-based.
 *
 * Keys are sorted when they can be, so paging is stable across calls and the
 * listing matches the old tree's sorted `SymbolDictionary` view — but unlike the
 * tree this works for *every* dictionary, not just `SymbolDictionary`. Each row
 * carries the key's OOP as well as the value's, so an edit can `at:put:` it.
 */
export function fetchEntries(
  execute: QueryExecutor,
  oop: bigint,
  from: number,
  count: number,
): InspectorRow[] {
  if (!Number.isInteger(from) || from < 1) return [];
  if (!Number.isInteger(count) || count < 1) return [];
  const code = `| obj out ${DUMP_PAYLOAD_TEMPS} keys k v |
obj := Object _objectForOop: ${oop}.
out := WriteStream on: String new.
${dumpPayloadPrelude()}keys := [obj keys asSortedCollection asArray]
  on: Error do: [:e | [obj keys asArray] on: Error do: [:e2 | #()]].
${from} to: (${from} + ${count} - 1 min: keys size) do: [:i |
  k := keys at: i.
  v := [obj at: k] on: Error do: [:e | nil].
  out nextPutAll: (psOf value: k); nextPutAll: tab;
      nextPutAll: (psOf value: v); nextPutAll: tab;
      nextPutAll: v asOop printString; nextPutAll: tab;
      nextPutAll: (esc value: ([v class name asString] on: Error do: [:e | '?'])); nextPutAll: tab;
      nextPutAll: k asOop printString; nextPut: Character lf].
out contents`;
  const data = inspectorExecute(execute, code);
  return data === null ? [] : parseEntries(data);
}

/** Exported for unit testing. */
export function parseEntries(data: string): InspectorRow[] {
  return splitDumpRows(data, 5).map((f) => ({
    label: unescapeDumpField(f[0]),
    value: unescapeDumpField(f[1]),
    oop: f[2],
    className: unescapeDumpField(f[3]),
    // An entry is written with `at:put:` on its key, not by slot number.
    index: 0,
    keyOop: f[4],
  }));
}

// ── Bytes ──────────────────────────────────────────────

/**
 * One page of raw bytes, as unsigned values. `from` is 1-based. The webview
 * renders the hex + ASCII dump; the server just streams the numbers, so a byte
 * that isn't printable text can't corrupt the payload.
 */
export function fetchBytes(
  execute: QueryExecutor,
  oop: bigint,
  from: number,
  count: number,
): number[] {
  if (!Number.isInteger(from) || from < 1) return [];
  if (!Number.isInteger(count) || count < 1) return [];
  const code = `| obj out |
obj := Object _objectForOop: ${oop}.
out := WriteStream on: String new.
${from} to: (${from} + ${count} - 1 min: obj _basicSize) do: [:i |
  out nextPutAll: ([(obj _basicAt: i) asInteger] on: Error do: [:e | 0]) printString;
      nextPut: Character lf].
out contents`;
  const data = inspectorExecute(execute, code);
  if (data === null) return [];
  return data
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => parseInt(l, 10))
    .filter((n) => !Number.isNaN(n));
}

// ── Meta ───────────────────────────────────────────────

/** The class-side facts behind the Meta tab. */
export interface ObjectMeta {
  className: string;
  superclassName: string;
  category: string;
  comment: string;
  definition: string;
  instanceSelectors: string[];
  classSelectors: string[];
}

/**
 * Class, superclass, category, comment, definition and both selector lists in
 * one round trip. Same content as the Enhanced Inspector's Meta tab, rebuilt on
 * the tab/newline payload because that one goes through STONJSON.
 *
 * Records are `kind \t value`, so a multi-line comment or definition (escaped)
 * stays one record and the sections can arrive in any order.
 */
export function fetchObjectMeta(execute: QueryExecutor, oop: bigint): ObjectMeta | null {
  const code = `| obj cls out ${DUMP_PAYLOAD_TEMPS} put sels |
obj := Object _objectForOop: ${oop}.
cls := obj class theNonMetaClass.
out := WriteStream on: String new.
${dumpPayloadPrelude()}put := [:kind :str |
  out nextPutAll: kind; nextPutAll: tab;
      nextPutAll: (esc value: str asString); nextPut: Character lf].
put value: 'cls' value: cls name.
put value: 'sup' value: (cls superclass ifNil: [''] ifNotNil: [:s | s name]).
put value: 'cat' value: ([cls category ifNil: ['']] on: Error do: [:e | '']).
put value: 'cmt' value: ([cls comment ifNil: ['']] on: Error do: [:e | '']).
put value: 'def' value: ([cls definition] on: Error do: [:e | '']).
sels := [cls selectors asSortedCollection asArray] on: Error do: [:e | #()].
sels do: [:s | put value: 'inst' value: s].
sels := [cls class selectors asSortedCollection asArray] on: Error do: [:e | #()].
sels do: [:s | put value: 'meta' value: s].
out contents`;
  const data = inspectorExecute(execute, code);
  if (data === null) return null;
  return parseObjectMeta(data);
}

/** Exported for unit testing. */
export function parseObjectMeta(data: string): ObjectMeta {
  const meta: ObjectMeta = {
    className: '',
    superclassName: '',
    category: '',
    comment: '',
    definition: '',
    instanceSelectors: [],
    classSelectors: [],
  };
  for (const [kind, raw] of splitDumpRows(data, 2)) {
    const value = unescapeDumpField(raw);
    switch (kind) {
      case 'cls':
        meta.className = value;
        break;
      case 'sup':
        meta.superclassName = value;
        break;
      case 'cat':
        meta.category = value;
        break;
      case 'cmt':
        meta.comment = value;
        break;
      case 'def':
        meta.definition = value;
        break;
      case 'inst':
        meta.instanceSelectors.push(value);
        break;
      case 'meta':
        meta.classSelectors.push(value);
        break;
    }
  }
  return meta;
}

/** Source of one method on the inspected object's class. */
export function fetchMethodSource(
  execute: QueryExecutor,
  oop: bigint,
  selector: string,
  isClassSide: boolean,
): string | null {
  if (!isValidSelector(selector)) return null;
  const cls = isClassSide
    ? `(Object _objectForOop: ${oop}) class theNonMetaClass class`
    : `(Object _objectForOop: ${oop}) class theNonMetaClass`;
  return inspectorExecute(execute, `${cls} sourceCodeAt: #'${escapeString(selector)}'`);
}

// ── Browse ─────────────────────────────────────────────

/** Where the System Browser should navigate to reach a value's class. */
export interface BrowseLocation {
  dictName: string;
  className: string;
}

/**
 * Resolve a value's class and the symbol dictionary holding it, for "Browse
 * Class" on a row. Mirrors `fetchMethodBrowseLocation` in the Enhanced
 * Inspector's queries, minus STONJSON and minus the method category — this one
 * browses to the class, not to a selector.
 */
export function fetchBrowseLocation(execute: QueryExecutor, oop: bigint): BrowseLocation | null {
  const code = `| obj cls dicts out ${DUMP_PAYLOAD_TEMPS} |
obj := Object _objectForOop: ${oop}.
cls := obj class theNonMetaClass.
out := WriteStream on: String new.
${dumpPayloadPrelude()}dicts := [System myUserProfile dictionariesAndSymbolsOf: cls] on: Error do: [:e | #()].
out nextPutAll: (esc value: (dicts isEmpty ifTrue: [''] ifFalse: [dicts first first name asString]));
    nextPutAll: tab;
    nextPutAll: (esc value: cls name asString).
out contents`;
  const data = inspectorExecute(execute, code);
  if (data === null) return null;
  const [f] = splitDumpRows(data, 2);
  if (!f) return null;
  const location = { dictName: unescapeDumpField(f[0]), className: unescapeDumpField(f[1]) };
  return location.className ? location : null;
}
