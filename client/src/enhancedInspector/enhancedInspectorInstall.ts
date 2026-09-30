/**
 * Server-side installation of Enhanced Inspector support.
 *
 * Files the vendored enhanced inspector support `.gs` payload into a stone over a GCI session.
 * Each file is filed in with a single server-side
 * `GsEnhancedInspectorFileIn fromPath:on:#serverUtf8File to:` call (the gem
 * reads and compiles the file itself; the class is a `GsFileIn` subclass the
 * installer creates first, see `ENHANCED_INSPECTOR_FILE_IN_CLASS`), in the
 * dependency order the topaz loader uses, then the work is committed and
 * verified.
 *
 * Server-side `GsFileIn` (rather than client-side per-method compilation) is
 * what keeps ~520 classes / ~3,700 methods from freezing the extension host.
 *
 * @see docs/explanation/enhanced-inspector.md for why the payload is vendored
 * and filed in this way rather than loaded live.
 *
 * The payload installs persistent classes (into the dedicated
 * `GsEnhancedInspector` dictionary, created and shared here before the file-in)
 * plus extension methods on kernel classes, so the session passed here must have
 * write access to those kernel classes — in practice a SystemUser session (set
 * up by the caller; this module is agnostic about how the session was obtained).
 *
 * Server-side file-in requires the gem to be able to read the files, i.e. share
 * a filesystem with them (a local stone). Remote stones are detected and
 * reported rather than failing cryptically.
 */
import { ActiveSession } from '../sessionManager';
import { executeFetchString } from '../browserQueries';
import { compareGemStoneVersions } from '../gemStoneVersion';
import { normalizeGemStoneVersion } from '../gemStoneVersionParsing';
import {
  gemCanRead,
  gsStringLiteral,
  messageOf,
  safeAbort,
  toLocalGemPath,
  yieldToEventLoop,
} from '../serverPlugin/installHelpers';

/**
 * Minimum GemStone version the Enhanced Inspector support is limited to.
 *
 * Needs kernel classes only present in 3.7+ (e.g. `GcFinalizeNotification`),
 * plus a non-obvious platform behavior below 3.7.5 that makes the inspector
 * silently return no views even though install succeeds.
 *
 * @see docs/explanation/enhanced-inspector.md#the-gemstone-375-version-gate
 */
export const ENHANCED_INSPECTOR_MIN_VERSION = '3.7.5';

/**
 * The dedicated symbol dictionary the Enhanced Inspector payload classes are
 * filed into — the isolation counterpart to the refactoring engine's
 * `GsRefactoring` (see `GsRefactoringLoader class>>dictionaryName`).
 *
 * The payload's class declarations name it as a bareword
 * (`inDictionary: GsEnhancedInspector`, produced by
 * gs-src/enhancedInspector/build/apply_jasper_transforms.sh), so the installer
 * creates and binds it — and shares it into every user's symbol list — BEFORE
 * filing in, exactly as the refactoring loader does.
 *
 * @see docs/explanation/enhanced-inspector.md for why a dedicated dictionary
 * (rather than the shared `Published` an earlier build used) is what enables a
 * clean uninstall.
 */
export const ENHANCED_INSPECTOR_DICTIONARY = 'GsEnhancedInspector';

/**
 * True when `stoneVersion` supports the Enhanced Inspector, i.e. it is
 * `ENHANCED_INSPECTOR_MIN_VERSION` or later. The comparison is semantic
 * (numeric per version segment), so future releases — 3.7.6, 3.7.10, 4.0 — pass
 * automatically without any list to maintain.
 *
 * `stoneVersion` is the raw `GciTsVersion` string, which starts with the numeric
 * version but may carry a trailing build/description suffix
 * (e.g. "3.7.5 build ..."). `normalizeGemStoneVersion` strips that suffix and
 * pads the result, since `compareGemStoneVersions` requires a bare 3–4 segment
 * numeric string and would otherwise throw (and fail closed, blocking a
 * supported stone).
 */
export function supportsEnhancedInspector(stoneVersion: string | undefined): boolean {
  const padded = normalizeGemStoneVersion(stoneVersion);
  if (!padded) return false;
  try {
    return compareGemStoneVersions(padded, ENHANCED_INSPECTOR_MIN_VERSION) >= 0;
  } catch {
    // Defensive: fail closed rather than offer an install that would break.
    return false;
  }
}

