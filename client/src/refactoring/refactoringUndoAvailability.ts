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
 * undo" rather than failing — and says which of the two it is, in `supported`, because those
 * two look identical to the user and only one of them is fixable. See `warnUndoUnsupported`.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import * as queries from '../browserQueries';
import { parseUndoStatus, UndoStatus } from './undoRefactoringPreview';
import { logInfo } from '../gciLog';

const NOTHING: UndoStatus = {
  available: false,
  // A probe that could not run is not evidence about the engine — only an answer the stone
  // actually gave can say the engine predates undo.
  supported: true,
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
  if (!session) {
    logInfo('[undoRefactoring] status probe skipped: no session');
    return NOTHING;
  }
  try {
    const raw = queries.refactoringUndoStatus(session);
    // The raw answer, every time: whether an Undo is offered turns on this one string, and a
    // stone that answers `{"available":false}` and a probe that threw look identical from the
    // outside — both end as a notice with no button.
    logInfo(`[undoRefactoring] status probe: ${raw.trim()}`);
    return parseUndoStatus(raw);
  } catch (e: unknown) {
    logInfo(`[undoRefactoring] status probe failed: ${e instanceof Error ? e.message : String(e)}`);
    return NOTHING;
  }
}

/**
 * Sessions already told that their engine has no undo. One notice per session: the fact does
 * not change while connected, and it would otherwise repeat after every refactoring.
 */
const toldUndoUnsupported = new Set<number>();

/**
 * Say — once per session — that this stone's refactoring engine predates undo.
 *
 * An engine installed before the undo work still has every forward refactoring, so
 * `rbSupportAvailable` is true, every rename applies, and the only symptom is that no Undo is
 * ever offered afterwards. That is indistinguishable, from the user's side, from a session in
 * which nothing has been applied yet — it was reported as "undo of a rename class didn't
 * work" (review of #507). The fix is a re-install, so the notice carries the button for it.
 *
 * Fire-and-forget: the caller has just finished a refactoring and must not wait on a
 * notification the user may never dismiss.
 */
export function warnUndoUnsupported(session: ActiveSession): void {
  if (toldUndoUnsupported.has(session.id)) return;
  toldUndoUnsupported.add(session.id);
  logInfo('[undoRefactoring] this stone has no GsRefactoringUndo; refactorings are not undoable');
  const INSTALL = 'Install GemStone Support…';
  void vscode.window
    .showWarningMessage(
      'Refactorings cannot be undone on this stone: its GemStone refactoring engine was ' +
        'installed before Undo existed. Re-installing the engine adds it. (Undoing ordinary ' +
        'edits — methods, classes, categories — works here regardless.)',
      INSTALL,
    )
    .then((choice) => {
      if (choice === INSTALL) void vscode.commands.executeCommand('gemstone.installServerSupport');
    });
}

/** Test seam: forget which sessions have been told. */
export function resetUndoUnsupportedNotices(): void {
  toldUndoUnsupported.clear();
}
