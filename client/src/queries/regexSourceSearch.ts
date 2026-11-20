import { NbQueryExecutor, QueryExecutor } from './types';
import { escapeString } from './util';
import {
  METHOD_SEARCH_RESULT_LIMIT,
  MethodSearchResult,
  methodSerialization,
  parseMethodSearchResults,
} from './methodSearch';

/**
 * Methods whose source matches a regular expression, found by the server plugin's
 * regex support (`GsRegexSourceSearch`, gs-src/regex/engine/). Needs that support
 * installed; on a stone without it the query fails to compile.
 *
 * The search matches one line at a time unless the pattern contains `\n` or `\r`,
 * when it matches whole methods and counts the ones too long to match as
 * `skipped`. Rows are the same as every other method search (environment 0, like
 * the plain Source search), at most `limit` of them (GemStone Search passes
 * `gemstone.omniSearch.maxServerScan`; other callers get `METHOD_SEARCH_RESULT_LIMIT`).
 */
/** Where a match is in a method's source: 0-based, `end` exclusive, as in a JS string. */
export interface RegexMatchRange {
  start: number;
  end: number;
}

export interface RegexSourceSearchResult {
  /** Each method with where its matches are, in order (at most 100; see GsRegexSourceSearch), so it
   *  can be opened at the first and the others marked. */
  methods: Array<MethodSearchResult & { matches?: RegexMatchRange[] }>;
  /** True when the pattern spans lines, so whole methods were matched. */
  wholeMethods: boolean;
  /** Methods too long for the matcher to finish; not searched. */
  skipped: number;
  /** Methods whose source was read before the search ended. */
  scanned: number;
  /** True when more methods matched than were returned. */
  truncated: boolean;
}

/** The pattern was refused: a syntax error, or a construct the dialect does not support.
 *  The message is the server's, written for the user. */
export class RegexPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegexPatternError';
  }
}

const ERROR_MARK = '#error\t';

export function regexSourceSearchCode(
  pattern: string,
  ignoreCase: boolean,
  limit = METHOD_SEARCH_RESULT_LIMIT,
): string {
  // A pattern error comes back as a value, not a GemStone error, so it reaches the user
  // as "Invalid pattern: ..." and leaves the session clean. Only GsRegexError is caught:
  // a soft break (Stop) must still end a long search.
  return `| search methods stream limit classDict sl |
search := GsRegexSourceSearch pattern: '${escapeString(pattern)}' ignoreCase: ${ignoreCase} limit: ${limit}.
[search run] on: GsRegexError do: [:e | ^'#error', (String with: Character tab), e messageText].
methods := search methods.
${methodSerialization(0, limit)}.
search summaryLine, (String with: Character lf), search rangesLine, (String with: Character lf), stream contents`;
}

/** One `start-stop` pair from the server (1-based, inclusive) as a JS range, or undefined if malformed. */
function parseRange(pair: string): RegexMatchRange | undefined {
  const [start, stop] = pair.split('-').map(Number);
  return Number.isInteger(start) && Number.isInteger(stop) && start >= 1 && stop >= start - 1
    ? { start: start - 1, end: stop }
    : undefined;
}

/** The server's ranges line: one space-separated entry per method, each its comma-separated pairs. */
function parseRanges(line: string): RegexMatchRange[][] {
  return line
    .split(' ')
    .filter((entry) => entry.length > 0)
    .map((entry) =>
      entry
        .split(',')
        .map(parseRange)
        .filter((r): r is RegexMatchRange => r !== undefined),
    );
}

export function parseRegexSourceSearch(raw: string): RegexSourceSearchResult {
  if (raw.startsWith(ERROR_MARK)) throw new RegexPatternError(raw.slice(ERROR_MARK.length));
  const [summaryLine, rangesLine = '', ...rows] = raw.split('\n');
  const summary = summaryLine.split('\t');
  if (summary.length !== 4)
    throw new Error(`Unexpected regex search summary: ${summary.join(' ')}`);
  const [whole, skipped, scanned, truncated] = summary;
  // The ranges come in the order the rows do (both are the search's #methods, in order).
  const ranges = parseRanges(rangesLine);
  return {
    methods: parseMethodSearchResults(rows.join('\n')).map((m, i) =>
      ranges[i]?.length ? { ...m, matches: ranges[i] } : m,
    ),
    wholeMethods: whole === '1',
    skipped: Number(skipped),
    scanned: Number(scanned),
    truncated: truncated === '1',
  };
}

export function searchMethodSourceRegex(
  execute: QueryExecutor,
  pattern: string,
  ignoreCase: boolean,
  limit?: number,
): RegexSourceSearchResult {
  return parseRegexSourceSearch(execute(regexSourceSearchCode(pattern, ignoreCase, limit)));
}

export async function searchMethodSourceRegexAsync(
  execute: NbQueryExecutor,
  pattern: string,
  ignoreCase: boolean,
  limit?: number,
): Promise<RegexSourceSearchResult> {
  return parseRegexSourceSearch(await execute(regexSourceSearchCode(pattern, ignoreCase, limit)));
}
