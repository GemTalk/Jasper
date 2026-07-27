/**
 * Orchestrates a full server-plugin install over an already-elevated SystemUser
 * session: files in every plugin feature applicable to the stone's version, then
 * re-verifies the version→feature contract.
 *
 * Deliberately `vscode`-free and elevation-free. The CI provisioning script
 * (`bin/install-server-plugin.mjs`) drives it from a plain Node process, and the
 * interactive command path elevates to SystemUser differently (a per-feature
 * prompt), so this function takes an already-elevated session and leaves the
 * printing to the caller via `onProgress`. `pluginFeatures.ts` stays pure
 * registry data; this file owns the install-all + verify orchestration.
 */
import * as path from 'path';
import { ActiveSession } from '../sessionManager';
import { PLUGIN_FEATURES } from './pluginFeatures';

/**
 * Install every applicable plugin feature into the stone reached by `session`,
 * then verify the version→feature contract.
 *
 * @param session   an ActiveSession ALREADY elevated to SystemUser by the caller.
 * @param rootDir   extension/repo root; each feature's payload is at
 *                  `rootDir/<feature.payloadSubdir>`.
 * @param onProgress optional sink for human-readable progress lines; the caller
 *                   owns the actual printing (this function keeps console/vscode
 *                   out).
 *
 * Throws if any applicable feature's install fails, or if the post-install
 * contract check finds a feature whose live presence disagrees with whether its
 * version supports it — the regression guard the two-pass CI workflow relies on:
 * a silently-broken install fails here, loudly, rather than masquerading
 * downstream as an indistinguishable "feature absent" skip.
 */
export async function installServerPlugin(
  session: ActiveSession,
  rootDir: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  const report = (message: string) => onProgress?.(message);
  const version = session.stoneVersion;

  // Install every feature applicable to this stone version. The registry
  // (pluginFeatures.ts) is the single source of truth for the feature list,
  // each feature's payload location, its version gate, and how it files in —
  // so this loop stays feature-agnostic.
  for (const feature of PLUGIN_FEATURES) {
    if (!feature.isApplicable(version)) {
      report(`Stone version ${version} does not support ${feature.label} — skipping.`);
      continue;
    }
    report(`Installing ${feature.label}…`);
    const result = await feature.install(
      session,
      path.join(rootDir, feature.payloadSubdir),
      (message) => report(`  ${message}`),
    );
    if (result.report) report(result.report);
    if (!result.success) {
      throw new Error(`${feature.label} install failed: ${result.message}`);
    }
  }

  // Re-verify the version→feature contract: each feature must be present iff it
  // applies to this version. This is the regression guard the two-pass CI
  // workflow relies on — a silently-broken install fails here, loudly, rather
  // than masquerading downstream as an indistinguishable "feature absent" skip.
  const problems: string[] = [];
  for (const feature of PLUGIN_FEATURES) {
    const expected = feature.isApplicable(version);
    const installed = feature.probe(session);
    if (installed !== expected) {
      problems.push(
        `${feature.label} installed=${installed} but version ${version} expects installed=${expected}`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(`Version→feature contract violated: ${problems.join('; ')}`);
  }
}
