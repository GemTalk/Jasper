/**
 * Letting go of what an undo entry was holding in the stone (issue #434).
 *
 * Two kinds of entry pin a server-side object: a class edit stashes the version bound before
 * it, and a dictionary removal stashes the dictionary. The entry leaving the stack does not
 * release either — SessionTemps survives an abort, and nothing in the stack knows about it —
 * so without this the pin count would track every class edit and every dictionary removal of
 * the session rather than the 25 the stack keeps. The two cases where the stash is the only
 * reference are exactly the two where that bites: remove a class subtree, then do 25 more
 * method saves, and those versions are held live for the rest of the session with no entry
 * left that could ever use them.
 *
 * A LISTENER on the stack rather than the stack doing it itself, because releasing needs a
 * live session and a query executor and the stack is deliberately a plain data structure —
 * the same reason the reversers, and not the stack, know what a `classEdit` means.
 *
 * Best-effort throughout. A release is housekeeping: it runs off the back of a save or an
 * abort, and a failure must never be the reason either of those reports an error. The keys
 * are forgotten either way — a key that could not be removed is one whose session is
 * unreachable or already gone, and retrying it forever would be worse than leaking it.
 */
import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import { defaultQueryExecutorUsing } from '../browserQueries';
import { logInfo } from '../gciLog';
import { forgetStashKeys, releaseStashKeys, takeIssuedStashKeys } from './queries/classSlotQueries';
import { onUndoEntriesReleased, UndoReleaseReason } from './undoStack';
import { UndoEntry } from './undoTypes';

/** The SessionTemps keys these entries hold, if any. Only a class edit and a dictionary
 *  removal have one; every other kind keeps its whole "before" on the client. */
function stashKeysOf(entries: UndoEntry[]): string[] {
  const keys: string[] = [];
  for (const entry of entries) {
    if (entry.kind === 'classEdit') {
      for (const key of entry.stashKeys) if (key) keys.push(key);
    } else if (entry.kind === 'dictionaryEdit' && entry.stashKey) {
      keys.push(entry.stashKey);
    }
  }
  return keys;
}

/**
 * Release the stash for entries that have just left `sessionId`'s stack.
 *
 * A `cleared` releases everything the session ever stashed, not just what was on the stack:
 * it says the whole record is gone, which is also the only chance to let go of a key issued
 * by a capture whose edit then failed before anything committed it.
 */
function releaseFor(
  sessions: SessionManager,
  sessionId: number,
  entries: UndoEntry[],
  reason: UndoReleaseReason,
): void {
  const keys = reason === 'cleared' ? takeIssuedStashKeys(sessionId) : stashKeysOf(entries);
  if (keys.length === 0) return;
  if (reason !== 'cleared') forgetStashKeys(sessionId, keys);

  // Gone already on a logout, where the stack is cleared because the session went away:
  // its SessionTemps went with it, so there is nothing left to release.
  const session = sessions.getSession(sessionId);
  if (!session) return;

  try {
    releaseStashKeys(defaultQueryExecutorUsing(session), keys);
    logInfo(`[undo] released ${keys.length} stashed object(s) (${reason})`);
  } catch (e: unknown) {
    logInfo(
      `[undo] could not release ${keys.length} stashed object(s) (${reason}): ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Start releasing stashed objects as entries leave the stack. Answers a disposable. */
export function registerStashRelease(sessions: SessionManager): vscode.Disposable {
  return new vscode.Disposable(
    onUndoEntriesReleased((sessionId, entries, reason) =>
      releaseFor(sessions, sessionId, entries, reason),
    ),
  );
}
