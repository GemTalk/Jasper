/**
 * The one call a method-editing site makes to become undoable (issue #434).
 *
 * Recording has to straddle the edit — the state that matters is the state BEFORE it —
 * so this is a two-step handle rather than a wrapper:
 *
 *   const recording = beginMethodEdit(session, [slot]);   // captures the "before"
 *   ... compile / remove the method ...
 *   recording?.commit('Save Account>>#balance', [present(source, category)]);
 *
 * Recording is strictly best-effort and never allowed to break the edit it wraps. A
 * capture that fails answers `undefined`, the edit proceeds exactly as it did before undo
 * existed, and the user simply has nothing to undo. The refactoring engine's own recorder
 * makes the same promise, for the same reason: undo is a convenience, and an edit that
 * fails because its undo could not be recorded is a far worse trade.
 *
 * A `commit` is skipped when the edit turns out to have changed nothing — an entry whose
 * reversal is a no-op would take up a slot on the stack and, worse, would answer "Undo
 * Save …" for a save that did not alter the method.
 */
import { ActiveSession } from '../sessionManager';
import { defaultQueryExecutorUsing } from '../browserQueries';
import { logInfo } from '../gciLog';
import { captureMethodSlots } from './queries/methodSlotQueries';
import { pushUndoEntry } from './undoStack';
import { MethodSlot, MethodSlotState, slotLabel } from './undoTypes';

/** The state of a slot that holds a method. */
export function present(source: string, category: string): MethodSlotState {
  return { exists: true, source, category };
}

/** The state of a slot that holds nothing — before a method is created, after one is
 *  deleted. */
export const ABSENT: MethodSlotState = { exists: false, source: null, category: null };

export interface MethodEditRecording {
  /** The state captured before the edit, in case the caller needs to reason about it
   *  (the FS provider uses it to tell "created" from "overwrote"). */
  readonly before: MethodSlotState[];
  /** Record the edit. `after` is what the edit left, parallel to the slots — the caller
   *  already knows it, so recording costs no second round trip. */
  commit(label: string, after: MethodSlotState[]): void;
}

/** Whether two states describe the same method. */
function same(a: MethodSlotState, b: MethodSlotState): boolean {
  if (a.exists !== b.exists) return false;
  if (!a.exists) return true;
  return a.source === b.source && a.category === b.category;
}

/**
 * Capture what `slots` hold right now, so the edit about to happen can be reversed.
 *
 * Answers `undefined` — meaning "this edit will not be undoable" — when the capture
 * fails, and when any slot names a non-default method environment. The reversal's
 * `removeSelector:` takes no environment id, so a created method there could not be
 * taken away again; recording a reversal that is wrong in one direction is worse than
 * recording none.
 */
export function beginMethodEdit(
  session: ActiveSession,
  slots: MethodSlot[],
): MethodEditRecording | undefined {
  if (slots.length === 0) return undefined;
  if (slots.some((s) => s.environmentId !== 0)) {
    logInfo('[undo] not recording: a slot names a non-default method environment');
    return undefined;
  }

  let before: MethodSlotState[];
  try {
    before = captureMethodSlots(defaultQueryExecutorUsing(session), slots);
  } catch (e: unknown) {
    logInfo(`[undo] capture failed, edit will not be undoable: ${describe(e)}`);
    return undefined;
  }
  // A capture that did not answer one state per slot cannot be trusted to describe what is
  // there, and every reversal rule below is written against the pairing being exact.
  if (before?.length !== slots.length) {
    logInfo('[undo] capture answered the wrong number of states; edit will not be undoable');
    return undefined;
  }

  return {
    before,
    commit(label: string, after: MethodSlotState[]): void {
      if (after.length === slots.length && after.every((s, i) => same(s, before[i]))) {
        logInfo(`[undo] not recording "${label}": the edit changed nothing`);
        return;
      }
      const entry = pushUndoEntry({
        kind: 'methodEdit',
        sessionId: session.id,
        label,
        slots,
        before,
        after,
      });
      logInfo(`[undo] recorded #${entry.id} "${label}" (${slots.length} slot(s))`);
    },
  };
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The delete-a-method shape of the same thing, since every deletion records the identical
 * entry: one slot, gone.
 *
 *   const recording = beginMethodDeletion(session, slot);
 *   ... remove the method ...
 *   recording?.commit();
 *
 * `commit` is called only once the removal has actually succeeded — a deletion GemStone
 * refused must not leave an entry offering to restore a method that never went away.
 */
export function beginMethodDeletion(
  session: ActiveSession,
  slot: MethodSlot,
): { commit(): void } | undefined {
  const recording = beginMethodEdit(session, [slot]);
  if (!recording) return undefined;
  // Nothing was there to begin with: the removal is a no-op and there is nothing to undo.
  if (!recording.before[0].exists) return undefined;
  return { commit: () => recording.commit(`Delete ${slotLabel(slot)}`, [ABSENT]) };
}
