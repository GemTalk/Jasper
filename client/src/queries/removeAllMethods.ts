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
 * The class is resolved through the symbol list globally, with no dictionary scope: a
 * file-out names its classes as bare globals, and that is how the file-in has to bind
 * them. Not committed automatically. Raises when the class doesn't resolve, so the
 * file-in reports it against the directive's line rather than removing nothing and
 * calling it done.
 */
export function removeAllMethods(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
): string {
  const code = `| cls |
cls := ${classLookupExpr(className)}.
cls ifNil: [^ Error signal: 'Class not found: ${escapeString(className)}'].
cls isBehavior ifFalse: [^ Error signal: 'Not a class: ${escapeString(className)}'].
${isMeta ? 'cls class' : 'cls'} removeAllMethods. 'ok'`;
  return execute(code);
}
