/**
 * Server-side removal of the Jasper refactoring engine — the counterpart to
 * `refactoringInstall.ts`.
 *
 * Where install files in a large payload (hence the server-side `GsFileIn`),
 * removal is small and bounded, so it runs as a single inline Smalltalk snippet
 * over the GCI rather than a payload file-in — the same style the presence
 * probes use. Because the engine is isolated in a dedicated `GsRefactoring`
 * symbol dictionary (created by `GsRefactoringLoader>>ensureDictionary` and
 * shared into every user's symbol list by `shareDictionary:`), removal is clean:
 *   1. Remove the `GsRefactoring` dictionary from EVERY user's symbol list — the
 *      exact inverse of the loader's `insertDictionary:at:` sharing — AND empty
 *      the dictionary object itself (remove every key, including its self-binding).
 *      Detaching alone would leave the dictionary — still holding all engine + AST
 *      + manifest classes — as an orphan awaiting GC; emptying it unbinds those
 *      classes now, so `objectNamed:` can no longer resolve them and the
 *      availability probe flips to false immediately, with nothing left resident.
 *   2. Remove `GsRefactoringLoader` from the installing user's `UserGlobals`
 *      (the load-time tool the client files in; the only engine artifact that
 *      lives outside the dictionary).
 *   3. Remove the compat backports — the handful of kernel-class extension
 *      methods `compat.gs` feature-detect-installed, tagged with the
 *      `*ast-core-compat*` method category, which uniquely fingerprints them so
 *      only Jasper's own additions are removed (never a real kernel method).
 *
 * Removing kernel-class methods and editing other users' profiles both require
 * SystemUser, exactly as the install does — the caller sets that up (this module
 * is agnostic about how the session was obtained). Unlike the loader-driven
 * install, this module owns the commit: it runs the removal, commits, and
 * verifies, aborting so nothing partial is committed if any step fails.
 */
import { ActiveSession } from '../sessionManager';
import { executeFetchString, checkRefactoringSupportAvailable } from '../browserQueries';
import { messageOf, safeAbort, yieldToEventLoop } from '../serverPlugin/installHelpers';

export interface RefactoringUninstallResult {
  /** True only when the removal ran, the commit succeeded, and the end-state
   *  verification confirmed the engine is gone. */
  success: boolean;
  committed: boolean;
  /** True when the post-commit probe reports the engine is no longer present. */
  verified: boolean;
  /** Human-readable summary, suitable for surfacing to the user. */
  message: string;
}

/** Reports incremental progress: a message plus a 0–100 increment for this step. */
export type ProgressReporter = (message: string, increment: number) => void;

/**
 * The removal snippet: drop the `GsRefactoring` dictionary from every user's
 * symbol list, drop the loader from `UserGlobals`, and remove the
 * `*ast-core-compat*`-tagged kernel backports. Ends in a String so
 * `executeFetchString` can fetch the result.
 *
 * Kept as one server-side statement so the whole removal is a single GCI round
 * trip inside the gem, leaving the transaction dirty for the client to commit
 * (or abort on failure).
 */
const REMOVAL_SNIPPET = `
| dictName dict |
dictName := #GsRefactoring.
dict := nil.
AllUsers do: [:prof |
	dict isNil ifTrue: [
		dict := prof symbolList detect: [:d | d name == dictName] ifNone: [nil] ] ].
AllUsers do: [:prof |
	| list idx |
	list := prof symbolList.
	idx := (1 to: list size) detect: [:i | (list at: i) name == dictName] ifNone: [nil].
	[idx notNil] whileTrue: [
		prof removeDictionaryAt: idx.
		list := prof symbolList.
		idx := (1 to: list size) detect: [:i | (list at: i) name == dictName] ifNone: [nil] ] ].
dict notNil ifTrue: [ dict keys asArray do: [:k | dict removeKey: k ] ].
(UserGlobals includesKey: #GsRefactoringLoader)
	ifTrue: [ UserGlobals removeKey: #GsRefactoringLoader ].
Globals valuesDo: [:v |
	(v isKindOf: Class) ifTrue: [
		{ v. v class } do: [:cls |
			cls selectors asArray do: [:sel |
				(((cls categoryOfSelector: sel) ifNil: ['']) asString beginsWith: '*ast-core-compat')
					ifTrue: [ cls removeSelector: sel ] ] ] ] ].
'ok'`;

/**
 * Remove the refactoring engine from the stone.
 *
 * Runs the removal, commits, and verifies the engine is gone. Any failure
 * aborts the transaction so nothing partial is committed. Idempotent: on a stone
 * that never had the engine the removal is a no-op and still reports success
 * (the end state — engine absent — is what was asked for).
 *
 * @param session     a session with write access to kernel classes and other
 *                    users' profiles (SystemUser).
 * @param onProgress  optional incremental progress callback.
 */
export async function uninstallRefactoringSupport(
  session: ActiveSession,
  onProgress: ProgressReporter = () => {},
): Promise<RefactoringUninstallResult> {
  onProgress('Removing the refactoring engine…', 60);
  await yieldToEventLoop();
  try {
    executeFetchString(session, REMOVAL_SNIPPET);
  } catch (e: unknown) {
    safeAbort(session);
    return {
      success: false,
      committed: false,
      verified: false,
      message: `Could not remove the refactoring engine: ${messageOf(e)}. No changes were committed.`,
    };
  }

  onProgress('Committing…', 20);
  await yieldToEventLoop();
  const { success: committed, err } = session.gci.GciTsCommit(session.handle);
  if (!committed) {
    safeAbort(session);
    return {
      success: false,
      committed: false,
      verified: false,
      message: `Commit failed: ${err.message || `GCI error ${err.number}`}`,
    };
  }

  onProgress('Verifying…', 20);
  await yieldToEventLoop();
  const stillPresent = checkRefactoringSupportAvailable(session);
  return {
    success: !stillPresent,
    committed: true,
    verified: !stillPresent,
    message: stillPresent
      ? 'The removal committed, but the engine is still detected. The uninstall may be incomplete.'
      : 'Refactoring engine uninstalled and verified.',
  };
}
