/**
 * Server-side installation of the Jasper refactoring engine.
 *
 * Thin client wrapper over the server-side `GsRefactoringLoader` — the single
 * source of truth for the load mechanism, which the by-hand topaz runbook
 * (`gs-src/refactoring/LOADING.md`) drives too. The client only has to:
 *   1. file in the loader class (`refactoring-loader.gs`), then
 *   2. send `GsRefactoringLoader loadFromServerDir: <payloadDir>`.
 * The loader does the rest inside the gem: create the dedicated `GsRefactoring`
 * dictionary, file in the AST substrate / feature-detected compat backports /
 * engine / manifest in dependency order, run a completeness check, and
 * COMMIT on success or ABORT on any failure. So — unlike the Enhanced Inspector
 * installer — this module never commits: the loader owns that decision, and we
 * just surface its report.
 *
 * Why server-side `GsFileIn` rather than client-side per-method compilation: the
 * AST payload alone is ~60 classes / ~1,200 methods. `GsFileIn` compiles each
 * file inside the gem in ~one call, so the extension host stays responsive.
 *
 * The engine installs the compat backports as extensions on kernel classes, so
 * the session passed here must have write access to them — in practice a
 * SystemUser session (the caller sets that up; this module is agnostic about
 * how the session was obtained).
 *
 * Server-side file-in requires the gem to read the files, i.e. share a
 * filesystem with them (a local stone). Remote stones are detected and reported
 * rather than failing cryptically.
 *
 * Unlike the Enhanced Inspector, refactoring support is NOT version-gated: the
 * engine and loader are built to load on every supported release (3.6.2 through
 * 3.7.5+). The only version-dependent choice here is the `GsFileIn` signature
 * used to file in the loader class itself (see `installRefactoringSupport`).
 */
import { ActiveSession } from '../sessionManager';
import { executeFetchString, checkRefactoringSupportAvailable } from '../browserQueries';
import { compareGemStoneVersions } from '../gemStoneVersion';
import {
  gemCanRead,
  gsStringLiteral,
  messageOf,
  safeAbort,
  yieldToEventLoop,
} from '../serverPlugin/installHelpers';

/**
 * The bootstrap file the client files in itself: it defines `GsRefactoringLoader`
 * (into UserGlobals) and nothing else. Everything after it is filed in by the
 * loader, server-side, in dependency order.
 */
export const REFACTORING_LOADER_FILE = 'refactoring-loader.gs';

/**
 * Every payload file the gem must be able to read: the loader bootstrap plus the
 * four files `GsRefactoringLoader` files in itself. Used only for the
 * gem-can-read precheck — the client hands the loader the directory and lets it
 * read the rest.
 */
export const REFACTORING_PAYLOAD_FILES: readonly string[] = [
  REFACTORING_LOADER_FILE,
  'ast-core.gs',
  'compat.gs',
  'engine.gs',
  'manifest.gs',
];

/**
 * First release whose `GsFileIn` understands `#serverUtf8File`. Below it, the
 * `to:` argument is a Boolean and `#serverUtf8File` does not exist, so we use the
 * plain `fromServerPath:` form. The payload is ASCII, so either form reads it
 * correctly; this only selects a signature that exists. Mirrors the loader's own
 * `useUtf8FileIn`, but decided on the client from the already-known stone
 * version — reading the version by String key over the GCI is unsafe on pre-3.7.5
 * stones (the literal compiles as Unicode and mis-compares), which is exactly why
 * the loader reads it in a filed-in method instead.
 */
const SERVER_UTF8_FILEIN_MIN_VERSION = '3.7';

export interface RefactoringInstallResult {
  /** True when the loader committed — i.e. every completeness check passed. */
  success: boolean;
  /** The loader's completeness report, for display (empty if the run never got
   *  far enough to produce one). */
  report: string;
  /** Human-readable summary, suitable for a notification. */
  message: string;
}

/** Reports incremental progress: a message plus a 0–100 increment for this step. */
export type ProgressReporter = (message: string, increment: number) => void;

/**
 * True when the server-side refactoring engine is present and usable in the
 * stone reached by this session. Delegates to the same probe the availability
 * latch uses, so "installed" and "available" never diverge.
 */
export function isRefactoringSupportInstalled(session: ActiveSession): boolean {
  return checkRefactoringSupportAvailable(session);
}

/**
 * Install (or re-install) the refactoring engine into the stone.
 *
 * Files in the loader class, then drives it. The loader is idempotent and
 * commits on success / aborts on failure entirely on the server, so this method
 * does not commit — a failed load leaves the stone untouched. On success the
 * engine is committed and the loader's completeness check has already passed.
 *
 * @param session     a session with write access to kernel classes (SystemUser).
 * @param payloadDir  absolute path to `resources/refactoring/`, readable by the
 *                    gem (a local stone).
 * @param onProgress  optional incremental progress callback.
 */
