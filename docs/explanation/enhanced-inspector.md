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

A stone built from the rowan3 extent comes with Rowan. Rowan brings its own copies of classes the Enhanced Inspector also ships, like STON, Announcements and RSR. Rowan also keeps track of which package every method belongs to, and it checks every method compiled into the stone.

So the installer does three things:

1. **It looks in our dictionary first.** While the payload files in, `GsEnhancedInspector` is at the front of the symbol list, so a class name in the payload finds our class, not Rowan's. When the file-in is done, the dictionary goes back to the end, where it cannot hide a class the stone already has.
2. **It compiles methods the plain way,** the same way a stone without Rowan does. Rowan never sees them, so it cannot reject them.
3. **It keeps methods the stone already has.** If a class that is not ours already has a method the payload ships, the stone keeps its own copy. The install result lists any kept method whose source differs from the payload's, so a GemStone release that changes one is easy to spot. Methods in a `*GToolkit…` category are ours, and a re-install always replaces them.

Good to know:

- While the inspector is installed on rowan3, Rowan's audit lists our added kernel methods as *Missing loaded method*. Uninstall removes them, and the audit is clean again.
- A few places in the payload look up classes by name while running. On rowan3 those find Rowan's classes, not ours. Jasper does not use those places.

## The GemStone 3.7.5 version gate

The Enhanced Inspector requires GemStone 3.7 or later for kernel classes the payload depends on (e.g. `GcFinalizeNotification`), but the effective floor is 3.7.5, for a more subtle reason: on stones before 3.7.5, string literals compiled through the GCI compile as Unicode, and the platform refuses to `=`-compare a Unicode string against the byte-`String` dictionary keys the payload builds. The install itself can succeed on an older stone, but the inspector's view lookups — which compare against those keys — silently return no views. There is no error to catch or work around; 3.7.5 is simply the first release where the comparison behaves as the payload expects, so the installer gates on it rather than shipping a feature that appears to work but never returns results.

## Migrating a legacy `Published`-placement install

An earlier build filed the payload's classes into the shared `Published` dictionary instead of a dedicated one. When the installer detects that legacy placement, it removes those classes from `Published` before filing the current payload into `GsEnhancedInspector`, so the fresh classes (added at the end of the symbol list) aren't shadowed by stale earlier-in-list copies, and nothing is left over to survive a later dictionary-drop uninstall.

That migration is gated on the presence of `#GtRemotePhlowViewedObject` in `Published` — a marker the old build is known to have bound there — rather than on the mere presence of a `GToolkit`-categorized class. A fresh install (no legacy marker) skips the migration branch entirely, which is the common case and the one where an over-broad sweep could only do harm; the marker check keeps the sweep scoped to stones that demonstrably carried the old placement.

The separate uninstall snippet identifies payload extension methods by a leading `*GToolkit` category anchor, but that anchor can't be reused for this migration: class categories in the legacy payload are bare (`GToolkit-RemotePhlow-DeclarativeViews` and similar), without the leading `*` that marks an *extension-method* category. Matching on `*GToolkit` here would match no class and silently skip the migration, so the migration instead matches classes whose category begins with the bare `GToolkit-` prefix. The residual risk — a user's own `Published` class that happens to use a `GToolkit...`-prefixed category — is accepted because the marker gate above already scopes this to stones that are known to need the migration.
