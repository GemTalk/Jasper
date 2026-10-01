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
export async function dictionaryNameFor(
  session: ActiveSession,
  dict: number | string | undefined,
): Promise<string | undefined> {
  if (typeof dict === 'string') return dict.length > 0 ? dict : undefined;
  if (dict === undefined) return undefined;
  try {
    return (await queries.getDictionaryNames(session))[dict - 1];
  } catch {
    return undefined;
  }
}

/**
 * `dictionaryNameFor` for many references at once: the symbol list is read once, up front, and
 * every index is resolved against that one read. For labelling a list of rows, where one round
 * trip per row costs a GCI call per class before anything is shown.
 *
 * Up front rather than on the first index asked about: the lookup is called from inside a
 * synchronous row builder, which cannot wait on a read, so the read has to be over before the
 * first row is built. That spends the read even on a list that names every dictionary by name.
 */
export async function dictionaryNameLookup(
  session: ActiveSession,
): Promise<(dict: number | string | undefined) => string | undefined> {
  let names: string[];
  try {
    names = await queries.getDictionaryNames(session);
  } catch {
    names = [];
  }
  return (dict) => {
    if (typeof dict === 'string') return dict.length > 0 ? dict : undefined;
    if (dict === undefined) return undefined;
    return names[dict - 1];
  };
}

export { qualifiedClassName, ambiguousClassNames, classNameForRow } from './qualifiedClassName';
