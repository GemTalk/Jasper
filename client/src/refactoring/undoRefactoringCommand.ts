/**
 * "Undo Last Refactoring" (issue #434) — the orchestration behind all three entry
 * points: the Undo button on the post-apply toast, the Explorer context-menu item,
 * and the command palette. All three land here, so there is exactly one flow.
 *
 * It is the mirror image of a forward refactoring: probe that an undo exists, start
 * a paginated preview of the INVERSE change set, show it in the preview panel (per
 * change, with a diff, with drift warnings, each row de-selectable), apply the
 * selected ones server-side WITHOUT committing, then refresh the Explorer and reload
 * the open method editors so the reverted source is what the user sees.
 *
 * Not committing is deliberate and matches the rest of the family: undoing an
 * uncommitted refactoring leaves the session uncommitted, and undoing a committed one
 * needs the user's own commit — the same rule the forward direction follows.
 */
import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { PREVIEW_PAGE_BYTES } from './queries/previewRenameMethod';
import {
  UndoStartPreview,
  parseUndoStartPreview,
  parseUndoPage,
  parseApplyResult,
} from './undoRefactoringPreview';
import { showUndoRefactoringPanel } from './undoRefactoringPanel';
import { ensureRbSupport, refuse } from './renameAtCursorShared';
import { refreshRefactoringUndoContext } from './refactoringUndoAvailability';
import { logInfo } from '../gciLog';

/** Reload every VISIBLE GemStone method editor that has no unsaved edits, so an
 *  undone method shows its restored source instead of the refactored one. Dirty
 *  editors are left alone — reverting one would silently discard the user's typing,
 *  and an undo is not licence to do that. Focus is put back where it started. */
