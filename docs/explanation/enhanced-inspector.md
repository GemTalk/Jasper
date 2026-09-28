# Enhanced Inspector support

Background for the installer in [`enhancedInspectorInstall.ts`](../../client/src/enhancedInspector/enhancedInspectorInstall.ts): why the payload is shaped, gated, and installed the way it is. Worth reading before changing dictionary handling, file order, the version gate, or the legacy migration.

## A dedicated `GsEnhancedInspector` dictionary

The payload's ~520 classes and ~3,700 methods are filed into their own symbol dictionary, `GsEnhancedInspector`. This mirrors the refactoring engine's isolation pattern (`GsRefactoringLoader class>>dictionaryName`, backing `GsRefactoring`): give a vendored subsystem its own dictionary so the entire payload can be removed cleanly by dropping one dictionary from every symbol list, with nothing left commingled with user or platform classes to sort out by hand.

The payload's class declarations name the dictionary as a bareword (`inDictionary: GsEnhancedInspector`, produced by `gs-src/enhancedInspector/build/apply_jasper_transforms.sh`), so the installer creates and binds that dictionary — and shares the same object into every user's symbol list — before filing anything in, exactly as the refactoring loader does for its own dictionary.

## Vendored and transformed, not Rowan-loaded

The payload is committed to the repo as pre-built `.gs` files under `resources/enhancedInspector/`, filed in with a bulk server-side `GsFileIn`, rather than loaded live from the four upstream Rowan projects it's built from. Two reasons drive this:

- **Scale.** Compiling ~3,700 methods one-by-one over a GCI round trip — the shape a live Rowan load would take from the extension host — blocks the extension host for thousands of synchronous calls, long enough to freeze the UI and trip VS Code's unresponsiveness watchdog. Filing in whole `.gs` files does the same work inside the gem in roughly one call per file, fast enough to stay responsive with progress notifications between files.
- **Placement.** The upstream projects don't know about `GsEnhancedInspector`; their class declarations target `Globals`/`Published` by default. `apply_jasper_transforms.sh` rewrites those declarations to the dedicated dictionary as part of building the vendored payload, so the isolation described above is baked into the `.gs` files themselves rather than something the installer has to arrange around foreign declarations at install time.

The tradeoff, made explicit in `gs-src/enhancedInspector/README.md`, is that the source of truth for this payload lives outside this repo, in `$ROWAN_PROJECTS_HOME`, and regenerating it is a human-run, non-CI step.

## File load order is load-bearing

`ENHANCED_INSPECTOR_FILES` in `enhancedInspectorInstall.ts` lists the payload files in dependency order — earlier files define classes and behavior that later files depend on — and the installer files them in that order over a single session, so a later file can compile against classes an earlier file just installed. That array is the sole authority on load order (there is no other manifest to keep in sync with it); reordering it without checking the payload's actual dependencies risks a file-in failure partway through, which aborts the whole install rather than leaving a partial one committed.

## Installing on a rowan3 extent

A stone built from `extent0.rowan3.dbf` already has 230 of the 523 class names the payload declares, bound in `Globals`: the whole `Rsr*` family, `Announcement` and its friends, and `STON`, `STONReader` and `STONWriter`. Rowan also owns most kernel classes there, as members of its packages. Two things in the installer exist for that, and both leave a base extent doing what it always did.

- **The dictionary comes first while the payload files in.** The payload names its target classes as barewords (`removeallmethods Announcement`, `method: RsrObject`, the superclass in each `subclass:`), and the file-in resolves them through the symbol list. With `GsEnhancedInspector` at the end, those names resolve to Rowan's classes, and the file-in strips and overwrites them. The installer moves the dictionary to the front for the file-in and back to the end before committing — the same ordering the refactoring loader uses (`GsRefactoringLoader>>withDictionaryFirstDo:`). This also fixes a base-extent slip: a base stone has its own `STONFileReference`, and the payload's two class methods for it used to land on that class instead of ours.
- **Methods compile the way a base extent compiles them.** On rowan3, `Behavior>>compileMethod:dictionaries:category:environmentId:` passes every method to Rowan (`_rwCompileMethodForConditionalPackaging:…`). A `*`-category method goes into the Rowan package that category names, so `*remoteservicereplication-gemstone` lands in the stone's own RemoteServiceReplication package, which rejects it as a duplicate. And a `*GToolkit-…` method on a class Rowan owns is refused outright. On a base extent the same hook is a stub that runs the plain unpackaged compile. The payload is filed in through `GsEnhancedInspectorFileIn`, a `GsFileIn` subclass the installer creates in the dictionary, which runs that unpackaged compile on every extent.

