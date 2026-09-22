import { QueryExecutor } from './types';
import { classLookupExpr } from './util';

/**
 * The comment a class actually STORES — its `#comment` extra-dict key — or `''`
 * when it has none. This is what a comment document must open on.
 *
 * Deliberately not {@link getClassComment}, which evaluates `cls comment` and so
 * answers GemStone's synthesised placeholder ("No class-specific documentation
 * for X…", plus a rendered hierarchy) for a class with no comment. Handing that
 * to an editor makes it editable text: Ctrl+Z returns to the placeholder rather
 * than to nothing, and saving writes the boilerplate in as a real comment, so
 * the class ends up permanently documented as having no documentation.
 *
 * The two callers differ on purpose. The hover and the System Browser's Comment
 * panel show `cls comment`, where the synthesised hierarchy is worth reading;
 * only the editable document opens on the stored text, because only it can be
 * saved back.
 *
 * `dict` (a 1-based SymbolList index, or a name) scopes the lookup, so the same
 * class name registered in two dictionaries resolves to the intended one.
 */
export function getStoredClassComment(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string {
  const code = `| cls c |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ ''].
c := [cls _extraDictAt: #comment] on: Error do: [:e | nil].
c ifNil: [^ ''].
c`;
  return execute(code);
}