async function reloadVisibleGemstoneEditors(): Promise<void> {
  const active = vscode.window.activeTextEditor;
  const targets = vscode.window.visibleTextEditors.filter(
    (e) => e.document.uri.scheme === 'gemstone' && !e.document.isDirty,
  );
  for (const editor of targets) {
    try {
      await vscode.window.showTextDocument(editor.document, { preserveFocus: false });
      await vscode.commands.executeCommand('workbench.action.files.revert');
    } catch {
      /* best-effort: a closed or unrevertable editor must not fail the undo */
    }
  }
  if (active && active !== vscode.window.activeTextEditor) {
    try {
      await vscode.window.showTextDocument(active.document, { preserveFocus: false });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * After an undo, put the Explorer on the thing that came back (#434).
 *
 * Undoing a method rename restores the ORIGINAL selector, and leaving the tree pointed at
 * whatever it was showing makes the user hunt for what just happened. The inverse change set is
 * ordered restore-first, so the first `methodAdd` is the restored method — exactly the row to land
 * on. Falls back to the first method change of any kind, so a plain recompile-style undo still
 * lands somewhere relevant.
 *
 * Deliberately does nothing for a class-shape reversal: there is no single method to land on, and
 * the Explorer refresh above already re-reads the class.
 *
 * Best-effort throughout — a reveal that cannot resolve simply leaves the panes alone.
 */
async function revealWhatCameBack(start: UndoStartPreview): Promise<void> {
  const rows = start.page.changes;

  // A METHOD came back: land on it. The inverse set is ordered restore-first, so the first
  // methodAdd is the restored method; fall back to any method row so a recompile-style undo still
  // lands somewhere relevant.
  const restored =
    rows.find((c) => c.kind === 'methodAdd' && c.selector !== null) ??
    rows.find((c) => c.selector !== null && c.kind.startsWith('method'));
  if (restored?.selector != null) {
    try {
      await vscode.commands.executeCommand(
        'gemstone.explorer.revealMethodByName',
        restored.className,
        restored.selector,
        restored.isMeta,
      );
    } catch {
      /* the Explorer may not be active, or the row may not be in the rebuilt tree */
    }
    return;
  }

  // Otherwise a CLASS came back — a rename reversed, or a reshape returned to its earlier state.
  // Land on the class, for the same reason: what changed should be what you are looking at.
  // A reversed class rename ends up under the name it went BACK to, which the row carries as
  // `newName`; every other class row keeps its own name.
  const classRow = rows.find((c) => c.className.length > 0);
  if (!classRow) return;
  const landOn =
    classRow.kind === 'classRename' ? (classRow.newName ?? classRow.className) : classRow.className;
  try {
    await vscode.commands.executeCommand('gemstone.explorer.findClass', landOn);
  } catch {
    /* best-effort */
  }
}

/** Preview and apply the undo of the most recently applied refactoring. Surfaces its
 *  own user-facing messages. */
export async function undoLastRefactoringCommand(sessions: SessionManager): Promise<void> {
  logInfo('[undoRefactoring] invoked');
  const session = sessions.getSelectedSession();
  if (!session) {
    refuse('Select a GemStone session first.');
    return;
  }
  if (!(await ensureRbSupport(session, 'Undoing a refactoring'))) {
    logInfo('[undoRefactoring] refactoring engine unavailable; user declined install');
    return;
  }

  // Probe first so "nothing to undo" is a plain, immediate refusal rather than an
  // empty preview panel. This also re-publishes the context key, which is how a menu
  // item left stale by a reconnect corrects itself.
  const status = refreshRefactoringUndoContext(session);
  if (!status.available) {
    refuse(
      'There is no refactoring to undo in this session. Undo covers the last refactoring ' +
        'applied since you connected, and it is used up once you undo it.',
    );
    return;
  }

  const token = `undo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearUndoRefactoringPreview(session, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    start = parseUndoStartPreview(
      await queries.startUndoRefactoringPreview(session, token, PREVIEW_PAGE_BYTES),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Undo preview failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    safeClear();
    return;
  }

  if (start.total === 0) {
    refuse('There is nothing left to undo — the recorded refactoring changed nothing.');
    safeClear();
    return;
  }

  const result = await showUndoRefactoringPanel(start, {
    loadPage: async (off) =>
      parseUndoPage(
        await queries.pageUndoRefactoringPreview(session, token, off, PREVIEW_PAGE_BYTES),
      ),
    apply: async (deselected) =>
      parseApplyResult(await queries.applyUndoRefactoring(session, token, deselected)),
    cleanup: safeClear,
  });
  if (!result) return;

  // The stone's record may have been consumed (a clean undo uses it up) or kept (a
  // partial or failed one), so re-probe rather than assume either way.
  refreshRefactoringUndoContext(session);

  // A whole-apply error (an expired preview token) answers `applied:0` with an empty
  // `failed`, so it parses cleanly and would otherwise reach the success path.
  if (result.error) {
    void vscode.window.showErrorMessage(`Undo failed: ${result.error}`);
    return;
  }

  try {
    await vscode.commands.executeCommand('gemstone.explorer.refresh');
  } catch {
    /* the Explorer may not be active */
  }
  await revealWhatCameBack(start);
  await reloadVisibleGemstoneEditors();

  if (result.failed.length > 0) {
    const first = result.failed[0];
    void vscode.window.showErrorMessage(
      result.failed.length === 1
        ? `Undo could not reverse ${first.label}: ${first.error}`
        : `Undo reversed ${result.applied} change${result.applied === 1 ? '' : 's'}; ` +
            `${result.failed.length} could not be reversed. First: ${first.label}: ${first.error}`,
    );
    return;
  }

  // Word it for what actually happened. A reverse rename did not roll anything back -- it
  // renamed again -- and saying "undid" without qualification would misdescribe the state the
  // stone is now in (an extra class version, history intact).
  void vscode.window.showInformationMessage(
    start.mechanism === 'mirror'
      ? `Reversed ${start.label} (${result.applied} change` +
          `${result.applied === 1 ? '' : 's'}). The class keeps its history. ` +
          'Compiled but NOT committed — commit when ready.'
      : `Undid ${start.label} (${result.applied} change${result.applied === 1 ? '' : 's'}). ` +
          'Compiled but NOT committed — commit when ready.',
  );
}
