// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED CONFIGURATION — Tonel file out / file in (issue #616)
//
//   GemStone 3.7.5 and later, on a **rowan3** extent. Nothing else.
//   ("rowan3" = Rowan 3 / the RowanV3 project / `extent0.rowan3.dbf` — NOT
//   `extent0.rowan.dbf`, which installs the older Rowan.)
//
// Full statement, and the reasoning: ./tonelCapability.ts
// ─────────────────────────────────────────────────────────────────────────────
//
// The one way this feature names a Rowan class.
//
// Why a plain `symbolList objectNamed:` is not enough
// ---------------------------------------------------
// Rowan's classes are not in every user's symbol list. Measured on a 3.7.5
// rowan3 stone:
//
//   SystemUser   UserGlobals, Globals, Published, RowanKernel, RowanLoader,
//                RowanTools, RowanClientServices
//   DataCurator  UserGlobals, Globals, Published
//
// `RwModificationTonelWriterVisitorV2` and `RwTonelParser` live in RowanKernel;
// `RwMethodDefinition` lives in RowanTools. So a DataCurator session — a
// perfectly ordinary way to connect to a rowan3 stone — resolves the global
// `Rowan` but none of the `Rw*` classes, and the feature would be hidden on a
// stone that plainly supports it. DataCurator is meant to see these commands,
// so the lookup reaches through.
//
// Why through SystemUser's profile, of all things
// ------------------------------------------------
// Every cheaper route was tried against a live stone and does not work:
//
//   Globals at: #RowanKernel            → nil (the dictionaries are not there)
//   Rowan globalNamed: #RwTonelParser   → nil (searches the session's list)
//   Rowan image symbolList              → the session's own list again
//   Rowan image symbolDictNamed:        → raises; searches the session's list
//   ClassOrganizer new classes          → 1123 classes, RwTonelParser not among
//                                         them (also symbol-list scoped)
//   SymbolDictionary allInstances       → 33,961 objects; not a lookup
//
// What remains is to ask the profile that does have them. Rowan installs its
// dictionaries into SystemUser's symbol list, so that profile is where they can
// be found from a session that cannot see them directly. Verified end to end:
// a DataCurator session resolving the writer this way files a class out
// successfully, so the classes are usable once named, not merely visible.
//
// The reach-through is guarded: a user with no read access to AllUsers gets nil
// and therefore a quietly unavailable feature, which is the gate doing its job.
// A raise here would surface as a broken command instead of a hidden one.
import { escapeString } from '../util';

/**
 * Smalltalk that defines `rwLookup`, a one-argument block answering the class
 * named by a Symbol, or nil.
 *
 * Paste this into a doit before any {@link rowanLookupExpr}, and declare
 * `rwLookup` in the doit's temporaries. Kept as a prelude rather than inlined
 * per lookup so a query naming five classes pays for the profile walk once.
 */
export const ROWAN_LOOKUP_PRELUDE = `rwLookup := [:aName |
  (System myUserProfile symbolList objectNamed: aName)
    ifNil: [
      "Not in this session's symbol list. On a rowan3 stone the Rowan
       dictionaries (RowanKernel, RowanTools, ...) are in SystemUser's list
       only, so a DataCurator session lands here for every Rw* class."
      [(AllUsers userWithId: 'SystemUser') symbolList objectNamed: aName]
        on: Error do: [:ignored | nil]]].`;

/** An expression that resolves `name` through {@link ROWAN_LOOKUP_PRELUDE}. */
export function rowanLookupExpr(name: string): string {
  return `(rwLookup value: #'${escapeString(name)}')`;
}