/**
 * The payload files, in dependency order — this array is the sole authority on
 * load order. The files themselves live in resources/enhancedInspector/.
 * Earlier files define classes and behavior that later files depend on.
 *
 * @see docs/explanation/enhanced-inspector.md#file-load-order-is-load-bearing
 */
export const ENHANCED_INSPECTOR_FILES: readonly string[] = [
  'Announcements.gs',
  'RemoteServiceReplication.gs',
  'STON.gs',
  'patch-gemstone.gs',
  'gtoolkit-wireencoding.gs',
  'gt4gemstone.gs',
  'gtoolkit-remote.gs',
];

/**
 * Server-side snippet run once BEFORE the payload file-in: create the dedicated
 * `GsEnhancedInspector` dictionary (binding its own name so the payload's
 * bareword `inDictionary: GsEnhancedInspector` resolves), position it at the END
 * of the installing user's symbol list (non-shadowing), and share the SAME
 * dictionary object into every user's symbol list — the mirror of
 * `GsRefactoringLoader>>ensureDictionary` + `shareDictionary:`.
 *
 * It also MIGRATES a stone installed by the earlier `Published`-placement
 * build, so nothing stale shadows the fresh classes or survives a later
 * dictionary-drop uninstall.
 *
 * @see docs/explanation/enhanced-inspector.md#migrating-a-legacy-published-placement-install
 * for why the migration is gated the way it is below.
 *
 * Ends in a String so `executeFetchString` can fetch the result. Idempotent.
 */
const PREPARE_DICTIONARY_SNIPPET = `
| sym prof list dict pub |
sym := #GsEnhancedInspector.
prof := System myUserProfile.
list := prof symbolList.
dict := list detect: [:d | d name == sym] ifNone: [nil].
dict isNil ifTrue: [
	dict := SymbolDictionary new name: sym; yourself.
	dict at: sym put: dict.
	prof insertDictionary: dict at: list size + 1 ].
AllUsers do: [:p |
	(p symbolList detect: [:d | d name == sym] ifNone: [nil]) isNil
		ifTrue: [ p insertDictionary: dict at: p symbolList size + 1 ] ].
pub := list detect: [:d | d name == #Published] ifNone: [nil].
"Legacy migration ONLY, gated on a marker the earlier build is known to have bound
 INTO Published (not on the mere presence of a GToolkit-categorized class), so a
 fresh install never sweeps. See docs/explanation/enhanced-inspector.md for why."
(pub notNil and: [pub includesKey: #GtRemotePhlowViewedObject]) ifTrue: [
	pub keys asArray do: [:k |
		| v |
		v := pub at: k ifAbsent: [nil].
		"Class categories here are bare 'GToolkit-...'; only the payload's
		 extension-method categories carry a leading '*', so the uninstall
		 snippet's '*GToolkit' anchor can't be reused for this match."
		((v isKindOf: Class)
			and: [((v category ifNil: ['']) asString beginsWith: 'GToolkit-')])
				ifTrue: [ pub removeKey: k ] ] ].
'ok'`;

/**
 * The `GsFileIn` subclass the payload is filed in through. It lives in
 * `GsEnhancedInspector`, so the uninstall's dictionary drop removes it too.
 *
 * On a rowan3 extent the stock compile hands every method to Rowan, which files
 * a `*`-category method into the Rowan package that category names (the stone's
 * own STON and RemoteServiceReplication, which reject our copies as duplicates)
 * and refuses one on a packaged kernel class. A base extent's hook is a stub that
 * runs the plain unpackaged compile; the subclass runs that on every extent.
 *
 * @see docs/explanation/enhanced-inspector.md#installing-on-a-rowan3-extent
 */
export const ENHANCED_INSPECTOR_FILE_IN_CLASS = 'GsEnhancedInspectorFileIn';

/**
 * The `SessionTemps` key under which `compileChunk:into:` collects the methods it
 * kept the stone's copy of although their source differs from the payload's.
 * Session-scoped, so nothing of it is committed.
 */
const KEPT_DIFFERENT_KEY = 'JasperEnhancedInspectorKeptDifferent';

/**
 * The subclass's methods. `compileChunk:into:` also leaves alone a method that a
 * class the payload did not create already has, unless the method is one of ours
 * (a `*GToolkit…` category, the anchor the uninstall removes by): the stone keeps
 * its own STON and Announcements methods, which on rowan3 belong to Rowan
 * packages, while a re-install still replaces our own kernel extensions. A kept
 * method whose source differs from the payload's is recorded under
 * `KEPT_DIFFERENT_KEY`, so a release that changes one shows up in the install
 * result rather than as an inspector bug.
 */
