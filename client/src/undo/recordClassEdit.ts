/**
 * The one call a class-editing site makes to become revertible (issue #434).
 *
 * The same two-step handle as `recordMethodEdit.ts` — capture straddles the edit, because
 * the version that matters is the one bound BEFORE it — and the same promise: recording is
 * best-effort and never allowed to break the edit it wraps.
 *
 *   const recording = beginClassEdit(session, [slot]);   // captures and stashes the "before"
 *   ... compile the definition / remove the class ...
 *   recording?.commit('Add class Account');
 *
 * Unlike a method edit, `commit` re-reads the live state rather than being told what the
 * edit left. A class edit's result is a new class VERSION whose identity the caller does not
 * know — `compileClassDefinition` answers a name, not an object — so there is nothing useful
 * to pass in. It costs one extra round trip on an operation that is rare and already slow.
 */
import { ActiveSession } from '../sessionManager';
import { defaultQueryExecutorUsing } from '../browserQueries';
import { logInfo } from '../gciLog';
import { captureClassSlots, newStashKey } from './queries/classSlotQueries';
import { pushUndoEntry } from './undoStack';
import { ClassSlot, ClassSlotState, classSlotLabel, UndoEntry } from './undoTypes';

export interface ClassEditRecording {
  /** The state captured before the edit — the FS provider uses it to tell "created" from
   *  "redefined" when naming the entry. */
  readonly before: ClassSlotState[];
  /** Record the edit, reading back what it left. Answers the stored entry, or `undefined`
   *  when nothing was recorded, so the caller can offer Revert on its own notice. */
  commit(label: string): UndoEntry | undefined;
}

function same(a: ClassSlotState, b: ClassSlotState): boolean {
  if (a.bound !== b.bound) return false;
  return !a.bound || a.oop === b.oop;
}

/**
 * Capture what `slots` are bound to right now, holding each bound version in the stone so
 * the edit about to happen can be reversed.
 *
 * Answers `undefined` when the capture fails — the edit then proceeds exactly as it did
 * before undo existed, and there is simply nothing to revert.
 */
export function beginClassEdit(
  session: ActiveSession,
  slots: ClassSlot[],
): ClassEditRecording | undefined {
  if (slots.length === 0) return undefined;
  const stashKeys = slots.map(() => newStashKey());

  // Everything that touches the session goes inside the guard, the executor lookup
  // included: recording must never be the reason an edit fails.
  let execute;
  let before: ClassSlotState[];
  try {
    execute = defaultQueryExecutorUsing(session);
    before = captureClassSlots(execute, slots, stashKeys);
  } catch (e: unknown) {
    logInfo(`[undo] class capture failed, edit will not be revertible: ${describe(e)}`);
    return undefined;
  }
  if (before?.length !== slots.length) {
    logInfo('[undo] class capture answered the wrong number of states; edit is not revertible');
    return undefined;
  }

  return {
    before,
    commit(label: string): UndoEntry | undefined {
      let after: ClassSlotState[];
      try {
        // No stash keys: this reads the live state, and pinning the version the edit just
        // produced would hold a class nothing else needs.
        after = captureClassSlots(execute, slots);
      } catch (e: unknown) {
        logInfo(`[undo] not recording "${label}": could not read the result (${describe(e)})`);
        return undefined;
      }
      if (after.length === slots.length && after.every((s, i) => same(s, before[i]))) {
        logInfo(`[undo] not recording "${label}": the edit changed nothing`);
        return undefined;
      }
      const entry = pushUndoEntry({
        kind: 'classEdit',
        sessionId: session.id,
        label,
        slots,
        before,
        after,
        // A slot that was unbound has no earlier version to keep, and nothing was stashed
        // under its key — say so, rather than leave a key that resolves to nil.
        stashKeys: stashKeys.map((key, i) => (before[i].bound ? key : null)),
      });
      logInfo(`[undo] recorded #${entry.id} "${label}" (${slots.length} class(es))`);
      return entry;
    },
  };
}

/**
 * The remove-a-class shape of the same thing. The Explorer removes a whole subtree at once,
 * so this takes a list and records it as ONE entry — putting back half a subtree is not a
 * reversal of anything the user asked for.
 */
export function beginClassDeletion(
  session: ActiveSession,
  slots: ClassSlot[],
): { commit(): UndoEntry | undefined } | undefined {
  const recording = beginClassEdit(session, slots);
  if (!recording) return undefined;
  if (!recording.before.some((s) => s.bound)) return undefined;
  const label =
    slots.length === 1
      ? `Remove class ${classSlotLabel(slots[0])}`
      : `Remove ${slots.length} classes (${classSlotLabel(slots[0])} and its subclasses)`;
  return { commit: () => recording.commit(label) };
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
