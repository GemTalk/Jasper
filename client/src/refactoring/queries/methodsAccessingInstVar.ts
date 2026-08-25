import { QueryExecutor } from '../../queries/types';
import {
  MethodSearchResult,
  methodSerialization,
  parseMethodSearchResults,
} from '../../queries/methodSearch';
import { classLookupExpr, escapeString } from '../../queries/util';

/** Every method that would break if an instance variable were removed: the instance-side
 *  methods of the declaring class and of every subclass that read or write it IN THE GIVEN
 *  ENVIRONMENT, as browsable method rows. The caller sweeps the environments it cares about
 *  and folds the answers together.
 *
 *  Detection is bytecode-precise (`GsNMethod>>instVarsAccessed`), the same reflection the
 *  engine's `instanceMethodsAccessing:inClass:` uses — so a method that merely names the
 *  variable in a comment, or in a string, is not a reference. Only the instance side is
 *  scanned: an instance variable is not in scope on the class side at all.
 *
 *  This asks the base image directly rather than going through the refactoring engine's
 *  preview, so the safe-delete guard reads the same on a stone with no server plugin as on
 *  one with it. The engine still has the last word on what a removal actually breaks — this
 *  only decides whether the user is asked.
 *
 *  The class is resolved through `dict` (a 1-based SymbolList index, canonical for Jasper,
 *  or a name); a class the dictionary does not bind answers nothing rather than an error.
 *
 *  Selectors are enumerated with `selectorsForEnvironment:`, not `selectors`: the latter
 *  lists environment 0 only, so a method that exists solely in another environment would
 *  never be offered to the accessed-variables test at all and the scan would wrongly report
 *  the variable unused. Verified on a live stone — `selectors` answers the environment-0
 *  selector and `selectorsForEnvironment: 1` the environment-1 one. */
export function methodsAccessingInstVar(
  execute: QueryExecutor,
  className: string,
  ivarName: string,
  dict?: number | string,
  environmentId: number = 0,
): MethodSearchResult[] {
  const code = `| cls want scanned methods stream limit classDict sl |
want := '${escapeString(ivarName)}' asSymbol.
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ ''].
scanned := OrderedCollection new.
scanned add: cls.
scanned addAll: cls allSubclasses.
methods := OrderedCollection new.
scanned do: [:each |
  (each selectorsForEnvironment: ${environmentId}) do: [:sel | | m |
    m := each compiledMethodAt: sel environmentId: ${environmentId} otherwise: nil.
    (m notNil and: [m instVarsAccessed includes: want])
      ifTrue: [methods add: m]]].
methods := methods asArray.
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(execute(code));
}
