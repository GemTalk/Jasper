// The `.ts` on this specifier is deliberate, and the resolvers that see it do
// three different things: tsc rewrites it to `.js` on emit
// (`rewriteRelativeImportExtensions` in tsconfig.base.json), vitest's esbuild
// transform resolves it literally, and Node's type-stripping — how
// `eslint.config.mjs` reads this chain — resolves an explicit `.ts` and nothing
// else, neither `.js` nor extensionless. "Helpfully" normalizing it to `.js`
// breaks that last one. `eslint.config.mjs` bans `.ts` specifiers repo-wide and
// exempts this file by name, so the exception stays deliberate rather than
// becoming an idiom.
import { HEADER_DERIVED_OPTIONAL_FUNCTIONS } from './optionalFunctions.generated.ts';

/**
 * The single source of truth for which `GciTs*` bindings may be absent from a
 * loaded library, and why.
 *
 * Two halves, split by what a header snapshot can prove. The version- and
 * platform-gated entries are *derived* from `vendor/gci-headers/` into
 * `optionalFunctions.generated.ts`, so a floor cannot be transcribed wrong and
 * a vendored revision that moves one cannot be silently accepted — CI reruns
 * the generator and fails on any diff. What is written by hand below is only
 * what no snapshot can state: a symbol on its way out of a release that is
 * deliberately not vendored.
 */

export type GciAbsenceReason = {
  /** Earliest vendored revision declaring the symbol; absent on every earlier release. */
  addedIn?: string;
  /** The declaration sits inside `#if defined(FLG_UNIX)` — absent from the Windows client DLL. */
  absentOn?: 'win32';
  /**
   * Gone from the next major release onward. A sentinel, not a version: those
   * headers are deliberately not vendored (a pre-GA build whose content can
   * still move), so nothing here can check it.
   */
  removedIn?: 'nextMajor';
};

export const GCI_OPTIONAL_FUNCTIONS = {
  ...HEADER_DERIVED_OPTIONAL_FUNCTIONS,
  // Declared in every vendored revision, but deleted from `gcits.hf` for the
  // next major release. Invisible to snapshots that all predate it, so this is
  // recorded from direct inspection; the test alongside guards the exemption
  // itself — it fails the day the headers come to cover the symbol.
  GciTsEncrypt: { removedIn: 'nextMajor' },
} as const satisfies Record<string, GciAbsenceReason>;

export type GciOptionalFunctionName = keyof typeof GCI_OPTIONAL_FUNCTIONS;
