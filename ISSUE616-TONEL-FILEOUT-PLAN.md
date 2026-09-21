# Issue #616 — Tonel file out / file in

> ## ⚠️ DELETE THIS FILE BEFORE THE PR
>
> This document is **working scaffolding, committed only so the work is backed up** — it
> is not a deliverable and must not ship. `git rm` it before opening the PR.
>
> The repo has no `docs/plans/` convention; `docs/` is shipped documentation. Anything
> here worth keeping goes into a source comment, `docs/how-to/`, or the PR body. Before
> deleting, sweep for anything not yet carried across — the rowan3-stone how-to and the
> NFS `data`-symlink workaround are the likeliest survivors.

**Worktree:** `/export/uffda1/users/ewinger/worktrees/issue616-tonel-fileout`
**Branch:** `eric/issue616-tonel-fileout` (off `origin/main` @ `f9cd5132`)
**Issue:** https://github.com/GemTalk/Jasper/issues/616

> ## Supported configuration — read this first
>
> **GemStone 3.7.5 and later, on a rowan3 extent. Nothing else.**
>
> "rowan3" throughout this document means **Rowan 3** — the `RowanV3` project and a
> stone built from `extent0.rowan3.dbf`. Not `extent0.rowan.dbf`, which installs the
> older Rowan. The distinction is load-bearing, not pedantry: both generations ship in
> the same 3.7.5 tarball, both define a global named `Rowan`, and both define classes
> named `RwModificationTonelWriterVisitorV2` that emit different header key sets.
>
> This is not a soft preference or a graceful-degradation story. Every line of the
> feature calls RowanV3 classes that do not exist on a base extent, and the 3.6.x
> tarballs ship **no Rowan extent of either generation** (`$GEMSTONE/bin/` there has
> `extent0.dbf` and `extent0.seaside.dbf`, nothing more) — a rowan3 3.6.2 stone is not
> merely unsupported, it is not constructible from the product. 3.7.5 ships
> `extent0.rowan3.dbf`.
>
> Consequences that run through the whole plan:
>
> - **The commands are hidden**, not degraded, wherever the capability gate fails.
> - **Every test for this feature runs against a rowan3 stone and nowhere else.**
>   There is no base-extent tier, not even a reduced one.
> - **Nothing here may be validated by the default test stone.** If a test for this
>   work *passes* on `npm run test:server:start`'s stone, that test is wrong — it is
>   asserting something other than what it claims.
> - **Gate and skip on capability, never on version or environment** — so the tests
>   light up by themselves if rowan3 ever reaches CI or the base extent.

---

## Progress

| | Step | State |
|---|---|---|
| ✅ | **A** — rowan3 test stone in the harness | done |
| ✅ | **0** — spike | done; findings in "Verified Smalltalk" |
| ✅ | **1** — file out one class | done; 4 oracles + churn suite |
| ◐ | **2** — widen the oracles | mostly covered by Steps A/1; corpus sweep as a test + 2 gap fixtures outstanding |
| ➖ | **3** — methods-only file-out | **cut** (see the step for why) |
| | | **— FILE IN —** |
| ✅ | **4** — **file in**, part 1: read Tonel into definitions | done |
| ✅ | **5** — **file in**, part 2: apply to the image | done; round trip is a fixpoint |
| ✅ | **6** — make it reachable: gate + menus, filters, code lens | done; the feature is usable from the UI |
| ✅ | **8** — prose sweep + how-to page | done; CHANGELOG, how-to, output-channels fix |
| ⬜ | **9** — final gate | **← NEXT** |

**Tests so far: 257.** All pass against a rowan3 stone. The branch and its stones now
live entirely on thor (`/thor1/users/ewinger/worktrees/issue616-tonel-fileout`), so the
NFS symlink workaround is gone. Lint, format and compile clean.

**Steps are not being done in numeric order.** Step 2 turned out to be mostly covered by
Steps A and 1, and Step 3 was cut, so the order worked so far is
**A → 0 → 1 → 4 → 5 → 6 → 8 → (9 next)**, with the remainder of 2 deferred. The numbers are labels,
not a sequence.

Decisions taken since the plan was first written, each from review feedback, all recorded
in the step that owns them:

- class-complete export, not package-partitioned (so: populate always, one code path);
- DataCurator must see the commands → reach through to the Rowan dictionaries;
- no methods-only file-out (Step 3 cut);
- trait methods excluded — traits are not a supported feature;
- non-zero environments not exported, matching the chunk file-out.

---

# Part 1 — Context (for a human)

## What we're building

Jasper files code out as Topaz chunk (`.gs`) today. This adds a second format —
**Tonel**, the one-class-per-file `.class.st` format Rowan and Pharo use — so a core
developer can pull a base class out of a stone, put it in git, and put it back.

Scope is deliberately narrow, per Eric's edit on the issue: **core developers,
GemStone 3.7.5 and later, on a rowan3 extent.** The unit is the **class** — definition,
comment and every method a Jasper user can see, in one file (see Step 3 for why there is
no methods-only variant). Not a
general end-user feature, and explicitly not something that works — or appears — on the
3.6.x releases Jasper otherwise supports.

## The two halves

The issue asks for file out **and** file in, and they are roughly equal work:

- **File out** — live class → Tonel text. Steps 1 and 2. Rowan's writer does the
  formatting; we build the definition and drive it.
- **File in** — Tonel text → live class. Steps 4 and 5, split because the two halves fail
  differently: *reading* is Rowan's parser plus the riskiest escaping in the feature,
  *applying* is Jasper's ordinary compile path plus a set of decisions about what happens
  to a class that already exists.

File in is the half with the unanswered design questions — see Step 5.

## Why this is mostly glue, not engineering

A rowan3 extent already ships both halves, and they are the *reference*
implementation — the same code that wrote the 720 `.class.st` files under
`$GEMSTONE/projects/gemstoneBaseImage/rowan/src/`. All three confirmed present in
`$GEMSTONE/projects/RowanV3/rowan/src/` in the 3.7.5 product source on this machine:

| Direction | Rowan class | What it gives us |
|---|---|---|
| Live class → definition | `Class >> rwClassDefinitionInSymbolDictionaryNamed:` | an `RwClassDefinition` from any class, Rowan-loaded or not |
| Definition → Tonel text | `RwModificationTonelWriterVisitorV2` | `_writeClassDefinition:on:`, `_writeClassSideMethodDefinitions:on:`, `_writeInstanceSideMethodDefinitions:on:` |
| Tonel text → definition | `RwRepositoryResolvedProjectTonelReaderVisitorV2` / `RwTonelParser` | parses a class file into real definition objects |

So we write **no parser and no writer**. We write the call sequence around them, plus
the client-side plumbing (menus, dialogs, the target-dictionary prompt, per-item
outcome reporting) that File Out/File In already has for chunk format.

## The four things that make it non-trivial

1. **There is no public single-class entry point on either side.** The writer's public
   API is all project/package *modification* visitors, and `_classSourceFile` writes
   into a package directory we don't have. The reader's public API takes a **file
   path**, not a string. We drive the private layer underneath both. That is a real
   coupling to a class we don't own — the plan pins it with tests that fail loudly and
   by name if the shape changes.

2. **`methodSortBlock` is a landmine.** It lazily reads
   `currentProjectDefinition methodSortOrder`, which is `nil` on a bare visitor — so a
   visitor we instantiate ourselves will doesNotUnderstand the first time it sorts
   methods. Our glue must send `methodSortBlock:` explicitly.

3. **Tonel carries no SymbolDictionary.** `#category` in a Tonel header is a *package*,
   not a dictionary. On the way out the dictionary is an argument; on the way in it is
   a separate user choice.

4. **Topaz's `TFILE` is not the read path.** `RwTopazTonelReader>>createClassFrom:`
   hard-errors on `#pools` and `#gs_constraints` — keys Rowan's own writer emits — and
   errors outright whenever a class reshapes. Do not reach for it.

