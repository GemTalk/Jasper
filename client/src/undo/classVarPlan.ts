/**
 * Working out what reversing a class-variable edit has to do (issue #434).
 *
 * Pure functions over captured state — no session, no vscode — matching `methodSlotPlan`
 * and `classSlotPlan`, and planned against the LIVE state at undo time for the same reason:
 * a variable someone has already removed by hand needs no reversal.
 */
import { ClassVarOpKind, ClassVarState } from './undoTypes';

/** What putting `before` back requires, given what is declared `now` — or null when the
 *  declaration is already as it was. */
export function planClassVarReversal(
  before: ClassVarState,
  now: ClassVarState,
): ClassVarOpKind | null {
  if (before.defined === now.defined) return null;
  return before.defined ? 'declare' : 'undeclare';
}

/** Whether someone has declared or removed the variable since the edit was recorded. Drift
 *  is a warning, never a refusal — the same policy every other reverser follows. */
export function classVarDrifted(after: ClassVarState, now: ClassVarState): boolean {
  return after.defined !== now.defined;
}
