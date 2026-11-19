/**
 * Server-side installation of Jasper's regular-expression support.
 *
 * A thin wrapper over the server-side `GsRegexLoader`, which the by-hand topaz
 * bootstrap (`resources/regex/load-regex.gs`) drives too. The client files in the
 * loader class, then sends `GsRegexLoader new ... loadFromServerDir:`. The loader
 * files in the payload, checks it, and commits on success or aborts on failure, so
 * this module never commits; it reports the loader's verdict.
 *
 * It follows `refactoringInstall.ts` step for step. The differences: nothing is
 * added to a kernel class, and the payload is small. SystemUser is still needed,
 * because the loader shares its dictionary into every user's symbol list.
 *
 * Server-side file-in needs a local stone (the gem reads the files itself); a
 * stone whose gem cannot read them is reported rather than failing cryptically.
 */
import { ActiveSession } from '../sessionManager';
import { executeFetchStringNb, checkRegexSupportAvailable } from '../browserQueries';
import { REGEX_LOADER_FILE, REGEX_PAYLOAD_FILES, REGEX_RECEIPT } from './regexPayload';
import { receiptFor } from '../serverPlugin/pluginFingerprint';
import {
  gemCanRead,
  gsStringLiteral,
  messageOf,
  safeAbort,
  toLocalGemPath,
  yieldToEventLoop,
} from '../serverPlugin/installHelpers';
import { supportsServerUtf8FileIn } from '../refactoring/refactoringInstall';

export interface RegexInstallResult {
  /** True when the loader committed: every completeness check passed. */
  success: boolean;
  /** The loader's completeness report (empty if it never got that far). */
  report: string;
  /** Human-readable summary, suitable for a notification. */
  message: string;
}

/** Reports incremental progress: a message plus a 0–100 increment for this step. */
export type ProgressReporter = (message: string, increment: number) => void;

/** True when the regex support is present in the stone reached by this session. */
export function isRegexSupportInstalled(session: ActiveSession): boolean {
  return checkRegexSupportAvailable(session);
}

/**
 * Install (or reinstall) the regex support into the stone.
 *
 * @param session     a SystemUser session.
 * @param payloadDir  absolute client-side path to `resources/regex/`; translated to
 *                    the gem's path here, so callers pass it untranslated.
 * @param onProgress  optional incremental progress callback.
 */
export async function installRegexSupport(
  session: ActiveSession,
  payloadDir: string,
  onProgress: ProgressReporter = () => {},
): Promise<RegexInstallResult> {
  const gemPayloadDir = toLocalGemPath(payloadDir);
  const sep = gemPayloadDir.endsWith('/') ? '' : '/';
  const serverPath = (file: string): string => `${gemPayloadDir}${sep}${file}`;

  const unreadable = REGEX_PAYLOAD_FILES.filter((f) => !gemCanRead(session, serverPath(f)));
  if (unreadable.length > 0) {
    return {
      success: false,
      report: '',
      message:
        `The database's gem cannot read the payload files (${unreadable.join(', ')}) under ` +
        `${gemPayloadDir}. Server-side install requires a local stone whose gem shares this ` +
        'filesystem.',
    };
  }

  let receipt;
  try {
    receipt = receiptFor(REGEX_RECEIPT, payloadDir);
  } catch (e: unknown) {
    return {
      success: false,
      report: '',
      message: `Could not read the regex payload in ${payloadDir}: ${messageOf(e)}.`,
    };
  }

  onProgress('Filing in the regex loader…', 25);
  await yieldToEventLoop();
  try {
    await executeFetchStringNb(
      session,
      'regex-filein-loader',
      `${fileInExpr(session, serverPath(REGEX_LOADER_FILE))}. 'ok'`,
    );
  } catch (e: unknown) {
    safeAbort(session);
    return {
      success: false,
      report: '',
      message: `Could not file in the regex loader: ${messageOf(e)}. No changes were committed.`,
    };
  }

  // The first line of the answer is the verdict (OK/FAIL); the rest is the report.
  onProgress('Loading and verifying regex support…', 75);
  await yieldToEventLoop();
  let raw: string;
  try {
    raw = await executeFetchStringNb(
      session,
      'regex-load',
      '| ldr | ' +
        'ldr := GsRegexLoader new. ' +
        `ldr receiptDigest: ${gsStringLiteral(receipt.digest)} ` +
        `installedBy: ${gsStringLiteral(receipt.installedBy)}. ` +
        `ldr loadFromServerDir: ${gsStringLiteral(gemPayloadDir)}. ` +
        "(ldr allOk ifTrue: ['OK'] ifFalse: ['FAIL']), (String with: Character lf), ldr reportString",
    );
  } catch (e: unknown) {
    safeAbort(session);
    return {
      success: false,
      report: '',
      message: `The regex loader did not run: ${messageOf(e)}. No changes were committed.`,
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
      ? 'Regex support installed and verified.'
      : 'Regex support did not install completely; the completeness check failed and nothing ' +
        'was committed. See the report for what was missing.',
  };
}

function fileInExpr(session: ActiveSession, serverPath: string): string {
  const literal = gsStringLiteral(serverPath);
  return supportsServerUtf8FileIn(session.stoneVersion)
    ? `GsFileIn fromPath: ${literal} on: #serverUtf8File to: nil`
    : `GsFileIn fromServerPath: ${literal}`;
}