## Testing is the interesting part

**Every test for this feature runs against a rowan3 3.7.5 stone, and only there.**

Today that stone does not exist in this repo. `client/bin/gs-reset-extent.sh` always
copies the pristine `$GEMSTONE/bin/extent0.dbf`, and the integration matrix in
`client/.gemstone-integration-releases.json` (3.6.2, 3.6.8, 3.7.2, 3.7.4.3, 3.7.5) is
five base extents. The one existing Rowan test,
`client/src/queries/rowan/__tests__/rowanExportFixpoint.integration.test.ts`, skips in
CI on every run and always has.

**Building that stone is part of this work, not a prerequisite someone else owns.**
Step A adds a rowan3 extent to the harness so a developer gets one with a single
command, and the integration tier runs against it locally.

The skip rule that goes with it matters as much as the stone:

> **Skip on capability, never on environment.** No test may ask "am I in CI?", "is this
> the default stone?", or "is this version 3.7.5?". It asks whether *the machinery this
> feature drives is present in this session* — and runs if it is.

That is what makes the tier future-proof in both directions Eric named: the day a
rowan3 stone is added to CI, or the day rowan3 lands in `extent0.dbf` itself, these
tests **start running on their own**, with no edit and nobody remembering to make one.
Until then they report skipped in CI, and a green `npm test` on a base extent says
nothing about this work — a skip is a non-result, not a pass.

The payoff for that inconvenience is a test we could not otherwise write: **720
reference files on disk, written by the exact code we are calling.** File the same
classes out through our glue and diff. That is a far stronger reference corpus than any
fixture we could author, and it is the spine of the plan.

## Risks, called out up front

- **Private-API drift** across Rowan generations. Mitigated by pinning to a Rowan
  extent, probing `respondsTo:` in a named test, and the corpus diff.
- **The reader has no string entry point.** Two ways around it (drive `RwTonelParser`
  on a `ReadStream`, or have the gem write a temp file). Step 0 decides which, with a
  spike against a live stone. If both prove unworkable, the fallback is a TypeScript
  Tonel reader — explicitly out of scope today, and the only thing that would revive it.
- **Telling rowan3 apart from the older Rowan.** Both generations ship in the same
  3.7.5 tarball (`$GEMSTONE/projects/Rowan` and `$GEMSTONE/projects/RowanV3`), both put
  a global named `Rowan` in the symbol list, and both have classes named
  `RwModificationTonelWriterVisitorV2` — which emit *different* header key sets. So
  "does `Rowan` resolve?" is the wrong question. Gate on the capability instead (Step 6).
  On a rowan3 stone the machinery is simply present; the earlier worry that `Rowan`
  might be missing there was about *base* extents, where Rowan genuinely is not
  installed, and does not apply here.

---

# Part 2 — Execution plan (agent-level)

## Conventions this follows

- Queries live in `client/src/queries/`, one file per query, taking a `QueryExecutor`
  (`client/src/queries/types.ts`). The rowan3-gated ones live in `client/src/queries/rowan/`
  and follow its house style exactly: probe
  `System myUserProfile symbolList objectNamed: #'Rowan'`, `^` a `!`-prefixed sentinel
  when absent, `escapeString` every interpolated name, `Unicode7` write streams.
- Two test tiers per query: a unit test with a `vi.fn()` executor pinning the *emitted
  Smalltalk* (`client/src/queries/__tests__/fileOutQueries.test.ts` is the model), and
  an integration test against a live stone (`fileOut.integration.test.ts` is the model).
- New code goes under `client/src/queries/tonel/` + `client/src/fileTransfer/`.
- `npm run lint && npm run format:check && npm run compile && npm test` before done.
  Never silence a lint rule.

## The tests, written out

**Status:** ✅ written · ⬜ outstanding. Entries are identified by FILENAME and are
deliberately un-numbered: this document already numbers steps (A, 0–9), and a second
numbered list in the same document reads as the first — "✅ 2." here was taken to mean
"Step 2 is done". Four files below were not in the original
inventory — they were added as review feedback exposed gaps (the three-way oracle split,
method ORDER, and churn). They are marked ➕.

TDD means these exist and fail before the code they describe. This is the red phase in
full — file by file, case by case, with the assertion each one makes. Nothing below is
"and some tests for X".

**Ordering rule:** a case may only be written once it can fail *for the right reason*.
An integration case with no stone fails on connection, which proves nothing — so Step A
comes first, and its own red case is the capability probe.

### ✅ `client/src/queries/tonel/__tests__/tonelCapability.test.ts` — unit, no stone

Drives a fake `QueryExecutor`; pins the probe's emitted Smalltalk and its decoding.

| Case | Asserts |
|---|---|
| `probes every selector the feature actually sends` | emitted code names `_writeClassDefinition:on:`, `_writeClassSideMethodDefinitions:on:`, `_writeInstanceSideMethodDefinitions:on:`, `methodSortBlock:`, `rwClassDefinitionInSymbolDictionaryNamed:`, `RwTonelParser` |
| `is false when any single selector is missing` | one case **per selector** (parameterized), so a future Rowan dropping one is named in the failure |
| `is false when Rowan does not resolve at all` | base-extent shape → false |
| `asks no version question` | emitted code contains no `System _version` / version compare — the auto-enable property, pinned as a test |

### ✅ `client/src/queries/tonel/__tests__/tonelFileOutQueries.test.ts` — unit, no stone

| Case | Asserts |
|---|---|
| `resolves the class in the named dictionary` | `classLookupExpr` shape, dictionary interpolated |
| `sets methodSortBlock before writing anything` | index of `methodSortBlock:` < index of first `_write` — the spike's landmine |
| `writes definition, then class side, then instance side` | the three selectors appear in `processClass:` order |
| `populates every live selector from both sides` | emitted code iterates `selectors` for `cls` **and** `cls class` |
| `never emits a nil category` | `category:` is sent unconditionally |
| `takes no loaded/unloaded branch` | emitted code contains no `loadedClassForClass:` — pins the one-path decision |
| `escapes a class name containing a quote` | `escapeString` applied |
| `answers a sentinel instead of raising` | `!ERR ` on Error, `!NO_ROWAN` when absent |

### ✅ `client/src/queries/tonel/__tests__/tonelReadQueries.test.ts` — unit, no stone (**file in**, Step 4)

| Case | Asserts |
|---|---|
| `builds the throwaway project, package and visitor` | the R1 sequence from the spike |
| `parses from a ReadStream, not a file` | no `asFileReference` / `GsFile` in emitted code |
| `survives source containing a quote, a bracket and a newline` | fixture text round-trips through the escaper |
| `reports a parse failure as a sentinel` | malformed Tonel → `!ERR ` with the parser's message |

### ✅ `client/src/queries/tonel/__tests__/tonelWire.test.ts` — unit, pure TS (**file in**, Step 4)

| Case | Asserts |
|---|---|
| `decodes a class description into name, superclass, ivars, methods` | round trip encode→decode |
| `survives method source containing the field delimiter` | the framing choice is actually safe |
| `rejects a truncated payload` | throws, not silently half-decoded |

### ✅ `client/src/fileTransfer/__tests__/tonelFileIn.test.ts` — unit, fake session (**file in**, Step 5)

| Case | Asserts |
|---|---|
| `compiles the class definition into the chosen dictionary` | dictionary is the user's choice, not the file's `#category` |
| `compiles each method with its category and meta flag` | both sides, categories preserved |
| `one failing method does not abort the rest` | outcome lists the failure, others still compiled |
| `commits nothing` | no commit query issued |
| `reports per-line outcomes in FileInOutcome shape` | same report shape as chunk file-in |

### ✅ `client/src/queries/tonel/__tests__/tonelFileOut.integration.test.ts` — rowan3 only

