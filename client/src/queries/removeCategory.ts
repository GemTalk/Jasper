import { QueryExecutor } from './types';
import { escapeString, receiver } from './util';

/**
 * Remove a method category from a class, in every environment it appears in. Not
 * committed automatically.
 *
 * Refuses a category that still holds methods: GemStone's own
 * `Behavior>>removeCategory:` removes the category **and every method in it**, and
 * tidying a stray category away should never be the thing that deletes code. The
 * emptiness test happens here, in the same doit as the removal, so nothing can slip
 * into the category between the check and the remove.
 *
 * **Every environment counts, and the doit sweeps them the way the Methods pane
 * does.** `includesCategory:`, `selectorsIn:` and `removeCategory:` are all env-0
 * shorthands (each delegates to its `…environmentId: 0` variant), while
 * `getClassEnvironments` — which builds the rows the user clicks — iterates
 * `_unifiedCategorys: env` for `0 to: maxEnv`. Trusting the shorthands made this
 * guard narrower than the pane it backstops, in two ways: a category empty in
 * environment 0 but holding a method in environment 1 was reported removed while its
 * row (and its method) stayed, and a category that exists ONLY in a non-zero
 * environment was reported as one the class "no longer has" while it sat on screen.
 * So the doit reads `_unifiedCategorys: env` across the same range, sums the
 * selectors over all of them, and removes from each environment that has it.
 *
 * The removal is verified before it is reported: `removeCategory:environmentId:` runs
 * its write-privilege check through `_validatePrivilege`, which answers nil rather
 * than raising if that check ever declines quietly, and answering 'ok' on the
 * strength of having *sent* the message would report a removal that didn't happen.
 * (On a read-only class the usual outcome is a raised SecurityError, which reaches
 * the caller as a thrown query.)
 *
 * Answers `'ok'`, `'no-class'` (the class name doesn't resolve), `'no-category'` (no
 * environment in range has that category — a stale row), `'has-methods:<n>'`
 * (refused; n methods are still filed under it across all environments), or
 * `'not-removed'` (GemStone kept it).
 */
export function removeCategory(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  category: string,
  dict?: number | string,
  // The highest method environment to sweep — the same `gemstone.maxEnvironment`
  // the Methods pane reads, so the guard can never see fewer environments than the
  // row the user clicked was built from.
  maxEnv = 0,
): string {
  const cat = escapeString(category);
  const code = `| recv envs cat found count |
recv := ${receiver(className, isMeta, dict)}.
recv isNil
  ifTrue: ['no-class']
  ifFalse: [
    envs := ${maxEnv}.
    "_existingWithAll: rather than asSymbol: a name no symbol exists for cannot be
     any class's category, and interning one would be a write for a failed lookup."
    cat := Symbol _existingWithAll: '${cat}'.
    found := OrderedCollection new.
    count := 0.
    cat isNil ifFalse: [
      0 to: envs do: [:env | | sels |
        sels := (recv _unifiedCategorys: env) at: cat otherwise: nil.
        sels isNil ifFalse: [found add: env. count := count + sels size]]].
    found isEmpty
      ifTrue: ['no-category']
      ifFalse: [
        count > 0
          ifTrue: ['has-methods:', count printString]
          ifFalse: [
            found do: [:env | recv removeCategory: '${cat}' environmentId: env].
            (found detect: [:env | ((recv _unifiedCategorys: env) at: cat otherwise: nil) notNil]
                   ifNone: [nil]) isNil
              ifTrue: ['ok']
              ifFalse: ['not-removed']]]]`;
  return execute(code);
}

/** The parsed outcome of `removeCategory` — see its sentinels. */
export type RemoveCategoryResult =
  | { removed: true }
  | { removed: false; reason: 'no-class' | 'no-category' | 'not-removed' }
  | { removed: false; reason: 'has-methods'; methodCount: number }
  | { removed: false; reason: 'unrecognized'; raw: string };

/** Read `removeCategory`'s answer. An unrecognized answer is reported as a failure
 *  rather than assumed successful, so a caller never refreshes and reports a
 *  removal that didn't happen — but under its own `'unrecognized'` reason, carrying
 *  the raw text, rather than as `'not-removed'`. The two are different facts:
 *  `'not-removed'` is the stone telling us it kept the category, while this is us
 *  being unable to read the stone's reply at all, and reporting the first for the
 *  second states as known something we could not read. */
export function parseRemoveCategoryResult(raw: string): RemoveCategoryResult {
  const answer = raw.trim();
  if (answer === 'ok') return { removed: true };
  const methods = /^has-methods:(\d+)$/.exec(answer);
  if (methods) return { removed: false, reason: 'has-methods', methodCount: Number(methods[1]) };
  if (answer === 'no-class') return { removed: false, reason: 'no-class' };
  if (answer === 'no-category') return { removed: false, reason: 'no-category' };
  if (answer === 'not-removed') return { removed: false, reason: 'not-removed' };
  return { removed: false, reason: 'unrecognized', raw: answer };
}
