/**
 * The one call a symbol-list command makes to become undoable (issue #434).
 *
 * Two shapes over one entry kind, because the reversal reads the same question either way —
 * put the symbol list back the way it was:
 *
 *   const recording = beginDictionaryRemoval(session, 'Reports');  // stashes the dictionary
 *   ... remove it from the symbol list ...
 *   recording?.commit();
 *
 *   const recording = beginDictionaryRename(session, 'Reports');
 *   ... rename it ...
 *   recording?.commit('Reporting');
 *
 * Best-effort, like every other recorder: a capture that fails answers `undefined` and the
 * command proceeds exactly as it did before undo existed.
 */
import { ActiveSession } from '../sessionManager';
import { defaultQueryExecutorUsing } from '../browserQueries';
import { logInfo } from '../gciLog';
import { captureDictionary } from './queries/dictionaryQueries';
import { newStashKey } from './queries/classSlotQueries';
import { pushUndoEntry } from './undoStack';
import { DictionaryState, UndoEntry } from './undoTypes';

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Read where the dictionary stands now, optionally pinning it in SessionTemps. Answers
 *  undefined when it cannot be read, or when there is no such dictionary — a command that
 *  is about to act on one that is not there records nothing. */
function capture(
  session: ActiveSession,
  name: string,
  stashKey?: string,
): DictionaryState | undefined {
  try {
    const state = captureDictionary(defaultQueryExecutorUsing(session), name, stashKey);
    if (!state.present) {
      logInfo(`[undo] not recording: no dictionary called ${name} on the symbol list`);
      return undefined;
    }
    return state;
  } catch (e: unknown) {
    logInfo(`[undo] dictionary capture failed, the change will not be undoable: ${describe(e)}`);
    return undefined;
  }
}

/**
 * Capture a dictionary about to be REMOVED, holding the dictionary itself in SessionTemps.
 *
 * That stash is what makes the removal reversible: `symbolList remove:` unlists the
 * dictionary without destroying it, so the same object goes back with every class it holds —
 * but only while something still references it.
 */
export function beginDictionaryRemoval(
  session: ActiveSession,
  name: string,
): { commit(): UndoEntry | undefined } | undefined {
  const stashKey = newStashKey();
  const before = capture(session, name, stashKey);
  if (!before) return undefined;

  return {
    commit(): UndoEntry | undefined {
      const entry = pushUndoEntry({
        kind: 'dictionaryEdit',
        sessionId: session.id,
        label: `Remove dictionary ${name}`,
        before,
        after: { present: false, name, index: before.index },
        stashKey,
      });
      logInfo(`[undo] recorded #${entry.id} "${entry.label}" (was at ${before.index})`);
      return entry;
    },
  };
}

/**
 * Capture a dictionary about to be RENAMED. No stash: it never leaves the symbol list, so the
 * reversal finds it under its new name and renames it back.
 */
export function beginDictionaryRename(
  session: ActiveSession,
  name: string,
): { commit(after: string): UndoEntry | undefined } | undefined {
  const before = capture(session, name);
  if (!before) return undefined;

  return {
    commit(after: string): UndoEntry | undefined {
      if (after === before.name) {
        logInfo(`[undo] not recording the dictionary rename on ${name}: same name`);
        return undefined;
      }
      const entry = pushUndoEntry({
        kind: 'dictionaryEdit',
        sessionId: session.id,
        label: `Rename dictionary ${before.name} to ${after}`,
        before,
        after: { present: true, name: after, index: before.index },
        stashKey: null,
      });
      logInfo(`[undo] recorded #${entry.id} "${entry.label}"`);
      return entry;
    },
  };
}
