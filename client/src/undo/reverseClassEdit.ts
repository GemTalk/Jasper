/**
 * Reverting a class edit (issue #434).
 *
 * Called a REVERT, not an undo, wherever the user can see it — and the distinction is real
 * rather than pedantic. Reversing a method edit recompiles source and leaves nothing behind.
 * Reversing a class edit binds an EARLIER VERSION of the class again: the class history
 * grows rather than shrinks, and anything written on the newer version since the edit stays
 * on that version, out of reach under the restored one. That is the same trade the
 * refactoring engine's class-reshape undo makes, and it is stated the same way — name what
 * goes, up front, rather than let the user find out afterwards.
 *
 * So this asks first in two cases, not one:
 *
 *  - DISCARD: the revert would leave methods behind. Modal, naming them.
 *  - DRIFT: someone has rebound the class since. Modal, as for a method edit.
 *
 * Both are warnings, never refusals. No preview panel, same as a method edit: the user just
 * did the thing, and a modal that names the cost is the honest amount of ceremony.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { defaultQueryExecutorUsing } from '../browserQueries';
import { logInfo } from '../gciLog';
import { applyClassSlotOps, captureClassSlots } from './queries/classSlotQueries';
import {
  describeClassOps,
  discardedByReversal,
  driftedClassSlots,
  planClassReversal,
} from './classSlotPlan';
import { ClassEditUndoEntry, classSlotLabel } from './undoTypes';
import { refreshExplorer, refreshSearch, reloadGemstoneEditors } from './afterUndo';

/** Whether the entry is finished with — true when it was reverted (or found already
 *  reverted), false when the user backed out or it could not run at all. */
export async function reverseClassEdit(
  session: ActiveSession,
  entry: ClassEditUndoEntry,
): Promise<boolean> {
  const execute = defaultQueryExecutorUsing(session);

  let now;
  try {
    now = captureClassSlots(execute, entry.slots);
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Revert failed: could not read the current state of ${entry.label} ` +
        `(${e instanceof Error ? e.message : String(e)}).`,
    );
    return false;
  }

  // Plan BEFORE asking anything, so a class already back the way it was costs no modal.
  const ops = planClassReversal(entry.slots, entry.before, now, entry.stashKeys);
  if (ops.length === 0) {
    void vscode.window.setStatusBarMessage(
      `Nothing to revert for ${entry.label} — it is already as it was.`,
      4000,
    );
    return true;
  }

  const drifted = driftedClassSlots(entry.slots, entry.after, now);
  if (drifted.length > 0 && !(await confirmDrift(entry, drifted.map(classSlotLabel)))) {
    logInfo(`[undo] #${entry.id} declined at the class drift prompt`);
    return false;
  }

  const discarded = discardedByReversal(ops);
  if (discarded.length > 0 && !(await confirmDiscard(entry, discarded))) {
    logInfo(`[undo] #${entry.id} declined at the discard prompt`);
    return false;
  }

  let results;
  try {
    results = applyClassSlotOps(execute, ops);
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Revert failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }

  const failures = results.filter((r) => r.error !== null);
  const succeeded = results.filter((r) => r.error === null).map((r) => r.op);

  await refreshExplorer();
  await refreshSearch(session.id);
  const landOn = succeeded.find((op) => op.kind === 'rebind');
  if (landOn) {
    try {
      await vscode.commands.executeCommand('gemstone.explorer.findClass', landOn.slot.className);
    } catch {
      /* the Explorer may not be active */
    }
  }
  await reloadGemstoneEditors();

  if (failures.length > 0) {
    const first = failures[0];
    void vscode.window.showErrorMessage(
      failures.length === results.length
        ? `Revert of ${entry.label} failed: ${first.error}`
        : `Revert of ${entry.label} was partial — ${first.op.slot.className}: ${first.error}`,
    );
    return true;
  }

  void vscode.window.showInformationMessage(
    `Reverted ${entry.label} — ${describeClassOps(succeeded)}. The class keeps its history. ` +
      'Compiled but NOT committed — commit when ready.',
  );
  return true;
}

async function confirmDrift(entry: ClassEditUndoEntry, names: string[]): Promise<boolean> {
  const list = names.length === 1 ? names[0] : `${names.length} classes (${names.join(', ')})`;
  const choice = await vscode.window.showWarningMessage(
    `${list} changed again since ${entry.label}. Reverting binds the version from before ` +
      'that edit and leaves the later one behind.',
    { modal: true },
    'Revert Anyway',
  );
  return choice === 'Revert Anyway';
}

async function confirmDiscard(entry: ClassEditUndoEntry, discarded: string[]): Promise<boolean> {
  const shown = discarded.slice(0, 10).join('\n');
  const more = discarded.length > 10 ? `\n…and ${discarded.length - 10} more` : '';
  const choice = await vscode.window.showWarningMessage(
    `Reverting ${entry.label} restores the class as it was before, which leaves ` +
      `${discarded.length} method${discarded.length === 1 ? '' : 's'} behind.`,
    {
      modal: true,
      detail:
        `${shown}${more}\n\nThese were written after the edit and belong to the newer ` +
        'version. GemStone has no transaction savepoints: the earlier version is bound ' +
        'again, and the newer one stays in the class history.',
    },
    'Revert Anyway',
  );
  return choice === 'Revert Anyway';
}
