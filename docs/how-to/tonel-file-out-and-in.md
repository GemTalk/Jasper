# Filing a class out and in as Tonel

Tonel is the one-class-per-file source format Rowan and Pharo use — a `.st` file
holding a class's definition, its comment and its methods. Jasper can write one
and read it back, so a class can go into git, be diffed and reviewed like any
other source, and come back.

This is **not** the same as the Topaz chunk file out (`.gs` / `.tpz`), which is
still there and unchanged. The two formats have separate commands, separate save
and open filters, and separate readers.

## What you need

**GemStone 3.7.5 or later, on a rowan3 extent** — one built from
`extent0.rowan3.dbf`. Nothing else works, and the commands are hidden where it
does not.

"rowan3" means Rowan **3**: the `RowanV3` project. Not `extent0.rowan.dbf`, which
installs the older Rowan. Both ship in the same 3.7.5 tarball and both define a
global named `Rowan`, so the distinction is easy to miss and does matter — the two
generations emit different header keys.

The feature calls Rowan classes that simply do not exist on a base extent, and the
3.6.x tarballs ship no Rowan extent at all, so a rowan3 3.6.x stone cannot be built
even in principle.

### Why the menu entries are missing

Jasper asks the session whether the Rowan classes it drives are actually reachable
— not the version number, not the extent's filename. If they are not, the Tonel
entries are absent rather than present and failing when clicked.

The file-**out** commands are **not in the Command Palette** — they need a class to act
on. File **in** is there, as **GemStone: File In…**, because it can ask for a file.

If the file-out entry is missing on a stone you believe is rowan3, file a `.st` file in
instead: those entries are deliberately never hidden, and the command refuses with an
explanation, which tells you whether the stone or the session is the problem.

A session as `DataCurator` works. Rowan's classes live in symbol dictionaries that
are in SystemUser's symbol list and not DataCurator's, and Jasper reaches through to
them, so you do not need to log in as SystemUser for this.

## Filing a class out

Right-click a class in the Explorer's **Classes** or **Class Hierarchy** pane →
**File Out Class (.st)…**, and choose where to save it. The default name is
`<ClassName>.class.st`, the name Rowan itself uses.

The entry above it, **File Out Class (.gs)…**, is the Topaz chunk file out. The two
are named by the extension they produce, which is the distinction that matters when
you are about to pick a filename.

The file carries **every method a Jasper user can see on that class** — including
ones Rowan would file into another package's `.extension.st`, because a Jasper user
has no notion of a package. Two methods are left out on purpose:

- methods a **trait** provides, which are not the class's own code (traits are not a
  supported Jasper feature);
- methods compiled into a **non-zero environment**, which the chunk file out omits
  too.

## Filing a class in

A `.st` file files in from the same places a `.gs` file does, through the same command —
you pick a file and Jasper works out which reader it needs. The link at the top of the
file names the format, so with both kinds open you can see which reader will run:

- the **File In Tonel to GemStone** link at the top of an open `.st` file (a `.gs` file
  says **File In to GemStone**);
- the ⤓ button in the **editor title bar**, or **right-click in the editor**;
- **right-click the file in VS Code's Explorer** — a mixed selection of `.gs` and `.st`
  files works, each going to its own reader, and reports once;
- **GemStone: File In…** in the Command Palette, the ⤓ on a session row, or the
  Dictionaries pane — all of which open a file dialog offering both formats.

Three things worth knowing before you do:

1. **It REPLACES.** The file is taken as the intended state of the class, so a
   method the image has that the file does not carry is removed. This is the same
   behaviour as chunk file in.
2. **It never commits.** The session is left dirty and you decide — commit it to
   keep the change.
3. **It asks which symbol dictionary** only when it has to. Tonel carries no
   dictionary (its `#category` is a *package*, not a SymbolDictionary), so Jasper
   defaults to the dictionary the class already lives in, and prompts only when the
   class is in several or is new.

### When something goes wrong

Failures go to the **GemStone File In** output channel — the same one the chunk
file in uses — one line each, as `ERROR <file>:<line> — <message>`. The toast that
reports a failure carries a **Show Log** button that opens it.

A method that will not compile does not stop the others; it is reported and the rest
file in. But a file whose superclass does not resolve creates nothing at all, rather
than leaving a half-built class behind.

