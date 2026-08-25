/**
 * Undoing an added class variable, together with the accessors that came with it (#434).
 *
 * An UNDO rather than a revert: `addClassVarName:` / `removeClassVarName:` change a shared
 * binding without touching instance layout, so no class version appears and nothing is left
 * behind on an older one.
 *
 * The two halves are reversed in the order that never leaves a method reading a binding its
 * class does not declare:
 *
 *  - taking the variable AWAY removes its accessors first, then the declaration;
 *  - putting one BACK declares it first, then restores the methods.
 *
 * Accessors go through the ordinary method-slot planner, so one that already existed when the
 * variable was added — and was therefore skipped rather than compiled — is left exactly
 * alone. Drift on either half is a warning, never a refusal, as everywhere else.
 *
 * The cost this has to name up front is OTHER METHODS. A class variable is shared with the
 * whole subtree, so anything written between the add and the undo — an Add Accessors run of
 * its own, a subclass method, a hand-written user — references it, and removing the
 * declaration does NOT take those methods with it. GemStone severs the reference instead:
 * each one stays in place, reads nil from then on, and no longer recompiles ("undefined
 * symbol"). Silently reading nil is the worst of the three outcomes, so it is a modal that
 * names the methods, in the same shape as the class revert's discard prompt.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { defaultQueryExecutorUsing } from '../browserQueries';
import { logInfo } from '../gciLog';
import { applyMethodSlotOps, captureMethodSlots } from './queries/methodSlotQueries';
import {
  applyClassVarOp,
  captureClassVar,
  methodsReferencingClassVar,
} from './queries/classVarQueries';
import { classVarDrifted, planClassVarReversal } from './classVarPlan';
import { driftedSlots, planReversal } from './methodSlotPlan';
import { ClassVarEditUndoEntry, classVarSlotLabel, MethodSlot, slotLabel } from './undoTypes';
import { refreshExplorer, refreshSearch, reloadGemstoneEditors } from './afterUndo';

/** Whether the entry is finished with — true when it was undone (or found already undone),
 *  false when the user backed out or the reversal could not run at all. */
