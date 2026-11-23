import { QueryExecutor } from '../../queries/types';
import {
  MethodSearchResult,
  methodSerialization,
  parseMethodSearchResults,
} from '../../queries/methodSearch';

/**
 * Run Smalltalk that answers a collection of methods, and answer them as method rows.
 *
 * Lets the assistant show a method set no search describes (class methods in one category,
 * overrides of a selector below a class) without spelling out every method in its tool call:
 * it writes the code, the stone does the walk. `code` runs as the body of a block, so it may
 * declare temporaries; its last expression is the collection. Elements that are not methods,
 * and methods no dictionary's class holds, are left out. At most `limit` come back; `more` says
 * the code answered others past them.
 */
export function methodsFromCode(
  execute: QueryExecutor,
  code: string,
  limit: number,
): { methods: MethodSearchResult[]; more: boolean } {
  const raw = execute(`| methods sl classDict stream limit |
methods := ([
${code}
] value) asArray select: [:m | (m respondsTo: #inClass) and: [m selector notNil]].
${methodSerialization(0, limit + 1)}`);
  // One row past the limit is fetched only to learn that more exist.
  const rows = parseMethodSearchResults(raw);
  return {
    methods: rows.slice(0, limit).filter((r) => r.dictName !== ''),
    more: rows.length > limit,
  };
}
