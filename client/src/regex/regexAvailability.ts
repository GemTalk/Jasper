/**
 * Whether the session's stone has the server plugin's regex support, cached on the
 * session's `regexSupportAvailable` flag. Latched at login and again after an
 * install or uninstall. Not version-gated: the support loads on every supported
 * release (3.6.2 and later).
 */
import { ActiveSession } from '../sessionManager';
import { probeRegexSupport } from '../browserQueries';

/** Re-probe the session, cache the answer on it, and return it. A probe that could not ask
 *  the stone (a busy session) leaves the cached answer as it was: it must not turn an
 *  installed support into "not installed" and grey out GemStone Search's `.*`. */
export function refreshRegexSupportAvailable(session: ActiveSession): boolean {
  const found = probeRegexSupport(session);
  if (found !== undefined) session.regexSupportAvailable = found;
  return session.regexSupportAvailable === true;
}
