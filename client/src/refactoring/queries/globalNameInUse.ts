import { QueryExecutor } from '../../queries/types';
import { dictLookupExpr, escapeString } from '../../queries/util';

// True when `name` is already bound to a global anywhere on the current session's
// symbol list (any dictionary).
//
// Anywhere is the WRONG question for a rename: a class name bound in another dictionary is a
// shadow, which GemStone allows, and refusing on it stops a rename that would have worked -- a
// rename asks `globalNameInUseInDictionary` instead (#396).
//
// Its one caller is Extract Superclass, which refuses a name bound anywhere on purpose: it
// creates a class rather than moving one, so there is nothing to weigh against a free name.
// The shadow WARNING a rename raises is built from `dictionariesShadowedByRename`, which names
// the dictionaries rather than answering yes or no -- and leaves out the renamed class's own by
// identity, since two dictionaries can share a name.
export async function globalNameInUse(execute: QueryExecutor, name: string): Promise<boolean> {
  return (
    (
      await execute(
        `(System myUserProfile symbolList objectNamed: #'${escapeString(name)}') notNil printString`,
      )
    ).trim() === 'true'
  );
}

/**
 * True when `name` is already bound in ONE dictionary — the one a rename or a new class would
 * actually be filed into.
 *
 * This is the collision that matters: two bindings of a name in the SAME dictionary is the case
 * the image cannot represent, and the one the apply would fail on. A binding in a different
 * dictionary is a shadow, which is legal and which the user may well intend.
 *
 * `dict` is a 1-based SymbolList index (canonical, since two dictionaries can share a name) or a
 * name. With no dictionary there is nothing to scope to, so this answers false and leaves the
 * decision to the caller rather than inventing one.
 */
export async function globalNameInUseInDictionary(
  execute: QueryExecutor,
  name: string,
  dict: number | string | undefined,
): Promise<boolean> {
  if (dict === undefined) return false;
  return (
    (
      await execute(
        `((${dictLookupExpr(dict)}) ifNil: [nil] ifNotNil: [:d |
         d at: #'${escapeString(name)}' ifAbsent: [nil]]) notNil printString`,
      )
    ).trim() === 'true'
  );
}
