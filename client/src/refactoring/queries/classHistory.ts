import { QueryExecutor } from '../../queries/types';
import { escapeString } from '../../queries/util';

// The class-definition history for a class, as the raw JSON the GsClassHistory
// engine helper returns (parsed by client/src/classHistoryModel.ts). One object
// per version, newest first, each carrying the version index, the name it had
// then, its oop, timeStamp, userId, an isCurrent flag, its definition source, and
// the methods added/removed/modified relative to the previous version. Built on
// GemStone's native classHistory, so it is this-stone-only and read-only.
export function getClassHistory(execute: QueryExecutor, className: string): string {
  return execute(`GsClassHistory forClassNamed: '${escapeString(className)}'`);
}

// Restore a historical version's shape + methods as a NEW version under the
// class's current name (a redo). Does NOT rename the class back and does NOT
// commit. Returns the raw JSON result ({"reverted":bool,...} or {"error":..}).
export function revertClassToVersion(
  execute: QueryExecutor,
  className: string,
  index: number,
): string {
  return execute(`GsClassHistory revertClassNamed: '${escapeString(className)}' toIndex: ${index}`);
}

// Remove the version at `index` from a class's class history (it no longer
// appears). The current version cannot be removed. Does NOT commit (the user
// commits). Returns the raw JSON result ({"removed":bool,...} or {"error":..}).
export function removeClassVersion(
  execute: QueryExecutor,
  className: string,
  index: number,
): string {
  return execute(`GsClassHistory removeVersionOf: '${escapeString(className)}' index: ${index}`);
}
