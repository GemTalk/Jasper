/**
 * The doits a class revert needs (issue #434).
 *
 * Plain Smalltalk again — `at:ifAbsent:`, `at:put:`, `removeKey:ifAbsent:` on a
 * SymbolDictionary — so reverting a class edit needs nothing installed on the stone, same
 * as reverting a method edit.
 *
 * The one piece of server-side state is the STASH. Capturing a class binding puts the
 * currently-bound version in SessionTemps under a generated key, and the reversal binds
 * that object back. Two reasons it has to be the object and not a rebuilt definition:
 *
 *  - re-sending `Object subclass: …` does NOT carry methods forward. It answers a new,
 *    EMPTY version. Reverting by recompiling a definition would put the shape back and
 *    throw away every method on it.
 *  - a removed class is only unbound, not destroyed, so the very same version can go back
 *    exactly as it was — history, methods, instances and all. Holding it in SessionTemps is
 *    also what keeps it reachable, since an unbound, unreferenced class version can go.
 *
 * The stash is RELEASED when the entry that needs it leaves the stack — evicted past the
 * 25-entry cap, spent by a successful reversal, dropped, or cleared by a logout or an abort.
 * That is what keeps the cap meaningful: without it the pin count would track the number of
 * class edits and dictionary removals in the whole session, not the depth of the stack, and
 * a session that removes a lot of classes would hold every one of those versions live in
 * temporary object memory with no entry left that could ever use them. `releaseStash.ts`
 * hangs off the stack's release hook and runs `releaseStashKeys` below.
 *
 * For everything except a removal the version is in the class's own history anyway, so
 * releasing the key frees nothing real — it is the removals (a class subtree, a dictionary
 * and every class it held) where the stash is the only reference and the release matters.
 */
import { QueryExecutor } from '../../queries/types';
import { dictLookupExpr, escapeString } from '../../queries/util';
import { ClassSlot, ClassSlotOp, ClassSlotState } from '../undoTypes';
import { decodeEscaped, SMALLTALK_ESCAPER, SMALLTALK_ESCAPER_TEMPS } from './methodSlotCodec';

let nextStashSerial = 1;

/**
 * Every key this process has handed out and not yet released, per session.
 *
 * Kept because a key can be issued and then never reach the stack: a capture straddles the
 * edit, and an edit that throws leaves a recording nobody commits. Those keys have pinned
 * something in the stone all the same, and the entry-by-entry release cannot name them —
 * nothing but this remembers they exist. A `cleared`, which says the session's whole record
 * is gone, releases the lot.
 */
const issued = new Map<number, Set<string>>();

/** A fresh SessionTemps key for `sessionId`, remembered so it can be released later. Per
 *  session, so a plain serial cannot collide with anything that matters; the prefix keeps it
 *  identifiable in a SessionTemps dump. */
export function newStashKey(sessionId: number): string {
  const key = `JasperUndoStash_${nextStashSerial}`;
  nextStashSerial += 1;
  let keys = issued.get(sessionId);
  if (!keys) {
    keys = new Set<string>();
    issued.set(sessionId, keys);
  }
  keys.add(key);
  return key;
}

/** Stop tracking keys that have been released, so the registry does not outgrow the stack. */
export function forgetStashKeys(sessionId: number, keys: string[]): void {
  const tracked = issued.get(sessionId);
  if (!tracked) return;
  for (const key of keys) tracked.delete(key);
  if (tracked.size === 0) issued.delete(sessionId);
}

/** Every key still outstanding for the session, forgetting them on the way out. For a
 *  `cleared`, where nothing this session stashed can be reached again. */
export function takeIssuedStashKeys(sessionId: number): string[] {
  const keys = issued.get(sessionId);
  if (!keys) return [];
  issued.delete(sessionId);
  return [...keys];
}

/** Test seam: restart the serial and forget every issued key, so keys are predictable. */
export function resetStashKeys(): void {
  nextStashSerial = 1;
  issued.clear();
}

/**
 * Let go of stashed objects — one `removeKey:ifAbsent:` per key.
 *
 * `ifAbsent:` throughout: a key that was issued but never written (a capture that found the
 * slot unbound, or one whose doit failed part-way) is the normal case, not an error, and a
 * release must never be the thing that raises.
 */
export function releaseStashKeys(execute: QueryExecutor, keys: string[]): void {
  if (keys.length === 0) return;
  const removals = keys
    .map((key) => `st removeKey: #'${escapeString(key)}' ifAbsent: [nil].`)
    .join('\n');
  execute(`| st |
st := SessionTemps current.
${removals}
'released'`);
}

