# GCI cross-version compatibility

How Jasper tracks which GCI symbols are missing on which release or platform, and enforces that the tracking stays accurate: vendored headers, a parser, a hand-written registry, and compiler checks tying them together. Worth reading before adding a GCI binding, calling a GciTs* function from production code, or supporting a new GemStone release.

## The problem

Jasper binds one native library — `libgcits` — that ships inside each GemStone distribution, and the extension must work against every release it claims to support. That set spans 3.6.2 through 3.7.5, on Linux, macOS and Windows. **The exported symbol set is not the same across them.**.

`gciLibrary.ts` binds symbols by name through koffi, at construction time. That gives two distinct failure modes:

- A **required** binding (`lib.func`) for a symbol the loaded library doesn't export throws while constructing `GciLibrary` — Jasper doesn't load at all, for that user, on that release.
- An **optional** binding (`optionalFunc`) survives construction and throws `"<name> is not available in this GCI library"` at the call site — a broken feature rather than a broken extension, but only if production code has a guarded fallback.

Neither is detectable on a developer machine running a single recent GemStone. Both are quiet until they reach a user on an older release or on Windows.

## Three independent reasons a symbol can be missing

| Field               | Meaning                                       | Ground truth in the headers                                    |
| ------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| `addedIn`           | Absent from every release older than this one | The earliest vendored revision that declares the symbol        |
| `absentOn: 'win32'` | Compiled out of the Windows client library    | The declaration sits inside `#if defined(FLG_UNIX)`            |
| `removedIn`         | Gone from this release onward                 | Not derivable from the current snapshot — see the limits below |

The headers carry no per-symbol version metadata: no comment, no `#if GCI_VERSION >=`, no changelog. `gci.ht`'s `GCI_FEATURE_LEVEL` discriminates major generations (`360` for everything from 3.6.2 to 3.7.5) and nothing finer. **Floors therefore come only from diffing revisions**, which is sound here because across the whole vendored range exports are strictly added: zero removals, and no symbol that appears, vanishes and returns.

## The chain, and which tool enforces each link

Four links, each checked by a _different_ mechanism — that is the point of the design, because each mechanism catches a class of mistake the others structurally cannot.

