/**
 * Server-side removal of Enhanced Inspector support — the counterpart to
 * `enhancedInspectorInstall.ts`.
 *
 * Where install files in the vendored GT payload (~520 classes + kernel
 * extension methods) via server-side `GsFileIn`, removal is expressed as a
 * single inline Smalltalk snippet over the GCI — the same style the presence
 * probe uses — because it only has to delete what is already there.
 *
 * The payload classes are isolated in the dedicated `GsEnhancedInspector`
 * dictionary (created and shared into every user's symbol list at install time,
 * the same isolation the refactoring engine uses with `GsRefactoring`), so
 * removal is a clean dictionary drop, exactly mirroring the refactoring
 * uninstall:
 *   1. Drop `GsEnhancedInspector` from EVERY user's symbol list AND empty the
 *      dictionary object itself (remove every key, including its self-binding).
 *      Detaching alone would leave the dictionary — still holding the whole class
 *      payload — as an orphan awaiting GC; emptying it unbinds those classes now,
 *      so the availability probe flips false immediately with nothing left resident.
 *   2. Remove the GToolkit extension methods — the payload also adds methods to
 *      kernel classes (e.g. `Object>>gtViewsInCurrentContext`), which cannot
 *      live in a dictionary. They are removed by their `*GToolkit` method-category
 *      fingerprint; the leading `*` marks an extension category, so only Jasper's
 *      own additions match, never a real kernel method.
 *   3. Sweep any legacy `Published`-resident GToolkit classes — a stone installed
 *      by the earlier `Published`-placement build has its classes there instead
 *      of in a dictionary. Removing them by the same GToolkit fingerprint makes
 *      the uninstall complete on those stones too. (A stone installed by the
 *      current build has none, so this is a no-op there.)
 *
 * Editing symbol lists, removing kernel-class methods, and editing the shared
 * `Published` dictionary all require SystemUser, exactly as the install does —
 * the caller sets that up. This module owns the commit: it runs the removal,
 * commits, and verifies, aborting so nothing partial is committed if any step
 * fails.
 */
import { ActiveSession } from '../sessionManager';
import { executeFetchString } from '../browserQueries';
import { messageOf, safeAbort, yieldToEventLoop } from '../serverPlugin/installHelpers';
import {
  isEnhancedInspectorInstalled,
  ENHANCED_INSPECTOR_DICTIONARY,
} from './enhancedInspectorInstall';

export interface EnhancedInspectorUninstallResult {
  /** True only when the removal ran, the commit succeeded, and the end-state
   *  verification confirmed the support is gone. */
  success: boolean;
  committed: boolean;
  /** True when the post-commit probe reports the support is no longer present. */
  verified: boolean;
  /** Human-readable summary, suitable for surfacing to the user. */
  message: string;
}

/** Reports incremental progress: a message plus a 0–100 increment for this step. */
export type ProgressReporter = (message: string, increment: number) => void;

/**
 * The removal snippet: drop the `GsEnhancedInspector` dictionary from every
 * user's symbol list, remove the `*GToolkit`-categorized extension methods from
 * surviving classes, and sweep any legacy GToolkit classes still resident in the
 * shared `Published` dictionary. Ends in a String so `executeFetchString` can
 * fetch the result.
 *
 * Kept as one server-side statement so the whole removal is a single GCI round
 * trip inside the gem, leaving the transaction dirty for the client to commit
 * (or abort on failure).
 */
const REMOVAL_SNIPPET = `
| dictName dict |
dictName := #${ENHANCED_INSPECTOR_DICTIONARY}.
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
Globals valuesDo: [:v |
	(v isKindOf: Class) ifTrue: [
		{ v. v class } do: [:cls |
			cls selectors asArray do: [:sel |
				(((cls categoryOfSelector: sel) ifNil: ['']) asString beginsWith: '*GToolkit')
					ifTrue: [ cls removeSelector: sel ] ] ] ] ].
(System myUserProfile symbolList detect: [:d | d name == #Published] ifNone: [nil]) ifNotNil: [:pub |
	pub keys asArray do: [:k |
		| v |
		v := pub at: k ifAbsent: [nil].
		((v isKindOf: Class) and: [((v category ifNil: ['']) asString beginsWith: 'GToolkit')])
			ifTrue: [ pub removeKey: k ] ] ].
'ok'`;

/**
 * Remove Enhanced Inspector support from the stone.
 *
 * Runs the removal, commits, and verifies the support is gone. Any failure
 * aborts the transaction so nothing partial is committed. Idempotent: on a stone
 * that never had the support the removal is a no-op and still reports success.
 *
 * @param session     a session with write access to kernel classes and the
 *                    shared `Published` dictionary (SystemUser).
 * @param onProgress  optional incremental progress callback.
 */
export async function uninstallEnhancedInspectorSupport(
  session: ActiveSession,
  onProgress: ProgressReporter = () => {},
): Promise<EnhancedInspectorUninstallResult> {
  onProgress('Removing enhanced inspector support…', 60);
  await yieldToEventLoop();
  try {
    executeFetchString(session, REMOVAL_SNIPPET);
  } catch (e: unknown) {
    safeAbort(session);
    return {
      success: false,
      committed: false,
      verified: false,
      message: `Could not remove enhanced inspector support: ${messageOf(e)}. No changes were committed.`,
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
  const stillPresent = isEnhancedInspectorInstalled(session);
  return {
    success: !stillPresent,
    committed: true,
    verified: !stillPresent,
    message: stillPresent
      ? 'The removal committed, but the support is still detected. The uninstall may be incomplete.'
      : 'Enhanced inspector support uninstalled and verified.',
  };
}
