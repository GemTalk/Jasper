/**
 * The one call a comment-saving site makes to become undoable (issue #434).
 *
 * The same two-step handle as `beginMethodEdit`, and the same promises: the state that
 * matters is the text BEFORE the save, recording is best-effort and never allowed to break
 * the save it wraps, and a save that changed nothing records nothing.
 *
 *   const recording = beginClassCommentEdit(session, slot);   // reads the old comment
 *   ... write the new comment ...
 *   recording?.commit(text);                                   // only once it landed
 *
 * `commit` takes the text the save wrote rather than re-reading it, because the caller
 * already has it and a second round trip would buy nothing.
 */
import { ActiveSession } from '../sessionManager';
import { getClassComment } from '../browserQueries';
import { logInfo } from '../gciLog';
import { pushUndoEntry } from './undoStack';
import { ClassSlot, UndoEntry } from './undoTypes';

export interface ClassCommentRecording {
  /** The comment as it read before the save. */
  readonly before: string;
  /** Record the save. Answers the stored entry, or `undefined` when nothing was recorded,
   *  so the caller can put Undo on its own notice without asking a second time. */
  commit(after: string): UndoEntry | undefined;
}

/**
 * Read what the class's comment says now, so the save about to happen can be reversed.
 *
 * Answers `undefined` — meaning "this save will not be undoable" — when the read fails.
 * A comment that cannot be read cannot be put back, and an entry that would write the
 * empty string over the user's earlier text is worse than no entry at all.
 */
export function beginClassCommentEdit(
  session: ActiveSession,
  slot: ClassSlot,
): ClassCommentRecording | undefined {
  let before: string;
  try {
    before = getClassComment(session, slot.className, slot.dict);
  } catch (e: unknown) {
    logInfo(
      `[undo] comment capture failed, save will not be undoable: ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
  if (typeof before !== 'string') {
    logInfo('[undo] comment capture answered no text; save will not be undoable');
    return undefined;
  }

  return {
    before,
    commit(after: string): UndoEntry | undefined {
      if (after === before) {
        logInfo(`[undo] not recording the comment on ${slot.className}: it did not change`);
        return undefined;
      }
      const entry = pushUndoEntry({
        kind: 'classComment',
        sessionId: session.id,
        label: `Save comment for ${slot.className}`,
        slot,
        before,
        after,
      });
      logInfo(`[undo] recorded #${entry.id} "${entry.label}"`);
      return entry;
    },
  };
}
