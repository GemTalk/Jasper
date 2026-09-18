/**
 * Undoing a method edit — with no preview (issue #434).
 *
 * A refactoring can rewrite dozens of methods across a hierarchy, which is why undoing
 * one opens a preview panel with a row and a checkbox per change. A method edit is one
 * method (two, when a save creates one and a rename-shaped edit retires another), and
 * the user just did it: previewing it would be ceremony around a decision already made.
 * So this reverses and reports what it did. The dispatcher has already named the change and
 * had it confirmed (`confirmUndo` in `undoLastCommand`) — that question is WHICH change,
 * asked of every kind alike, and is not this module's business.
 *
 * What IS this module's business is DRIFT. If the method has changed since the edit was
 * recorded — someone else saved it, a refactoring rewrote it, the user edited it again —
 * putting the old source back discards that, which the user cannot know from the change's
 * name alone. So it is worth asking a second time, and it is a warning rather than a
 * refusal, matching the refactoring undo's policy.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { defaultQueryExecutorUsing } from '../browserQueries';
import { logInfo } from '../gciLog';
import { applyMethodSlotOps, captureMethodSlots } from './queries/methodSlotQueries';
import { describeOps, driftedSlots, planReversal } from './methodSlotPlan';
import { MethodEditUndoEntry, slotLabel } from './undoTypes';
import {
  closeEditorsForRemovedMethods,
  refreshExplorer,
  refreshSearch,
  reloadGemstoneEditors,
  revealMethod,
} from './afterUndo';

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

  // Plan BEFORE asking anything. A slot that is already back the way it was needs no work,
  // and drift on a slot nothing is going to touch is not worth a modal — the commonest case
  // being an entry the user has already undone by hand.
  const ops = planReversal(entry.slots, entry.before, now);
  if (ops.length === 0) {
    void vscode.window.setStatusBarMessage(
      `Nothing to undo for ${entry.label} — it is already as it was.`,
      4000,
    );
    return true;
  }

  const drifted = driftedSlots(entry.slots, entry.after, now);
  if (drifted.length > 0 && !(await confirmDrift(entry, drifted.map(slotLabel)))) {
    logInfo(`[undo] #${entry.id} declined at the drift prompt`);
    return false;
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
  await refreshSearch(session.id);
  const landOn = succeeded.find((op) => op.kind === 'restore') ?? succeeded[0];
  if (landOn && landOn.kind !== 'remove') {
    // The slot's dictionary goes with it: a class name is not unique in a session, and without
    // it the Explorer cascades to whichever `Account` comes first on the symbol list.
    await revealMethod(
      landOn.slot.className,
      landOn.slot.selector,
      landOn.slot.isMeta,
      landOn.slot.dict,
    );
  }
  // Before the reload: a method this undo deleted has no source left to re-read, so its
  // tab is closed rather than refreshed.
  await closeEditorsForRemovedMethods(
    session.id,
    succeeded.filter((op) => op.kind === 'remove').map((op) => op.slot),
  );
  await reloadGemstoneEditors();

  if (failures.length > 0) {
    const first = failures[0];
    void vscode.window.showErrorMessage(
      failures.length === results.length
        ? `Undo of ${entry.label} failed: ${first.error}`
        : `Undo of ${entry.label} was partial — ${slotLabel(first.op.slot)}: ${first.error}`,
    );
    // A PARTIAL reversal spends the entry: some of it landed, so the recorded "before" no
    // longer describes anything the stone holds, and offering it again would reverse from a
    // state it does not know. A TOTAL failure does not — nothing was written, the stone holds
    // exactly what it held, and the entry still describes it. Spending it there was visible as
    // the button moving on to the previous change immediately after a failure was reported,
    // which reads as the undo having been silently used up (review of #507).
    return succeeded.length > 0;
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
