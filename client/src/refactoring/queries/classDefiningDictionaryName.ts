import { QueryExecutor } from '../../queries/types';
import { classLookupExpr, symbolListIndexOfClassExpr } from '../../queries/util';

/**
 * The name of the dictionary that DEFINES `className` — the SymbolList dictionary
 * that binds the class object by identity — resolved through `dict` (a 1-based
 * SymbolList index, a dictionary name, or undefined to resolve across the whole
 * symbol list). Returns '' when the class can't be resolved, isn't bound under its
 * own name, or lives in an unnamed dictionary.
 *
 * This is the correct "This dictionary" scope for a class rename: the scope must
 * follow the class being renamed, not whatever dictionary happens to be selected
 * in the Explorer — those differ when the rename is invoked from a method editor
 * or a hierarchy node whose class lives elsewhere. Compared as identity (`==`), so
 * a name shadowed across dictionaries resolves to the one holding THIS class.
 */
export function classDefiningDictionaryName(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string {
  const code = `| cls idx |
cls := ${classLookupExpr(className, dict)}.
cls isNil
  ifTrue: ['']
  ifFalse: [
    idx := ${symbolListIndexOfClassExpr('cls')}.
    idx = 0
      ifTrue: ['']
      ifFalse: [((System myUserProfile symbolList at: idx) name ifNil: ['']) asString]]`;
  return execute(code).trim();
}
