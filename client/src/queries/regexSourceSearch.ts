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
 * the plain Source search), at most `METHOD_SEARCH_RESULT_LIMIT` of them.
 */
export interface RegexSourceSearchResult {
  methods: MethodSearchResult[];
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

export function regexSourceSearchCode(pattern: string, ignoreCase: boolean): string {
  // A pattern error comes back as a value, not a GemStone error, so it reaches the user
  // as "Invalid pattern: ..." and leaves the session clean. Only GsRegexError is caught:
  // a soft break (Stop) must still end a long search.
  return `| search methods stream limit classDict sl |
search := GsRegexSourceSearch pattern: '${escapeString(pattern)}' ignoreCase: ${ignoreCase} limit: ${METHOD_SEARCH_RESULT_LIMIT}.
[search run] on: GsRegexError do: [:e | ^'#error', (String with: Character tab), e messageText].
methods := search methods.
${methodSerialization(0)}.
search summaryLine, (String with: Character lf), stream contents`;
}

export function parseRegexSourceSearch(raw: string): RegexSourceSearchResult {
  if (raw.startsWith(ERROR_MARK)) throw new RegexPatternError(raw.slice(ERROR_MARK.length));
  const newline = raw.indexOf('\n');
  const summary = (newline === -1 ? raw : raw.slice(0, newline)).split('\t');
  if (summary.length !== 4)
    throw new Error(`Unexpected regex search summary: ${summary.join(' ')}`);
  const [whole, skipped, scanned, truncated] = summary;
  return {
    methods: newline === -1 ? [] : parseMethodSearchResults(raw.slice(newline + 1)),
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
): RegexSourceSearchResult {
  return parseRegexSourceSearch(execute(regexSourceSearchCode(pattern, ignoreCase)));
}

export async function searchMethodSourceRegexAsync(
  execute: NbQueryExecutor,
  pattern: string,
  ignoreCase: boolean,
): Promise<RegexSourceSearchResult> {
  return parseRegexSourceSearch(await execute(regexSourceSearchCode(pattern, ignoreCase)));
}
