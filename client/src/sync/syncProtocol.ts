// Server-side (GemStone Smalltalk) code generators and tunables for the
// incremental class-sync engine.
//
// Transport model — one primitive, reused for the manifest and for each batch of
// class source. The server builds the whole payload once, and:
//   * if it fits in a single chunk, returns it inline (one round trip, nothing
//     stored), otherwise
//   * stashes it in a SessionTemps slot and streams it by code-point offset.
// Slicing on code-point boundaries (copyFrom:to:) keeps every chunk valid UTF-8,
// so the wrapper's UTF-8 decode is lossless and JS concatenation reproduces the
// exact payload.
//
// Full design of the incremental class-sync engine: docs/incremental-class-sync.md

import { escapeString } from '../queries/util';

export interface ClassRef {
  dictIndex: number;
  dictName: string; // for file placement; lookup is by index
  className: string;
}

// SessionTemps slot holding the in-flight payload. Sync is foreground and
// serial (one GCI call per session), so a single fixed key is safe.
export const SYNC_BLOB_KEY = 'JasperSyncBlob';

// Code points per transport chunk. Bigger ⇒ fewer round trips (latency win on
// slow links) but a larger client buffer and a longer per-chunk event-loop
// stall. Tuned from logged size/timing; see ExportManager's sync logging.
export const SYNC_CHUNK_CHARS = 4_000_000;

// Classes per content build. Keeps the generated Smalltalk literal modest and
// each batch's payload near one chunk. The delta is processed in these groups.
export const SYNC_REFS_PER_BATCH = 400;

/**
 * The result buffer (bytes) the GCI fetch must allocate to receive a chunk of
 * `chunkChars` code points without truncation.
 *
 * UTF-8 encodes any code point in at most 4 bytes, so `chunkChars * 4` bounds
 * the encoded chunk itself; the `+ 1024` covers the small ASCII header
 * (`serverMs \t total \n` / `serverMs \n`) that {@link prepareCode} and
 * {@link fetchCode} prefix to each response. Always derive `maxBytes` from
 * `chunkChars` through this function rather than choosing it independently:
 * the two must move together, or a chunk can come back short with no error.
 *
 * @param chunkChars - The chunk size, in code points, that will be requested.
 * @returns The minimum safe result-buffer size, in bytes.
 */
export function maxResultBytesFor(chunkChars: number): number {
  return chunkChars * 4 + 1024;
}

// Wrap a multi-statement Smalltalk block as an expression yielding its value.
function blockExpr(body: string): string {
  return `[${body}] value`;
}

// Expression evaluating to the manifest String: one D line per dictionary (even
// empty ones, so stale dirs can be pruned) and one C line per (dict, class) with
// the md5 of its file-out. Enumeration mirrors the export's per-(dict, class)
// layout, so manifest entries line up one-to-one with files on disk.
export const MANIFEST_BUILD_EXPR = blockExpr(`
  | ws sl classCount methodCount |
  ws := WriteStream on: String new.
  sl := System myUserProfile symbolList.
  classCount := 0. methodCount := 0.
  1 to: sl size do: [:idx | | dict |
    dict := sl at: idx.
    ws nextPutAll: 'D'; tab; nextPutAll: idx printString; tab; nextPutAll: dict name; lf.
    dict keysAndValuesDo: [:k :v |
      v isBehavior ifTrue: [
        classCount := classCount + 1.
        methodCount := methodCount + v selectors size + v class selectors size.
        ws nextPutAll: 'C'; tab; nextPutAll: idx printString; tab;
           nextPutAll: k; tab; nextPutAll: v fileOutClass md5sum printString; lf]]].
  'S', (String with: Character tab), classCount printString, (String with: Character tab),
    methodCount printString, (String with: Character lf), ws contents`);