const FILE_IN_METHODS: readonly string[] = [
  `methodBody
	session notNil ifTrue: [ ^super methodBody ].
	currentClassObj ifNil: [ self error: 'current class not defined' ].
	^self compileChunk: self nextChunk into: currentClassObj`,
  `classMethodBody
	session notNil ifTrue: [ ^super classMethodBody ].
	currentClassObj ifNil: [ self error: 'current class not defined' ].
	^self compileChunk: self nextChunk into: currentClassObj class`,
  `compileChunk: aString into: aBehavior
	"Behavior>>compileMethod:dictionaries:category:environmentId: with Rowan's
	 packaging hook replaced by the unpackaged compile a base extent runs."
	| symList categ owner policy meth sel kept ws |
	symList := GsCurrentSession currentSession symbolList.
	categ := category asSymbol.
	owner := aBehavior theNonMetaClass.
	(${ENHANCED_INSPECTOR_DICTIONARY} at: owner name ifAbsent: [nil]) == owner ifFalse: [
		meth := aBehavior compileMethod: aString dictionaries: symList category: categ
			intoMethodDict: GsMethodDictionary new intoCategories: GsMethodDictionary new
			environmentId: compileEnvironment.
		sel := meth selector.
		((aBehavior includesSelector: sel)
			and: [ (((aBehavior categoryOfSelector: sel) ifNil: ['']) asString beginsWith: '*GToolkit') not ])
				ifTrue: [
					(aBehavior compiledMethodAt: sel) sourceString = meth sourceString ifFalse: [
						kept := SessionTemps current at: #${KEPT_DIFFERENT_KEY} ifAbsent: [nil].
						kept ifNil: [ SessionTemps current at: #${KEPT_DIFFERENT_KEY} put: (kept := OrderedCollection new) ].
						ws := WriteStream on: String new.
						ws nextPutAll: owner name; nextPutAll: (aBehavior isMeta ifTrue: [' class>>'] ifFalse: ['>>']); nextPutAll: sel.
						kept add: ws contents ].
					^nil ] ].
	policy := GsPackagePolicy current.
	((policy methodAndCategoryDictionaryFor: aBehavior source: aString dictionaries: symList category: categ) at: 1) notNil
		ifTrue: [ ^aBehavior compileMethod: aString dictionaries: symList category: categ environmentId: compileEnvironment ].
	GsObjectSecurityPolicy setCurrent: aBehavior objectSecurityPolicy while: [
		meth := aBehavior compileMethod: aString dictionaries: symList category: categ
			intoMethodDict: nil intoCategories: nil environmentId: compileEnvironment.
		(compileEnvironment == 0 and: [ policy enabled ])
			ifTrue: [ policy setStamp: aBehavior changeStamp forBehavior: aBehavior forMethod: meth selector ] ].
	^meth`,
];

/**
 * Server-side snippet run after `PREPARE_DICTIONARY_SNIPPET`: create the file-in
 * subclass, and move `GsEnhancedInspector` to the FRONT of the symbol list for
 * the file-in, as `GsRefactoringLoader>>withDictionaryFirstDo:` does. The
 * payload names its classes as barewords (`removeallmethods Announcement`), and
 * rowan3 binds 230 of those names in `Globals`; with our dictionary last, the
 * file-in would strip and overwrite Rowan's classes instead of ours.
 *
 * SystemUser's session symbol list is its persistent one, so an abort restores
 * the order; on success `RESTORE_ORDER_SNIPPET` does, before the commit.
 */
const PREPARE_FILE_IN_SNIPPET = `
| prof list idx dict cls |
prof := System myUserProfile.
list := prof symbolList.
idx := (1 to: list size) detect: [:i | (list at: i) name == #${ENHANCED_INSPECTOR_DICTIONARY}].
dict := list at: idx.
cls := GsFileIn subclass: '${ENHANCED_INSPECTOR_FILE_IN_CLASS}'
	instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
	inDictionary: dict options: #().
{ ${FILE_IN_METHODS.map(gsStringLiteral).join('.\n  ')} } do: [:src |
	| errs |
	errs := cls compileMethod: src dictionaries: list category: 'Jasper-Installer'.
	errs notNil ifTrue: [ Error signal: 'could not compile ${ENHANCED_INSPECTOR_FILE_IN_CLASS}: ', errs printString ] ].
SessionTemps current removeKey: #${KEPT_DIFFERENT_KEY} ifAbsent: [nil].
idx = 1 ifFalse: [
	prof removeDictionaryAt: idx.
	prof insertDictionary: dict at: 1 ].
'ok'`;

