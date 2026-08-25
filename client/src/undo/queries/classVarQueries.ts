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
import { classLookupExpr, escapeString, splitLines } from '../../queries/util';
import { getDefinedClassVarNames } from '../../refactoring/queries/getDefinedClassVarNames';
import { addClassVariable } from '../../refactoring/queries/addClassVariable';
import { removeClassVariable } from '../../refactoring/queries/removeClassVariable';
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
        : removeClassVariable(execute, slot.className, slot.varName, slot.dict);
  } catch (e: unknown) {
    return e instanceof Error ? e.message : String(e);
  }
  const result = answer.trim();
  if (result === 'ok') return null;
  // 'not-defined' means the removal had nothing to do, which is the state the reversal was
  // aiming at — not a failure. Every other sentinel is one.
  if (result === 'not-defined' && kind === 'undeclare') return null;
  if (result === 'no-class') return `${slot.className} could not be resolved`;
  return result;
}

/**
 * Every method that would stop compiling if the class variable's declaration went away.
 *
 * Both SIDES and the whole SUBTREE, because that is the variable's actual visibility: a class
 * variable is shared with every subclass, and a class-side method reads it exactly as an
 * instance-side one does. Scanning only the declaring class's instance side would miss the
 * accessors — which live on the class side — and every subclass method that uses it.
 *
 * Detection is by IDENTITY on the literal frame, the same test the engine's rename uses: a
 * method references the class variable iff its literals hold that exact association. A
 * same-named global is a different association and a shadowing temporary has no association
 * literal, so neither is reported.
 *
 * Answers an empty list when the class will not resolve or does not declare the name — there
 * is nothing the removal could break in either case. `_classVars` itself answers NIL on a
 * class that declares none, which is why it is guarded rather than sent to directly.
 */
export function methodsReferencingClassVar(
  execute: QueryExecutor,
  slot: ClassVarSlot,
): MethodSlot[] {
  const name = escapeString(slot.varName);
  const code = `| cls assoc ws classes |
cls := ${classLookupExpr(slot.className, slot.dict)}.
(cls isNil or: [cls isBehavior not]) ifTrue: [^ ''].
assoc := cls _classVars
  ifNil: [nil]
  ifNotNil: [:cv | cv associationAt: #'${name}' ifAbsent: [nil]].
assoc isNil ifTrue: [^ ''].
ws := WriteStream on: String new.
classes := OrderedCollection new.
classes add: cls.
classes addAll: cls allSubclasses.
classes do: [:c |
  #(false true) do: [:meta | | target |
    target := meta ifTrue: [c class] ifFalse: [c].
    target selectors do: [:sel | | m |
      m := target compiledMethodAt: sel environmentId: 0 otherwise: nil.
      (m notNil and: [m literals anySatisfy: [:each | each == assoc]])
        ifTrue: [
          ws nextPutAll: c name asString; tab.
          ws nextPutAll: (meta ifTrue: ['1'] ifFalse: ['0']); tab.
          ws nextPutAll: sel asString; lf]]]].
ws contents`;
  return parseReferences(execute(code), slot.dict);
}

/** Decode one reference scan. Exported for tests. */
export function parseReferences(raw: string, dict?: number | string): MethodSlot[] {
  return splitLines(raw).flatMap((line) => {
    const [className, meta, selector] = line.split('\t');
    if (!className || !selector) return [];
    return [{ dict, className, isMeta: meta === '1', selector, environmentId: 0 }];
  });
}
