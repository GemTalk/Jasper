// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement and the reasoning behind it.
//
// The one place the Tonel test tier decides whether it can run. Written once so
// no individual suite can get the condition subtly wrong, and so every rowan3
// suite switches on together.
//
// It skips on CAPABILITY, never on environment. No suite may ask "am I in CI?",
// "is this the default test stone?", or "is this 3.7.5?" — it asks whether the
// machinery the feature drives is present in THIS session. Jasper runs no CI
// test against a rowan3 stone today (`gs-reset-extent.sh` always copies the
// pristine base `extent0.dbf`, and every entry in
// `.gemstone-integration-releases.json` is a base extent), so these suites skip
// in CI and are developer-run against a rowan3 stone. The day that changes —
// rowan3 added to CI, or rowan3 machinery reaching the base extent — they begin
// running on their own.
//
// A skip is a NON-RESULT, not a pass: a green `npm test` on a base extent says
// nothing whatsoever about the Tonel feature. When verifying this feature, run
// against a rowan3 stone and confirm these suites actually executed.
//
// It deliberately does NOT re-login as SystemUser
// ------------------------------------------------
// The Rowan dictionaries (RowanKernel, RowanTools, ...) are in SystemUser's
// symbol list and not in DataCurator's, so an earlier version of this helper
// swapped to a SystemUser session to see them. It no longer does, and the
// difference is the point: the feature is required to work for DataCurator, so
// `../rowanLookup` reaches through to those dictionaries and the suites run as
// the harness's ordinary configured user.
//
// Running as DataCurator is therefore load-bearing, not incidental — it is what
// proves the reach-through actually works for the user who needs it. A suite
// that quietly swapped to SystemUser would pass while the shipped feature stayed
// invisible to everyone else.
import { beforeAll } from 'vitest';
import { QueryExecutor } from '../../types';
import { tonelCapability } from '../tonelCapability';

/** What a suite needs in order to decide whether to run. */
export interface Rowan3Gate {
  /** Whether every Tonel capability is present in this session. */
  readonly available: boolean;
  /** Capabilities that are absent — named, so a failure is actionable. */
  readonly missing: readonly string[];
  /** Skip this test unless the session can actually exercise the feature. */
  skipUnlessAvailable(ctx: { skip: () => void }): void;
}

/**
 * Probe the connected stone once per suite and answer the gate.
 *
 * Call inside a `describe`, after `useIntegrationTest`, passing a getter for the
 * executor — no session exists when `describe` is evaluated.
 */
export function useRowan3Stone(executor: () => QueryExecutor): Rowan3Gate {
  const state = { available: false, missing: [] as readonly string[] };

  // Registered after the harness's own beforeAll, so a session is already logged
  // in — as the configured user, deliberately not swapped (see header).
  beforeAll(() => {
    const result = tonelCapability(executor());
    state.available = result.available;
    state.missing = result.missing;
  });

  return {
    get available() {
      return state.available;
    },
    get missing() {
      return state.missing;
    },
    skipUnlessAvailable(ctx) {
      if (!state.available) ctx.skip();
    },
  };
}
