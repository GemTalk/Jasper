import { QueryExecutor } from '../../queries/types';
import { classLookupExpr, escapeString, splitLines } from '../../queries/util';

/** The class that DECLARES a class variable, resolved by walking up from a starting
 *  class — the answer to "an inherited class variable belongs to which class?".
 *  `dictIndex` is the 1-based SymbolList index that binds that exact class object
 *  (by identity), so a rename can retarget to the defining class and resolve it
 *  unambiguously even when it lives in a different dictionary than the subclass the
 *  cursor was in; 0 means the class is not bound by its own name (the caller falls
 *  back to the starting class's scope). */
export interface DefiningClass {
  className: string;
  dictIndex: number;
}

/** Walk up `className`'s superclass chain (starting at `className` itself) for the
 *  class whose OWN `classVarNames` declares `classVarName`, and report it with the
 *  SymbolList index binding it. Answers undefined when no class in the chain
 *  declares it (the name is not a visible class variable at all, or the starting
 *  class could not be resolved through `dict`).
 *
 *  `classVarNames` answers Symbols, so the name is interned and compared by IDENTITY
 *  — a `String =` (via `includes:`) raises "Unicode argument disallowed in String
 *  comparison" (error 2718) on 3.6.x when the strings differ in encoding. */
export function getDefiningClassOfClassVar(
  execute: QueryExecutor,
  className: string,
  classVarName: string,
  dict?: number | string,
): DefiningClass | undefined {
  const code = `| cls target want |
want := '${escapeString(classVarName)}' asSymbol.
cls := ${classLookupExpr(className, dict)}.
target := nil.
[cls notNil and: [target isNil]] whileTrue: [
  (cls classVarNames anySatisfy: [:e | e asSymbol == want]) ifTrue: [target := cls].
  cls := cls superclass].
target isNil
  ifTrue: ['']
  ifFalse: [ | sym idx |
    sym := System myUserProfile symbolList.
    idx := 0.
    1 to: sym size do: [:i |
      (idx = 0 and: [((sym at: i) at: target name asSymbol ifAbsent: [nil]) == target])
        ifTrue: [idx := i]].
    target name asString, (String with: Character lf), idx printString ]`;
  const lines = splitLines(execute(code));
  if (lines.length === 0) return undefined;
  const dictIndex = lines.length > 1 ? Number(lines[1]) : 0;
  return { className: lines[0], dictIndex: Number.isFinite(dictIndex) ? dictIndex : 0 };
}
