import { QueryExecutor } from '../../queries/types';
import { escapeString } from '../../queries/util';

// The per-method source history for one method, as the raw JSON the GsMethodHistory
// engine returns (parsed by ../methodHistoryModel.ts). One object per recorded
// version, newest first, each carrying the version index, timeStamp, userId,
// category, an isCurrent flag, and its source. Kept in the user's UserGlobals in
// this stone, so it is this-stone-only and per-user. Read-only.
export function getMethodHistory(
  execute: QueryExecutor,
  className: string,
  selector: string,
  isMeta: boolean,
): string {
  return execute(
    `GsMethodHistory forClassNamed: '${escapeString(className)}' selector: '${escapeString(
      selector,
    )}' meta: ${isMeta ? 'true' : 'false'}`,
  );
}

// Forget all recorded versions of one method. Does NOT commit (the user commits).
// Returns the raw JSON result ({"removed":bool,...} or {"error":..}).
export function removeMethodHistory(
  execute: QueryExecutor,
  className: string,
  selector: string,
  isMeta: boolean,
): string {
  return execute(
    `GsMethodHistory removeHistoryForClassNamed: '${escapeString(className)}' selector: '${escapeString(
      selector,
    )}' meta: ${isMeta ? 'true' : 'false'}`,
  );
}
