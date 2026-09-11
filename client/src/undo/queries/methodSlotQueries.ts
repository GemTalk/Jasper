/**
 * The two doits the generic undo needs, and nothing else (issue #434).
 *
 * Both are PLAIN Smalltalk against the kernel — `compiledMethodAt:`, `compileMethod:`,
 * `removeSelector:`. Neither names a class the refactoring engine installs, so undoing a
 * method edit works on any stone Jasper can log into, with nothing to install first.
 * That is the whole point of keeping this layer out of the engine.
 *
 * One capture covers every slot an edit touches, and one apply covers every reversal
 * operation, so recording costs exactly one extra round trip per edit and undoing costs
 * two (capture the live state, then apply).
 */
import { QueryExecutor } from '../../queries/types';
import { classLookupExpr, escapeString } from '../../queries/util';
import { MethodSlot, MethodSlotOp, MethodSlotState } from '../undoTypes';
import { decodeEscaped, SMALLTALK_ESCAPER, SMALLTALK_ESCAPER_TEMPS } from './methodSlotCodec';

/** A Smalltalk expression for the slot's receiver, or nil when the class will not
 *  resolve or is not a class at all. Written as a nil-tolerant conditional rather than
 *  `receiver()`'s bare `X class`, because `nil class` is `UndefinedObject` — which would
 *  turn "no such class" into a snapshot of the wrong object. */
function targetExpr(slot: MethodSlot): string {
  const base = classLookupExpr(slot.className, slot.dict);
  return `base := ${base}.
  target := (base isNil or: [base isBehavior not])
    ifTrue: [nil]
    ifFalse: [${slot.isMeta ? 'base class' : 'base'}]`;
}

/**
 * What each slot holds right now: a state parallel to `slots`.
 *
 * A class that will not resolve, or a selector it does not implement, reads as
 * `exists: false` — the planner treats "not there" the same however it got that way.
 */
export function captureMethodSlots(execute: QueryExecutor, slots: MethodSlot[]): MethodSlotState[] {
  if (slots.length === 0) return [];
  const captures = slots
    .map((slot) => {
      const sel = escapeString(slot.selector);
      return `[ | base target m src cat |
  ${targetExpr(slot)}.
  m := target isNil
    ifTrue: [nil]
    ifFalse: [target compiledMethodAt: #'${sel}' environmentId: ${slot.environmentId} otherwise: nil].
  m isNil
    ifTrue: [ws nextPutAll: '0'; lf]
    ifFalse: [
      src := m sourceString.
      cat := (target categoryOfSelector: #'${sel}' environmentId: ${slot.environmentId}) ifNil: [''].
      ws nextPutAll: '1'; tab.
      esc value: cat asString value: ws.
      ws tab.
      esc value: src asString value: ws.
      ws lf]] value.`;
    })
    .join('\n');

  const code = `| ws ${SMALLTALK_ESCAPER_TEMPS} |
ws := WriteStream on: String new.
${SMALLTALK_ESCAPER}
${captures}
ws contents`;

  return parseCapture(execute(code), slots.length);
}

/** Decode one capture result. Exported for the codec's own tests. */
export function parseCapture(raw: string, expected: number): MethodSlotState[] {
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const states: MethodSlotState[] = [];
  for (let i = 0; i < expected; i += 1) {
    const line = lines[i];
    if (line === undefined || line[0] === '0') {
      states.push({ exists: false, source: null, category: null });
      continue;
    }
    const [, category, source] = line.split('\t');
    states.push({
      exists: true,
      source: decodeEscaped(source ?? ''),
      category: decodeEscaped(category ?? ''),
    });
  }
  return states;
}

/** One reversal operation's outcome. `error` is null when it worked. */
export interface MethodSlotOpResult {
  op: MethodSlotOp;
  error: string | null;
}

/**
 * Perform the reversal operations, in the order given, in ONE doit.
 *
 * Each operation is guarded on its own: a class that has since been removed, or a
 * method GemStone refuses to recompile, fails that one operation and leaves the rest to
 * run. A half-applied reversal reported honestly beats an all-or-nothing one that
 * abandons the reversals that would have worked.
 *
 * Nothing commits — the same rule the refactoring undo and every Jasper edit follow.
 */
export function applyMethodSlotOps(
  execute: QueryExecutor,
  ops: MethodSlotOp[],
): MethodSlotOpResult[] {
  if (ops.length === 0) return [];
  const bodies = ops
    .map((op) => {
      const sel = escapeString(op.slot.selector);
      const action =
        op.kind === 'remove'
          ? `(target includesSelector: #'${sel}') ifTrue: [target removeSelector: #'${sel}']`
          : `target
        compileMethod: '${escapeString(op.source ?? '')}'
        dictionaries: System myUserProfile symbolList
        category: '${escapeString(op.category ?? '')}'
        environmentId: ${op.slot.environmentId}`;
      return `[ | base target |
  ${targetExpr(op.slot)}.
  target isNil
    ifTrue: [ws nextPutAll: 'E'; tab; nextPutAll: 'no such class: ${escapeString(op.slot.className)}'; lf]
    ifFalse: [
      [${action}.
       ws nextPutAll: 'O'; lf]
        on: Error
        do: [:ex |
          ws nextPutAll: 'E'; tab.
          esc value: (ex messageText ifNil: ['failed']) asString value: ws.
          ws lf]]] value.`;
    })
    .join('\n');

  const code = `| ws ${SMALLTALK_ESCAPER_TEMPS} |
ws := WriteStream on: String new.
${SMALLTALK_ESCAPER}
${bodies}
ws contents`;

  return parseApply(execute(code), ops);
}

/** Decode one apply result. Exported for tests. */
export function parseApply(raw: string, ops: MethodSlotOp[]): MethodSlotOpResult[] {
  const lines = raw.split('\n').filter((l) => l.length > 0);
  return ops.map((op, i) => {
    const line = lines[i];
    if (line === undefined) return { op, error: 'no result reported' };
    if (line[0] === 'O') return { op, error: null };
    return { op, error: decodeEscaped(line.split('\t')[1] ?? 'failed') };
  });
}
