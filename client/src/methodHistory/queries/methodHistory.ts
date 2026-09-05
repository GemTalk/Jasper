import { QueryExecutor } from '../../queries/types';
import { escapeString } from '../../queries/util';

// The message returned (as a JSON error envelope) in the rare case the
// JasperMethodHistory helper is not installed in the session (e.g. its login
// bootstrap could not compile). Kept apostrophe-free so it needs no Smalltalk
// escaping, and double-quote-free so it is valid inside the JSON envelope.
const HELPER_MISSING = 'Method history support is not available in this session.';

// The JasperMethodHistory helper is installed at login and held in SessionTemps
// (see methodHistory/methodHistoryServer.ts) — NOT in the symbol list, and needs
// no plugin — so it is resolved from SessionTemps rather than named as a bareword
// (which would fail to COMPILE when absent). When missing we answer the error
// envelope the client surfaces.
function withHelper(body: string): string {
  return `| h |
h := SessionTemps current at: #JasperMethodHistory otherwise: nil.
h isNil
  ifTrue: ['{"error":"${HELPER_MISSING}"}']
  ifFalse: [${body}]`;
}

// The per-method source history for one method, as the raw JSON the
// JasperMethodHistory helper returns (parsed by ../methodHistoryModel.ts). One object per recorded
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
    withHelper(
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
    withHelper(
      `h removeHistoryForClassNamed: '${escapeString(className)}' selector: '${escapeString(
        selector,
      )}' meta: ${isMeta ? 'true' : 'false'}`,
    ),
  );
}
