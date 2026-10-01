# Loading the refactoring engine into a stone

This is the canonical runbook for installing Jasper's server-side refactoring
engine into a GemStone stone **by hand**, independent of the VS Code client. It
works on every supported release (**3.6.2 through 3.7.5+**).

If you just want it loaded and you are running Jasper, the client will do all of
this for you (it wraps the same loader). This document is for loading it
yourself — from topaz, in CI, or while developing the engine.

> **One mechanism, two front doors.** All the real work lives in one server-side
> class, `GsRefactoringLoader`. The human path (this runbook) and the client path
> both file that class in and send it the same message, so they never diverge.

## TL;DR

From a machine that shares a filesystem with the stone's gem (a **local** stone),
as a user who can write kernel classes (**SystemUser**):

```sh
cd <repo>/resources/refactoring
topaz -l
```
```smalltalk
topaz> set user SystemUser password <pw> gemstone <stoneName>
topaz> login
topaz> input load-refactoring.gs      "after replacing <PAYLOAD_DIR> — see below"
topaz> logout
```

`load-refactoring.gs` is a template: replace both occurrences of `<PAYLOAD_DIR>`
with the **absolute** path to this `resources/refactoring/` directory first (one
find-and-replace). Then it files in the loader and runs it. You will see a report
and a final `Committed.` / `Aborted.` line.

## Prerequisites

- **A local stone.** Server-side file-in requires the gem to *read the payload
  files itself*, so the gem must share a filesystem with them. Remote stones are
  not supported by this path.
- **A SystemUser session.** The compat backports (below) are extensions on
  kernel classes owned by SystemUser. A non-privileged user cannot install them.
- **The built payloads** in this directory (`resources/refactoring/`). They are
  checked in. If you changed anything under `gs-src/refactoring/`, rebuild them
  first: `gs-src/refactoring/build/build-refactoring.sh`.

## What gets loaded, and in what order

`GsRefactoringLoader` files these in, in this order (order matters — each layer
depends on the ones before it):

| # | Payload | What it is |
|---|---|---|
| 1 | `ast-core.gs` | Vendored Refactoring-Browser AST — `RBParser`, `RBParseTreeRewriter`, the `RB*` nodes/tokens/scanner. The engine parses and rewrites source with these. Its kernel extension methods (`rbStoreOn:`, `isValue`, …) are gated on `includesSelector:`, so a stone that already defines them — a rowan3 extent does, from the same AST-Kernel-Core we vendored — keeps its own. |
| 2 | `compat.gs` | A handful of kernel-method backports the vendored AST needs. Each is installed **only if the target release lacks it** (per-method feature detection), so newer releases get nothing and no real kernel method is ever shadowed. |
| 3 | `engine.gs` | The `Gs*` engine classes (environment, change-set, rename-instance-variable refactoring). |
| 4 | `manifest.gs` | The expected class list + per-class method counts, used by the post-load check. |

The loader itself (`refactoring-loader.gs`) is filed in first by the bootstrap.

### The dedicated dictionary

The engine and AST classes are installed into a dedicated symbol dictionary,
**`GsRefactoring`**, which the loader creates and places at the **end** of the
installing user's symbol list. This isolates the refactoring code from everything
else and keeps it from shadowing a base/kernel class or a Rowan `RB*` class in
normal use. The engine resolves its own classes through the whole symbol list, so
nothing else needs to know where they live.

**While the payload is loading, the dictionary is moved to the front.** End
placement is right for normal use but wrong for the file-in: the payload's topaz
directives name their target class as a bareword (`removeallmethods RBArrayNode`,
`method: RBArrayNode`, and the superclass in each `subclass:`), and the file-in
resolves that name through the symbol list. On a **rowan3** extent `RowanKernel`
binds every one of those names and sits ahead of `GsRefactoring`, so with the
dictionary at the end each directive lands on *Rowan's* class: our copies come up
empty while Rowan's are stripped and partially overwritten. Measured on 3.7.5.1,
`RowanKernel`'s `RBScanner class` fell from 11 methods to 2, losing
`initializeClassificationTable` — which is why the payload's own `RBScanner
initialize.` then failed and the load reported `INCOMPLETE`.

`GsRefactoringLoader>>withDictionaryFirstDo:` moves the dictionary to position 1,
files in all four payloads, and restores the end placement under `#ensure:`, so a
failed file-in cannot leave it shadowing. Engine methods bind their `RB*`
references at compile time, so `engine.gs` has to load under the same ordering or
it binds to Rowan's AST instead of ours.

