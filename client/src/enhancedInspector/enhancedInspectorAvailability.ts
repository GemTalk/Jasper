/**
 * Shared "enhanced inspector availability" latch.
 *
 * Probes whether the session's stone has the enhanced inspector support loaded
 * and caches the result on the session's `enhancedInspectorAvailable` flag,
 * which "Inspect It" routing (see inspectRouter.ts) reads to choose the Enhanced
 * Inspector vs. the basic tabbed Inspector. Used at login and again after an install
 * refresh, so routing reflects a fresh install without a reconnect.
 */
import { ActiveSession } from '../sessionManager';
import { checkEnhancedInspectorAvailable } from '../browserQueries';
import { supportsEnhancedInspector } from './enhancedInspectorInstall';

/** Re-probe the session and cache `enhancedInspectorAvailable` on it. Returns
 *  the freshly-probed value.
 *
 *  Stones older than the supported minimum never route to the Enhanced
 *  Inspector — even if the support classes happen to be present (e.g. a shared
 *  stone, or one installed by an older build) — because the inspector returns no
 *  views there. Short-circuit to false without probing so routing
 *  (see inspectRouter.ts) falls back to the basic tabbed Inspector. */
export function refreshEnhancedInspectorAvailable(session: ActiveSession): boolean {
  session.enhancedInspectorAvailable =
    supportsEnhancedInspector(session.stoneVersion) && checkEnhancedInspectorAvailable(session);
  return session.enhancedInspectorAvailable;
}
