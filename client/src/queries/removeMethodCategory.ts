import { QueryExecutor } from './types';
import { escapeString, receiver } from './util';

/**
 * Remove a method category from a class — but ONLY when it is empty.
 *
 * The guard is the whole point. GemStone's `removeCategory:` does not refuse a category that
 * holds methods: it removes them along with it, so a bare call is a silent way to delete
 * every method in a category. Nothing in Jasper wants that, and undoing a category someone
 * created certainly does not.
 *
 * Check and removal are one doit, so nothing can file a method into the category between
 * reading it as empty and removing it.
 *
 * Answers 'ok', 'not-found' when the class does not have that category (`removeCategory:`
 * raises rather than shrugging), or 'holds:N' naming how many methods stopped it — a
 * refusal the caller can report, not an error. `categoryNames` answers SYMBOLS and is
 * compared as such: `each asString = '…'` raises "Unicode argument disallowed in String
 * comparison" on a stone in legacy string mode.
 */
export function removeMethodCategory(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  category: string,
  dict?: number | string,
): string {
  const recv = receiver(className, isMeta, dict);
  const name = escapeString(category);
  const code = `| target held |
target := ${recv}.
(target categoryNames includes: #'${name}') ifFalse: [^ 'not-found'].
held := target selectorsIn: '${name}'.
held isEmpty ifFalse: [^ 'holds:', held size printString].
target removeCategory: '${name}'.
'ok'`;
  return execute(code);
}
