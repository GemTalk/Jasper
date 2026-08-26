import { QueryExecutor } from '../../queries/types';
import { escapeString } from '../../queries/util';

// The message returned (as a JSON error envelope) when this stone's refactoring
// engine predates GsMethodHistory. Kept apostrophe-free so it needs no Smalltalk
// escaping, and double-quote-free so it is valid inside the JSON envelope.
const ENGINE_MISSING =
  'Method history is not installed in this stone. Update GemStone server support to enable it.';

// GsMethodHistory is resolved through the symbol list rather than named as a
// bareword: a stone whose refactoring engine predates it would otherwise fail to
// COMPILE the query (undefined symbol), turning a graceful "not installed" into a
// raw CompileError. When absent we answer the error envelope the client surfaces.
function withEngine(body: string): string {
  return `| h |
h := System myUserProfile symbolList objectNamed: #GsMethodHistory.
h isNil
  ifTrue: ['{"error":"${ENGINE_MISSING}"}']
  ifFalse: [${body}]`;
}

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
    withEngine(
      `h forClassNamed: '${escapeString(className)}' selector: '${escapeString(
        selector,
      )}' meta: ${isMeta ? 'true' : 'false'}`,
    ),
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
    withEngine(
      `h removeHistoryForClassNamed: '${escapeString(className)}' selector: '${escapeString(
        selector,
      )}' meta: ${isMeta ? 'true' : 'false'}`,
    ),
  );
}
