/**
 * Server-side removal of Jasper's regular-expression support, the counterpart to
 * `regexInstall.ts`.
 *
 * Everything the install added lives in the `GsRegexLibrary` dictionary, plus the
 * `GsRegexLoader` class in the installing user's UserGlobals; nothing was added to
 * a kernel class. So removal is one inline snippet: take the dictionary out of
 * every user's symbol list, empty it (so its classes stop resolving at once rather
 * than lingering until garbage collection), and remove the loader. Then commit and
 * check the support is gone, aborting if any step fails.
 *
 * Editing other users' symbol lists needs SystemUser, as the install does.
 */
import { ActiveSession } from '../sessionManager';
import { executeFetchString, probeRegexSupport } from '../browserQueries';
import { messageOf, safeAbort, yieldToEventLoop } from '../serverPlugin/installHelpers';
import { explainGciError } from '../gciLibraryError';

export interface RegexUninstallResult {
  /** True only when the removal ran, committed, and the support is no longer detected. */
  success: boolean;
  committed: boolean;
  verified: boolean;
  /** Human-readable summary, suitable for a notification. */
  message: string;
}

/** Reports incremental progress: a message plus a 0–100 increment for this step. */
export type ProgressReporter = (message: string, increment: number) => void;

export const REGEX_REMOVAL_SNIPPET = `
| dictName dict |
dictName := #GsRegexLibrary.
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
AllUsers do: [:prof |
	prof symbolList do: [:d |
		(d name == #UserGlobals and: [ d includesKey: #GsRegexLoader ])
			ifTrue: [ d removeKey: #GsRegexLoader ] ] ].
'ok'`;

/**
 * Remove the regex support from the stone, commit, and verify it is gone. Any
 * failure aborts, so nothing partial is committed. On a stone that never had it,
 * the removal does nothing and still reports success: the end state is what was asked for.
 *
 * @param session     a SystemUser session.
 * @param onProgress  optional incremental progress callback.
 */
export async function uninstallRegexSupport(
  session: ActiveSession,
  onProgress: ProgressReporter = () => {},
): Promise<RegexUninstallResult> {
  onProgress('Removing regex support…', 60);
  await yieldToEventLoop();
  try {
    executeFetchString(session, REGEX_REMOVAL_SNIPPET);
  } catch (e: unknown) {
    safeAbort(session);
    return {
      success: false,
      committed: false,
      verified: false,
      message: `Could not remove regex support: ${messageOf(e)}. No changes were committed.`,
    };
  }

  onProgress('Committing…', 20);
  await yieldToEventLoop();
  const { success: committed, err } = session.GciTsCommit();
  if (!committed) {
    safeAbort(session);
    return {
      success: false,
      committed: false,
      verified: false,
      message: `Commit failed: ${explainGciError(err) || `GCI error ${err.number}`}`,
    };
  }

  onProgress('Verifying…', 20);
  await yieldToEventLoop();
  // A probe that could not ask counts as still present: the removal is then unverified.
  const stillPresent = probeRegexSupport(session) !== false;
  return {
    success: !stillPresent,
    committed: true,
    verified: !stillPresent,
    message: stillPresent
      ? 'The removal committed, but regex support is still detected. The uninstall may be incomplete.'
      : 'Regex support uninstalled and verified.',
  };
}
