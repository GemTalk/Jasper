/**
 * Undoing a method edit — immediately, with no preview (issue #434).
 *
 * A refactoring can rewrite dozens of methods across a hierarchy, which is why undoing
 * one opens a preview panel with a row and a checkbox per change. A method edit is one
 * method (two, when a save creates one and a rename-shaped edit retires another), and
 * the user just did it: previewing it would be ceremony around a decision already made.
 * So this reverses on the spot and reports what it did.
 *
 * The single exception is DRIFT. If the method has changed since the edit was recorded —
 * someone else saved it, a refactoring rewrote it, the user edited it again — putting the
 * old source back discards that. Drift is the one thing worth a confirmation, and it is a
 * warning rather than a refusal, matching the refactoring undo's policy.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { defaultQueryExecutorUsing } from '../browserQueries';
import { logInfo } from '../gciLog';
import { applyMethodSlotOps, captureMethodSlots } from './queries/methodSlotQueries';
import { describeOps, driftedSlots, planReversal } from './methodSlotPlan';
import { MethodEditUndoEntry, slotLabel } from './undoTypes';
import { refreshExplorer, reloadVisibleGemstoneEditors, revealMethod } from './afterUndo';

/** Whether the entry is finished with — true when it was reversed (or found already
 *  reversed), false when the user backed out or the reversal could not run at all, so
 *  the caller knows whether to keep offering it. */
export async function reverseMethodEdit(
  session: ActiveSession,
  entry: MethodEditUndoEntry,
): Promise<boolean> {
  const execute = defaultQueryExecutorUsing(session);

  let now;
  try {
    now = captureMethodSlots(execute, entry.slots);
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Undo failed: could not read the current state of ${entry.label} ` +
        `(${e instanceof Error ? e.message : String(e)}).`,
    );
    return false;
  }

  const drifted = driftedSlots(entry.slots, entry.after, now);
  if (drifted.length > 0 && !(await confirmDrift(entry, drifted.map(slotLabel)))) {
    logInfo(`[undo] #${entry.id} declined at the drift prompt`);
    return false;
  }

  const ops = planReversal(entry.slots, entry.before, now);
  if (ops.length === 0) {
    void vscode.window.setStatusBarMessage(
      `Nothing to undo for ${entry.label} — it is already as it was.`,
      4000,
    );
    return true;
  }

  let results;
  try {
    results = applyMethodSlotOps(execute, ops);
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Undo failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }

  const failures = results.filter((r) => r.error !== null);
  const succeeded = results.filter((r) => r.error === null).map((r) => r.op);

  await refreshExplorer();
  const landOn = succeeded.find((op) => op.kind === 'restore') ?? succeeded[0];
  if (landOn && landOn.kind !== 'remove') {
    await revealMethod(landOn.slot.className, landOn.slot.selector, landOn.slot.isMeta);
  }
  await reloadVisibleGemstoneEditors();

  if (failures.length > 0) {
    const first = failures[0];
    void vscode.window.showErrorMessage(
      failures.length === results.length
        ? `Undo of ${entry.label} failed: ${first.error}`
        : `Undo of ${entry.label} was partial — ${slotLabel(first.op.slot)}: ${first.error}`,
    );
    // Partial or total, the recorded "before" is no longer a description of anything the
    // stone holds, so the entry is spent either way; offering it again would reverse
    // from a state it no longer knows.
    return true;
  }

  void vscode.window.showInformationMessage(
    `Undid ${entry.label} — ${describeOps(succeeded)}. Compiled but NOT committed — ` +
      'commit when ready.',
  );
  return true;
}

async function confirmDrift(entry: MethodEditUndoEntry, names: string[]): Promise<boolean> {
  const list = names.length === 1 ? names[0] : `${names.length} methods (${names.join(', ')})`;
  const choice = await vscode.window.showWarningMessage(
    `${list} changed since ${entry.label}. Undoing puts back the earlier source and ` +
      'discards that change.',
    { modal: true },
    'Undo Anyway',
  );
  return choice === 'Undo Anyway';
}