/**
 * What each class slot is bound to right now.
 *
 * `stashKeys` (parallel to `slots`, null to skip) asks for the bound version to be held in
 * SessionTemps under that key. Pass keys when capturing BEFORE an edit — that is the copy
 * the reversal binds back. Pass nulls when reading the live state at undo time, which must
 * not pin anything further.
 */
export function captureClassSlots(
  execute: QueryExecutor,
  slots: ClassSlot[],
  stashKeys: (string | null)[] = [],
): ClassSlotState[] {
  if (slots.length === 0) return [];
  const captures = slots
    .map((slot, i) => {
      const name = escapeString(slot.className);
      const key = stashKeys[i];
      const stash = key ? `SessionTemps current at: #'${escapeString(key)}' put: cls.` : '';
      return `[ | d cls |
  d := ${dictLookupExpr(slot.dict)}.
  cls := d isNil ifTrue: [nil] ifFalse: [d at: #'${name}' ifAbsent: [nil]].
  (cls isNil or: [cls isBehavior not])
    ifTrue: [ws nextPutAll: '0'; lf]
    ifFalse: [
      ${stash}
      ws nextPutAll: '1'; tab; nextPutAll: cls asOop printString; tab.
      cls selectors asSortedCollection do: [:sel | ws nextPutAll: sel asString; nextPut: $ ].
      cls class selectors asSortedCollection do: [:sel |
        ws nextPutAll: 'class>>'; nextPutAll: sel asString; nextPut: $ ].
      ws lf]] value.`;
    })
    .join('\n');

  const code = `| ws |
ws := WriteStream on: String new.
${captures}
ws contents`;

  return parseClassCapture(execute(code), slots.length);
}

/** Decode one class capture. Exported for tests. */
export function parseClassCapture(raw: string, expected: number): ClassSlotState[] {
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const states: ClassSlotState[] = [];
  for (let i = 0; i < expected; i += 1) {
    const line = lines[i];
    if (line === undefined || line[0] === '0') {
      states.push({ bound: false, oop: null, selectors: [] });
      continue;
    }
    const [, oop, selectors] = line.split('\t');
    states.push({
      bound: true,
      oop: oop ?? '',
      selectors: (selectors ?? '').split(' ').filter((s) => s.length > 0),
    });
  }
  return states;
}

export interface ClassSlotOpResult {
  op: ClassSlotOp;
  error: string | null;
}

/**
 * Perform the reversal operations in one doit, each guarded on its own so a binding that
 * cannot be restored does not abandon the ones that can.
 *
 * Nothing commits — the same rule every other Jasper edit follows.
 */
export function applyClassSlotOps(execute: QueryExecutor, ops: ClassSlotOp[]): ClassSlotOpResult[] {
  if (ops.length === 0) return [];
  const bodies = ops
    .map((op) => {
      const name = escapeString(op.slot.className);
      const guarded =
        op.kind === 'unbind'
          ? `[d removeKey: #'${name}' ifAbsent: [nil].
       ws nextPutAll: 'O'; lf]
        on: Error
        do: [:ex |
          ws nextPutAll: 'E'; tab.
          esc value: (ex messageText ifNil: ['failed']) asString value: ws.
          ws lf]`
          : `[obj := SessionTemps current at: #'${escapeString(op.stashKey ?? '')}' ifAbsent: [nil].
       obj isNil
         ifTrue: [
           ws nextPutAll: 'E'; tab;
             nextPutAll: 'this session no longer holds the earlier version'; lf]
         ifFalse: [
           d at: #'${name}' put: obj.
           ws nextPutAll: 'O'; lf]]
        on: Error
        do: [:ex |
          ws nextPutAll: 'E'; tab.
          esc value: (ex messageText ifNil: ['failed']) asString value: ws.
          ws lf]`;
      return `[ | d obj |
  d := ${dictLookupExpr(op.slot.dict)}.
  d isNil
    ifTrue: [ws nextPutAll: 'E'; tab; nextPutAll: 'no such dictionary'; lf]
    ifFalse: [
      ${guarded}]] value.`;
    })
    .join('\n');

  const code = `| ws ${SMALLTALK_ESCAPER_TEMPS} |
ws := WriteStream on: String new.
${SMALLTALK_ESCAPER}
${bodies}
ws contents`;

  return parseClassApply(execute(code), ops);
}

/** Decode one class apply result. Exported for tests. */
export function parseClassApply(raw: string, ops: ClassSlotOp[]): ClassSlotOpResult[] {
  const lines = raw.split('\n').filter((l) => l.length > 0);
  return ops.map((op, i) => {
    const line = lines[i];
    if (line === undefined) return { op, error: 'no result reported' };
    if (line[0] === 'O') return { op, error: null };
    return { op, error: decodeEscaped(line.split('\t')[1] ?? 'failed') };
  });
}
