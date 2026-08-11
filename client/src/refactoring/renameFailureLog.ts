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
