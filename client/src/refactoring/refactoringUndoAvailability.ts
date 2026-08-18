/**
 * The "is there a refactoring to undo" latch (issue #434).
 *
 * The undo record lives in the STONE (in SessionTemps, beside the preview tokens),
 * because that is where the refactoring's own state already lives and where an undo
 * has to be executed. So the client cannot know whether an undo exists without
 * asking — this module is the one place that asks, and the one place that drives the
 * `gemstone.refactoringUndoAvailable` context key the Explorer menu item and the
 * palette entry gate on.
 *
 * The probe is safe on ANY stone: it reaches GsRefactoringUndo through
 * `objectNamed:`, so a stone with no refactoring engine (or an engine that predates
 * undo) answers "nothing to undo" rather than failing.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import * as queries from '../browserQueries';
import { parseUndoStatus, UndoStatus } from './undoRefactoringPreview';
import { logInfo } from '../gciLog';

/** The context key the Explorer menu item and the palette entry gate on. */
export const UNDO_AVAILABLE_CONTEXT_KEY = 'gemstone.refactoringUndoAvailable';

const NOTHING: UndoStatus = {
  available: false,
  label: '',
  engine: '',
  sequence: 0,
  total: 0,
};

/** Ask the stone whether it holds an undo entry. Never throws: a session that is
 *  gone, busy, or has no engine simply reports "nothing to undo". */
export function checkRefactoringUndoAvailable(session: ActiveSession | undefined): UndoStatus {
  if (!session) return NOTHING;
  try {
    return parseUndoStatus(queries.refactoringUndoStatus(session));
  } catch (e: unknown) {
    logInfo(`[undoRefactoring] status probe failed: ${e instanceof Error ? e.message : String(e)}`);
    return NOTHING;
  }
}

/** Re-probe and publish the context key. Answers the freshly-probed status so the
 *  caller can decide what to offer without a second round trip. */
export function refreshRefactoringUndoContext(session: ActiveSession | undefined): UndoStatus {
  const status = checkRefactoringUndoAvailable(session);
  void vscode.commands.executeCommand('setContext', UNDO_AVAILABLE_CONTEXT_KEY, status.available);
  return status;
}
