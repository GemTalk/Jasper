import { describe, it, expect, vi } from 'vitest';
import type { TestContext } from 'vitest';
import type { ActiveSession } from '../sessionManager';
import {
  type KnownGemStoneBug,
  isVersionKnownBroken,
  skipForKnownGemStoneBug,
} from './knownGemStoneBugs';

const macOnly37: KnownGemStoneBug = {
  description: 'an example defect',
  osName: 'Darwin',
  brokenIn: [{ from: '3.7.0', through: '3.7.6' }],
};

/** A gem that answers the gate's one query with this version and OS. */
function gemReporting(version: string, osName: string): ActiveSession {
  return { executeAndFetchString: () => `${version}|${osName}` } as unknown as ActiveSession;
}

/** Runs the gate and answers whether it asked to skip, and with what reason. */
function gateOutcome(
  bug: KnownGemStoneBug,
  session: ActiveSession,
): { skipped: boolean; reason?: string } {
  const skip = vi.fn();

  skipForKnownGemStoneBug(bug, { skip } as unknown as TestContext, session);

  const [condition, reason] = skip.mock.calls[0] as [boolean, string];
  return { skipped: condition, reason };
}

describe('isVersionKnownBroken', () => {
  it('counts every release from the first through the last known broken', () => {
    expect(isVersionKnownBroken(macOnly37, '3.7.0')).toBe(true);
    expect(isVersionKnownBroken(macOnly37, '3.7.4.3')).toBe(true);
    expect(isVersionKnownBroken(macOnly37, '3.7.6')).toBe(true);
  });

  it('leaves releases before the range alone', () => {
    expect(isVersionKnownBroken(macOnly37, '3.6.8')).toBe(false);
  });

  it('runs the test again on any later release, whichever line it is on', () => {
    // Nobody knows yet which release carries the fix, so each newer one gets
    // tested: a patch, the next minor, and the next major's pre-release alike.
    expect(isVersionKnownBroken(macOnly37, '3.7.6.1')).toBe(false);
    expect(isVersionKnownBroken(macOnly37, '3.7.7')).toBe(false);
    expect(isVersionKnownBroken(macOnly37, '3.8.0')).toBe(false);
    expect(isVersionKnownBroken(macOnly37, '4.0.0-a3')).toBe(false);
  });

  it('can mark a later release line broken while an earlier one is fixed', () => {
    const fixedOnlyIn377: KnownGemStoneBug = {
      ...macOnly37,
      brokenIn: [
        { from: '3.7.0', through: '3.7.6' },
        { from: '3.8.0', through: '3.8.0' },
      ],
    };

    expect(isVersionKnownBroken(fixedOnlyIn377, '3.7.7')).toBe(false);
    expect(isVersionKnownBroken(fixedOnlyIn377, '3.8.0')).toBe(true);
    expect(isVersionKnownBroken(fixedOnlyIn377, '3.8.1')).toBe(false);
  });

  it('treats a version it cannot read as not broken, so the test still runs', () => {
    expect(isVersionKnownBroken(macOnly37, '3.8')).toBe(false);
    expect(isVersionKnownBroken(macOnly37, '')).toBe(false);
  });
});

describe('skipForKnownGemStoneBug', () => {
  it('skips, naming the bug, on an affected release and OS', () => {
    expect(gateOutcome(macOnly37, gemReporting('3.7.5', 'Darwin'))).toEqual({
      skipped: true,
      reason: 'skipping: an example defect',
    });
  });

  it('runs the test on an affected release under another OS', () => {
    expect(gateOutcome(macOnly37, gemReporting('3.7.5', 'Linux')).skipped).toBe(false);
  });

  it('runs the test on an unaffected release of the affected OS', () => {
    expect(gateOutcome(macOnly37, gemReporting('3.6.2', 'Darwin')).skipped).toBe(false);
  });

  it('skips on every OS when the bug names none', () => {
    const everywhere: KnownGemStoneBug = {
      description: 'an example defect',
      brokenIn: [{ from: '3.7.0', through: '3.7.6' }],
    };

    expect(gateOutcome(everywhere, gemReporting('3.7.5', 'Linux')).skipped).toBe(true);
  });
});