| Case | Asserts |
|---|---|
| `header is byte-identical to the shipped file` | 3 corpus classes, reference picked **by package** |
| `every shipped method block appears verbatim` | method-fidelity oracle |
| `exports every selector the Explorer would show` | selector-completeness oracle: file selectors == `cls selectors` + `cls class selectors` |
| `a class Rowan has not loaded exports all its methods` | **the spike blocker, regression-guarded** — scratch class in UserGlobals |
| `a class Rowan has not loaded emits a real category` | never `#category : nil` |
| `an unresolvable class reports instead of writing a file` | sentinel surfaces, no file written |

### ⬜ `client/src/queries/tonel/__tests__/tonelCorpus.integration.test.ts` — rowan3, opt-in (Step 2)

Baseline is the spike's measured numbers; the assertion is equality with them.

| Case | Asserts |
|---|---|
| `all 649 resolvable classes have byte-identical headers` | 649, not "most" |
| `no shipped method is missing or altered anywhere` | 0 |
| `the 200 extension-free classes match whole-file` | whole-file byte equality where it is meaningful |
| `classes absent from the symbol list are skipped, not failed` | 69 skips reported by name |

### ⬜ `client/src/queries/tonel/__tests__/tonelGaps.integration.test.ts` — rowan3 only (Step 2)

The four header keys with **zero** corpus coverage. Hand-built fixtures, one case each:
`#pools`, `#gs_constraints`, `#traits`, `#classTraits` — each asserted to appear in the
file out and to survive a round trip.

### ✅ `client/src/queries/tonel/__tests__/tonelRoundTrip.integration.test.ts` — rowan3 only (**file in**, Step 5)

| Case | Asserts |
|---|---|
| `a class survives out and back into a different dictionary` | definition, both selector lists, each method's category and source |
| `file-in leaves the session dirty, not committed` | transaction state unchanged |

### ⬜ `client/src/__tests__/tonelAvailability.test.ts` — unit (Step 6)

| Case | Asserts |
|---|---|
| `sets gemstone.tonelAvailable from the probe` | context key wiring |
| `commands refuse when the key is false` | the palette route, which ignores `when` |

### ✅ Shared helper — `client/src/queries/tonel/__tests__/useRowan3Stone.ts`

Not a test. Wraps case 1's probe as a suite-level skip, so the condition is written once
and every rowan3 suite switches on together the day the capability appears in CI.

### ➕✅ `client/src/queries/tonel/__tests__/tonelCapability.integration.test.ts`

The probe against a live stone — the one thing every other rowan3 suite trusts. Added in
Step A so that step could be red-first like the rest.

### ➕✅ `client/src/queries/tonel/__tests__/tonelOracles.ts` + `tonelOracles.test.ts`

The four oracles, and their own tests. Not in the original plan, which said "diff against
the shipped file" — that turned out to be the wrong test entirely, and the split into
header / method-fidelity / selector-completeness / method-order oracles came out of it.
They are tested because a wrong oracle passes silently and takes every suite it backs
with it — and one was wrong (the header oracle swallowed the blank line before the first
method).

### ➕✅ `client/src/queries/tonel/__tests__/tonelDiff.ts` + `tonelDiff.test.ts`

An LCS line diff for the churn suite. A set difference would report "no change" when
lines come back REORDERED, which is exactly the churn worth catching — so that case is
the one test here that earns its keep.

### ➕✅ `client/src/queries/tonel/__tests__/tonelFileOutChurn.integration.test.ts`

**A small change must make a small diff.** Added from review feedback, and it is the
suite closest to how the feature is actually used: these files live in git. Every other
suite would pass on a file-out that reshuffled methods on every write and made each
commit a whole-file rewrite.

## Step A — A rowan3 test stone in the harness ✅ DONE

Everything downstream needs a stone that does not exist yet. This step is the reason
the feature is testable at all, and it ships as part of the PR.

The harness is already shaped for it — `gs-test-setup.sh` is a five-line pipeline
(`gs-install` → `gs-stop` → `gs-reset-extent` → `gs-start` → `gs-create-test-env-file`),
and `gs-config.sh` already derives per-instance stone and NetLDI names from `NAME`. Two
changes:

1. **`client/bin/gs-reset-extent.sh` takes an optional extent name**, defaulting to
   `extent0.dbf` so every existing caller is unaffected. It copies
   `${GEMSTONE}/bin/<extent>` and **still lands it as `data/extent0.dbf`** — the stone
   always reads `extent0.dbf`; which pristine copy it came from is this script's
   business alone. Fail with a clear message when the requested extent is not in the
   tarball, because that is exactly what happens on 3.6.x and the error should say so.
2. **A second instance name**, so the rowan3 stone and the default stone can run side
   by side rather than clobbering each other's `data/` and `.env.test`:
   `npm run test:server:start:rowan3` → `gs-test-server.sh --start 3.7.5 jasper-rowan3`
   with the new extent argument threaded through `gs-test-setup.sh`.

Two details that will bite otherwise:

- **`.env.test` is a single file and both stones write it.** `gs-create-test-env-file.sh`
  writes `client/.env.test` unconditionally, so starting one stone repoints the whole
  suite at it. Decide this explicitly rather than by accident — a separate
  `.env.test.rowan3` plus a vitest project that loads it is the clean answer; whatever
  is chosen must be written down, because a stale env file pointing at a dead stone
  produces a connection error that reads like a broken branch.
  (Related trap already on record: a stale `client/.env.test.local` silently overrides
  `.env.test`.)
- **`GEMSTONE_DATA_DIR` is per *version*, not per instance** (`gs-config.sh` derives it
  from `$GEMSTONE` alone). Two 3.7.5 stones would fight over one `data/` directory.
  Either give the rowan3 stone its own data dir or accept one-3.7.5-stone-at-a-time and
  say so in the script's usage comment.

**Red first, even here.** Test file 1 (`tonelCapability.test.ts`) and the
`useRowan3Stone.ts` helper were written *before* the scripts, plus one integration case
asserting the probe answers true. Step A is done when that case goes green against a
rowan3 stone and *skips* — never fails — against a base extent. Both verified.

### What shipped

- `client/src/queries/tonel/tonelCapability.ts` — the gate, carrying the
  supported-configuration header.
- `client/src/queries/tonel/rowanLookup.ts` — the single way a Rowan class is named.
- `client/src/queries/tonel/__tests__/` — 23 cases (20 unit, 3 integration) plus the
  shared `useRowan3Stone.ts` gate.
- `client/bin/gs-reset-extent.sh` — optional `[extent]` argument, default `extent0.dbf`,
  always landing as `data/extent0.dbf`. Fails with the available extents listed when a
  release does not ship the one asked for (the 3.6.x case).
- `client/bin/gs-test-setup.sh` — `--extent <name>`, and prints which stone `.env.test`
  now names so the repoint is never silent.
- `client/bin/gs-test-server.sh` — passes trailing arguments through rather than learning
  each option itself.
- `npm run test:server:start:rowan3` / `test:server:stop:rowan3` (root + client).

**One `.env.test`, as before.** Starting the rowan3 stone repoints the whole suite at it;
the two tiers do not run side by side. That is the existing design (one env file), not a
new limitation — hence the printed confirmation line.

### Two environment facts this turned up, both measured

**1. GemStone refuses an extent on NFS.** `$GEMSTONE/data` under the repo is on uffda,
and `startstone` fails with `File is on NFS, $GEMSTONE/data/extent0.dbf`. The existing
3.6.2 install already works around it — `data` is a symlink to ext4 under
`/thor1/users/ewinger/jasper-stones/`, with the original left as `data.nfs-was`. The
3.7.5 install needed the same treatment before a rowan3 stone would start. This is
machine-local setup, not a repo change, but every developer on an NFS checkout hits it,
so it belongs in the how-to page (Step 8).