export async function installRefactoringSupport(
  session: ActiveSession,
  payloadDir: string,
  onProgress: ProgressReporter = () => {},
): Promise<RefactoringInstallResult> {
  const sep = payloadDir.endsWith('/') ? '' : '/';
  const serverPath = (file: string): string => `${payloadDir}${sep}${file}`;

  // Fail fast (and clearly) if the gem can't read the payload — e.g. a remote
  // stone whose gem doesn't share this machine's filesystem.
  const unreadable = REFACTORING_PAYLOAD_FILES.filter((f) => !gemCanRead(session, serverPath(f)));
  if (unreadable.length > 0) {
    return {
      success: false,
      report: '',
      message:
        `The database's gem cannot read the payload files (${unreadable.join(', ')}) under ` +
        `${payloadDir}. Server-side install requires a local stone whose gem shares this ` +
        'filesystem.',
    };
  }

  // Step 1: file in the loader class. Two logical steps (file-in, then run) plus
  // the loader's own work, which reports through the run.
  onProgress('Filing in the refactoring loader…', 25);
  await yieldToEventLoop();
  try {
    executeFetchString(
      session,
      // Must end in a byte object (a String): executeFetchString fetches the
      // result via GciTsExecuteFetchBytes, so a non-byte result raises 2103.
      `${fileInExpr(session, serverPath(REFACTORING_LOADER_FILE))}. 'ok'`,
    );
  } catch (e: unknown) {
    safeAbort(session);
    return {
      success: false,
      report: '',
      message: `Could not file in the refactoring loader: ${messageOf(e)}. No changes were committed.`,
    };
  }

  // Step 2: run the loader. It files in the AST/compat/engine/manifest payloads,
  // runs the completeness check, and commits on success / aborts on failure —
  // all inside the gem. We fetch its verdict (OK/FAIL) and full report in one
  // round trip: the first line is the verdict, the rest is the report to show.
  onProgress('Loading and verifying the refactoring engine…', 75);
  await yieldToEventLoop();
  let raw: string;
  try {
    raw = executeFetchString(
      session,
      '| ldr | ' +
        `ldr := GsRefactoringLoader loadFromServerDir: ${gsStringLiteral(payloadDir)}. ` +
        "(ldr allOk ifTrue: ['OK'] ifFalse: ['FAIL']), (String with: Character lf), ldr reportString",
    );
  } catch (e: unknown) {
    // The loader aborts on its own failures, but a failure to even run it (e.g.
    // the session dropped) leaves the loader file-in uncommitted — roll it back.
    safeAbort(session);
    return {
      success: false,
      report: '',
      message: `The refactoring loader did not run: ${messageOf(e)}. No changes were committed.`,
    };
  }

  const newline = raw.indexOf('\n');
  const verdict = (newline === -1 ? raw : raw.slice(0, newline)).trim();
  const report = newline === -1 ? '' : raw.slice(newline + 1);
  const success = verdict === 'OK';
  return {
    success,
    report,
    message: success
      ? 'Refactoring engine installed and verified.'
      : 'The refactoring engine did not install completely; the completeness check failed and ' +
        'nothing was committed. See the report for what was missing.',
  };
}

/**
 * The `GsFileIn` expression for `serverPath`, choosing the signature that exists
 * on this stone's release. See `SERVER_UTF8_FILEIN_MIN_VERSION`.
 */
function fileInExpr(session: ActiveSession, serverPath: string): string {
  const literal = gsStringLiteral(serverPath);
  return supportsServerUtf8FileIn(session.stoneVersion)
    ? `GsFileIn fromPath: ${literal} on: #serverUtf8File to: nil`
    : `GsFileIn fromServerPath: ${literal}`;
}

/**
 * True when `stoneVersion` is `SERVER_UTF8_FILEIN_MIN_VERSION` (3.7) or later, so
 * `GsFileIn fromPath:on:#serverUtf8File to:` is available. Extracts the leading
 * numeric token from the raw `GciTsVersion` string (which may carry a build
 * suffix) and compares semantically; a missing or unparseable version falls back
 * to the older `fromServerPath:` form, which exists on every supported release.
 */
export function supportsServerUtf8FileIn(stoneVersion: string | undefined): boolean {
  const numeric = stoneVersion?.match(/^\d+\.\d+(\.\d+){0,2}/)?.[0];
  if (!numeric) return false;
  const padded = numeric.split('.').length < 3 ? `${numeric}.0` : numeric;
  try {
    return compareGemStoneVersions(padded, `${SERVER_UTF8_FILEIN_MIN_VERSION}.0`) >= 0;
  } catch {
    return false;
  }
}
