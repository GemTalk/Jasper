import type { TestContext } from 'vitest';
import type { ActiveSession } from '../sessionManager';
import { compareGemStoneVersions, isComparableGemStoneVersion } from '../gemStoneVersion';

/**
 * A GemStone defect that a test is known to trip, and the releases it is known
 * to be in.
 *
 * Each `brokenIn` range runs `from` one release `through` another, both
 * included, and `through` is the last release *observed* broken, never a
 * guessed fix. A release past every range runs the test again, so the first
 * release carrying the fix turns the test green with nobody watching for it,
 * while one still carrying the defect fails loudly — that failure is the cue to
 * extend a range, not a regression. It is a list because GemStone ships one fix
 * on several release lines at once: fixed in 3.7.7 but not in 3.8.0 needs a
 * second range, which one upper bound cannot say.
 */
export interface KnownGemStoneBug {
  /** Why the test skips, as it appears in the skip report. */
  readonly description: string;
  /** The gem's `System gemVersionAt: #osName` (`'Darwin'`, `'Linux'`); absent means every OS. */
  readonly osName?: string;
  readonly brokenIn: readonly { readonly from: string; readonly through: string }[];
}

export const knownGemStoneBugs = {
  /**
   * On the macOS 3.7 builds, resuming from a method breakpoint on a `to:do:`
   * loop's step point never advances: every resume answers 6006 (a stack
   * breakpoint "on return") at that same step. Plain `topaz -l` shows it, so no
   * Jasper code is involved; 3.6.x and the other platforms resume normally.
   */
  resumeStuckAtLoopStep: {
    description:
      'GemStone bug 52165 (GemTalk/Jasper#804): on macOS 3.7, resuming from a breakpoint stops again with error 6006 at the same step instead of advancing',
    osName: 'Darwin',
    brokenIn: [{ from: '3.7.0', through: '3.7.6' }],
  },
} satisfies Record<string, KnownGemStoneBug>;

/**
 * Is `version` inside one of the bug's ranges? A version that can't be compared
 * counts as not broken, so the test runs: a surprise version string then shows
 * up as a real result rather than quietly skipping the test.
 */
export function isVersionKnownBroken(bug: KnownGemStoneBug, version: string): boolean {
  if (!isComparableGemStoneVersion(version)) return false;
  return bug.brokenIn.some(
    ({ from, through }) =>
      compareGemStoneVersions(version, from) >= 0 && compareGemStoneVersions(version, through) <= 0,
  );
}

/**
 * Call at the top of a test that trips `bug`: skips it, with the bug as the
 * reason, when the connected gem is a release and OS the bug is known to affect.
 * Asks the gem rather than the GCI library, since the defect is in the gem.
 */
export function skipForKnownGemStoneBug(
  bug: KnownGemStoneBug,
  ctx: TestContext,
  session: ActiveSession,
): void {
  const [version, osName] = session
    .executeAndFetchString(`(System gemVersionAt: #gsVersion), '|', (System gemVersionAt: #osName)`)
    .split('|');
  const affectsOs = bug.osName === undefined || osName === bug.osName;
  ctx.skip(affectsOs && isVersionKnownBroken(bug, version), `skipping: ${bug.description}`);
}
