# Server-side refactoring engine

This directory holds the GemStone-side code that powers Jasper's refactoring
tools. It runs **inside a stone** and is driven from the VS Code client over GCI.
The first refactoring it ships is *rename instance variable* — reference-aware,
across all dictionaries, and non-committing (the user commits explicitly).

If you want to **load** the engine into a stone, see **[`LOADING.md`](LOADING.md)** —
the canonical runbook. If you are new to the *code*, start with the "How it
loads" section below — it explains the reason the directory is laid out this way.

## Directory map

Everything about the engine lives under `gs-src/refactoring/`, except the
*generated, shipped* payloads, which live where the VSIX packages runtime assets:

```
gs-src/refactoring/
  README.md          ← you are here
  LOADING.md         ← how to load the engine into a stone (start here to install)
  engine/            ← the engine: the source of truth (Smalltalk, Tonel format)
  loader/            ← GsRefactoringLoader: the one server-side load mechanism
  compat/            ← kernel-method backports for older releases (feature-detected)
    362/
  tests/             ← in-stone SUnit tests for the engine
  vendor/            ← third-party AST library, vendored verbatim (do not edit)
    rowanv3-ast/
      PROVENANCE.md  ← where the vendored code came from + the one adaptation
      AST-Core/  AST-Kernel-Core/  AST-Tests-Core/
  build/             ← turns the source above into the shipped payloads
    build-refactoring.sh   ← top-level build (run this); builds every payload
    build-ast-payload.sh   ← the AST substrate step (audits the one adaptation)
    tonel-to-gs.js
    ast-provenance-header.gs

resources/refactoring/       ← GENERATED payloads (built from the above); ship in the VSIX
  ast-core.gs                ← vendored AST substrate
  compat.gs                  ← feature-detected kernel backports
  engine.gs                  ← the Gs* engine classes
  manifest.gs                ← expected classes/counts for the post-load check
  refactoring-loader.gs      ← the loader class
  load-refactoring.gs        ← thin topaz bootstrap a human runs
```

### Finding the code

The engine is written in **Tonel**, Pharo's one-class-per-file source format.
Each file is named `<ClassName>.class.st` and defines exactly the class named in
the filename, so the class list *is* the file list:

| File in `engine/` | Class it defines |
|---|---|
| `GsRefactoringEnvironment.class.st` | `GsRefactoringEnvironment` — read-only queries over the whole symbol list |
| `GsRefactoringChange.class.st` | `GsRefactoringChange` — one addressable change (a method recompile or class-definition edit) |
| `GsRefactoringChangeSet.class.st` | `GsRefactoringChangeSet` — a non-committing set of changes the client previews |
| `GsRefactoringUndo.class.st` | `GsRefactoringUndo` — the undo record for the last applied refactoring, and the executor that reverses it |
| `GsRenameInstanceVariableRefactoring.class.st` | `GsRenameInstanceVariableRefactoring` — the rename-ivar refactoring itself |

Each class carries a doc comment at the top of its file; read those for the
per-class detail this README deliberately keeps out.

## How it loads

Loading a working engine into a stone has **two independent pieces**. Understand
this and the rest of the directory makes sense.

### 1. The vendored AST substrate (the big one)

The engine parses and rewrites Smalltalk source with the Refactoring Browser AST
(`RBParser`, `RBParseTreeRewriter`, and friends). We do not reimplement that — we
**vendor** it under `vendor/rowanv3-ast/` as verbatim Tonel and load it as-is.

The target stones (down to 3.6.2) have **no runtime Tonel reader**, so the Tonel
cannot be filed in directly. Instead, a build step converts it to a single
topaz-chunk `.gs` file that any stone can file in:

```
vendor/rowanv3-ast/  ──(build/build-ast-payload.sh)──▶  resources/refactoring/ast-core.gs
   (verbatim Tonel)         converts + adapts                (generated; ships in VSIX)
```

- `build/build-ast-payload.sh` — run this whenever the vendored source changes.
  It copies the Tonel to a temp dir, applies **one** documented, behaviour-
  preserving adaptation (`Rowan globalNamed:` → `System myUserProfile symbolList
  objectNamed:`, so it loads on a stone without Rowan), then invokes the
  converter. It **fails** if the number of adaptation sites drifts, so a
  re-vendor that pulls in a new Rowan dependency is caught, not silently shipped.
- `build/tonel-to-gs.js` — the Tonel→`.gs` converter (topological class order,
  preserved comments, explicit class-side `initialize` doits that topaz file-in
  would otherwise skip).
- `build/ast-provenance-header.gs` — the attribution header prepended to the
  generated `.gs`.

The generated `ast-core.gs` is **checked in** (so the VSIX ships without a Node
build step) and must be regenerated and committed whenever `vendor/` changes.
Never hand-edit it. Filing it in requires a **SystemUser** session, because
`AST-Kernel-Core` adds methods to SystemUser-owned kernel classes.

### 2. The `Gs*` engine classes and the loader

The `engine/*.class.st` classes are the source of truth; they load on top of the
AST substrate from step 1. The whole install — dedicated `GsRefactoring`
dictionary, ordered file-in, feature-detected `compat/` backports, and a
post-load completeness check — is encapsulated in one server-side class,
**`GsRefactoringLoader`** (`loader/`). The human runbook and the Jasper client
both drive that one class, so the two paths never drift.

`build/build-refactoring.sh` (the top-level build) turns everything above into
the ordered payload set in `resources/refactoring/` (`ast-core.gs`, `compat.gs`,
`engine.gs`, `manifest.gs`, `refactoring-loader.gs`) plus the `load-refactoring.gs`
bootstrap. Run it whenever any source under `gs-src/refactoring/` changes, and
commit the regenerated payloads alongside. **To load a stone, follow
[`LOADING.md`](LOADING.md).**

## Developing and testing

Author Tonel in `engine/`; iterate against a live stone with the gemstone MCP
(`compile_class_definition` / `compile_method`) — no in-stone Tonel reader is
needed for that path. To load the whole engine and run its tests against a stone,
use the loader (see [`LOADING.md`](LOADING.md)) under a **SystemUser** session,
then run the tests with `run_test_class` (or topaz):

- `GsRefactoringEnvironmentTest`
- `GsRefactoringChangeSetTest`
- `GsRenameInstanceVariableRefactoringTest`

Verified on GemStone 3.7.5 and 3.6.2 (the loader's completeness check passes on a
live 3.6.2 stone). The client GCI round-trip arrives with the client integration.

## Naming

Classes use the `Gs` prefix (`GsRefactoringEnvironment`, etc.) to fit GemStone
base conventions — this code is meant to eventually live in the GemStone base and
be usable by clients other than Jasper. The prefix also avoids colliding with the
`RB*` AST classes of a Rowan stone, which the engine binds to in place (it never
shadows them) when they are already present.

## Provenance / licensing

- The `Gs*` engine classes in `engine/` are **original code** under the
  repository `LICENSE`.
- The AST substrate in `vendor/rowanv3-ast/` is **third-party**, vendored from
  RowanV3 3.7.5 (Pharo AST-Core, MIT). Its origin, the exact adaptation, and
  verification are documented in `vendor/rowanv3-ast/PROVENANCE.md`; attribution
  and license text are in the repo-root `THIRD-PARTY.md` and `NOTICE`.
