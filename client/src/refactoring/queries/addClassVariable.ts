import { QueryExecutor } from '../../queries/types';
import { classLookupExpr, escapeString } from '../../queries/util';

/** Add a class variable to a class. Unlike adding an INSTANCE variable, this does
 *  not reshape the class — class variables are not part of instance layout, so no
 *  new class version is created and no instances migrate (`addClassVarName:` just
 *  adds the shared binding, initialized to nil). The change is not committed.
 *
 *  The class is resolved through `dict` (a 1-based SymbolList index, canonical for
 *  Jasper, or a name) via classLookupExpr; the name is escaped there. Answers 'ok'
 *  on success and throws (surfaced by the executor) if the class cannot be resolved
 *  or the engine/base rejects the name. */
export function addClassVariable(
  execute: QueryExecutor,
  className: string,
  classVarName: string,
  dict?: number | string,
): string {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: ['no-class'] ifNotNil: [:c | c addClassVarName: '${escapeString(classVarName)}'. 'ok']`;
  return execute(code);
}