## How a Jasper `.st` file relates to a Rowan one

Jasper writes **Tonel that Rowan can parse, not a Rowan project artifact.** Three
deliberate differences:

| | Rowan | Jasper |
|---|---|---|
| `#category` | the package name | the same package name for a Rowan-loaded class; for a class Rowan has not loaded, its class category, falling back to the symbol dictionary |
| Methods from other packages | separate `.extension.st` files | all in the class file |
| Surrounding files | `package.st`, `properties.st`, a project tree | just the one file you named |

`#category` is worth being precise about: for every class in the base image — which is
what this feature is for — Rowan has loaded it, and Jasper writes the **package name**,
exactly as Rowan does. That is why the header-identity check can require byte-identical
headers. The class-category fallback applies only to a class you defined yourself, which
Rowan knows nothing about.

So a Jasper file drops into a Rowan package tree only after splitting out any extension
methods (and editing `#category` if the class is one of your own). Everything else — the header keys, the method
blocks, their order — is byte-for-byte what Rowan's own writer produces; that is
checked against the 720 reference files GemStone ships under
`$GEMSTONE/projects/gemstoneBaseImage/rowan/src/`.

## What survives a round trip, and what does not

Filing a class out and back in preserves its shape and its behaviour:

| Carried | Notes |
|---|---|
| Superclass, instance / class / class-instance variables | |
| Class type | `normal`, `variable` and `byteSubclass`. `immediate` is refused — GemStone has no creation selector for it |
| Class comment | Cleared if the file carries none: filing in REPLACES |
| `#gs_options` | `dbTransient`, `subclassesDisallowed` and friends — these change what the class *is* |
| Class category | Applied after the definition, since no creation selector carries it |
| Every method, with its protocol and side | |

Two header properties are deliberately **not** applied, and filing in says so in the
File In log rather than dropping them quietly:

| Not carried | Why |
|---|---|
| `#gs_reservedoop` | An identity the base image assigns. Re-applying it to a class created from a file would at best fail and at worst collide with the object that already holds it |
| `#gs_constraints`, `#gs_foreignKeys` | Per-instance-variable constraints. Expressible in GemStone, but not part of what Jasper shows you, and there is no tested path for applying them |
| `#pools` | Rowan's reader does not carry pool dictionaries — file out writes them, filing in does not restore them. A class whose methods read a pool variable files in without its pool, and those methods fail to compile with `error 1001, undefined symbol`. This is Rowan's decision about what Tonel represents; Jasper reads Tonel through Rowan and inherits it |

There is also a size limit: a single Tonel file above **2 MB** is refused. The whole
file becomes one Smalltalk string inside one doit, and past roughly 5 MB the gem runs
out of temporary object memory and the *session dies* — so the limit turns a lost
session into a message about the file. For scale, the largest class in the 3.7.5 base
image, `Object`, files out at about 218 KB.

## Running the tests

The Tonel tests need a rowan3 stone and **skip** on any other, which means a green
`npm test` against the default test stone says nothing about this feature.

```sh
npm run test:server:start:rowan3   # 3.7.5 on extent0.rowan3.dbf
JASPER_REQUIRE_ROWAN3=1 npm test
```

`JASPER_REQUIRE_ROWAN3=1` turns every Tonel skip into a **failure** naming the
capabilities that are absent. Use it whenever you mean to verify this feature: a green
run under it cannot have silently skipped the tier, which a green run without it can.
Leave it unset in CI and on a base extent, where skipping is the correct behaviour.

`test:server:start:rowan3` repoints `client/.env.test` at that stone, so the two
tiers do not run side by side — start whichever one you are verifying.

### If the stone will not start

GemStone refuses to open an extent on NFS:

```
reason = File is on NFS, $GEMSTONE/data/extent0.dbf
```

The harness installs GemStone under the checkout (`client/tmp/gemstone/…`), so this
happens whenever the checkout itself is on a network filesystem. Either work from a
checkout on local disk — the simplest fix, and then nothing else is needed — or
point that install's `data` directory at local storage with a symlink. Note that
re-extracting the product archive replaces such a symlink with a real directory,
because the archive ships a `data/` of its own.
