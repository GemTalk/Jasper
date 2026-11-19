/**
 * Whether the session's stone has the server plugin's regex support, cached on the
 * session's `regexSupportAvailable` flag. Latched at login and again after an
 * install or uninstall. Not version-gated: the support loads on every supported
 * release (3.6.2 and later).
 */
import { ActiveSession } from '../sessionManager';
import { checkRegexSupportAvailable } from '../browserQueries';

/** Re-probe the session, cache the answer on it, and return it. */
export function refreshRegexSupportAvailable(session: ActiveSession): boolean {
  session.regexSupportAvailable = checkRegexSupportAvailable(session);
  return session.regexSupportAvailable;
}
