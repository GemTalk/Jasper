import type { TestContext } from 'vitest';
import type { ActiveSession } from '../sessionManager';
import { pluginFeature } from '../serverPlugin/pluginFeatures';

/**
 * Gates keyed off the shared plugin-feature registry (`pluginFeature(id)` from
 * `serverPlugin/pluginFeatures.ts`). Call one at the top of an integration test to
 * declare which runtime scenario the test applies to — feature present or feature
 * absent — and skip it, with a reason, when the connected stone isn't in that
 * scenario. This lets each CI pass (bare stone vs. plugin-installed stone) run
 * exactly the subset of tests that make sense for it: inapplicable tests report as
 * skipped rather than failing.
 *
 * Both gates decide live against the connected session — version applicability plus
 * a live presence probe — so no phase or environment flag is involved. The stone
 * version is resolved from the session's GCI handle, since the synthesized
 * integration `session()` carries no `stoneVersion`.
 */
const stoneVersionOf = (session: ActiveSession): string => session.gci.GciTsVersion().version;

/**
 * Present-world gate: call at the top of a test that only applies when `id`'s
 * server plugin feature IS present, so the test exercises the feature's behavior.
 * Skips when the stone version can't support the feature at all, or when it is
 * supported but not currently installed.
 */
export function requireServerPluginFeature(
  id: string,
  ctx: TestContext,
  session: ActiveSession,
): void {
  const feature = pluginFeature(id);

  ctx.skip(
    !feature.isApplicable(stoneVersionOf(session)),
    `skipping: ${feature.label} is not supported by this stone version, so this test does not apply to the current scenario`,
  );
  ctx.skip(
    !feature.probe(session),
    `skipping: ${feature.label} is not installed in this stone; this test only applies when the feature is present`,
  );
}

/**
 * Absent-world gate: call at the top of a test that only applies when `id`'s server
 * plugin feature is ABSENT — the tests asserting graceful degradation / fallback
 * behavior. Skips when the feature is actually present, since that behavior no
 * longer applies.
 */
export function requireServerPluginFeatureAbsent(
  id: string,
  ctx: TestContext,
  session: ActiveSession,
): void {
  const feature = pluginFeature(id);

  const present = feature.isApplicable(stoneVersionOf(session)) && feature.probe(session);
  ctx.skip(
    present,
    `skipping: ${feature.label} is installed; this test only applies to the absent/degraded scenario, which does not match the current context`,
  );
}