// Expression evaluating to the content String for a batch of class refs. A count
// header line (`N \t classes \t methods`) lets the client audit that it received
// everything; each record is then a header line (dictIndex, className, code-point
// length) followed by the raw file-out. Lookup is dict-scoped so shadowed names
// resolve correctly.
export function contentBuildExpr(refs: ClassRef[]): string {
  const literal = refs.map((r) => `(${r.dictIndex} '${escapeString(r.className)}')`).join(' ');
  return blockExpr(`
  | ws sl classCount methodCount |
  ws := WriteStream on: String new.
  sl := System myUserProfile symbolList.
  classCount := 0. methodCount := 0.
  #( ${literal} ) do: [:pair | | cls src |
    cls := (sl at: (pair at: 1)) at: (pair at: 2) asSymbol ifAbsent: [nil].
    cls ifNotNil: [
      classCount := classCount + 1.
      methodCount := methodCount + cls selectors size + cls class selectors size.
      src := cls fileOutClass.
      ws nextPutAll: (pair at: 1) printString; tab;
         nextPutAll: (pair at: 2); tab;
         nextPutAll: src size printString; lf;
         nextPutAll: src]].
  'N', (String with: Character tab), classCount printString, (String with: Character tab),
    methodCount printString, (String with: Character lf), ws contents`);
}

// Expression for a targeted single-class update (used when one class changes,
// e.g. a method save). Resolves the dictionary index by name (matching the
// manifest's per-index keying), then returns `dictIndex \t md5 \n file-out`,
// or '' if the dictionary or class is not found.
export function syncClassBuildExpr(dictName: string, className: string): string {
  return blockExpr(`
  | sl idx |
  sl := System myUserProfile symbolList.
  idx := 0.
  1 to: sl size do: [:i | (idx = 0 and: [(sl at: i) name asString = '${escapeString(dictName)}']) ifTrue: [idx := i]].
  idx = 0
    ifTrue: ['']
    ifFalse: [
      | cls |
      cls := (sl at: idx) at: #'${escapeString(className)}' ifAbsent: [nil].
      cls isNil
        ifTrue: ['']
        ifFalse: [ | src |
          src := cls fileOutClass.
          idx printString, (String with: Character tab), src md5sum printString,
            (String with: Character lf), src]]`);
}

// Prepare returns `serverMs \t total \n <firstChunk>`, the whole thing encoded as
// UTF-8 bytes. The encodeAsUTF8 is the crucial part: a file-out containing any
// non-ASCII character (e.g. an em dash) is a wide GemStone string (Unicode16),
// whose raw bytes are NOT UTF-8; returning it directly makes the client's UTF-8
// decode corrupt the payload and desync the parser. Slicing happens on code-point
// boundaries first, so encoding never splits a character. `serverMs` is the build
// time (Time millisecondsElapsedTime:) so the client can separate server vs network.
export function prepareCode(buildExpr: string, chunkChars: number): string {
  return `| payload firstEnd serverMs |
serverMs := Time millisecondsElapsedTime: [payload := (${buildExpr})].
firstEnd := payload size min: ${chunkChars}.
payload size > ${chunkChars} ifTrue: [SessionTemps current at: #'${SYNC_BLOB_KEY}' put: payload].
(serverMs printString, (String with: Character tab), payload size printString,
  (String with: Character lf), (payload copyFrom: 1 to: firstEnd)) encodeAsUTF8`;
}

// Fetch returns `serverMs \n <chunk>`, encoded as UTF-8 (see prepareCode).
export function fetchCode(start: number, end: number): string {
  return `| chunk serverMs |
serverMs := Time millisecondsElapsedTime: [
  chunk := (SessionTemps current at: #'${SYNC_BLOB_KEY}' ifAbsent: ['']) copyFrom: ${start} to: ${end}].
(serverMs printString, (String with: Character lf), chunk) encodeAsUTF8`;
}

export function releaseCode(): string {
  return `SessionTemps current removeKey: #'${SYNC_BLOB_KEY}' ifAbsent: [nil]. ''`;
}
