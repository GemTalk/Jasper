import { describe, expect, it } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { compareGemStoneVersions } from '../../gemStoneVersion';
import {
  GCI_OPTIONAL_FUNCTIONS,
  type GciAbsenceReason,
  type GciOptionalFunctionName,
} from '../optionalFunctions';

/**
 * Proves `GCI_OPTIONAL_FUNCTIONS` against the actual loaded GCI client
 * library, on every matrix cell: for each registry entry, the registry's
 * prediction of `addedIn`/`absentOn` must match what `gci.isAvailable`
 * reports for the library that is really loaded. This is what makes the
 * registry self-verifying rather than trusted blindly — a wrong floor or a
 * missed platform gate fails here against a real library, not just against
 * the vendored header snapshots `optionalFunctionsFromHeaders.test.ts` checks.
 *
 * `removedIn: 'nextMajor'` entries name no version to check a prediction
 * against, since no current matrix cell is on the next major version yet.
 * Instead of skipping them, this asserts they're still available today — a
 * passing canary. The day the matrix includes a next-major GemStone version,
 * that assertion will genuinely fail there, pointing a future developer at
 * the symbol that now needs a real `removedIn` version.
 */

/** Every registry entry, whichever `GciAbsenceReason` axes it combines. */
const ALL_ENTRIES = Object.entries(GCI_OPTIONAL_FUNCTIONS) as [
  GciOptionalFunctionName,
  GciAbsenceReason,
][];

const REMOVED_IN_NEXT_MAJOR_ENTRIES = ALL_ENTRIES.filter(
  ([, reason]) => reason.removedIn === 'nextMajor',
);

const REMOVED_IN_NEXT_MAJOR_NAMES = new Set(REMOVED_IN_NEXT_MAJOR_ENTRIES.map(([name]) => name));

/** Registry entries this test can check a prediction for: excludes `removedIn`, which names no version. */
const CHECKABLE_ENTRIES = ALL_ENTRIES.filter(([name]) => !REMOVED_IN_NEXT_MAJOR_NAMES.has(name));

/**
 * Extracts and pads the leading numeric version from a `GciTsVersion` string
 * the same way `supportsEnhancedInspector` (enhancedInspectorInstall.ts) does,
 * so it compares cleanly with `compareGemStoneVersions` instead of throwing on
 * a trailing build/description suffix (e.g. "3.7.5 build ...").
 */
function normalizedLibraryVersion(rawVersion: string): string | undefined {
  const numeric = rawVersion.match(/^\d+\.\d+(\.\d+){0,2}/)?.[0];
  if (!numeric) return undefined;
  return numeric.split('.').length < 3 ? `${numeric}.0` : numeric;
}

/**
 * Predicts availability from `reason`'s `addedIn`/`absentOn` axes -- shared
 * with the canary below, since a `removedIn` entry can carry those axes too,
 * and asserting a bare `toBe(true)` over them would report an unmet floor or a
 * Windows gate as a next-major removal. `removedIn` is deliberately not read
 * here: no version sits on the other side of it to compare against, which is
 * why those entries are canaried rather than checked.
 */
function expectedAvailability(
  version: string,
  name: GciOptionalFunctionName,
  reason: GciAbsenceReason,
): boolean {
  let expectedAvailable = true;
  if (reason.addedIn) {
    const normalized = normalizedLibraryVersion(version);
    if (!normalized) {
      throw new Error(
        `GciTsVersion reported "${version}", which has no leading numeric version to compare ${name}'s addedIn (${reason.addedIn}) against`,
      );
    }
    expectedAvailable &&= compareGemStoneVersions(normalized, reason.addedIn) >= 0;
  }
  if (reason.absentOn === 'win32') {
    expectedAvailable &&= process.platform !== 'win32';
  } else if (reason.absentOn) {
    throw new Error(
      `${name} carries absentOn: '${reason.absentOn}', which this test has no platform check for. ` +
        'Add one to the absentOn branch above.',
    );
  }
  return expectedAvailable;
}

describe('GCI_OPTIONAL_FUNCTIONS against the loaded library (integration)', () => {
  let gci: GciLibrary;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
  });

  it.each(CHECKABLE_ENTRIES)('predicts %s availability correctly', (name, reason) => {
    const { version } = gci.GciTsVersion();

    expect(gci.isAvailable(name)).toBe(expectedAvailability(version, name, reason));
  });

  for (const [name, reason] of REMOVED_IN_NEXT_MAJOR_ENTRIES) {
    it(`${name} still matches its predicted availability (removedIn: nextMajor not yet reached)`, () => {
      const { version } = gci.GciTsVersion();

      expect(gci.isAvailable(name)).toBe(expectedAvailability(version, name, reason));
    });
  }
});
