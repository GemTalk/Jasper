/**
 * The "does the stone still hold a refactoring undo" probe (issue #434).
 *
 * A refactoring's undo record lives in the STONE (in SessionTemps, beside the preview
 * tokens), because that is where the refactoring's own state already lives and where the
 * reversal has to be executed. Jasper's undo STACK, by contrast, lives in the extension
 * (see `undo/undoStack.ts`) — so a refactoring entry on that stack is a pointer, and this
 * module is the one place that asks whether it still points at anything.
 *
 * The probe is safe on ANY stone: it reaches GsRefactoringUndo through `objectNamed:`, so
 * a stone with no refactoring engine (or an engine that predates undo) answers "nothing to
 * undo" rather than failing.
 */
import { ActiveSession } from '../sessionManager';
import * as queries from '../browserQueries';
import { parseUndoStatus, UndoStatus } from './undoRefactoringPreview';
import { logInfo } from '../gciLog';

const NOTHING: UndoStatus = {
  available: false,
  label: '',
  engine: '',
  mechanism: 'changeSet',
  reverseKind: null,
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