**2. The feature needs a session whose symbol list has the Rowan dictionaries, and
DataCurator's does not.** On a 3.7.5 rowan3 stone:

| user | symbol list |
|---|---|
| SystemUser | UserGlobals, Globals, Published, **RowanKernel, RowanLoader, RowanTools, RowanClientServices** |
| DataCurator | UserGlobals, Globals, Published |

`RwModificationTonelWriterVisitorV2` and `RwTonelParser` live in **RowanKernel**;
`RwMethodDefinition` lives in **RowanTools**. So as DataCurator — the harness's
configured `VITE_GEMSTONE_USER` — the global `Rowan` resolves but none of the `Rw*`
classes do, and the probe answers "unavailable" on a perfectly good rowan3 stone.

**Decided (Eric): DataCurator must see the commands — reach through to the Rowan
dictionaries.** So the feature never resolves an `Rw*` class through the session's symbol
list alone. `client/src/queries/tonel/rowanLookup.ts` is the single place that names a
Rowan class: session symbol list first, then SystemUser's profile, guarded so a user
without read access to `AllUsers` gets a quietly unavailable feature rather than a
walkback.

Every cheaper route was tried against the live stone first, and each one is symbol-list
scoped — recorded here so nobody re-tries them:

| Route | Result from DataCurator |
|---|---|
| `Globals at: #RowanKernel` | nil — the dictionaries are not in Globals |
| `Rowan globalNamed: #RwTonelParser` | nil |
| `Rowan image symbolList` | the session's own list again |
| `Rowan image symbolDictNamed: 'RowanKernel'` | raises: "No symbol dictionary … found" |
| `ClassOrganizer new classes` | 1123 classes, `RwTonelParser` not among them |
| `SymbolDictionary allInstances` | 33,961 objects — not a lookup |
| `(AllUsers userWithId: 'SystemUser') symbolList` | **resolves** |

Verified end to end, not merely resolved: a DataCurator session files a class out through
the reach-through successfully, so the classes are usable once named.

The test suites therefore run as the harness's **ordinary configured user (DataCurator),
deliberately not swapped to SystemUser** — running as DataCurator is what proves the
reach-through works for the user who needs it. A suite that quietly swapped to SystemUser
would pass while the shipped feature stayed invisible to everyone else.

## Step 0 — Spike (throwaway; nothing committed) ✅ DONE

Not TDD — this is the fact-finding that makes the tests writable. Four questions, none
of which can be settled by reading source, because all four are about runtime behaviour.

Needs a rowan3 stone but **not** the Step A harness work: `copydbf` the 3.7.5
`extent0.rowan3.dbf` into a scratch data dir and `startstone` by hand. (The stone
currently up on thor is a base extent and cannot be used.)

### W1 — does the writer reproduce a shipped file byte for byte?

The whole test strategy rests on "yes". Everything downstream is worthless if the
answer is "nearly".

```smalltalk
| defn v ws |
defn := StringPair rwClassDefinitionInSymbolDictionaryNamed: 'Globals'.
v := RwModificationTonelWriterVisitorV2 new
  methodSortBlock: [:a :b | a selector _unicodeLessThan: b selector];
  yourself.
ws := WriteStream on: Unicode16 new.
v _writeClassDefinition: defn on: ws.
v _writeClassSideMethodDefinitions: defn on: ws.
v _writeInstanceSideMethodDefinitions: defn on: ws.
ws contents
```

Diff against `$GEMSTONE/projects/gemstoneBaseImage/rowan/src/Filein2A/StringPair.class.st`.
`StringPair` is the right first target: a comment, a `#gs_reservedoop`, and no methods —
it exercises the header path alone, so a mismatch cannot be blamed on method ordering.
Then repeat with a class that has both instance and class methods.

Specifically watching for: **the leading comment block** (`_writeClassDefinition:on:`
emits it before the `Class {` line — does a live definition carry the comment the file
shows?); `#gs_reservedoop` surviving the round out of a live class; the trailing
newline; `_newLine` resolving via `self class lineEnding`; and whether class-side really
precedes instance-side, which is the order `processClass:` uses.

### W2 — the same for an extension file

*Was:* `_writeClassExtension:on:` plus one
`_writeMethodDefinition:classDefinition:isMeta:on:`, diffed against a shipped
`.extension.st` — to decide whether a methods-only file-out was writable.

**Moot.** Step 3 is cut: there is no methods-only file-out, so nothing needs
`_writeClassExtension:on:` on the write side. Left recorded only so the next reader
knows it was considered and why it went away.

### R1 — can the reader be driven from a string, with no filesystem?

The public entry (`readClassFile:`) does `file asFileReference readStreamDo:` — it takes
a **path**, and our Tonel text is on the user's machine, not the gem's. Both signatures
are confirmed to exist; what is unknown is whether a hand-assembled visitor works:

```smalltalk
| proj pkg v parser |
proj := RwResolvedProjectV2 new
  projectName: 'JasperTonelRead';
  packageConvention: 'Rowan';
  gemstoneSetDefaultSymbolDictNameTo: 'Globals';
  yourself.
proj addLoadComponentNamed: 'Core' comment: 'throwaway'.
pkg := proj addPackageNamed: 'P' toComponentNamed: 'Core'.
v := RwRepositoryResolvedProjectTonelReaderVisitorV2 new
  currentProjectDefinition: proj;
  currentPackageDefinition: pkg;
  _packageConvention: 'Rowan';
  yourself.
parser := RwTonelParser on: (ReadStream on: tonelText) filePath: 'string' forReader: v.
parser start
```

The specific thing that may bite: `readClassFile:inPackage:` calls
`validateClassCategory:forPackageNamed:`, and a real file's `#category`
(`Collections-Support`) will not match our throwaway package name. If validation is in
the parser path rather than the file path, this fails and R2 takes over.

### R2 — the fallback, if R1 fails

Have the **gem** write the text to a temp file (`GsFile`) and hand `readClassFile:` the
path. Works for remote stones too, since the gem writes it — but it needs a writable
directory on the gem's host and a cleanup path, so it is the second choice.

**Output:** the exact working Smalltalk pasted into "Verified Smalltalk" below, a
byte-diff verdict for W1, and an R1-vs-R2 decision. Every step after this one quotes
that Smalltalk rather than re-deriving it.

**Status: run and complete** — see "Verified Smalltalk" below.

## Step 1 — File out one class (TDD) ✅ DONE

1. **Red (unit)** — `client/src/queries/tonel/__tests__/tonelQueries.test.ts`:
   `fileOutClassTonel(exec, 'Animal', 'Globals')` emits code that
   (a) probes `Rowan` and returns the `!NO_ROWAN` sentinel,
   (b) sends `rwClassDefinitionInSymbolDictionaryNamed:` with the escaped dict name,
   (c) sends `methodSortBlock:` before any write — the landmine, pinned,
   (d) sends the three `_write…` selectors in `processClass:` order: definition,
       **class side, then instance side**,
   (e) returns a `!ERR ` sentinel on Error rather than raising.
2. **Red (integration)** — `client/src/queries/tonel/__tests__/tonelFileOut.integration.test.ts`.
   **rowan3 stone only** — skipped elsewhere via the shared capability helper (Step 6/9).
   Three classes from the corpus with different shapes (one with `#instVars` +
   `#gs_reservedoop`, one with `#classVars`, one with `#gs_options`), asserted against
   the three oracles above — header identical, shipped methods present verbatim,
   selector set complete. **Not** a whole-file diff: our output is deliberately a
   superset. Pick reference files by package (the RowanV2/V3 duplicate trap).
3. **Green** — `client/src/queries/tonel/fileOutClassTonel.ts` + the `browserQueries.ts`
   re-export. One path: take the header from
   `rwClassDefinitionInSymbolDictionaryNamed:`, set a non-nil category, then populate
   **every** method from the live class (both sides) before writing. No loaded/unloaded
   branch — see the spike's "One code path" finding for why the branch would be a bug,
   not an optimization.

