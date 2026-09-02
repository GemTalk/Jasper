# GCI cross-version compatibility

How Jasper tracks which GCI symbols are missing on which release or platform: vendored headers, a parser, a registry generated from them plus one hand-written override, and compiler checks tying them together. Read before adding a GCI binding, calling a `GciTs*` function from production code, or supporting a new GemStone release.

## The problem

Jasper binds `libgcits`, which ships inside each GemStone distribution, and must work against every release it supports — 3.6.2 through 3.7.5, on Linux, macOS and Windows. **The exported symbol set is not the same across them.**

`gciLibrary.ts` binds symbols by name at construction time, giving two failure modes:

- A **required** binding (`lib.func`) for a missing symbol throws while constructing `GciLibrary` — Jasper doesn't load at all for that user.
- An **optional** binding (`optionalFunc`) throws `"<name> is not available in this GCI library"` at the call site — a broken feature, unless production code has a guarded fallback.

Neither is visible on a dev machine running a single recent GemStone.

## Three reasons a symbol can be missing

| Field               | Meaning                                       | Ground truth in the headers                                                                                                                   |
| ------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `addedIn`           | Absent from every release older than this one | The earliest vendored revision declaring the symbol                                                                                           |
| `absentOn: 'win32'` | Compiled out of the Windows client library    | The declaration sits inside `#if defined(FLG_UNIX)`                                                                                           |
| `removedIn`         | Gone from this release onward                 | Derivable in principle — but no vendored revision drops a symbol, so today it is hand-written; see [the limits](#the-limits-of-the-guarantee) |

The headers carry no per-symbol version metadata (`GCI_FEATURE_LEVEL` is `360` for the whole range), so **every field comes from diffing revisions**. Across the vendored range exports are strictly added — no removals, nothing that vanishes and returns — which is why the derived half only ever emits `addedIn` and `absentOn`. That is a property of the current snapshot, not a law, so the generator asserts it rather than assuming it: a revision that breaks it aborts instead of yielding a confident, wrong answer.

## The chain

Four links, each checked by a _different_ mechanism, because each catches mistakes the others structurally cannot.

**1. `vendor/gci-headers/` — ground truth.** Ten distinct header revisions spanning 3.6.2 → 3.7.5, copied verbatim, one folder per content revision. `versions.md` maps each GemStone version to its folder with a sha256 per file; `scripts/lint-gci-header-versions.mjs` checks that table against disk in both directions.

**2. `headerDeclarations.ts` — the parser.** Walks `EXTERN_GCI_DEC` declarations tracking `#if` nesting, reporting both the name and whether it is platform-guarded. Not a regex — multi-line declarations are the norm.

**3. `optionalFunctions.ts` — the registry.** Two halves, split by what a header snapshot can prove:

- **Derived:** `optionalFunctions.generated.ts`, produced by `optionalFunctionsFromHeaders.ts` and **committed**. A symbol declared unconditionally everywhere is required, so it is omitted. CI's "GCI optional-functions registry" step reruns the generator and fails on any diff, so no field here can be transcribed wrong or drift. [`optionalFunctionsFromHeaders.test.ts`](../../client/src/gciLibrary/__tests__/optionalFunctionsFromHeaders.test.ts) tests the generator against fixture trees, including five shapes it must _refuse_ to derive.
- **Hand-written:** the spread in `optionalFunctions.ts`, for the one claim no snapshot can make — `removedIn`. [`optionalFunctions.overrides.test.ts`](../../client/src/gciLibrary/__tests__/optionalFunctions.overrides.test.ts) guards the seam: overrides are disjoint from generated entries (a shadowing spread compiles silently), the merge is exactly their union, no reason carries an off-schema field, and each override is still declared in every vendored revision — so it expires the day the headers can prove its optionality.

**4. `gciLibrary.ts` — the type system closes the loop.** `_optional` is a mapped type over the registry's keys:

```ts
private _optional: { [N in GciOptionalFunctionName]: OptionalBinding<N> };
```

Both directions are compile errors: an entry with no binding, and an `optionalFunc` binding with no entry. `isAvailable(name: GciOptionalFunctionName)` is typed the same way, so a misspelled probe can't silently answer `true`.

## What stops you, concretely

| If you…                                                                    | What stops you                                                                                                                                                     | When                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Add an `optionalFunc` binding without a registry entry                     | Compile error (missing key in the mapped type)                                                                                                                     | `npm run compile`, and in your editor             |
| Delete or rename a registry entry that is still bound                      | Compile error                                                                                                                                                      | Same                                              |
| Bind a known-optional symbol as required (`lib.func`)                      | Compile error — the mapped type loses a key                                                                                                                        | Same                                              |
| "Fix" that by editing the registry, or record a wrong `addedIn`/`absentOn` | You can't: rerunning the generator reverts the edit and CI fails on the diff                                                                                       | CI's "GCI optional-functions registry" step       |
| Add an entry with an unanticipated field combination                       | The renderer writes only `DerivedEntry` fields, and `optionalFunctions.overrides.test.ts` whitelists merged keys                                                   | `npm test`, stone-free                            |
| Hand-write an override the headers already cover                           | Same test — disjointness is asserted, not inferred                                                                                                                 | Same                                              |
| Vendor a revision the schema can't express                                 | The generator refuses to write, naming the symbol that comes and goes, moves its `#if FLG_UNIX` gate, or is dropped                                                | `npm run generate:gci-optional-functions`, and CI |
| Typo a name in `isAvailable(...)`                                          | Compile error                                                                                                                                                      | `npm run compile`                                 |
| Call any registry symbol from production code                             | `eslint.config.mjs`'s `OPTIONAL_GCI_CALL` block fails and names the hazard the entry implies — absent before its `addedIn` floor, absent from the Windows client library, or removed in a server version that is supported by Jasper. Selectors are generated from the registry, so the gated set is never restated. The remedy is to put the conditional in `client/src/gciLibrary/` and call a helper from there; the fallback is an `eslint-disable-next-line` at the call site whose `-- reason` names the guard and the degraded path | `npm run lint`                                    |
| Add a registry entry but no absent-world assertion                         | Compile error — [`missingGciFunctions.test.ts`](../../client/src/gciLibrary/__tests__/missingGciFunctions.test.ts)'s invocation map is an exhaustive `Record`      | `npm run compile`                                 |
| Break the Windows non-blocking-login path                                  | `gciSpecials.integration.test.ts` asserts `supportsNonBlockingLogin() === (process.platform !== 'win32')`                                                          | CI, on all five Windows and five Linux cells      |
| Vendor a revision declaring a symbol Jasper doesn't bind                   | The generator adds an entry (it scopes over what the _headers_ gate), which is a compile error until it has a binding                                              | `npm run compile`, after regenerating             |
| Vendor a revision and forget to regenerate                                 | CI fails on the diff. **`npm test` alone does not catch this**                                                                                                     | CI's "GCI optional-functions registry" step       |
| Add a header revision whose `versions.md` row lies                         | `scripts/lint-gci-header-versions.mjs`                                                                                                                             | CI's "GCI header version map" step                |

**The one gap that costs a developer time:** vendoring headers and running only `npm test` shows green — registry staleness is CI's to catch. So **run `npm run generate:gci-optional-functions` as part of vendoring headers**, not after CI tells you to. Once regenerated, a newly gated symbol fails loudly as a compile error.

## The cost of an entry, and why Jasper binds everything

A registry key feeds two exhaustive maps — `_optional` and `missingGciFunctions.test.ts`'s invocation map — so a new entry also demands a koffi prototype, a raw wrapper method, and an absent-world assertion. Since the generator scopes over every gated symbol, it can hand you work for a symbol Jasper has no use for.

That is accepted deliberately: Jasper binds 103 of the 106 symbols declared across the vendored range, and every one of the 16 added between 3.7.0 and 3.7.4.1. If a future revision declares something genuinely not worth binding, revisit then.

## Why the registry is generated _and committed_

Two properties the old hand-written literals had, which the current shape is built to keep:

- **The floor must be visible in the diff** when a new binding lands. Derived on the fly it is invisible at review time and ungreppable.
- **A floor _moving_ must be loud** — it changes what Jasper can claim to support. A floor recomputed on demand silently changes its answer.

Committing the generated file keeps both: the floors are greppable literals, a moved one shows up in the vendoring commit's diff, and CI fails if the committed bytes disagree with a fresh run. Generating buys what literals couldn't rule out — a floor transcribed wrong, or a vendored revision that moves one and is silently accepted.

A third objection was that `vendor/**` is excluded from the `.vsix` (`.vscodeignore`), so anything derived at test time is unreachable from production code. That is now satisfied too: what ships is a `.ts` module, and the headers stay out of the package.

## This all rests on the headers being vendored

**The snapshot's default answer for anything outside its range is the unsafe one.** "Declared in every vendored revision" resolves to _required, present on every release_ — so a release whose headers were never vendored yields a confident, right-looking answer that may be wrong, surfacing as `GciLibrary` construction throwing on a user's install.

**So: supporting a new GemStone release includes vendoring its headers.** `vendor/gci-headers/README.md` has the step-by-step; in short, hash-matching headers need only a `versions.md` row, otherwise a folder too. Adding the release to the CI matrix (`client/.gemstone-integration-releases.json`) is a separate, conscious decision — but if you do, do both together: a matrix entry whose headers aren't vendored resolves every symbol to the unsafe default.

## The limits of the guarantee

- **A declaration is not proof of an export.** The registry projects what the headers _declare_; a symbol declared one release before it is exported would be recorded a release early. No case has hit this so far.
- **`removedIn` is hand-written, but not because removal is undiffable.** A symbol declared in older revisions and gone from the newest is a perfectly visible diff; the generator sees that shape and, today, hard-fails on it rather than deriving anything:

  ```
  <name> is declared in <revisions> but not in the newest revision <newest> —
  a removal inside the vendored range, which the registry cannot express.
  ```

  The one removal Jasper records is invisible for a different reason: the release that drops `GciTsEncrypt` is deliberately not vendored (a pre-GA build whose content can still move). With no snapshot to name, the field is a sentinel — `removedIn: 'nextMajor'` — rather than a version, and `DerivedEntry` carries no `removedIn` member at all. Vendor a revision that drops a symbol and the generator stops rather than guessing; teaching it to emit `removedIn` is a change worth making at that point, not before.

  The **exemption** is guarded even though the claim isn't: `optionalFunctions.overrides.test.ts` asserts every hand-written name is still declared in _every_ vendored revision, so vendoring the release that drops it fails and demands the real check. Until then this class stays outside the header-derived enforcement table: a `removedIn` entry deleted together with its binding would compile and pass everything. Vendoring that release forces the reckoning from both ends — the override test fails, and so does the generator, on the removal it currently refuses to express.
