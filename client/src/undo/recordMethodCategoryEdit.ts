/**
 * The one call the rename-a-method-category command makes to become undoable (issue #434).
 *
 * The plainest recorder here: the state that matters is two names, and the caller knows both
 * before it starts, so there is nothing to capture and no round trip to make.
 *
 *   const recording = beginMethodCategoryRename(session, slot, oldCategory);
 *   ... rename the category ...
 *   recording?.commit(newCategory);   // only once it landed
 *
 * A rename that would change nothing records nothing, and — as everywhere else — `commit` is
 * called only after the rename has actually succeeded.
 *
 * A STILL-EMPTY category is recorded on the same terms as a real one. Jasper has not put it
 * on the stone yet, but the user renamed something and it stayed renamed; which side of the
 * wire that happened on is not theirs to keep track of. The reverser decides which rename to
 * run from the live state, so an entry recorded over an empty category still does the right
 * thing once a method has been filed into it.
 */
import { ActiveSession } from '../sessionManager';
import { logInfo } from '../gciLog';
import { pushUndoEntry } from './undoStack';
import { MethodCategorySlot, methodCategorySlotLabel, UndoEntry } from './undoTypes';

export interface MethodCategoryRecording {
  commit(after: string): UndoEntry | undefined;
}

export function beginMethodCategoryRename(
  session: ActiveSession,
  slot: MethodCategorySlot,
  before: string,
): MethodCategoryRecording {
  return {
    commit(after: string): UndoEntry | undefined {
      if (after === before) {
        logInfo(`[undo] not recording the category rename on ${slot.className}: same name`);
        return undefined;
      }
      const entry = pushUndoEntry({
        kind: 'methodCategoryEdit',
        sessionId: session.id,
        label: `Rename category '${before}' to '${after}' in ${methodCategorySlotLabel(slot)}`,
        slot,
        before,
        after,
      });
      logInfo(`[undo] recorded #${entry.id} "${entry.label}"`);
      return entry;
    },
  };
}
