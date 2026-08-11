import { RenameApplyResult } from './renameInstVarPreview';

/**
 * Format the persistent-log block listing EVERY method a rename could not recompile
 * onto the new class version, or `undefined` when none failed.
 *
 * A rename re-versions the class and copies methods forward; a method whose
 * rewritten source will not compile is reported here rather than dropped in
 * silence. The apply toast can only name the first failure (a notification
 * truncates and then vanishes), so the full set goes to the persistent "GemStone
 * GCI" output channel — a durable list the user can work through, per the
 * rename-family "surface post-rename warnings" hardening goal.
 */
export function formatRenameFailureLog(
  action: string,
  failed: RenameApplyResult['failed'],
): string | undefined {
  if (failed.length === 0) return undefined;
  return (
    `${action}: ${failed.length} method(s) did not recompile onto the new class version ` +
    '(compiled but NOT committed — abort if this was not intended):\n' +
    failed.map((f) => `    • ${f.label}: ${f.error}`).join('\n')
  );
}

/**
 * The notification for the same failure, from the same two inputs — so the toast and the
 * log block cannot drift apart in what they tell the user. A notification collapses
 * newlines and truncates, so it names only the first failure and leans on the channel
 * (and the toast's Show Details button) for the rest. Every rename reports the
 * not-committed caveat, which previously only the instance-variable one carried.
 */
export function formatRenameFailureToast(action: string, result: RenameApplyResult): string {
  const first = result.failed[0];
  const more = result.failed.length > 1 ? ` (+${result.failed.length - 1} more)` : '';
  return (
    `${action}: applied ${result.applied} change(s), but ${result.failed.length} method(s) ` +
    `did not recompile onto the new class version: ${first.label}: ${first.error}${more}. ` +
    'Compiled but NOT committed — abort if this is not what you wanted.'
  );
}
