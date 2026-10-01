import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

/**
 * Remove every method from a class or its metaclass — Topaz's `removeAllMethods` /
 * `removeAllClassMethods`, which a GemStone file-out emits ahead of a class's methods
 * so that filing it in REPLACES the class's behaviour instead of merging into
 * whatever was already there.
 *
 * GemStone has no `removeAllClassMethods`; the class side is `theClass class
 * removeAllMethods`, which is what Topaz does too.
 *
 * `dict` scopes the lookup to one dictionary (1-based symbol-list index or name), as
 * the other class queries do. Chunk file-in leaves it off deliberately: a chunk
 * file-out names its classes as bare globals, so binding the first match in the symbol
 * list is what reproduces its behaviour. Tonel file-in MUST pass it — there the
 * dictionary is an explicit user choice, and resolving the bare name instead empties
 * the methods of a same-named class in a dictionary the user did not pick.
 *
 * Not committed automatically. Raises when the class doesn't resolve, so the file-in
 * reports it against the directive's line rather than removing nothing and calling it
 * done.
 */
export function removeAllMethods(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  dict?: number | string,
): string {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ Error signal: 'Class not found: ${escapeString(className)}'].
cls isBehavior ifFalse: [^ Error signal: 'Not a class: ${escapeString(className)}'].
${isMeta ? 'cls class' : 'cls'} removeAllMethods. 'ok'`;
  return execute(code);
}
