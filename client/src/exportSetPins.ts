/**
 * Ref-counted pins into a session's GCI export set.
 *
 * `GciTsSaveObjs` / `GciTsReleaseObjs` work on a set that is **not**
 * ref-counted: saving the same OOP twice adds one entry, and the first release
 * drops it. That is fine for a lone holder and wrong the moment there are two,
 * which on one session is the normal case — the debugger's variable-revert
 * bookkeeping and a basic Inspector's slot-revert bookkeeping coexist whenever
 * "Inspect" on a frame variable opens an inspector on the debugger's own
 * session, and both store the OOP a slot held before its first edit. Nothing
 * stops the two from storing the SAME object: an aliased receiver, a shared
 * collection, the same global reached two ways.
 *
 * Left on raw GCI calls, whichever holder let go first would unpin the object
 * the other still depended on — a step or resume clears the debugger's undo
 * state and releases its originals — and once that OOP was scavenged and its
 * number reused, the inspector's revert would write the stored number into
 * whatever unrelated object now answered to it.
 *
 * So both hold their pins through here: the stone is asked to save an OOP when
 * the FIRST holder claims it and to release it when the LAST one lets go. The
 * bookkeeping is per session, since an OOP means nothing across sessions.
 */
import { ActiveSession } from './sessionManager';
import { saveObjs, releaseObjs } from './debugQueries';

/** sessionId → (oop → how many holders are keeping it pinned). */
const pinsBySession = new Map<number, Map<bigint, number>>();

/**
 * Claim a pin on `oop` for this session, saving it into the export set if no
 * one else already has. Throws whatever `GciTsSaveObjs` failed with — and
 * records nothing in that case, so a caller that decides to offer no revert
 * leaves no phantom claim behind.
 */
export function pinObject(session: ActiveSession, oop: bigint): void {
  let pins = pinsBySession.get(session.id);
  if (!pins) {
    pins = new Map<bigint, number>();
    pinsBySession.set(session.id, pins);
  }
  const held = pins.get(oop) ?? 0;
  if (held === 0) saveObjs(session, [oop]);
  pins.set(oop, held + 1);
}

/**
 * Let go of one claim per entry in `oops` — pass the same OOP twice to drop two
 * claims, which is what a holder that pinned it twice has. Only the OOPs whose
 * last claim this was are released from the export set.
 *
 * The bookkeeping is dropped BEFORE the stone is asked, so a failed release (a
 * session already gone, which is the common case on dispose) still leaves the
 * registry honest. Throws what `GciTsReleaseObjs` failed with; every caller
 * treats a release failure as best-effort.
 */
export function unpinObjects(session: ActiveSession, oops: bigint[]): void {
  const pins = pinsBySession.get(session.id);
  if (!pins) return;
  const toRelease: bigint[] = [];
  for (const oop of oops) {
    const held = pins.get(oop) ?? 0;
    if (held === 0) continue; // not ours (or already dropped) — nothing to release
    if (held === 1) {
      pins.delete(oop);
      toRelease.push(oop);
    } else {
      pins.set(oop, held - 1);
    }
  }
  if (pins.size === 0) pinsBySession.delete(session.id);
  if (toRelease.length > 0) releaseObjs(session, toRelease);
}

/**
 * Drop every claim recorded for a session without asking the stone anything —
 * for a session that is going away, whose export set goes with it. Call it
 * after logout, so a holder that somehow failed to unpin can't leave counts
 * behind that would suppress the save for a later session reusing the id.
 */
export function forgetSession(sessionId: number): void {
  pinsBySession.delete(sessionId);
}

/** How many holders currently pin `oop` on this session. For tests. */
export function pinCount(sessionId: number, oop: bigint): number {
  return pinsBySession.get(sessionId)?.get(oop) ?? 0;
}
