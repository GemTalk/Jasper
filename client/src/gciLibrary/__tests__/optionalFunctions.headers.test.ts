import { describe, expect, it } from 'vitest';
import { vendoredRevisions, declaredFunctions } from '../headerDeclarations';
import { compareGemStoneVersions } from '../../gemStoneVersion.js';
import {
  GCI_OPTIONAL_FUNCTIONS,
  type GciAbsenceReason,
  type GciOptionalFunctionName,
} from '../optionalFunctions';

/**
 * Two sides meet here: the *registry* (`GCI_OPTIONAL_FUNCTIONS`, hand-maintained)
 * and the *headers* (the vendored `vendor/gci-headers/` snapshots, ground truth).
 * Every test asserts a registry claim against a header fact, in both directions —
 * a field that shouldn't be there fails as loudly as one that's missing or wrong.
 *
 * Grouped by *why* a symbol is optional, not by which fields happen to be set —
 * `absentOn`-only and `removedIn`-only both mean "declared in every vendored
 * revision," for unrelated reasons, and asserting that shared consequence
 * without naming the cause reads as a coincidence. `removedIn` is the one
 * reason this can't check forward (4.0 isn't vendored) — it's exempted, but
 * the exemption itself is checked so the day 4.0 is vendored this test starts
 * failing and demands the real check.
 */

// ---------------------------------------------------------------------------
// The header side: what the vendored snapshots actually declare.
// ---------------------------------------------------------------------------

const revisionsOldestFirst = vendoredRevisions();
const declarationsByRevision = new Map(
  revisionsOldestFirst.map((revision) => [revision, declaredFunctions(revision)]),
);

function revisionsDeclaring(name: string): string[] {
  return revisionsOldestFirst.filter((revision) => declarationsByRevision.get(revision)!.has(name));
}

function revisionsAtOrAfter(floor: string): string[] {
  return revisionsOldestFirst.filter((revision) => compareGemStoneVersions(revision, floor) >= 0);
}

function isUnixOnlyEverywhereDeclared(name: string): boolean {
  return revisionsDeclaring(name).every(
    (revision) => declarationsByRevision.get(revision)!.get(name)!.unixOnly,
  );
}

/**
 * Every symbol name declared in at least one vendored revision — the full
 * universe the registry could possibly need to account for.
 */
function allNamesDeclaredAnywhere(): Set<string> {
  const names = new Set<string>();
  for (const revision of revisionsOldestFirst) {
    for (const name of declarationsByRevision.get(revision)!.keys()) names.add(name);
  }
  return names;
}

/**
 * Names the *headers themselves* mark as optional, independent of the
 * registry and of whether `gciLibrary.ts` binds them at all: declared in
 * fewer than every vendored revision (version-gated), or `unixOnly` wherever
 * declared (platform-gated). `removedIn` has no header-derivable counterpart
 * — a symbol on its way out of an unvendored future release still looks,
 * to every vendored snapshot, exactly like a normal required binding.
 */
function namesTheHeadersMarkOptional(): string[] {
  return [...allNamesDeclaredAnywhere()].filter((name) => {
    const declaredIn = revisionsDeclaring(name);
    return declaredIn.length < revisionsOldestFirst.length || isUnixOnlyEverywhereDeclared(name);
  });
}

// ---------------------------------------------------------------------------
// The registry side: what GCI_OPTIONAL_FUNCTIONS claims, and why.
// ---------------------------------------------------------------------------

const registryEntries = Object.entries(GCI_OPTIONAL_FUNCTIONS) as [
  GciOptionalFunctionName,
  GciAbsenceReason,
][];
const registeredNames = new Set(registryEntries.map(([name]) => name as string));

type OptionalityCategory =
  | 'versionGated' // addedIn only
  | 'platformGated' // absentOn only
  | 'versionAndPlatformGated'
  | 'pendingRemoval' // removedIn only
  | 'uncategorized';

function categorize({ addedIn, absentOn, removedIn }: GciAbsenceReason): OptionalityCategory {
  if (removedIn && !addedIn && !absentOn) return 'pendingRemoval';
  if (addedIn && absentOn && !removedIn) return 'versionAndPlatformGated';
  if (addedIn && !absentOn && !removedIn) return 'versionGated';
  if (absentOn && !addedIn && !removedIn) return 'platformGated';
  return 'uncategorized';
}

const inCategory = (category: OptionalityCategory) =>
  registryEntries.filter(([, reason]) => categorize(reason) === category);

describe('the GCI_OPTIONAL_FUNCTIONS registry vs vendor/gci-headers/', () => {
  it('has an entry for every symbol the headers themselves mark as optional', () => {
    const unregistered = namesTheHeadersMarkOptional()
      .filter((name) => !registeredNames.has(name))
      .sort();

    expect(
      unregistered,
      `${unregistered.length} symbol(s) are version- or platform-gated per vendor/gci-headers/ ` +
        `but missing from GCI_OPTIONAL_FUNCTIONS: ${unregistered.join(', ')} — add an entry for ` +
        `each in client/src/gciLibrary/optionalFunctions.ts; see docs/explanation/gci-version-compatibility.md.`,
    ).toEqual([]);
  });

  it('every registry entry falls into a known optionality category', () => {
    const uncategorized = inCategory('uncategorized').map(([name]) => name);

    expect(
      uncategorized,
      `${uncategorized.length} entry(ies) in GCI_OPTIONAL_FUNCTIONS match no optionality ` +
        `category and would silently escape every category-specific check below: ` +
        `${uncategorized.join(', ')}`,
    ).toEqual([]);
  });

  describe('versionGated: added partway through the release cycle (addedIn only)', () => {
    it.each(inCategory('versionGated'))(
      '%s is declared from its addedIn floor onward, and absent before it',
      (name, reason) => {
        expect(revisionsDeclaring(name)).toEqual(revisionsAtOrAfter(reason.addedIn!));
      },
    );
  });

  describe('platformGated: every release, but compiled out on Windows (absentOn only)', () => {
    it.each(inCategory('platformGated'))(
      '%s is declared in every vendored revision, always inside #if FLG_UNIX',
      (name) => {
        expect(revisionsDeclaring(name)).toEqual(revisionsOldestFirst);
        expect(isUnixOnlyEverywhereDeclared(name)).toBe(true);
      },
    );
  });

  describe('versionAndPlatformGated: added partway through the cycle, and Unix-only from then on', () => {
    it.each(inCategory('versionAndPlatformGated'))(
      '%s is declared from its addedIn floor onward, always inside #if FLG_UNIX',
      (name, reason) => {
        expect(revisionsDeclaring(name)).toEqual(revisionsAtOrAfter(reason.addedIn!));
        expect(isUnixOnlyEverywhereDeclared(name)).toBe(true);
      },
    );
  });

  describe('pendingRemoval: every vendored release, slated for removal in an unvendored one', () => {
    it.each(inCategory('pendingRemoval'))(
      '%s is declared in every vendored revision — removedIn is exempted because 4.0 is not vendored',
      (name, reason) => {
        expect(revisionsDeclaring(name)).toEqual(revisionsOldestFirst);
        expect(revisionsOldestFirst).not.toContain(reason.removedIn);
      },
    );
  });

  it.each(registryEntries)('%s is declared in the newest vendored revision', (name) => {
    const newest = revisionsOldestFirst.at(-1)!;
    expect(declarationsByRevision.get(newest)!.has(name)).toBe(true);
  });
});
