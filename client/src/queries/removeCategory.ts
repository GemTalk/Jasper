import { QueryExecutor } from './types';
import { escapeString, receiver } from './util';

/**
 * Remove a method category from a class. Not committed automatically.
 *
 * Refuses a category that still holds methods: GemStone's own
 * `Behavior>>removeCategory:` removes the category **and every method in it**, and
 * tidying a stray category away should never be the thing that deletes code. The
 * emptiness test happens here, in the same doit as the removal, so nothing can slip
 * into the category between the check and the remove.
 *
 * The removal is verified before it is reported: `removeCategory:` runs its
 * write-privilege check through `_validatePrivilege`, which answers nil rather than
 * raising if that check ever declines quietly, and answering 'ok' on the strength of
 * having *sent* the message would report a removal that didn't happen. (On a
 * read-only class the usual outcome is a raised SecurityError, which reaches the
 * caller as a thrown query.)
 *
 * Answers `'ok'`, `'no-class'` (the class name doesn't resolve), `'no-category'` (the
 * class doesn't have that category — a stale row), `'has-methods:<n>'` (refused; n
 * methods are still filed under it), or `'not-removed'` (GemStone kept it).
 */
export function removeCategory(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  category: string,
  dict?: number | string,
): string {
  const cat = escapeString(category);
  const code = `| recv |
recv := ${receiver(className, isMeta, dict)}.
recv isNil
  ifTrue: ['no-class']
  ifFalse: [
    (recv includesCategory: '${cat}')
      ifFalse: ['no-category']
      ifTrue: [ | sels |
        sels := recv selectorsIn: '${cat}'.
        sels isEmpty
          ifTrue: [
            recv removeCategory: '${cat}'.
            (recv includesCategory: '${cat}') ifTrue: ['not-removed'] ifFalse: ['ok']]
          ifFalse: ['has-methods:', sels size printString]]]`;
  return execute(code);
}

/** The parsed outcome of `removeCategory` — see its sentinels. */
export type RemoveCategoryResult =
  | { removed: true }
  | { removed: false; reason: 'no-class' | 'no-category' | 'not-removed' }
  | { removed: false; reason: 'has-methods'; methodCount: number };

/** Read `removeCategory`'s answer. An unrecognized answer is reported as a failure
 *  rather than assumed successful, so a caller never refreshes and reports a
 *  removal that didn't happen. */
export function parseRemoveCategoryResult(raw: string): RemoveCategoryResult {
  const answer = raw.trim();
  if (answer === 'ok') return { removed: true };
  const methods = /^has-methods:(\d+)$/.exec(answer);
  if (methods) return { removed: false, reason: 'has-methods', methodCount: Number(methods[1]) };
  if (answer === 'no-class') return { removed: false, reason: 'no-class' };
  if (answer === 'no-category') return { removed: false, reason: 'no-category' };
  return { removed: false, reason: 'not-removed' };
}
