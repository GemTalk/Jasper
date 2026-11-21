import { QueryExecutor } from '../../queries/types';
import {
  MethodSearchResult,
  methodSerialization,
  parseMethodSearchResults,
} from '../../queries/methodSearch';

/** The most methods one call shows. A list longer than this is not one anyone reads row by row. */
export const METHODS_FROM_CODE_LIMIT = 5000;

/**
 * Run Smalltalk that answers a collection of methods, and answer them as method rows.
 *
 * Lets the assistant show a method set no search describes (class methods in one category,
 * overrides of a selector below a class) without spelling out every method in its tool call:
 * it writes the code, the stone does the walk. `code` runs as the body of a block, so it may
 * declare temporaries; its last expression is the collection. Elements that are not methods,
 * and methods no dictionary's class holds, are left out.
 */
export function methodsFromCode(execute: QueryExecutor, code: string): MethodSearchResult[] {
  const raw = execute(`| methods sl classDict stream limit |
methods := ([
${code}
] value) asArray select: [:m | (m respondsTo: #inClass) and: [m selector notNil]].
${methodSerialization(0, METHODS_FROM_CODE_LIMIT)}`);
  return parseMethodSearchResults(raw).filter((r) => r.dictName !== '');
}
