/**
 * Server-side installation of Enhanced Inspector support.
 *
 * Files the vendored enhanced inspector support `.gs` payload into a stone over a GCI session.
 * Each file is filed in with a single server-side
 * `GsFileIn fromPath:on:#serverUtf8File to:` call (the gem reads and compiles
 * the file itself), in the dependency order the topaz loader uses, then the
 * work is committed and verified.
 *
 * Why server-side `GsFileIn` rather than client-side per-method compilation:
 * the payload is ~520 classes and ~3,700 methods. Compiling each over the GCI
 * one round-trip at a time blocks the extension host for thousands of
 * synchronous calls — long enough to freeze the UI and trip VS Code's
 * unresponsiveness watchdog. `GsFileIn` does all of that work inside the gem in
 * ~one call per file (near-instant), and yields between files keep the host
 * responsive and the progress notification live.
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
 * The vendored GT payload requires kernel classes that only exist in 3.7+
 * (e.g. `GcFinalizeNotification`), and — more subtly — on stones before 3.7.5
 * string literals in GCI-compiled queries compile as Unicode, which the
 * platform refuses to `=`-compare against the byte-String dictionary keys the
 * payload builds. That mismatch makes the inspector return no views. 3.7.5 is
 * the first release where the whole pipeline (install + views) works, so we gate
 * on it rather than trying to paper over the platform behavior.
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
 * filing in, exactly as the refactoring loader does. Isolating the classes here
 * (rather than commingling them in the shared `Published` dictionary, as an
 * earlier build did) means the whole payload can be removed cleanly by dropping
 * this one dictionary from every symbol list.
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
 * (e.g. "3.7.5 build ..."). We extract the leading `x.y.z[.w]` token before
 * comparing — `compareGemStoneVersions` requires a bare numeric string and would
 * otherwise throw on the suffix (and fail closed, blocking a supported stone).
 */
export function supportsEnhancedInspector(stoneVersion: string | undefined): boolean {
  // Extract the leading numeric version: major.minor with optional patch and
  // build segments — "3.7.5", "3.7.5.1", or a future short form like "4.0" —
  // ignoring any trailing build/description suffix from GciTsVersion.
  const numeric = stoneVersion?.match(/^\d+\.\d+(\.\d+){0,2}/)?.[0];
  if (!numeric) return false;
  // compareGemStoneVersions requires 3–4 numeric segments; pad a short version
  // (e.g. "4.0" -> "4.0.0") so it compares cleanly instead of throwing.
  const padded = numeric.split('.').length < 3 ? `${numeric}.0` : numeric;
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
 * It also MIGRATES a stone installed by the earlier `Published`-placement build:
 * any GToolkit-categorized class still sitting in the shared `Published`
 * dictionary is removed, so the freshly filed-in copies in `GsEnhancedInspector`
 * (added at the end of the symbol list) are not shadowed by stale earlier-in-list
 * copies, and nothing is left behind to survive a later dictionary-drop uninstall.
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
"Legacy migration ONLY. Gate on a marker the earlier build is known to have bound INTO
 Published -- not on the mere presence of a GToolkit-categorized class -- so a stone that
 never carried the old placement is never swept. On a fresh install this whole branch is
 skipped, which is the common case and the one where an over-broad sweep could only do harm."
(pub notNil and: [pub includesKey: #GtRemotePhlowViewedObject]) ifTrue: [
	pub keys asArray do: [:k |
		| v |
		v := pub at: k ifAbsent: [nil].
		"NB the class categories are a BARE 'GToolkit-...' ('GToolkit-RemotePhlow-DeclarativeViews'
		 and friends); only the payload's EXTENSION-METHOD categories carry the leading '*'. So the
		 uninstall snippet's '*GToolkit' anchor cannot be reused here -- it would match no class and
		 silently skip the migration. The residual risk (a user's own Published class filed under a
		 GToolkit... category) is accepted because the gate above means this only runs on a stone
		 that demonstrably carried the old placement."
		((v isKindOf: Class)
			and: [((v category ifNil: ['']) asString beginsWith: 'GToolkit-')])
				ifTrue: [ pub removeKey: k ] ] ].
'ok'`;

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
  /** Human-readable summary, suitable for surfacing to the user. */
  message: string;
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
export function isEnhancedInspectorInstalled(session: ActiveSession): boolean {
  try {
    const result = executeFetchString(
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
  const unreadable = ENHANCED_INSPECTOR_FILES.filter((f) => !gemCanRead(session, serverPath(f)));
  if (unreadable.length > 0) {
    return {
      success: false,
      committed: false,
      verified: false,
      filedIn: [],
      message:
        `The database's gem cannot read the payload files (${unreadable.join(', ')}) under ` +
        `${gemPayloadDir}. Server-side install requires a local stone whose gem shares this ` +
        'filesystem.',
    };
  }

  // Create + share the dedicated dictionary (and migrate any legacy Published
  // copies) before filing in, so the payload's `inDictionary: GsEnhancedInspector`
  // bareword resolves and nothing stale shadows the fresh classes.
  onProgress('Preparing the GsEnhancedInspector dictionary…', stepIncrement);
  await yieldToEventLoop();
  try {
    executeFetchString(session, PREPARE_DICTIONARY_SNIPPET);
  } catch (e: unknown) {
    safeAbort(session);
    return {
      success: false,
      committed: false,
      verified: false,
      filedIn: [],
      message: `Could not create the GsEnhancedInspector dictionary: ${messageOf(e)}. No changes were committed.`,
    };
  }

  const filedIn: string[] = [];
  for (const file of ENHANCED_INSPECTOR_FILES) {
    onProgress(`Filing in ${file}…`, stepIncrement);
    await yieldToEventLoop();
    try {
      executeFetchString(
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
        `GsFileIn fromPath: ${gsStringLiteral(serverPath(file))} on: #serverUtf8File to: nil. 'ok'`,
      );
      filedIn.push(file);
    } catch (e: unknown) {
      safeAbort(session);
      return {
        success: false,
        committed: false,
        verified: false,
        filedIn,
        failedFile: file,
        message: `File-in of ${file} failed: ${messageOf(e)}. No changes were committed.`,
      };
    }
  }

  onProgress('Committing…', stepIncrement);
  await yieldToEventLoop();
  const { success: committed, err } = session.gci.GciTsCommit(session.handle);
  if (!committed) {
    safeAbort(session);
    return {
      success: false,
      committed: false,
      verified: false,
      filedIn,
      message: `Commit failed: ${err.message || `GCI error ${err.number}`}`,
    };
  }

  const verified = isEnhancedInspectorInstalled(session);
  return {
    success: verified,
    committed: true,
    verified,
    filedIn,
    message: verified
      ? 'Enhanced inspector support installed and verified.'
      : 'Payload committed, but verification failed: the expected classes/methods ' +
        'were not found. The install may be incomplete.',
  };
}
