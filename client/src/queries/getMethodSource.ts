import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

/**
 * A method's source, or `''` when there is no such method to read.
 *
 * Both halves are guarded, because either can go missing between the moment a tab
 * was opened and the moment VS Code reads it: the class can be removed (by an
 * abort discarding the transaction that defined it, or by another session), and
 * the method can be removed from a class that is still there. Unguarded, the
 * `compiledMethodAt:` went to whatever the lookup answered and raised
 * `a UndefinedObject does not understand #compiledMethodAt:` into the GCI log,
 * with nothing in the UI to say what had happened.
 *
 * Nothing upstream catches it either, and `stat` is not the place to: it answers
 * every method URI writable without asking the stone at all, deliberately — see
 * its own comment on why pre-locking on `canClassBeWritten` was removed. So the
 * read path is where a vanished method has to be handled.
 *
 * The class is resolved through {@link classLookupExpr} even when no dictionary
 * scopes it, where other queries name the class directly. A bare class name in a
 * doit is resolved by the COMPILER, so an unbound one fails as
 * `CompileError 1001, undefined symbol` before the doit runs — which no
 * `on: Error do:` inside it can catch, because there is nothing to run. Going
 * through the symbol list makes the same lookup answer nil at run time, which is
 * catchable. `objectNamed:` walks the symbol list exactly as the bare reference
 * would, so a class that IS bound resolves identically.
 *
 * `''` rather than a raise: a `stat`/read of a vanished method is an ordinary
 * race, not a fault, and an empty buffer is something the user can see. The tabs
 * themselves are closed by the abort resync (see `afterAbort.ts`); this is the
 * net under everything else that can remove a method.
 */
export function getMethodSource(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  const at =
    environmentId === 0
      ? `compiledMethodAt: #'${escapeString(selector)}' otherwise: nil`
      : `compiledMethodAt: #'${escapeString(selector)}' environmentId: ${environmentId} otherwise: nil`;
  // The lookup itself is wrapped too: a numeric dict index that is out of range
  // raises rather than answering nil (see classLookupExpr).
  const code = `| cls m |
cls := [${classLookupExpr(className, dict)}] on: Error do: [:e | nil].
cls ifNil: [^ ''].
m := [${isMeta ? 'cls class' : 'cls'} ${at}] on: Error do: [:e | nil].
m ifNil: [^ ''].
m sourceString`;
  return execute(code);
}
