// Chunked transport: pull one server-built payload to the client, regardless of
// size, with the small case costing a single round trip.
//
// The executor runs a Smalltalk string and returns the (UTF-8 decoded) result,
// with a caller-chosen result-buffer size. Offsets are GemStone code points; the
// server slices on code-point boundaries and encodes each chunk as UTF-8 (see
// syncProtocol), so the decode is lossless even for wide (Unicode16/32) source
// and plain string concatenation reproduces the payload exactly.
//
// Each server response is prefixed with the server-side elapsed time
// (`Time millisecondsElapsedTime:`) so the client can attribute a slow sync to
// the server (build) vs the network (wall − server).

import {
  prepareCode,
  fetchCode,
  releaseCode,
  SYNC_CHUNK_CHARS,
  maxResultBytesFor,
} from './syncProtocol';

export type LimitExecutor = (label: string, code: string, maxBytes: number) => string;

export interface TransportStats {
  roundTrips: number;
  chars: number; // code points of payload(s) transferred
  serverMs: number; // sum of server-reported build/fetch times
  wallMs: number; // sum of client wall-clock per request
}

// Per-request timing, surfaced to the "GemStone Class Sync" log so a slow sync
// can be localized: net ≈ wallMs − serverMs is the network/transport portion.
export interface RequestTiming {
  label: string;
  serverMs: number;
  wallMs: number;
  bytes: number;
}

export type RequestLogger = (t: RequestTiming) => void;

export function newStats(): TransportStats {
  return { roundTrips: 0, chars: 0, serverMs: 0, wallMs: 0 };
}

// Build `buildExpr` server-side and return the full payload string.
export function fetchBlob(
  exec: LimitExecutor,
  label: string,
  buildExpr: string,
  chunkChars: number = SYNC_CHUNK_CHARS,
  stats?: TransportStats,
  onRequest?: RequestLogger,
): string {
  const maxBytes = maxResultBytesFor(chunkChars);

  const timedExec = (lbl: string, code: string, max: number): { resp: string; wallMs: number } => {
    const t0 = Date.now();
    const resp = exec(lbl, code, max);
    return { resp, wallMs: Date.now() - t0 };
  };

  const record = (lbl: string, serverMs: number, wallMs: number, resp: string): void => {
    if (stats) {
      stats.roundTrips++;
      stats.serverMs += serverMs;
      stats.wallMs += wallMs;
    }
    if (onRequest)
      onRequest({ label: lbl, serverMs, wallMs, bytes: Buffer.byteLength(resp, 'utf8') });
  };

  // prepare → `serverMs \t total \n <firstChunk>`
  const prepLabel = `${label}:prepare`;
  const { resp: prep, wallMs: prepWall } = timedExec(
    prepLabel,
    prepareCode(buildExpr, chunkChars),
    maxBytes,
  );
  let buildMs = 0;
  let total = 0;
  let payload = '';
  const prepNl = prep.indexOf('\n');
  if (prepNl >= 0) {
    const head = prep.slice(0, prepNl).split('\t');
    buildMs = parseInt(head[0], 10) || 0;
    total = parseInt(head[1], 10) || 0;
    payload = prep.slice(prepNl + 1);
  }
  record(prepLabel, buildMs, prepWall, prep);

  // Code points consumed so far; the first chunk holds min(chunkChars, total).
  let offset = Math.min(chunkChars, total);
  if (offset >= total) {
    if (stats) stats.chars += total;
    return payload;
  }

  while (offset < total) {
    const start = offset + 1; // GemStone copyFrom: is 1-based
    const end = Math.min(offset + chunkChars, total);
    const fetchLabel = `${label}:fetch`;
    const { resp, wallMs } = timedExec(fetchLabel, fetchCode(start, end), maxBytes);
    let fetchMs = 0;
    const fnl = resp.indexOf('\n');
    if (fnl >= 0) {
      fetchMs = parseInt(resp.slice(0, fnl), 10) || 0;
      payload += resp.slice(fnl + 1);
    }
    record(fetchLabel, fetchMs, wallMs, resp);
    offset = end;
  }

  const relLabel = `${label}:release`;
  const { resp: rel, wallMs: relWall } = timedExec(relLabel, releaseCode(), 1024);
  record(relLabel, 0, relWall, rel);

  if (stats) stats.chars += total;
  return payload;
}
