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
import { UNDO_COMMAND } from './refactoringAppliedToast';

/** The context key the Explorer menu item and the palette entry gate on. */
export const UNDO_AVAILABLE_CONTEXT_KEY = 'gemstone.refactoringUndoAvailable';

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

/**
 * The status-bar button.
 *
 * The Explorer title-bar button is easy to miss unless you are already looking at the Explorer
 * (Eric, F5: "I couldn't find it. Neither will a user"), so the same action also sits in the
 * status bar, where it is visible whatever has focus. Two things make it findable: it is PURPLE
 * — `charts.purple`, a real theme colour, so it reads correctly in light and dark — against a
 * row of otherwise neutral items, and it carries a text label rather than a bare glyph.
 *
 * It also does what a contributed menu title cannot: name the refactoring. VS Code menu titles are
 * static, so the Explorer button can only ever say "Undo Last Refactoring…", while this tooltip
 * says exactly which one — and says GemStone, so it is obvious which extension it belongs to.
 */
let statusItem: vscode.StatusBarItem | undefined;

/** Create the status-bar button. The caller owns disposal (push it on the subscriptions). */
export function createUndoStatusBarItem(): vscode.StatusBarItem {
  // Left, so it sits with the always-relevant items rather than at the end of the crowded right
  // side where the session indicator and perf counters already live.
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = UNDO_COMMAND;
  item.color = new vscode.ThemeColor('charts.purple');
  statusItem = item;
  return item;
}

/** Point the module at a specific item (tests; and to release it on dispose). */
export function setUndoStatusBarItem(item: vscode.StatusBarItem | undefined): void {
  statusItem = item;
}

function updateStatusItem(status: UndoStatus): void {
  if (!statusItem) return;
  if (!status.available) {
    statusItem.hide();
    return;
  }
  statusItem.text = '$(discard) Undo Refactoring';
  // Name the extension AND the refactoring: a status-bar glyph with no owner is a mystery, and
  // "Undo Last Refactoring" without saying WHICH one is a guess.
  statusItem.tooltip = `GemStone — Undo ${status.label}`;
  statusItem.show();
}

/** Re-probe, publish the context key, and update the status-bar button. Answers the
 *  freshly-probed status so the caller can decide what to offer without a second round trip. */
export function refreshRefactoringUndoContext(session: ActiveSession | undefined): UndoStatus {
  const status = checkRefactoringUndoAvailable(session);
  void vscode.commands.executeCommand('setContext', UNDO_AVAILABLE_CONTEXT_KEY, status.available);
  updateStatusItem(status);
  return status;
}