**1. `vendor/gci-headers/` — ground truth.** Ten distinct header revisions spanning 3.6.2 → 3.7.5, copied verbatim from the vendor distributions, one folder per distinct content revision. `versions.md` maps each GemStone version to its folder with a sha256 per file, and `scripts/lint-gci-header-versions.mjs` (CI's "GCI header version map" step) checks that table against the files on disk in both directions.

**2. `headerDeclarations.ts` — the parser.** Walks `EXTERN_GCI_DEC` declarations while tracking `#if` nesting, so it reports both the symbol name and whether it is platform-guarded. It is not a regex over lines, deliberately: multi-line declarations are the norm.

**3. `optionalFunctions.ts` — the registry, hand-written and machine-verified.** Every field is asserted against the parsed headers by [`optionalFunctions.headers.test.ts`](../../client/src/gciLibrary/__tests__/optionalFunctions.headers.test.ts), **in both directions** — a field that shouldn't be there fails as loudly as one that's missing or wrong. `versionGated` entries assert exact set equality between "revisions declaring this symbol" and "revisions at or after the floor", so a floor that is too low and one that is too high both fail. The test also enumerates the symbols the _headers_ mark optional independently of the registry, and fails if any lacks an entry.

**4. `gciLibrary.ts` — the type system closes the loop.** `_optional` is a mapped type over the registry's keys:

```ts
private _optional: { [N in GciOptionalFunctionName]: OptionalBinding<N> };
```

That makes both directions compile errors: a registry entry with no binding, and an `optionalFunc` binding with no registry entry. `isAvailable(name: GciOptionalFunctionName)` is typed the same way, so a misspelled probe is rejected by the compiler instead of silently answering `true`.

## What stops you, concretely

The useful table if you're about to change something:

| If you…                                                      | What stops you                                                                                                                                                                                                          | When                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Add an `optionalFunc` binding without a registry entry       | Compile error (missing key in the mapped type)                                                                                                                                                                          | `npm run compile`, and in your editor                  |
| Delete or rename a registry entry that is still bound        | Compile error                                                                                                                                                                                                           | Same                                                   |
| Bind a known-optional symbol as required (`lib.func`)        | Compile error — the mapped type loses a key                                                                                                                                                                             | Same                                                   |
| "Fix" that by editing the registry instead                   | `optionalFunctions.headers.test.ts` fails: the registry no longer matches the headers                                                                                                                                   | `npm test`, stone-free                                 |
| Record a wrong `addedIn` floor, in either direction          | Same test — floors are exact set equality, not a bound                                                                                                                                                                  | Same                                                   |
| Add or omit `absentOn` incorrectly                           | Same test — `#if defined(FLG_UNIX)` is checked both ways                                                                                                                                                                | Same                                                   |
| Add an entry with a field combination nobody anticipated     | Same test — it lands in `uncategorized`, which has its own failing assertion, rather than escaping every category-specific check                                                                                        | Same                                                   |
| Typo a name in `isAvailable(...)`                            | Compile error                                                                                                                                                                                                           | `npm run compile`                                      |
| Call a post-3.6.2 symbol from production code                | [`gciVersionGated.test.ts`](../../client/src/__tests__/gciVersionGated.test.ts) fails and names every call site, unless you consciously add the symbol to `ALLOWED_POST_362` — which is then a reviewable diff          | `npm test`, stone-free                                 |
| Add a registry entry but no absent-world assertion           | Compile error — [`missingGciFunctions.test.ts`](../../client/src/gciLibrary/__tests__/missingGciFunctions.test.ts)'s invocation map is a `Record<GciOptionalFunctionName, …>`, so the set is exhaustive by construction | `npm run compile`                                      |
| Break the Windows non-blocking-login path                    | `gciSpecials.integration.test.ts` asserts `supportsNonBlockingLogin() === (process.platform !== 'win32')` against the real library                                                                                      | CI, on all five Windows cells and all five Linux cells |
| Vendor a revision that declares a symbol Jasper doesn't bind | `optionalFunctions.headers.test.ts` fails — the test enumerates what the _headers_ gate, not what Jasper binds, so a newly gated symbol needs a registry entry, and the entry then needs a binding (see below)          | `npm test`, stone-free                                 |
| Add a header revision whose `versions.md` row lies           | `scripts/lint-gci-header-versions.mjs`                                                                                                                                                                                  | CI's "GCI header version map" step                     |

Note where the load is carried: the _registry-vs-headers_ checks are stone-free unit tests that run on every `npm test`, while the _library-vs-reality_ checks need the CI matrix (five GemStone versions × two platforms, each run twice — bare and with the server plugin).

## The cost of an entry, and why Jasper binds everything

A registry entry is not just a line in `optionalFunctions.ts`. The key feeds two exhaustive maps — `_optional` in `gciLibrary.ts` and the invocation map in `missingGciFunctions.test.ts` — so adding one also demands a real koffi prototype, a raw wrapper method, and an absent-world assertion. That is the mapped type doing its job, but it means the headers test can hand you work for a symbol Jasper has no use for: it scopes over every symbol the headers gate, not the ones Jasper binds.

**That is accepted deliberately, because Jasper binds essentially everything nowadays** — 103 of the 106 symbols declared across the vendored range, and every one of the 16 symbols added between 3.7.0 and 3.7.4.1.

If a future revision declares something genuinely not worth binding, that is the moment to revisit. Until then, bind it.

## Why the registry is hand-written rather than generated

The floors are recomputable from the snapshot at any time, so generating them was a real option. Literals won on two grounds:

- **The floor is visible in the diff** when a new binding lands, which is exactly the fact review should be weighing. Generated or derived at test time, it is invisible at review time and ungreppable.
- **It is the only shape where a floor _moving_ is loud.** If a newly vendored revision declares a symbol earlier than recorded, the literal's test fails and demands a reviewed edit. A generated or derived floor silently changes its answer — and a moved floor is a change in what Jasper can claim to support.

Test-time derivation was rejected for a third reason: `vendor/**` is excluded from the packaged extension (`.vscodeignore`), so floors derived only in tests are unreachable from production code that wants to explain a version requirement to a user.

## This all rests on the headers being vendored

**The snapshot's default answer for anything outside its range is the unsafe one.** "Declared in every vendored revision" resolves to _required, present on every release_ — so a GemStone release whose headers were never vendored doesn't produce a flagged unknown, it produces a confident, right-looking answer that may be wrong. If that release dropped a symbol, or added one Jasper binds as required, nothing in this chain notices; the failure surfaces as `GciLibrary` construction throwing on a user's install.

**So: supporting a new GemStone release includes vendoring its headers.** It is not optional documentation upkeep — it is what keeps every mechanism above honest. `vendor/gci-headers/README.md` has the step-by-step ("Adding a new version"); the short version is that if the headers hash-match an existing folder you only add a row to `versions.md`, and if they don't you add a folder too. Vendoring a release's headers is required to support it; adding it to the CI matrix in `client/.gemstone-integration-releases.json` is a separate, conscious decision, not an automatic consequence. If you do decide to add matrix coverage, do both together — a matrix entry whose headers aren't vendored resolves every symbol on it to the unsafe "present everywhere" default.

## The limits of the guarantee

Two things the snapshot cannot establish, worth knowing so nobody over-trusts the chain:

- **A declaration is not proof of an export.** The registry is a projection of what the headers _declare_; a symbol declared in one release but exported only from the next would be recorded a release early. Nothing here has hit that, and every case checked so far agrees, but the guarantee is about declarations.
- **`removedIn` is not header-verified.** 4.0 is deliberately not vendored (it is a pre-GA private build whose content can still move), so `GciTsEncrypt`'s removal is recorded from direct inspection rather than checked. The test asserts that 4.0 is _not_ among the vendored revisions, so the day someone vendors it this test fails and demands the real check — the exemption itself is guarded. The enforcement table above is header-derived, so until then it does not cover this class: a `removedIn` entry deleted together with its `optionalFunc` binding would compile and pass every check. Vendoring 4.0 closes that too — `GciTsEncrypt` then stops being declared in every vendored revision, so a missing entry fails this test like any other gated symbol.