### Outcome

`client/src/queries/tonel/fileOutClassTonel.ts`, plus `__tests__/tonelOracles.ts` — the
three oracles, which got their own unit tests because a wrong comparison passes silently and
takes every suite it backs with it.

All three fixtures (`Message`, `SystemLoginNotification`, `NscBuilder` — chosen for
`#gs_reservedoop` + `#instVars`, `#classVars`, `#gs_options`) pass all three oracles on
the rowan3 stone, **as DataCurator**.

Two things worth keeping:

- **Header identity and method fidelity passed first time.** The spike's measurements
  held: the writer reproduces the reference exactly, and populate-always loses nothing.
- **The three oracles needed a normalization decision.** Blank lines at the header/method
  boundary belong to neither side, so `headerOf` and `methodBlocksOf` both normalize
  them; everything *inside* a header or block stays exact. Pinned by its own test rather
  than left implicit.

Totals: **55 Tonel cases** — all 55 pass on rowan3; 44 pass and 11 skip on a base extent.
Full suite green (client 9527 passed / 162 skipped, server 329, mcp 94), lint, format and
compile clean.

### Churn: a small change must make a small diff

Added after review feedback — these files exist to live in git, and the suites above
could all pass on a file-out that reshuffled methods on every write, making every commit
a whole-file rewrite. `tonelFileOutChurn.integration.test.ts` files a deliberately
non-trivial class out, changes ONE thing through Jasper's ordinary write path, files it
out again, and asserts the diff is exactly that change. Uses an LCS line diff
(`tonelDiff.ts`), not a set difference — a set difference reports "no change" when the
same lines come back reordered, which is the churn worth catching.

Covered: no change at all; recompiling identical source; adding a method mid-order;
deleting one; changing a body; changing a protocol; changing the class comment; adding a
class-side method.

**What can change method order, established rather than assumed:**

| Change | Effect on order |
|---|---|
| Add / rename a method | takes its sorted position — minimal diff (tested) |
| Move a method between sides | moves between the two runs (tested for additions) |
| The comparator itself | **164 of 776 classes order differently** under `codePointCompareTo:` vs `_unicodeLessThan:` — pinned by test, `Message` discriminates |
| Change a protocol / category | none — sorting is by selector only (tested) |
| Change method source | none (tested) |
| Change the class comment | none (tested) |
| Add an instance variable | see below — not an ordering question at all |

**Findings from writing these:**

- **Class changes carry the methods over — that is the DEFAULT case for these users,**
  and an earlier note here claiming otherwise was wrong. Jasper's class-changing commands
  go through the refactoring engine, which carries behaviour forward:
  `GsInstVarStructureRefactoring >> copyMethodsFrom:to:` — *"a new class version starts
  with an empty method dictionary, so this carries the behaviour forward."* So the churn
  test sets the image up the way a developer's edit leaves it, and adding an instance
  variable touches the header only. One unavoidable extra line: the previously-last
  instance variable gains a trailing comma when it stops being last — inherent to the
  list format, git shows it too. (A bare `subclass:` *does* leave the new version
  method-less; that is not a path a developer takes, and is noted only so nobody
  re-derives it and mistakes it for what users see.)
- **Methods in a non-zero environment are never exported.** `selectors` does not report
  them, verified on a rowan3 stone. This matches the chunk file-out, which pins
  `environmentId: 0` deliberately — **confirmed as the intended behaviour (Eric)**, so
  both formats agree on what a file-out contains. Pinned by test.
- **Trait methods are excluded — decided (Eric): traits are new-ish and not supported.**
  A trait's methods are not the class's own code; exporting them would put methods in a
  class's file that it does not define, and adding a trait would rewrite the whole file.
  Filtered by `isFromTrait`, which is now part of the capability contract, so a stone
  where we cannot tell hides the feature rather than quietly exporting them. The
  selector-completeness oracle excludes them too, so the contract is stated in one way
  on both sides.

## Step 2 — Widen the oracles ◐ MOSTLY DONE ELSEWHERE

**Read this before picking the step up.** Two of the four items below were already
covered while building Steps A and 1, and a third was cut. Only the corpus sweep is
genuinely outstanding, and even that has been run once by hand. The step as originally
written overstates what is left.

| | Item | State |
|---|---|---|
| ⬜ | **Corpus sweep as an automated test** | outstanding — the spike ran it by hand (649/649 headers, 649/649 method fidelity, 0 missing), but those numbers live in this document, not in a test that will re-run |
| ✅ | **The non-Rowan-loaded class** | done in Step 1 — `a class Rowan has not loaded exports all its methods` and `… emits a real category`, both in `tonelFileOut.integration.test.ts` |
| ◐ | **Gap fixtures** | `#traits` / `#classTraits` **cut** — traits are not a supported feature and their methods are excluded. `#pools` and `#gs_constraints` remain, and the corpus covers neither |
| ✅ | **API-shape guard** | done in Step A, as the capability probe: `tonelCapability.ts` names every private selector the feature drives, with one unit case per selector so a dropped one fails by name |

So the remaining work is: **(1)** turn the hand-run corpus sweep into an opt-in test that
asserts equality with the 649/649/0 baseline and reports non-resolving classes (69) as
skips rather than failures; **(2)** two gap fixtures, for `#pools` and `#gs_constraints`.

Worth weighing against Step 5's fixpoint test before spending time here: that test files
real base-image classes out *and back in*, so it subsumes much of what a file-out-only
corpus sweep proves, on the same input.

## Step 3 — *Cut.* No methods-only Tonel file-out

An earlier draft had a "file out selected methods" command writing an
`Extension { #name : 'Foo' }` file. **Dropped**, and the reasoning is worth keeping
because it is the same reasoning as the class-complete decision above.

A methods-only file is a *chunk-format* idea: file out one method, file it into a stone
that already has the class. Tonel has no such unit — one file is one class, definition
and methods together. The only Tonel shape that carries methods without a class
definition is `Extension { }`, and that shape means "these methods belong to another
package" — the exact Rowan concept we just decided must never reach a Jasper user, who
cannot see Rowan and has no packages. Offering it as an output format would put that
concept in front of them in the menu.

So the Tonel file-out unit is **the class**: definition, comment and every method a
Jasper user can see, in one file. A developer who wants one method in git files out its
class. The chunk-format method-level commands (`gemstone.explorer.fileOutMethods`,
`fileOutProtocol`) are untouched and keep working as they do today — this removes
nothing that exists.

The read side needs nothing either. `.extension.st` files reach a developer through a
Rowan project checkout, and **Rowan is not integrated into Jasper** — that workflow does
not exist for this feature's users. Not a deferred question; simply not in the picture.

## Step 4 — FILE IN, part 1: read Tonel into definitions (TDD) ✅ DONE

1. **Red (unit)** — `readTonelClass(exec, tonelText)` emits the R1-or-R2 sequence from
   Step 0, escapes the text safely (it contains quotes, brackets and newlines — this is
   the riskiest escaping in the feature; pin it with a fixture containing `'`, `"`, and
   a `]`), and returns `!NO_ROWAN` / `!ERR <message>` sentinels.
2. **Red (integration)** — parse a shipped corpus file, assert the returned structure
   names the right class, superclass, instVars and selector counts.
3. **Green** — `client/src/queries/tonel/readTonelClass.ts`.

**Wire format:** the query returns a *description* of the parsed definition, not live
objects — class name, superclass, type, instVars/classVars/classInstVars, comment, and
one record per method (isMeta, category, source). Follow the existing structured-return
idiom (`describeClass.ts`, `getStepPointBundle.ts`) rather than inventing one, and
choose a framing that survives arbitrary method source. Decoder gets its own pure unit
test with an encode/decode round trip.

