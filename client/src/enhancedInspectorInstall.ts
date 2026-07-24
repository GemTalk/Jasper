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
 * The payload installs persistent classes (into Published) plus extension
 * methods on kernel classes, so the session passed here must have write access
 * to those kernel classes — in practice a SystemUser session (set up by the
 * caller; this module is agnostic about how the session was obtained).
 *
 * Server-side file-in requires the gem to be able to read the files, i.e. share
 * a filesystem with them (a local stone). Remote stones are detected and
 * reported rather than failing cryptically.
 */
import { ActiveSession } from './sessionManager';
import { executeFetchString } from './browserQueries';
import { compareGemStoneVersions } from './gemStoneVersion';

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
 * The payload files, in dependency order — must match the `input` order in
 * docs/enhancedInspectorSupport/load_enhanced_inspector_support.sh. The files themselves live in
 * resources/enhancedInspector/. Earlier files define classes and behavior that
 * later files depend on.
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
 * Resolution walks the session's symbol list, so this works whether the
 * classes were installed into `Published` or `Globals`.
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
 * @param payloadDir  absolute path to the directory holding the `.gs` files,
 *                    readable by the gem (a local stone).
 * @param onProgress  optional incremental progress callback.
 */
export async function installEnhancedInspectorSupport(
  session: ActiveSession,
  payloadDir: string,
  onProgress: ProgressReporter = () => {},
): Promise<InstallResult> {
  const sep = payloadDir.endsWith('/') ? '' : '/';
  const serverPath = (file: string): string => `${payloadDir}${sep}${file}`;
  // 7 files + the commit step.
  const stepIncrement = 100 / (ENHANCED_INSPECTOR_FILES.length + 1);

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
        `${payloadDir}. Server-side install requires a local stone whose gem shares this ` +
        'filesystem.',
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

/** Whether the gem process can read the file at `serverPath`. */
function gemCanRead(session: ActiveSession, serverPath: string): boolean {
  try {
    const r = executeFetchString(
      session,
      `[(GsFile existsOnServer: ${gsStringLiteral(serverPath)}) printString] ` +
        "on: Error do: [:e | 'false']",
    );
    return r.trim() === 'true';
  } catch {
    return false;
  }
}

/** Render a JS string as a GemStone string literal: single quotes doubled and
 *  the whole value wrapped in quotes. Named distinctly from systemBrowser.ts's
 *  `smalltalkString`, which only escapes (it does not wrap). */
function gsStringLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Yield to the event loop so the progress notification can paint between the
 *  per-file (synchronous) server calls. */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function safeAbort(session: ActiveSession): void {
  try {
    session.gci.GciTsAbort(session.handle);
  } catch {
    // Best-effort rollback; the caller closes the session regardless.
  }
}

/** Extract a human-readable message from a thrown value. Shared with
 *  enhancedInspectorCommand.ts. */
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
