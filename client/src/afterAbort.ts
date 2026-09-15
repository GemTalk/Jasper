/**
 * Putting open editors back in step after a session ABORT.
 *
 * An abort discards every uncommitted change at once, so a tab left open over a
 * method it threw away is the same trap the undo work names in
 * `closeEditorsForRemovedMethods`: "leaving it open invites the user to carry on
 * typing in it and save — which would compile the method straight back and
 * quietly undo the undo." An abort is that with a wider blast radius, and until
 * now the abort handler resynchronised everything EXCEPT the editors — the
 * mirror export, the System Browser, the cached ClassOrganizer, GemStone
 * Search's corpora and the Explorer, but no open tab. VS Code's next `stat` of a
 * discarded method raised into the GCI log with nothing in the UI to say so, and
 * the buffer stayed editable.
 *
 * Two halves, the same pair the undo path uses:
 *
 *  - methods that SURVIVED are re-read, because an abort rewinds them over GCI
 *    without going through the file system provider, so VS Code has no reason to
 *    believe what it is showing is stale;
 *  - methods that are GONE have their tabs closed.
 *
 * The difference from an undo is that an abort cannot say what it discarded, so
 * the open tabs are probed against the stone instead. One batched read
 * (`readMethodSlotState`) answers for every open tab at once; it fetches each
 * surviving method's source as well as its existence, which is more than is
 * needed here but keeps this on the one tested capture path rather than adding a
 * second, near-identical query. Bounded by how many tabs are open.
 *
 * Dirty buffers are left entirely alone, by both halves — see `openMethodSlots`.
 */
import { ActiveSession } from './sessionManager';
import { logInfo } from './gciLog';
import { readMethodSlotState } from './undo/recordMethodEdit';
import {
  closeEditorsForRemovedMethods,
  openMethodSlots,
  reloadGemstoneEditors,
} from './undo/afterUndo';

export async function resyncEditorsAfterAbort(session: ActiveSession): Promise<void> {
  const open = openMethodSlots(session.id);
  if (open.length > 0) {
    // `undefined` means the read itself failed — the stone is unreachable, or the
    // session is in no state to answer. Closing nothing is the safe way to be
    // wrong: the reload below still runs, and a stale tab beats a tab closed over
    // a method that is really still there.
    const states = readMethodSlotState(session, open);
    if (states) {
      const gone = open.filter((_, i) => !states[i].exists);
      if (gone.length > 0) {
        logInfo(`[abort] closing ${gone.length} editor(s) over methods the abort discarded`);
        await closeEditorsForRemovedMethods(session.id, gone);
      }
    }
  }
  await reloadGemstoneEditors();
}
