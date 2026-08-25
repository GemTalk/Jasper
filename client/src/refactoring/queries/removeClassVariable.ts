import { QueryExecutor } from '../../queries/types';
import { classLookupExpr, escapeString } from '../../queries/util';

/** Remove a class variable from the class that DECLARES it — the mirror of
 *  `addClassVariable`, and what undoing an add runs (#434).
 *
 *  Like the add, this does not reshape the class: class variables are not part of instance
 *  layout, so `removeClassVarName:` drops the shared binding without creating a new class
 *  version or migrating instances. The change is not committed.
 *
 *  Only the DECLARING class is touched. A name the class merely inherits is reported as
 *  'not-defined' rather than removed from an ancestor, which would take the variable away
 *  from every other subclass as well.
 *
 *  Methods that reference the variable are NOT removed with it, and GemStone does not break
 *  them loudly: it severs the reference, so each one stays in place, reads nil from then on,
 *  and no longer recompiles. Any caller that can strand a method has to say so first — see
 *  `methodsReferencingClassVar`, which is what the undo warns from.
 *
 *  The class is resolved through `dict` (a 1-based SymbolList index, canonical for Jasper,
 *  or a name) via classLookupExpr; the name is escaped there. Answers 'ok' on success,
 *  'no-class' when the class will not resolve, and 'not-defined' when it does not declare
 *  the name — both sentinels rather than errors, so a caller can tell "could not" from
 *  "nothing to do". */
export function removeClassVariable(
  execute: QueryExecutor,
  className: string,
  classVarName: string,
  dict?: number | string,
): string {
  const name = escapeString(classVarName);
  // `classVarNames` answers SYMBOLS, and the guard compares symbols. Comparing
  // `each asString` to a String literal instead raises "Unicode argument disallowed in
  // String comparison" on a stone in legacy string mode — caught by the integration test.
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: ['no-class'] ifNotNil: [:c |
  (c classVarNames includes: #'${name}')
    ifFalse: ['not-defined']
    ifTrue: [c removeClassVarName: '${name}'. 'ok']]`;
  return execute(code);
}