A method that a class the payload did not create **already has** is left alone, as the refactoring engine does for its kernel extensions. On 3.7.5 and 3.7.6 there are 64 of these on a base extent and 67 on rowan3 (the `STON` kernel extensions and three `Announcements` ones), each source-identical to the vendored copy. On rowan3 they belong to Rowan's packages, and recompiling one outside Rowan would leave Rowan pointing at a method that is no longer installed.

Moving the dictionary back to the end does not change what the payload's methods call: GemStone binds a global when a method is compiled, not when it runs. The exception is the payload's few by-name lookups — `RsrClassResolver class>>classNamed:` and STON's reader (`symbolList resolveSymbol:`) — which on rowan3 find the stone's `Rsr…` and `STON…` classes instead of ours, since those come earlier in every user's symbol list. Jasper never reaches them: its queries only write STON (`STONJSON toString:`) and open no RSR connection. Code that reads STON through the payload on a rowan3 stone would get the stone's classes.

What is still visible on rowan3: the payload's new `*GToolkit…` kernel methods (115 of them) are unpackaged methods on classes Rowan owns, so while the Enhanced Inspector is installed, Rowan's `audit` of `gemstoneBaseImage` and `FileSystemGs` reports them as *Missing loaded method*. Rowan's own STON, RemoteServiceReplication and Announcements projects audit clean. The uninstall removes every one of those methods, and afterwards both audits are clean again; on 3.7.6 every class outside `GsEnhancedInspector` then matched an untouched stone in method count and source.

## The GemStone 3.7.5 version gate

The Enhanced Inspector requires GemStone 3.7 or later for kernel classes the payload depends on (e.g. `GcFinalizeNotification`), but the effective floor is 3.7.5, for a more subtle reason: on stones before 3.7.5, string literals compiled through the GCI compile as Unicode, and the platform refuses to `=`-compare a Unicode string against the byte-`String` dictionary keys the payload builds. The install itself can succeed on an older stone, but the inspector's view lookups — which compare against those keys — silently return no views. There is no error to catch or work around; 3.7.5 is simply the first release where the comparison behaves as the payload expects, so the installer gates on it rather than shipping a feature that appears to work but never returns results.

## Migrating a legacy `Published`-placement install

An earlier build filed the payload's classes into the shared `Published` dictionary instead of a dedicated one. When the installer detects that legacy placement, it removes those classes from `Published` before filing the current payload into `GsEnhancedInspector`, so the fresh classes (added at the end of the symbol list) aren't shadowed by stale earlier-in-list copies, and nothing is left over to survive a later dictionary-drop uninstall.

That migration is gated on the presence of `#GtRemotePhlowViewedObject` in `Published` — a marker the old build is known to have bound there — rather than on the mere presence of a `GToolkit`-categorized class. A fresh install (no legacy marker) skips the migration branch entirely, which is the common case and the one where an over-broad sweep could only do harm; the marker check keeps the sweep scoped to stones that demonstrably carried the old placement.

The separate uninstall snippet identifies payload extension methods by a leading `*GToolkit` category anchor, but that anchor can't be reused for this migration: class categories in the legacy payload are bare (`GToolkit-RemotePhlow-DeclarativeViews` and similar), without the leading `*` that marks an *extension-method* category. Matching on `*GToolkit` here would match no class and silently skip the migration, so the migration instead matches classes whose category begins with the bare `GToolkit-` prefix. The residual risk — a user's own `Published` class that happens to use a `GToolkit...`-prefixed category — is accepted because the marker gate above already scopes this to stones that are known to need the migration.
