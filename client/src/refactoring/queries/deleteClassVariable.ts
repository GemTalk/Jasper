import { QueryExecutor } from '../../queries/types';
import { classLookupExpr, escapeString } from '../../queries/util';

/** Remove a class variable from a class. The mirror of addClassVariable, and just as
 *  lightweight: class variables are not part of instance layout, so `removeClassVarName:`
 *  drops the shared binding without creating a new class version or migrating anything.
 *  The change is not committed.
 *
 *  A class variable is visible to a whole subtree, so a row in the Explorer can name a
 *  variable an ANCESTOR declares. Removing it from there would silently act on the wrong
 *  class, so the guard is server-side: the class must declare the name in its OWN
 *  `classVarNames`, and the query answers 'not-declared' rather than acting when it does
 *  not. Answers 'ok' on success and 'no-class' when the class cannot be resolved through
 *  `dict` (a 1-based SymbolList index, canonical for Jasper, or a name).
 *
 *  Methods that still reference the variable keep the association in their literal frame
 *  and go on running against a binding nothing declares any more — which is why the caller
 *  looks for those methods first (see methodsAccessingClassVar). */
export function deleteClassVariable(
  execute: QueryExecutor,
  className: string,
  classVarName: string,
  dict?: number | string,
): string {
  const name = escapeString(classVarName);
  const code = `| cls want |
want := '${name}' asSymbol.
cls := ${classLookupExpr(className, dict)}.
cls isNil
  ifTrue: ['no-class']
  ifFalse: [
    (cls classVarNames anySatisfy: [:e | e asSymbol == want])
      ifFalse: ['not-declared']
      ifTrue: [cls removeClassVarName: '${name}'. 'ok']]`;
  return execute(code);
}
