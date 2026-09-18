/**
 * Reading and writing a class's own class-variable declarations, for the undo layer (#434).
 *
 * Thin wrappers over the three queries that already exist — `getDefinedClassVarNames` to
 * read, `addClassVariable` / `removeClassVariable` to write — rather than a fourth copy of
 * the `classVarNames` / `addClassVarName:` / `removeClassVarName:` Smalltalk. All three are
 * plain kernel messages, so undoing an added class variable needs nothing installed on the
 * stone, exactly like undoing a method edit.
 *
 * Answers are DECLARED names only, never inherited ones: the reversal touches the class that
 * declares the variable, and removing an inherited name would take it away from every other
 * subclass too.
 *
 * The one doit written here rather than reused is the REFERENCE scan — what removing the
 * declaration would break — because nothing else in the client asks that question. It is
 * plain kernel reflection, so it holds to the same promise as the rest of this layer.
 */
import { QueryExecutor } from '../../queries/types';
import { getDefinedClassVarNames } from '../../refactoring/queries/getDefinedClassVarNames';
import { addClassVariable } from '../../refactoring/queries/addClassVariable';
import { deleteClassVariable } from '../../refactoring/queries/deleteClassVariable';
import { methodsAccessingClassVar } from '../../refactoring/queries/methodsAccessingClassVar';
import { ClassVarOpKind, ClassVarSlot, ClassVarState, MethodSlot } from '../undoTypes';

/** Whether the class declares the variable right now. A class that will not resolve reads as
 *  `defined: false` — which is what the planner needs to hear either way. */
export function captureClassVar(execute: QueryExecutor, slot: ClassVarSlot): ClassVarState {
  const declared = getDefinedClassVarNames(execute, slot.className, slot.dict);
  return { defined: declared.includes(slot.varName) };
}

/** Declare the name again, or take the declaration away. Answers null on success and the
 *  reason otherwise, so a failed reversal is reported rather than thrown past the caller. */
export function applyClassVarOp(
  execute: QueryExecutor,
  slot: ClassVarSlot,
  kind: ClassVarOpKind,
): string | null {
  let answer: string;
  try {
    answer =
      kind === 'declare'
        ? addClassVariable(execute, slot.className, slot.varName, slot.dict)
        : deleteClassVariable(execute, slot.className, slot.varName, slot.dict);
  } catch (e: unknown) {
    return e instanceof Error ? e.message : String(e);
  }
  const result = answer.trim();
  if (result === 'ok') return null;
  // 'not-declared' means the removal had nothing to do, which is the state the reversal was
  // aiming at — not a failure. Every other sentinel is one.
  if (result === 'not-declared' && kind === 'undeclare') return null;
  if (result === 'no-class') return `${slot.className} could not be resolved`;
  return result;
}

/**
 * Every method that would stop compiling if the class variable's declaration went away.
 *
 * Delegates to the refactoring layer's `methodsAccessingClassVar`, which safe-delete already
 * uses: both sides, the whole subtree, detection by literal-frame IDENTITY so a same-named
 * global and a shadowing temporary are both excluded — and it walks UP to the class that
 * DECLARES the name first, so a subclass row answers the same set as its ancestor's.
 *
 * Answered as METHOD SLOTS, because that is what the reversal plans over: the undo has to
 * discount the accessors it is removing itself, which is a slot-by-slot comparison. The
 * dictionary comes from the slot rather than from the row, so the reversal resolves each
 * class exactly as the recording did.
 *
 * Environment 0 only, like the rest of this layer — see `beginMethodEdit` for why an edit in
 * another environment records no undo at all.
 */
export function methodsReferencingClassVar(
  execute: QueryExecutor,
  slot: ClassVarSlot,
): MethodSlot[] {
  return methodsAccessingClassVar(execute, slot.className, slot.varName, slot.dict, 0).map(
    (row) => ({
      dict: slot.dict,
      className: row.className,
      isMeta: row.isMeta,
      selector: row.selector,
      environmentId: 0,
    }),
  );
}
