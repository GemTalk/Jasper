import { ActiveSession } from '../sessionManager';
import * as queries from '../browserQueries';

/**
 * Naming the dictionary a refactoring acted in, for the text a user reads afterwards.
 *
 * A class name does not identify a class: the same name can be bound in several dictionaries,
 * and a refactoring acts on exactly one of them. An undo label that says only "Add x to Shadowed"
 * cannot be checked against what the user meant, and an Undo button is the last chance to notice
 * that a refactoring went somewhere unintended (#396).
 */

/**
 * The NAME of the dictionary a `dict` reference points at, or undefined.
 *
 * `dict` is what the tree hands commands: a 1-based SymbolList index (the canonical form, since
 * two dictionaries can share a name) or a name. An index is resolved through the symbol list.
 *
 * Answers undefined rather than guessing: a label with no dictionary is merely less specific,
 * while a label naming the wrong one is worse than saying nothing.
 */
export function dictionaryNameFor(
  session: ActiveSession,
  dict: number | string | undefined,
): string | undefined {
  if (typeof dict === 'string') return dict.length > 0 ? dict : undefined;
  if (dict === undefined) return undefined;
  try {
    return queries.getDictionaryNames(session)[dict - 1];
  } catch {
    return undefined;
  }
}

/**
 * `Shadowed (DictionaryB)` when the dictionary is known, plain `Shadowed` when it is not.
 *
 * Used for undo labels and panel headings, so the two halves of a refactoring -- doing it and
 * undoing it -- name the same class the same way.
 */
export function qualifiedClassName(className: string, dictName: string | undefined): string {
  return dictName ? `${className} (${dictName})` : className;
}