The loader then shares that **same** `GsRefactoring` dictionary object into every
user's symbol list (the mechanism `Published`/`Globals` use), so the engine is
visible to whoever uses the stone — not just the installing SystemUser. This
matters for the client: it installs over a transient SystemUser session but you
*use* Jasper as your normal user (e.g. DataCurator), which must resolve the engine
for the rename command to light up. Sharing is idempotent — a user that already
has a `GsRefactoring` dictionary is left untouched. A world-writable
`GsRefactoring` is also what lets a non-SystemUser *apply* a refactoring later
(the class-version bump rewrites the dictionary binding).

## Version differences the loader handles for you

You do not need to special-case these — they are listed so the runbook is
complete:

- **File-in signature.** 3.7+ uses `GsFileIn fromPath:on:#serverUtf8File to:`;
  `#serverUtf8File` does not exist pre-3.7, so on older releases the loader uses
  `GsFileIn fromServerPath:` (the payloads are ASCII, so both read them
  correctly). The loader branches on the stone's release.
- **Compat backports.** Installed one method at a time, each gated on
  `(TargetClass canUnderstand: #selector) not`. 3.6.2 (oldest) needs the whole
  set; a 3.7.5 stone needs none; intermediate releases get exactly their missing
  subset. This is why the engine loads correctly on releases never explicitly
  tested.
- **Class-side initializers.** Topaz file-in does not run class `initialize` the
  way a Pharo image load does, so `ast-core.gs` runs the scanner/formatter
  initializers explicitly. The post-load check confirms they took effect.

## Confirming it worked

The loader prints a completeness report and only commits when **every** check
passes. A successful run looks like:

```
[GsRefactoring] --- install report ---
[GsRefactoring]   [ ok ] Classes present -- 60 classes
[GsRefactoring]   [ ok ] Method counts -- all classes have their expected methods
[GsRefactoring]   [ ok ] Compat methods resolve -- all AST kernel dependencies present
[GsRefactoring]   [ ok ] Initializers ran (scanner/formatter) -- parse + format works
[GsRefactoring]   [ ok ] Functional smoke (parse/rewrite/rename) -- parse / rewrite / rename preview OK
[GsRefactoring] SUCCESS -- all completeness checks passed.
[GsRefactoring] Committed.
```

Any `[FAIL]` line means the load was **incomplete**; the transaction is aborted
(nothing committed) and the line tells you what was missing — a dropped class, a
short method count, a missing kernel dependency, or a broken initializer/smoke.
Fix the cause (usually a stale or partial payload — rebuild) and re-run; the load
is idempotent. One exception to be aware of: the `ast-core.gs` kernel extension
methods are gated on `includesSelector:` (row 1 above), so a re-run leaves any
already-present copy alone — including one an earlier install put there. If a
re-vendor changes one of those bodies, an existing stone keeps the old one;
neither a reinstall nor an uninstall replaces it.

You can also confirm from the client: the Explorer's rename-instance-variable
command lights up once the `rbSupportAvailable` probe sees the engine.

## Loading without the bootstrap (advanced)

The bootstrap is only a two-line convenience. Equivalently, from any SystemUser
session (topaz or GCI):

```smalltalk
GsFileIn fromServerPath: '<PAYLOAD_DIR>/refactoring-loader.gs'.
GsRefactoringLoader loadFromServerDir: '<PAYLOAD_DIR>'.   "files in, verifies, commits on success"
```

To inspect the result **without committing** (for a dry-run or a test), stage
instead and abort:

```smalltalk
| ldr |
ldr := GsRefactoringLoader new stageFromServerDir: '<PAYLOAD_DIR>'.
ldr reportString displayNl.
System abortTransaction.
```

## See also

- `README.md` — the directory layout and how the payloads are built.
- `vendor/rowanv3-ast/PROVENANCE.md` — where the AST came from and its license.
- `loader/GsRefactoringLoader.class.st` — the loader source (the mechanism this
  runbook describes).
