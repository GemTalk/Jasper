/**
 * Orchestrates a full server-plugin uninstall over an already-elevated SystemUser
 * session: removes every plugin feature currently present on the stone, then
 * verifies that nothing is left behind.
 *
 * The mirror of `installServerPlugin`, and deliberately `vscode`-free and
 * elevation-free for the same reasons: the provisioning script
 * (`bin/uninstall-server-plugin.mjs`) drives it from a plain Node process, while
 * the interactive command path elevates to SystemUser differently. Removal takes
 * no payload directory — each feature expresses its removal as inline Smalltalk —
 * so there is no `rootDir` counterpart here.
 *
 * `pluginFeatures.ts` stays pure registry data; this file owns the
 * uninstall-all + verify orchestration, so the loop stays feature-agnostic and a
 * feature added to the registry is picked up here for free.
 */
import { ActiveSession } from '../sessionManager';
import { PLUGIN_FEATURES } from './pluginFeatures';

/**
 * Remove every plugin feature present on the stone reached by `session`, then
 * verify none remains.
 *
 * Features are removed in REVERSE registry order — the registry is in file-in
 * (dependency) order, so unwinding back-to-front takes dependants out before the
 * things they depend on.
 *
 * A feature that is already absent is skipped rather than treated as an error,
 * which keeps the whole operation idempotent: running it twice, or against a
 * stone that was only partly provisioned, succeeds instead of failing on the
 * second pass.
 *
 * @param session    an ActiveSession ALREADY elevated to SystemUser by the caller.
 * @param onProgress optional sink for human-readable progress lines; the caller
 *                   owns the actual printing.
 *
 * Throws if any feature's removal fails, or if a feature is still detected
 * afterwards — the same loud-failure posture as the install path, so a partial
 * uninstall can't masquerade downstream as a clean stone.
 */
export async function uninstallServerPlugin(
  session: ActiveSession,
  onProgress?: (message: string) => void,
): Promise<void> {
  const report = (message: string) => onProgress?.(message);

  for (const feature of [...PLUGIN_FEATURES].reverse()) {
    if (!feature.probe(session)) {
      report(`${feature.label} is not installed — skipping.`);
      continue;
    }
    report(`Uninstalling ${feature.label}…`);
    const result = await feature.uninstall(session, (message) => report(`  ${message}`));
    if (!result.success) {
      throw new Error(`${feature.label} uninstall failed: ${result.message}`);
    }
  }

  // Verify the stone is actually clean. A feature whose removal reported success
  // but whose probe still answers true means the removal did not take (or did not
  // commit), which must fail here rather than downstream.
  const remaining = PLUGIN_FEATURES.filter((f) => f.probe(session)).map((f) => f.label);
  if (remaining.length > 0) {
    throw new Error(`Still installed after uninstall: ${remaining.join('; ')}`);
  }
}