/**
 * Server-side snippet run after the last file-in and before the commit: put
 * `GsEnhancedInspector` back at the END of the installing user's symbol list,
 * where it cannot shadow a kernel or Rowan class of the same name. Answers the
 * methods recorded under `KEPT_DIFFERENT_KEY`, one per line (empty when none).
 */
const RESTORE_ORDER_SNIPPET = `
| prof list idx dict ws |
prof := System myUserProfile.
list := prof symbolList.
idx := (1 to: list size) detect: [:i | (list at: i) name == #${ENHANCED_INSPECTOR_DICTIONARY}].
idx = list size ifFalse: [
	dict := list at: idx.
	prof removeDictionaryAt: idx.
	prof insertDictionary: dict at: prof symbolList size + 1 ].
ws := WriteStream on: String new.
(SessionTemps current at: #${KEPT_DIFFERENT_KEY} ifAbsent: [#()]) do: [:m | ws nextPutAll: m; lf].
ws contents`;

export interface InstallResult {
  /** True only when every file filed in, the commit succeeded, and the
   *  end-state verification passed. */
  success: boolean;
  committed: boolean;
  verified: boolean;
  /** Files successfully filed in (in order). */
  filedIn: string[];
  /** The file whose file-in stopped the install, if any. */
  failedFile?: string;
  /** Methods (`Class>>selector`) where the stone's own copy was kept although its
   *  source differs from the payload's. Empty unless the install got that far. */
  keptDifferent: string[];
  /** Human-readable summary, suitable for surfacing to the user. */
  message: string;
}

/**
 * The sentence the install result carries when the stone kept its own copy of
 * methods that differ from the payload's; empty when there are none.
 */
export function keptDifferentNote(keptDifferent: readonly string[]): string {
  if (keptDifferent.length === 0) return '';
  return (
    ` The stone kept its own copy of ${keptDifferent.length} method(s) whose source ` +
    `differs from the payload's: ${keptDifferent.join(', ')}.`
  );
}

/** Reports incremental progress: a message plus a 0–100 increment for this step. */
export type ProgressReporter = (message: string, increment: number) => void;

/**
 * True when the Enhanced Inspector support is present and usable in the stone
 * reached by this session. Checks both a marker class (filed last) and the
 * `Object` dispatch extension, so a partial install fails the check.
 *
 * Resolution walks the session's symbol list, so this works wherever the classes
 * live — the dedicated `GsEnhancedInspector` dictionary (current builds) or a
 * legacy `Published`/`Globals` placement (older builds).
 */
