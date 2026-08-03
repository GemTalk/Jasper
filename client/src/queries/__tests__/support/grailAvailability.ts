import type { TestContext } from 'vitest';
import { QueryExecutor } from '../../types';
import { isGrailInstalled } from '../../python';

/**
 * Gates keyed off whether the Grail package is installed in the connected stone. Call
 * one of these at the top of a test to declare which scenario it applies to — Grail
 * present or Grail absent — and skip it, with a reason, when the connected stone
 * isn't in that scenario. This lets present/absent behavior be split into separately
 * gated tests: inapplicable tests report as skipped rather than failing.
 *
 * Both gates decide live against the connected session via `isGrailInstalled`, so no
 * phase or environment flag is involved.
 */

/**
 * Present-world gate: call at the top of a test that only applies when Grail IS
 * installed, so the test exercises Grail-dependent behavior.
 */
export function requireGrail(ctx: TestContext, execute: QueryExecutor): void {
  ctx.skip(
    !isGrailInstalled(execute),
    'skipping: Grail is not installed; this test only applies when Grail is present',
  );
}

/**
 * Absent-world gate: call at the top of a test that only applies when Grail is
 * ABSENT — the tests asserting fallback/degraded behavior without Grail.
 */
export function requireGrailAbsent(ctx: TestContext, execute: QueryExecutor): void {
  ctx.skip(
    isGrailInstalled(execute),
    'skipping: Grail is installed; this test only applies to the absent scenario',
  );
}