## Step 5 — FILE IN, part 2: apply to the image (TDD) ✅ DONE

The parsed definition is applied with **Jasper's existing compile path**, not Rowan's
loader: `compileClassDefinition` for the class, then `compileMethod` per method. This
keeps the target dictionary a user choice, creates no Rowan loaded-package bookkeeping,
gives per-method outcome reporting for free, and — matching chunk file-in —
**commits nothing**.

- **Red (unit)** — a fake session; assert the class definition is built in the chosen
  dictionary, every method is compiled with its category and meta flag, and one failing
  method is reported without aborting the rest.
- **Red (integration)** — **round trip**: define a scratch class with instance and class
  methods in known categories → file out as Tonel → file in to a *different* scratch
  dictionary → compare `definition`, both selector lists, and each method's category and
  source.
- **Green** — `client/src/fileTransfer/tonelFileIn.ts`, reusing the `FileInOutcome`
  shape from `fileTransfer/fileIn.ts` so the report reads the same as a chunk file-in.

### The big one: a round-trip FIXPOINT over real base-image classes

Eric's suggestion, and it is the strongest test available to this feature: the base image
is hundreds of real classes with every header key, selector shape and source oddity that
exists — input diversity no hand-written fixture will ever match. It also tests the two
halves **against each other** rather than each against my fixtures, which is where an
asymmetry would hide (the writer emitting something the reader cannot parse, or the
reader quietly normalising something away).

**Constraint that shapes it: never file a base class back onto itself.** Measured on a
rowan3 stone: **0 of 1127 `Globals` classes answer `canBeWritten`** — `Object`, `String`,
`Message`, all false. As DataCurator the file-in simply errors. As SystemUser it might
succeed, and that is worse: file-in is REPLACE, so `removeAllMethods` on `Object` or
`String` would destroy the running gem before the transaction could abort. The test must
file in **under a different name, into a scratch dictionary.**

**Shape — a text fixpoint, not a field-by-field comparison:**

```
t1 = fileOut(C)                      "a real base-image class"
t1' = rewrite(t1)                    "#name -> JasperRT_<C>, drop #gs_reservedoop"
       file in t1' to UserGlobals    "creates the copy"
t2 = fileOut(JasperRT_<C>)
assert t2 == t1'
```

Why this rather than comparing definitions and method lists field by field:

- **One string comparison proves everything at once** — superclass, instVars, classVars,
  classInstVars, type, comment, every method's category, every method's source, AND the
  method order. A field-by-field check would have to remember to assert each of those,
  and would silently not cover whatever it forgot.
- **It reuses the machinery already built** — the file-out path and the four oracles.
- **There is precedent in this repo**: `rowanExportFixpoint.integration.test.ts` proves
  Rowan project export the same way, so the shape is familiar to a reviewer.

**Two rewrites are forced, and both are findings worth stating:**

- `#name` — obviously, since the copy cannot shadow the original.
- `#gs_reservedoop` — a reserved OOP belongs to the original class and cannot be claimed
  by a copy. So the fixpoint holds *modulo* that key, and the test says so rather than
  quietly stripping it. (370 of the corpus files carry one.)

**Failures that are NOT our bug, so this is baselined rather than absolute:** methods with
`<primitive:>` pragmas, references to pool dictionaries or class variables the copy does
not inherit, and classes whose superclass chain cannot be reproduced. Measure once,
record the number, and assert against that baseline — exactly as the corpus sweep asserts
649/649/0 rather than "mostly passes". A class that newly fails is then a real signal.

**Tiering:** a handful of shape-diverse classes in the default run; the full sweep opt-in
behind an env var, like the corpus sweep, since it is hundreds of classes through two
round trips each.

### Decided (Eric) — settled before the code is written

File out reads a class and cannot damage anything. File in writes, over classes that may
already exist, so each of these is visible to the developer.

1. **REPLACE, not merge.** A file-in is an **explicit instruction by the system
   developer**: the file is the intended state of the class. A method the image has that
   the file does not carry is *removed*. (The earlier draft proposed merge, on the
   grounds that deleting a colleague's method is the worse failure — overruled, and the
   reasoning is that this audience is filing in deliberately, not importing casually.)

   Implementation: clear the class's methods on both sides, then compile the file's.
   `removeAllMethods` already exists (`queries/removeAllMethods.ts`), so the replace is
   one query rather than a diff.

2. **The user must be able to find every failure.** Not a toast that vanishes.

   Reuse the chunk path's mechanism verbatim — it is already exactly this, in
   `fileTransfer/fileIn.ts`: a **`GemStone File In` output channel** holding one line per
   note (`ERROR <file>:<line> — <message>`), plus a toast that names the first error
   inline and carries a **`Show Log`** button that reveals the channel. Tonel file-in
   writes into the SAME channel and uses the same toast, so a developer has one place to
   look regardless of format, and nothing new to learn.

   What has to reach that log, at minimum: a superclass that does not resolve; a method
   that will not compile; a class that cannot be created or written
   (`canClassBeWritten`); a file that is not parseable Tonel.

3. **A missing superclass is an error against the file**, reported as above, and the
   class is not created — never silently rooted at `Object`.

4. **Target dictionary: default to the dictionary the class is already in.**
   - in exactly one dictionary → use it, no prompt;
   - in several → **ask**, so a shadowed name cannot be resolved by guess;
   - nowhere yet (a new class) → ask, defaulting sensibly.

   Tonel genuinely cannot tell us this — `#category` is a package, not a
   SymbolDictionary — so it is the one input that has to come from the user or from the
   image.

5. **Never commit.** Matches chunk file-in and the rest of Jasper: the session is left
   dirty and the developer decides. Said in the toast every time, as the chunk path does.

6. **Partial failure does not abort the rest.** One method that will not compile is
   reported against its line; the remaining methods still file in.

### What the fixpoint test caught that the unit tests could not

Both were real defects in code whose unit tests were already green:

- **The parser answers methods ALONGSIDE the class definition, not attached to it** —
  `(defs at: 2) at: 1` is the class side, `at: 2` the instance side. Rowan's own
  `readClassFile:inPackage:` attaches them in a separate step. Reading the definition's
  own method dictionaries found nothing, so every file-in produced a class with a correct
  header and **zero methods**, silently.
- **The class comment was decoded and then never applied**, so the copy came back
  comment-less.

Neither is visible to a unit test that mocks the query layer: both live in the seam
between the two halves. That is the argument for this test shape.

### Tests these decisions add

| Case | Asserts |
|---|---|
| `removes a method the file does not carry` | replace, not merge — the decisive case |
| `reports a missing superclass and creates nothing` | no half-built class |
| `writes every failure to the GemStone File In channel` | findable, not just a toast |
| `offers Show Log when anything failed` | the route to the detail exists |
| `uses the class's own dictionary without asking` | the single-dictionary default |
| `asks when the class is in more than one dictionary` | no guessing on a shadowed name |
| `does not commit` | session left dirty |
| `one uncompilable method does not stop the others` | partial failure |

**Prose note for Step 8:** `docs/output-channels.md` lists eight channels and does **not**
include `GemStone File In`, which already exists in `fileTransfer/fileIn.ts`. That doc is
stale today, before this feature touches it — fix it while we are in there.

## Rowan comparison — critical review against Rowan's own writer

Run on 2026-09-18 against a rowan3 stone, driving **Rowan's own public writer**
(`Rowan projectTools write writeProjectNamed:`) over a throwaway project and diffing its
output against ours for the same class. Rowan's SUnit tonel tests
(`RwProjectTonelReaderWriterTest`, `RwTonelParserTest`, `RwTopazTonelReaderTest`) exist in
the source tree but are **not loaded in the extent**, so they could not be run; driving
the writer directly exercises the same code on the same input, which is the point.

It found two real defects. Both had passed every test we had.

### 1. Every method was written TWICE for a Rowan-loaded class