export async function isEnhancedInspectorInstalled(session: ActiveSession): Promise<boolean> {
  try {
    const result = await executeFetchString(
      session,
      '[(GtRemotePhlowViewedObject notNil ' +
        'and: [Object includesSelector: #gtViewsInCurrentContext]) printString] ' +
        "on: Error do: [:e | 'false']",
    );
    return result.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Install (or re-install) the Enhanced Inspector support into the stone.
 *
 * Always re-files-in — presence is never a gate, so editing a `.gs` file and
 * re-running pushes the change. Files are processed in dependency order; the
 * first file that fails stops the run and the transaction is aborted so nothing
 * partial is committed. On success the work is committed and verified.
 *
 * @param session     a session with write access to kernel classes (SystemUser).
 * @param payloadDir  absolute client-side path to the directory holding the
 *                    `.gs` files; translated to the gem's local path (see
 *                    `toLocalGemPath`) before use, so callers must pass it
 *                    untranslated.
 * @param onProgress  optional incremental progress callback.
 */
export async function installEnhancedInspectorSupport(
  session: ActiveSession,
  payloadDir: string,
  onProgress: ProgressReporter = () => {},
): Promise<InstallResult> {
  const gemPayloadDir = toLocalGemPath(payloadDir);
  const sep = gemPayloadDir.endsWith('/') ? '' : '/';
  const serverPath = (file: string): string => `${gemPayloadDir}${sep}${file}`;
  // The prepare-dictionary step + 7 files + the commit step.
  const stepIncrement = 100 / (ENHANCED_INSPECTOR_FILES.length + 2);

  // Fail fast (and clearly) if the gem can't read the payload — e.g. a remote
  // stone whose gem doesn't share this machine's filesystem.
  const unreadable: string[] = [];
  for (const f of ENHANCED_INSPECTOR_FILES) {
    if (!(await gemCanRead(session, serverPath(f)))) unreadable.push(f);
  }
  if (unreadable.length > 0) {
    return {
      success: false,
      committed: false,
      verified: false,
      filedIn: [],
      keptDifferent: [],
      message:
        `The database's gem cannot read the payload files (${unreadable.join(', ')}) under ` +
        `${gemPayloadDir}. Server-side install requires a local stone whose gem shares this ` +
        'filesystem.',
    };
  }

  // Create + share the dedicated dictionary (and migrate any legacy Published
  // copies) before filing in, so the payload's `inDictionary: GsEnhancedInspector`
  // bareword resolves and nothing stale shadows the fresh classes. Then create
  // the file-in subclass and put the dictionary first for the file-in.
  onProgress('Preparing the GsEnhancedInspector dictionary…', stepIncrement);
  await yieldToEventLoop();
  try {
    await executeFetchString(session, PREPARE_DICTIONARY_SNIPPET);
  } catch (e: unknown) {
    safeAbort(session);
    return {
      success: false,
      committed: false,
      verified: false,
      filedIn: [],
      keptDifferent: [],
      message: `Could not create the GsEnhancedInspector dictionary: ${messageOf(e)}. No changes were committed.`,
    };
  }

  try {
    await executeFetchString(session, PREPARE_FILE_IN_SNIPPET);
  } catch (e: unknown) {
    safeAbort(session);
    return {
      success: false,
      committed: false,
      verified: false,
      filedIn: [],
      keptDifferent: [],
      message: `Could not prepare the file-in: ${messageOf(e)}. No changes were committed.`,
    };
  }

  const filedIn: string[] = [];
  for (const file of ENHANCED_INSPECTOR_FILES) {
    onProgress(`Filing in ${file}…`, stepIncrement);
    await yieldToEventLoop();
    try {
      await executeFetchString(
        session,
        // #serverUtf8File (not fromServerPath:) because the payload contains
        // UTF-8 test data (e.g. GtWireEncodingExamples' 'čtyři'). The plain
        // file-in reads the file as the repository's StringConfiguration
        // class, and on a stone in Unicode comparison mode any byte > 127
        // raises error 2710 before a single line is processed. The UTF-8
        // variant decodes correctly in both String and Unicode16 modes
        // (UTF-8 decode of the all-ASCII files is the identity).
        //
        // Must end in a String: executeFetchString sends #encodeAsUTF8 to the
        // result before fetching it, and a non-String result (e.g. the
        // boolean `true`) raises an error attempting that send.
        `${ENHANCED_INSPECTOR_FILE_IN_CLASS} fromPath: ${gsStringLiteral(serverPath(file))} on: #serverUtf8File to: nil. 'ok'`,
      );
      filedIn.push(file);
    } catch (e: unknown) {
      safeAbort(session);
      return {
        success: false,
        committed: false,
        verified: false,
        filedIn,
        keptDifferent: [],
        failedFile: file,
        message: `File-in of ${file} failed: ${messageOf(e)}. No changes were committed.`,
      };
    }
  }

  onProgress('Committing…', stepIncrement);
  await yieldToEventLoop();
  let keptDifferent: string[];
  try {
    keptDifferent = (await executeFetchString(session, RESTORE_ORDER_SNIPPET))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (e: unknown) {
    safeAbort(session);
    return {
      success: false,
      committed: false,
      verified: false,
      filedIn,
      keptDifferent: [],
      message: `Could not restore the symbol list order: ${messageOf(e)}. No changes were committed.`,
    };
  }
  const { success: committed, err } = session.gci.GciTsCommit(session.handle);
  if (!committed) {
    safeAbort(session);
    return {
      success: false,
      committed: false,
      verified: false,
      filedIn,
      keptDifferent: [],
      message: `Commit failed: ${err.message || `GCI error ${err.number}`}`,
    };
  }

  const verified = await isEnhancedInspectorInstalled(session);
  return {
    success: verified,
    committed: true,
    verified,
    filedIn,
    keptDifferent,
    message:
      (verified
        ? 'Enhanced inspector support installed and verified.'
        : 'Payload committed, but verification failed: the expected classes/methods ' +
          'were not found. The install may be incomplete.') + keptDifferentNote(keptDifferent),
  };
}