export async function reverseClassVarEdit(
  session: ActiveSession,
  entry: ClassVarEditUndoEntry,
): Promise<boolean> {
  const execute = defaultQueryExecutorUsing(session);

  let nowVar;
  let nowAccessors;
  try {
    nowVar = captureClassVar(execute, entry.slot);
    nowAccessors = captureMethodSlots(execute, entry.accessorSlots);
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Undo failed: could not read the current state of ${entry.label} ` +
        `(${e instanceof Error ? e.message : String(e)}).`,
    );
    return false;
  }

  // Plan BEFORE asking anything, so a variable already removed by hand costs no modal.
  const varOp = planClassVarReversal(entry.before, nowVar);
  const accessorOps = planReversal(entry.accessorSlots, entry.accessorBefore, nowAccessors);
  if (varOp === null && accessorOps.length === 0) {
    void vscode.window.setStatusBarMessage(
      `Nothing to undo for ${entry.label} — it is already as it was.`,
      4000,
    );
    return true;
  }

  const drifted = [
    ...(classVarDrifted(entry.after, nowVar) ? [classVarSlotLabel(entry.slot)] : []),
    ...driftedSlots(entry.accessorSlots, entry.accessorAfter, nowAccessors).map(slotLabel),
  ];
  if (drifted.length > 0 && !(await confirmDrift(entry, drifted))) {
    logInfo(`[undo] #${entry.id} declined at the class-variable drift prompt`);
    return false;
  }

  // Scan BEFORE anything is removed, and discount the accessors this reversal takes away
  // itself — a method that is going anyway is not left behind by it.
  const stranded =
    varOp === 'undeclare'
      ? strandedMethods(
          execute,
          entry,
          accessorOps.map((op) => op.slot),
        )
      : [];
  if (stranded.length > 0 && !(await confirmStranded(entry, stranded))) {
    logInfo(`[undo] #${entry.id} declined at the stranded-reference prompt`);
    return false;
  }

  const failures: string[] = [];
  const done: string[] = [];

  const reverseVariable = (): void => {
    if (varOp === null) return;
    const error = applyClassVarOp(execute, entry.slot, varOp);
    if (error !== null) failures.push(`${classVarSlotLabel(entry.slot)}: ${error}`);
    else done.push(varOp === 'declare' ? 'declared the variable again' : 'removed the variable');
  };

  const reverseAccessors = (): void => {
    if (accessorOps.length === 0) return;
    let results;
    try {
      results = applyMethodSlotOps(execute, accessorOps);
    } catch (e: unknown) {
      failures.push(`accessors: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    for (const r of results) {
      if (r.error !== null) failures.push(`${slotLabel(r.op.slot)}: ${r.error}`);
    }
    const ok = results.filter((r) => r.error === null).length;
    if (ok > 0) done.push(`${ok} accessor${ok === 1 ? '' : 's'} put back`);
  };

  if (varOp === 'declare') {
    reverseVariable();
    reverseAccessors();
  } else {
    reverseAccessors();
    reverseVariable();
  }

  await refreshExplorer();
  await refreshSearch(session.id);
  try {
    await vscode.commands.executeCommand('gemstone.explorer.findClass', entry.slot.className);
  } catch {
    /* the Explorer may not be active */
  }
  await reloadGemstoneEditors();

  if (failures.length > 0) {
    void vscode.window.showErrorMessage(
      done.length === 0
        ? `Undo of ${entry.label} failed: ${failures[0]}`
        : `Undo of ${entry.label} was partial — ${failures[0]}`,
    );
    // Partial or total, what was recorded no longer describes anything the stone holds, so
    // the entry is spent either way; offering it again would reverse from a state it no
    // longer knows.
    return true;
  }

  const strandedNote =
    stranded.length > 0
      ? ` ${stranded.length} method${stranded.length === 1 ? '' : 's'} still reference` +
        `${stranded.length === 1 ? 's' : ''} ${entry.slot.varName} and now read` +
        `${stranded.length === 1 ? 's' : ''} nil.`
      : '';
  void vscode.window.showInformationMessage(
    `Undid ${entry.label} — ${done.join(', ')}.${strandedNote} Compiled but NOT committed — ` +
      'commit when ready.',
  );
  return true;
}

/**
 * The methods that would be left reading nil, excluding the ones this reversal removes.
 *
 * Best-effort: a scan that fails logs and answers nothing, because recording and reversing
 * both hold to the rule that undo must not be the reason an operation cannot run. The cost
 * of a missed warning is the state the user is already in without this check at all.
 */
function strandedMethods(
  execute: ReturnType<typeof defaultQueryExecutorUsing>,
  entry: ClassVarEditUndoEntry,
  removing: MethodSlot[],
): MethodSlot[] {
  let referencing: MethodSlot[];
  try {
    referencing = methodsReferencingClassVar(execute, entry.slot);
  } catch (e: unknown) {
    logInfo(
      `[undo] could not scan for methods referencing ${classVarSlotLabel(entry.slot)}: ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
  const gone = new Set(removing.map((s) => `${s.className}|${s.isMeta}|${s.selector}`));
  return referencing.filter((s) => !gone.has(`${s.className}|${s.isMeta}|${s.selector}`));
}

async function confirmStranded(
  entry: ClassVarEditUndoEntry,
  stranded: MethodSlot[],
): Promise<boolean> {
  const names = stranded.map(slotLabel);
  const shown = names.slice(0, 10).join('\n');
  const more = names.length > 10 ? `\n…and ${names.length - 10} more` : '';
  const choice = await vscode.window.showWarningMessage(
    `Undoing ${entry.label} removes ${entry.slot.varName}, which leaves ` +
      `${names.length} method${names.length === 1 ? '' : 's'} referencing it.`,
    {
      modal: true,
      detail:
        `${shown}${more}\n\nThese were written after the variable was added, on either side ` +
        'and anywhere in the subtree, and undoing does not remove them. Their reference is ' +
        `severed instead: each reads nil from then on and no longer recompiles ("undefined ` +
        `symbol ${entry.slot.varName}").`,
    },
    'Undo Anyway',
  );
  return choice === 'Undo Anyway';
}

async function confirmDrift(entry: ClassVarEditUndoEntry, names: string[]): Promise<boolean> {
  const list = names.length === 1 ? names[0] : `${names.length} of them (${names.join(', ')})`;
  const choice = await vscode.window.showWarningMessage(
    `${list} changed since ${entry.label}. Undoing removes the variable and its accessors ` +
      'anyway, discarding that change.',
    { modal: true },
    'Undo Anyway',
  );
  return choice === 'Undo Anyway';
}
