import { QueryExecutor } from '../../queries/types';
import {
  classLookupExpr,
  escapeString,
  splitLines,
  symbolListIndexOfClassExpr,
} from '../../queries/util';

/** The class that DECLARES an instance variable, resolved by walking up from a
 *  starting class — the answer to "an inherited ivar belongs to which class?".
 *  `dictIndex` is the 1-based SymbolList index that binds that exact class object
 *  (by identity), so a rename can retarget to the defining class and resolve it
 *  unambiguously even when it lives in a different dictionary than the subclass
 *  the cursor was in; 0 means the class is not bound by its own name (the caller
 *  should fall back to the starting class's scope). */
export interface DefiningClass {
  className: string;
  dictIndex: number;
}

/** Walk up `className`'s superclass chain (starting at `className` itself) for the
 *  class whose OWN `instVarNames` declares `ivarName`, and report it with the
 *  SymbolList index binding it. Answers undefined when no class in the chain
 *  declares `ivarName` (the name is not a visible instance variable at all, or the
 *  starting class could not be resolved through `dict`). */
export function getDefiningClassOfInstVar(
  execute: QueryExecutor,
  className: string,
  ivarName: string,
  dict?: number | string,
): DefiningClass | undefined {
  // `instVarNames` answers the class's OWN instance-variable names as SYMBOLS.
  // Match by interning the sought name and comparing symbols by IDENTITY — a
  // `String =` (via `includes:` or `asString =`) raises "Unicode argument
  // disallowed in String comparison" (error 2718) on 3.6.x when the two strings
  // differ in encoding. Walking up until a class declares the name gives its
  // defining class.
  const code = `| cls target want |
want := '${escapeString(ivarName)}' asSymbol.
cls := ${classLookupExpr(className, dict)}.
target := nil.
[cls notNil and: [target isNil]] whileTrue: [
  (cls instVarNames anySatisfy: [:e | e asSymbol == want]) ifTrue: [target := cls].
  cls := cls superclass].
target isNil
  ifTrue: ['']
  ifFalse: [
    target name asString, (String with: Character lf), ${symbolListIndexOfClassExpr('target')} printString ]`;
  const lines = splitLines(execute(code));
  if (lines.length === 0) return undefined;
  const dictIndex = lines.length > 1 ? Number(lines[1]) : 0;
  return { className: lines[0], dictIndex: Number.isFinite(dictIndex) ? dictIndex : 0 };
}
