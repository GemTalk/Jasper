/**
 * Shared "refactoring support availability" latch.
 *
 * Probes whether the session's stone has the server-side refactoring engine
 * loaded and caches the result on the session's `rbSupportAvailable` flag. The
 * Explorer's rename-instance-variable command reads it to decide between running
 * the refactoring and offering to load the (optional, separately-installed)
 * engine payload. Latched at login and again after an install, so the command
 * reflects a fresh install without a reconnect.
 *
 * Unlike the Enhanced Inspector, refactoring support is NOT version-gated: the
 * engine is designed to load on every supported stone (3.6.2 through 3.7.5+), so
 * availability is purely "is the engine present in this stone".
 */
import { ActiveSession } from '../sessionManager';
import { checkRefactoringSupportAvailable } from '../browserQueries';

/** Re-probe the session and cache `rbSupportAvailable` on it. Returns the
 *  freshly-probed value. */
export async function refreshRefactoringSupportAvailable(session: ActiveSession): Promise<boolean> {
  session.rbSupportAvailable = await checkRefactoringSupportAvailable(session);
  return session.rbSupportAvailable;
}