Rowan keys method definitions by the `#selector` property, and its own loaded definitions
use **Symbols**. We added ours with `newForSelector: sel asString` — a **String**.
Different keys, so `addInstanceMethodDefinition:` added ours *alongside* Rowan's instead
of replacing, and `addDefinition:to:`'s duplicate check never fired because the keys
genuinely differed. `Message` came out with 34 method blocks where the shipped file has
17.

**Fix:** clear the definition's method dictionaries before populating, so the live class
is the single source and the result does not depend on how Rowan happens to key them.
Also pass the selector as a Symbol, matching Rowan's own convention.

### 2. The test helpers could not see it — and would have invented a false one

`methodBlocksOf` answers a **Map** and `declarationsOf` **sorts**: both silently collapse
a doubled method, so every comparison built on them passed while the file-out was writing
each method twice. There was no test that could fail.

Worse, the key was taken from the FIRST LINE of a declaration. Rowan wraps long keyword
declarations across lines, and `Array class` really does define both
`byteSubclass:…inClassHistory:description:isInvariant:` and
`byteSubclass:…newVersionOf:description:options:`, whose first lines are identical. So
the helper both hid real duplicates and reported false ones — 22 files' worth.

**Fix:** a `duplicateDeclarationsOf` oracle that counts rather than collapsing, and a
declaration key that spans the wrapped lines with whitespace normalised.

### Duplicate coverage, after review

The first fix added the oracle and three spot checks. That was too thin for a defect
that shipped and hid, so the check now sits everywhere a Tonel file is produced or
consumed:

| Where | What |
|---|---|
| `tonelFileOut.integration` | per-fixture, plus a sweep over `Array`, `Behavior`, `Class`, `Object`, `System`, `CharacterCollection` — hundreds of methods each, and wrapped declarations |
| `tonelRoundTrip.integration` | inside the shared `fileOut` helper, so **every** file-out in the suite is checked |
| `tonelFileOutChurn.integration` | same, so before/after every mutation |
| `tonelWire` (decode) | a class defining one selector twice on a side is **rejected**, so a malformed or hand-edited file cannot reach file in, where REPLACE means the last one silently wins |
| `tonelOracles` | `declarationSequenceOf` now counts BLOCKS, not Map keys |

**Verified by reintroducing the defect**: with the old code restored, 10 cases fail. The
three original fixtures caught it only because they happen to be Rowan-loaded; `Array`,
`Object`, `System` and `CharacterCollection` are not, so they never duplicated — which is
why three small fixtures were never going to be enough.

That last point is the lesson worth keeping: `declarationSequenceOf` was reading the keys
of a Map, so the count check added in the same pass *also* could not see duplicates until
it was made to count blocks. A helper built on a Map is duplicate-blind by construction,
and every helper here was.

### Corrected corpus measurement

The earlier numbers in this document were taken with the flawed key. Re-measured with
both fixes, across the 649 resolvable corpus classes:

| Property | Result |
|---|---|
| Headers byte-identical to Rowan's | **649 / 649** |
| Files containing a duplicate method | **0** |
| Files missing or altering a shipped method | **0** |
| Whole-file byte-identical (extension-free classes) | **200** |
| Extra methods — the genuine class extensions | 13,400 |

The 13,400 figure survives, and now means what it was always claimed to mean: methods a
Jasper user sees on the class that Rowan files into other packages' `.extension.st`.
Previously it was right by accident, with duplicates and extensions both inflating a
count that was being read with a duplicate-blind key.

### Where we still differ from Rowan, deliberately

- **`#category`.** Rowan writes the **package** name. We have no package, so we write the
  class category, falling back to the symbol dictionary name. A Jasper file is therefore
  not drop-in loadable into a Rowan package tree without editing that key.
- **One file per class, extensions included.** Rowan splits a class's methods across its
  own `.class.st` and other packages' `.extension.st`. We write them all in the class
  file, by design — a Jasper user has no notion of a package.
- **No `package.st` / `properties.st`.** Rowan writes a project tree; we write one file
  the user names.

None of these is a defect, but all three mean a Jasper `.st` file is **Tonel that Rowan
can parse, not a Rowan project artifact.** Worth saying plainly in the how-to page.

## Step 6 — Make it reachable: gate + menus ✅ DONE

**Was two steps (6 gating, 7 wiring) and should never have been.** A `when` clause lives
ON a menu entry, so the gate cannot be built before the menus it gates — Step 6 alone
would have produced a context key nothing reads and nothing to demonstrate. One step.

### The gate

The probe is already built and tested (Step A): it asks the session whether the classes
and selectors this feature drives are actually present — not the version, not the extent
filename, not whether `Rowan` resolves, all of which are proxies that would stop the
feature ever switching itself on when rowan3 reaches CI or the base extent.

3.7.5 stays the documented support floor, not a runtime check: no 3.6.x tarball can
produce a stone where the probe passes.

Remaining work is to publish its answer and act on it:

1. Set context key `gemstone.tonelAvailable` from the probe on session connect.
2. `when`-clause every Tonel menu entry on that key.
3. Guard each command at runtime as well — the command palette ignores `when`.
4. Tests in `client/src/__tests__/tonelAvailability.test.ts`: key set true/false from the
   probe; commands refuse when the key is false.

### The wiring


- `client/src/fileTransfer/fileOut.ts` — add `TONEL_FILE_OUT_FILTERS` (`st`).
  **`FILE_OUT_FILTERS`'s doc-comment currently explains that `.st` is excluded because
  every route back in is gated on `gemstone-topaz`. That reasoning is now scoped to the
  chunk path — rewrite it in the same change.**
- `client/src/fileTransfer/fileIn.ts` — a separate `TONEL_FILE_IN_FILTERS`; the chunk
  path keeps its own filters and must not start accepting `.st`.
- `client/src/gemstoneCodeLensProvider.ts` — a "File In Tonel to GemStone" lens on
  `gemstone-tonel` file documents, gated on availability; its doc-comment at the
  `gemstone-topaz` predicate needs updating too.
- `package.json` — new commands, `commandPalette` `"when": "false"` entries where the
  siblings have them, editor/context and Explorer menu entries, `4_fileout` /
  `5_filein` groups.
- `client/src/gemstoneExplorer.ts` — the command handlers, alongside `fileOutClass` /
  `fileOutMethods`.
- Check `client/src/languageIds.ts`: its doc-comment already says a Tonel `.st` file is
  deliberately outside `BREAKPOINT_GUTTER_LANGUAGES`. Still true — verify, don't edit.

## Step 8 — Prose sweep (CLAUDE.md rule) ✅ DONE

Grep for the claims this change falsifies before calling it done:
`FILE_OUT_FILTERS`, `gemstone-topaz`, `fileformat utf8`, "every route back in",
"chunk format", and `docs/README.md`. Add a `docs/how-to/` page covering the Rowan-extent
requirement and the one-file-per-class unit, and a CHANGELOG entry. Report what was
stale, or say plainly that nothing was.

## Step 9 — Gate ⬜

Two runs, and **only the second one proves anything about this feature**:

1. `npm run lint && npm run format:check && npm run compile && npm test` on the usual
   test stone. A regression check on everything *else*: every test for this work must
   report **skipped** — not passed, not failed. A pass here means a test is not reaching
   rowan3 at all, which is a bug in the test, not good news.
2. The same suite against the **rowan3 stone from Step A**, where the tier actually
   executes. Say in the PR body that this run happened and on which stone — CI cannot
   do it today, so nothing else will say so, and a green badge must not be left to
   imply coverage that does not exist.

One shared helper — `client/src/queries/tonel/__tests__/useRowan3Stone.ts` — wraps the
Step 6 capability probe as a suite-level skip, so the condition is written once, no
individual test can get it subtly wrong, and every one of them switches on together the
day the capability appears somewhere new.

