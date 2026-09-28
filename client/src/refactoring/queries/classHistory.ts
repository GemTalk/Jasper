import { QueryExecutor } from '../../queries/types';
import { escapeString } from '../../queries/util';

/**
 * The `inDictionary:` argument for the three GsClassHistory entry points, from the caller's
 * dictionary reference: a 1-based SymbolList index (canonical here — two dictionaries can share
 * a name), a dictionary name, or `undefined` for the engine's old unscoped lookup.
 *
 * Unscoped resolution answers the FIRST binding on the symbol list, which for a shadowed class
 * name is a different class from the one the user selected in the Explorer — so the history
 * shown described the wrong class, and Restore rewrote it (#396). Every caller that knows its
 * dictionary must pass it.
 */
function dictArg(dict?: number | string): string {
  if (dict === undefined) return 'nil';
  return typeof dict === 'number' ? String(dict) : `'${escapeString(dict)}'`;
}

// The class-definition history for a class, as the raw JSON the GsClassHistory
// engine helper returns (parsed by client/src/classHistoryModel.ts). One object
// per version, newest first, each carrying the version index, the name it had
// then, its oop, timeStamp, userId, an isCurrent flag, its definition source, and
// the methods added/removed/modified relative to the previous version. Built on
// GemStone's native classHistory, so it is this-stone-only and read-only.
export function getClassHistory(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string {
  return execute(
    `GsClassHistory forClassNamed: '${escapeString(className)}' inDictionary: ${dictArg(dict)}`,
  );
}

// Restore a historical version's shape + methods as a NEW version under the
// class's current name (a redo). Does NOT rename the class back and does NOT
// commit. Returns the raw JSON result ({"reverted":bool,...} or {"error":..}).
export function revertClassToVersion(
  execute: QueryExecutor,
  className: string,
  index: number,
  dict?: number | string,
): string {
  return execute(
    `GsClassHistory revertClassNamed: '${escapeString(className)}' toIndex: ${index} ` +
      `inDictionary: ${dictArg(dict)}`,
  );
}

// Remove the version at `index` from a class's class history (it no longer
// appears). The current version cannot be removed. Does NOT commit (the user
// commits). Returns the raw JSON result ({"removed":bool,...} or {"error":..}).
export function removeClassVersion(
  execute: QueryExecutor,
  className: string,
  index: number,
  dict?: number | string,
): string {
  return execute(
    `GsClassHistory removeVersionOf: '${escapeString(className)}' index: ${index} ` +
      `inDictionary: ${dictArg(dict)}`,
  );
}
