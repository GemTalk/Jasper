import { describe, expect, it } from 'vitest';
import { vendoredRevisions, declaredFunctions } from '../headerDeclarations';
import { HEADER_DERIVED_OPTIONAL_FUNCTIONS } from '../optionalFunctions.generated';
import {
  GCI_OPTIONAL_FUNCTIONS,
  type GciAbsenceReason,
  type GciOptionalFunctionName,
} from '../optionalFunctions';

/**
 * The *hand-written* half of the registry, and only that half. Everything the
 * vendored headers can prove — floors, Unix-only gates, the completeness of the
 * derived set — is asserted against fixture trees in
 * `optionalFunctionsFromHeaders.test.ts`, and the committed
 * `optionalFunctions.generated.ts` is diff-checked in CI by rerunning the
 * generator. What is left here is the seam: `optionalFunctions.ts` spreads the
 * generated object and adds entries no snapshot can state, and nothing about
 * *that* is generated or diff-checked.
 *
 * This file reads `vendor/gci-headers/` for one reason only — guard 3, which
 * makes each hand-written entry expire on its own once the headers come to
 * cover the symbol.
 */

// ---------------------------------------------------------------------------
// The hand-written half, restated.
// ---------------------------------------------------------------------------

/**
 * Stated, not derived by subtracting the generated keys from the merged ones.
 * A spread whose later key *shadows* a generated one compiles silently (verified
 * with tsc), and a derived difference would be EMPTY in exactly that case — the
 * one case guard 1 exists to catch. Keeping this list honest is guard 2's job.
 */
const HAND_WRITTEN = {
  GciTsEncrypt: { removedIn: 'nextMajor' },
} as const satisfies Record<string, GciAbsenceReason>;

const handWrittenNames = Object.keys(HAND_WRITTEN);
const derivedNames = Object.keys(HEADER_DERIVED_OPTIONAL_FUNCTIONS);

const mergedEntries = Object.entries(GCI_OPTIONAL_FUNCTIONS) as [
  GciOptionalFunctionName,
  GciAbsenceReason,
][];

const revisionsOldestFirst = vendoredRevisions();

function revisionsNotDeclaring(name: string): string[] {
  return revisionsOldestFirst.filter((revision) => !declaredFunctions(revision).has(name));
}

describe('the hand-written overrides in GCI_OPTIONAL_FUNCTIONS', () => {
  it('names nothing the generated registry already covers', () => {
    const shadowed = handWrittenNames.filter((name) => derivedNames.includes(name)).sort();

    expect(
      shadowed,
      `${shadowed.length} hand-written entry(ies) shadow a generated one: ${shadowed.join(', ')} ` +
        `— the spread in optionalFunctions.ts silently wins, so the derived floor or platform ` +
        `gate for each is discarded without a compile error. Delete the hand-written entry, or ` +
        `if the headers are the ones that are wrong, say so where the generator can see it.`,
    ).toEqual([]);
  });

  it('accounts for every merged entry, each surviving the merge unaltered', () => {
    expect(mergedEntries.map(([name]) => name as string).sort()).toEqual(
      [...derivedNames, ...handWrittenNames].sort(),
    );

    for (const [name, reason] of Object.entries(HAND_WRITTEN)) {
      expect(GCI_OPTIONAL_FUNCTIONS[name as GciOptionalFunctionName]).toEqual(reason);
    }
  });

  // Strictly stronger than asserting the recorded `removedIn` isn't a vendored
  // directory name: this fires however the headers come to cover the symbol,
  // not only when a directory named after that release appears.
  it.each(handWrittenNames)(
    '%s is still declared in every vendored revision — vendor the release that drops it and this fails',
    (name) => {
      const missingFrom = revisionsNotDeclaring(name);

      expect(
        missingFrom,
        `${name} is hand-written in optionalFunctions.ts precisely because no vendored ` +
          `snapshot can state its optionality, but ${missingFrom.join(', ')} no longer ` +
          `declare(s) it — the headers can now prove this, so the generator should own the ` +
          `entry. Drop it from the hand-written half and regenerate.`,
      ).toEqual([]);
    },
  );

  // The split costs the excess-property check that a single fresh object
  // literal with `satisfies` used to give: the generated values are frozen by
  // `as const` and so aren't fresh at the merge, and the target
  // `Record<string, GciAbsenceReason>` has an index signature, against which
  // excess-property checking never fires. A stray field compiles clean.
  it.each(mergedEntries)('%s carries no field outside the reason schema', (name, reason) => {
    const unknown = Object.keys(reason).filter(
      (field) => !['addedIn', 'absentOn', 'removedIn'].includes(field),
    );

    expect(
      unknown,
      `${name} carries ${unknown.join(', ')}, which no consumer of GciAbsenceReason reads. ` +
        `Fields on a generated entry come from the renderer in ` +
        `optionalFunctionsFromHeaders.ts; fields on a hand-written one come from ` +
        `optionalFunctions.ts.`,
    ).toEqual([]);
  });
});