## Explicitly out of scope

Traits beyond the gap fixture; package/project-level Tonel export (Rowan's own export
already does that — `queries/rowan/exportRowanProject.ts`); a hand-written TypeScript
Tonel writer; `TFILE`; AST-Core (`RBTonelParser` parses method *bodies*, has no writer,
and cannot read a `Class { … }` header — it is not related to this work despite the name).

## Verified Smalltalk

Step 0 was run on 2026-09-18 against a 3.7.5 stone built from `extent0.rowan3.dbf`
(`gs64rowan3`, data in `/thor1/users/ewinger/jasperStones/db-rowan3`, started by hand —
no harness work needed). Verdicts below; every step above quotes this section rather
than re-deriving it.

### W1 — the writer is exact, for Rowan-loaded classes: **649 / 649 byte-identical**

Filed every resolvable class in the reference corpus out through the writer and diffed
against the shipped `.class.st`. **647 matched immediately; the 2 that did not were a
harness error, not a writer error** — `GsRowanImageTool` and `GsTopazRowanTool` each
appear *twice* in the corpus, once under `GemStone-RowanV2-Tools` and once under
`GemStone-RowanV3-Tools`, and picking the file by class name alone chose the V2 copy.
Against the V3 copy both match. **Final score: 649 of 649.**

(720 files, 718 distinct class names — two appear twice, see below — of which 649
resolve.) 69 of the 718 never resolved in SystemUser's symbol list at all (e.g.
`IndentingStream`, `StackSegment`, `SimpleBlock`) and were skipped — none errored.
*Test consequence:* the differential test must resolve tolerantly and report skips, and
must select the reference file **by package**, not by class name.

```smalltalk
| defn v ws |
defn := StringPair rwClassDefinitionInSymbolDictionaryNamed: 'Globals'.
v := RwModificationTonelWriterVisitorV2 new
  methodSortBlock: [:a :b | a selector _unicodeLessThan: b selector];
  yourself.
ws := WriteStream on: Unicode16 new.
v _writeClassDefinition: defn on: ws.
v _writeClassSideMethodDefinitions: defn on: ws.
v _writeInstanceSideMethodDefinitions: defn on: ws.
ws contents
```

Confirmed along the way: `methodSortBlock:` is genuinely required (the landmine is
real); class-side precedes instance-side; `_newLine` resolves via `self class
lineEnding` with no instance state; the leading comment block, `#gs_reservedoop`,
`#instVars` and `#classVars` all round-trip exactly.

### THE BLOCKER — `rwClassDefinitionInSymbolDictionaryNamed:` drops every method for a class Rowan has not loaded

The issue's research says this API "builds an `RwClassDefinition` from a live class,
including the classes Rowan has never loaded." It does — **without their methods.** Its
own comment says so outright: *"create an RwClassDefinition for the reciever suitable
for recreating the class. **Ignore methods**"*. It has two paths:

- class **is** Rowan-loaded → `loadedClass asDefinition`, methods included (this is what
  scored 649/649);
- class **is not** → a definition built from scratch, with **zero** method definitions.

A plain user class in UserGlobals with 2 instance and 1 class-side method files out as:

```
Class {
	#name : 'JasperSpikeWidget',
	#superclass : 'Object',
	#instVars : [ 'size', 'colour' ],
	#classVars : [ 'Registry' ],
	#category : nil
}
```

Header only. **Every method silently gone, no error**, and `#category : nil` is not even
valid Tonel. This is the case a developer filing out their own work hits *every time* —
so shipping the issue's design as written would have shipped silent data loss.

**Fix, verified working:** when Rowan has not loaded the class, populate the definition
from the live class ourselves, and set a real category. The writer then needs no change.

```smalltalk
defn category: aCategoryString.   "never leave it nil"
#(false true) do: [:meta | | target |
  target := meta ifTrue: [cls class] ifFalse: [cls].
  target selectors do: [:sel | | md |
    md := RwMethodDefinition
            newForSelector: sel asString
            protocol: (target categoryOfSelector: sel) asString
            source: (target compiledMethodAt: sel) sourceString.
    meta ifTrue: [defn addClassMethodDefinition: md]
         ifFalse: [defn addInstanceMethodDefinition: md]]]
```

### One code path: populate always — and the corpus is the wrong yardstick for methods

**Requirement (Eric):** export the methods *a Jasper user can see*. A Jasper user looks
at a class in the Explorer and sees all of its methods. They have no notion of a Rowan
package, and **no way to see Rowan at all** — so "this method is an extension, it lives
in another package's file" is a distinction that must not reach the output.

That means **populate always**, one path, no loaded/unloaded branch. It also fixes the
blocker above for free, since an unloaded class is just the case where there was nothing
to populate over.

An earlier read of this data recorded populate-always as "wrong, 22 / 649". **That was
measuring against the wrong standard.** The corpus is a *package-partitioned* export —
Rowan's on-disk project layout, where a class's methods are split across its own
`.class.st` and other packages' `.extension.st` files. Jasper's file-out is a
*class-complete* export. They are different products; a whole-file diff between them is
meaningless for methods. Re-measured against what actually matters:

| Property, across all 649 corpus classes | Result |
|---|---|
| Header byte-identical to the shipped file | **649 / 649** |
| Every shipped method block present **verbatim** in our output | **649 / 649** |
| Any shipped method missing or altered | **0** |
| Additional methods exported (the extensions a Jasper user sees) | 13,400 (median 5/class, max 810) |
| Classes with no extensions → whole file still byte-identical | 200 |

So populate-always loses nothing and adds exactly the methods the requirement asks for.

**Test consequence — the single whole-file diff splits into three named oracles, each
stronger than the diff would have been:**

1. **Header oracle** — all 649 headers byte-identical. Cheap, and it covers the part
   most likely to regress.
2. **Method-fidelity oracle** — every shipped method block appears verbatim in ours (the
   superset property above). Catches any formatting drift in method emission.
3. **Selector-completeness oracle** — the real product requirement: the selectors in the file
   equal `cls selectors` + `cls class selectors`, i.e. exactly what the Explorer shows.
   The corpus cannot express this one; it is asserted against the image.

The 200 zero-extension classes keep a whole-file byte-identical check as a bonus.

### R1 — reading from a string works; **R2 is not needed**

No filesystem, no gem-side temp file, no `validateClassCategory:` complaint (calling
`parser start` directly bypasses the validation in `readClassFile:inPackage:`). Fed the
Tonel text produced above, it returned a real `RwClassDefinition` with 1 class-side and
2 instance-side method definitions — correct counts.

```smalltalk
| proj pkg v parser res |
proj := RwResolvedProjectV2 new
  projectName: 'JasperTonelRead';
  packageConvention: 'Rowan';
  gemstoneSetDefaultSymbolDictNameTo: 'Globals';
  yourself.
proj addLoadComponentNamed: 'Core' comment: 'throwaway'.
pkg := proj addPackageNamed: 'Jasper-Spike' toComponentNamed: 'Core'.
v := RwRepositoryResolvedProjectTonelReaderVisitorV2 new
  currentProjectDefinition: proj;
  currentPackageDefinition: pkg;
  _packageConvention: 'Rowan';
  yourself.
parser := RwTonelParser on: (ReadStream on: tonelText) filePath: 'string' forReader: v.
res := parser start.
"res at: 1 -> RwClassDefinition;  (res at: 2) at: 1 -> class methods;  at: 2 -> instance methods"
```

### Smaller facts worth not rediscovering

- Method-definition dictionaries are keyed by **Symbol**, not String.
- The writer emits method source **verbatim**, so a one-line source (`'size ^size'`)
  produces a one-line Tonel body. Faithful, and round-trip safe.
- W2 (the extension-file path) was never reached, and no longer needs to be: Step 3 is
  cut, so nothing on the write side uses `_writeClassExtension:on:`.
