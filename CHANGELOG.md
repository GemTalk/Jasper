# Changelog

All notable changes to the **GemStone Smalltalk** extension will be documented in this file.

## [Unreleased]

### Fixed

- **Revealing a class no longer hides the rest of the dictionary.** Jumping to a class — after a rename or reshape, from GemStone Search, from Find Class — pinned the Class Categories pane to that class's own category, which filtered the Classes pane down to it. On a category holding one class, the whole dictionary appeared to vanish behind the class you had just renamed. A reveal now leaves the category selection alone unless keeping it would hide the class, so you get the dictionary's class list with the revealed class selected. ([#434](https://github.com/GemTalk/Jasper/issues/434))
- **Class Definition History → Restore now restores the class's superclass too.** Restoring a version rebuilt the class with its historical shape and methods but left it under whatever superclass it has *now*, so restoring across a re-parenting (an inserted or extracted superclass) silently did not restore the definition it claimed to. Found while building refactoring undo on top of it. ([#434](https://github.com/GemTalk/Jasper/issues/434))

### Added

- **Undo.** Editing GemStone code is no longer one-way. One **Undo** covers everything you have done this session — saving a method, adding one, deleting one, creating a class, changing its definition, removing it, and applying a refactoring — most recent first. The affordance you will actually use is the **Undo button on the notice that follows the action**: all of those end in a toast that offers to put it back. For when that is missed, a **↩ Undo** button sits at the left end of the **status bar** for as long as you are connected: purple when there is something to undo and named after it in the tooltip, dimmed when there is not, but always in the same place, so it can be found a second time. There is also **Ctrl+K U**, an ↩ icon on the Explorer's **Methods** pane and on an open method editor's title bar, and a **Command Palette** entry. Nothing commits in either direction, so undoing uncommitted work stays uncommitted and undoing committed work needs your own commit. Undo is per session: a reconnect starts empty, and an **abort** clears it, since an abort has already rewound the stone underneath every entry. ([#434](https://github.com/GemTalk/Jasper/issues/434))
- **Undoing an ordinary method edit needs nothing installed on the stone, and asks nothing first.** Saving a method, creating one and deleting one are reversed on the spot — no preview panel, because you just did it and it is one method — putting back the earlier source *and* its category, reloading any open editor and selecting the method that came back. The last 25 edits stay reversible, so you can walk several saves back. The one thing that stops and asks is drift: if the method has changed since that edit, undoing discards the change, and you are told before it happens rather than after — and it is still a warning, never a refusal. This path is plain Smalltalk against the kernel, so it works on any stone Jasper can log in to, whether or not the refactoring engine is installed. ([#434](https://github.com/GemTalk/Jasper/issues/434))
- **Class actions can be put back too — as a revert.** Creating a class, changing its definition (adding or removing an instance variable, re-parenting it, changing its class variables) and removing it now go on the same stack, reached by the same button and the same **Ctrl+K U**. The word is *revert* rather than undo, and the difference is real: GemStone has no transaction savepoints and gives a class a new version on every shape change, so what happens is that the **earlier version is bound again** — the class history grows rather than shrinks, and anything written on the newer version since is left behind on it. You are told that before it happens, in a modal that **names the methods** it would leave, rather than after. Removing a class is the one case that is exact: the name is unbound but the class itself is not destroyed, so the very same version goes back with its methods, its class-side methods, its history and its instances. Removing a class **with subclasses** from the Explorer records the whole subtree as one entry, and one revert puts all of it back. Reverting a definition change is also the quickest way back from a GemStone behaviour worth knowing about: re-sending `Object subclass: …` with a changed shape answers a **new, empty version** — it does not carry the methods forward — which is why the refactoring engine has its own Add/Remove Instance Variable. ([#434](https://github.com/GemTalk/Jasper/issues/434))
- **Undo a refactoring.** A refactoring keeps its preview, because it can rewrite dozens of methods across a hierarchy. Undo covers the refactorings that change methods — change signature, extract/inline method, extract/inline temporary, move method, push up, push down, rename method, rename temporary — and a missed toast does not strand it. The preview is the one the forward direction gets: every reversal listed with its diff and its own checkbox, so you can keep part of an undo, and the rows badged with what undoing *does* (Restore / Revert / Delete). A method edited since the refactoring is flagged inline and summarised at the top, and the undo still runs: drift is a warning, never a refusal. After an undo that restored a method, the Explorer selects that method, so what came back is where you are looking. The stone keeps the most recent refactoring only, so applying a second one replaces it. ([#434](https://github.com/GemTalk/Jasper/issues/434))
- **Every class reshape can be put back too, by returning it to its pre-refactoring state.** Instance-variable push up / push down, convert temporary to instance variable, extract superclass, insert superclass and split class are now reversible: each class the refactoring reshaped goes back to the version it had **before** it — shape *and* methods — and any class the refactoring created is unbound. Because a revert restores the methods of that version too, anything written on those classes since the refactoring is discarded, so the preview says so up front, names how many methods, and names them per row; when nothing has been written since, it says that instead. It is all-or-nothing (each subclass is restored onto its parent), so the rows are shown but not de-selectable. An apply that **migrated instances** or **deleted old versions from the class history** records no reversal at all — both commit, and both are irreversible. ([#434](https://github.com/GemTalk/Jasper/issues/434))
- **Renames and instance-variable add/remove can be put back too — by applying the opposite operation.** Renaming a class, an instance variable or a class variable, and adding or removing an instance variable, are now reversible from the same Undo affordances. It is deliberately **not** a rollback, and the preview says so: GemStone has no transaction savepoints, so reversing a rename is a fresh rename in the other direction, and the class keeps its history rather than losing a version. That also makes it *safer* than a true rollback here — anything you wrote after the rename is carried forward instead of discarded. If the old name has since been taken by something else, the reversal refuses up front and names the collision rather than clobbering it. Reversing an *added* instance variable removes it again, which deletes any method written since that uses it — the banner names the number; reversing a *removed* one declares the name again but cannot bring back the values it held or the methods the removal dropped, and says so. An apply that **migrated instances** or **deleted old versions from the class history** records no reversal at all: both commit, and both are irreversible. ([#434](https://github.com/GemTalk/Jasper/issues/434))

## [1.8.12] - 2026-08-19

Follow-up release for **GemStone Search**, which shipped in 1.8.11: seven rounds of fixes and refinements from issue [#428](https://github.com/GemTalk/Jasper/issues/428) (the manual-testing and review backlog), plus the Explorer filter/comment UX pass from [#387](https://github.com/GemTalk/Jasper/issues/387).

### Added

- **GemStone Search: in-panel controls for what a search costs.** The bottom panel is the default UI and it is wide but short — the shape that benefits least from a source preview and suffers most from per-keystroke round trips — so three controls now hand that budget back. A **◧** chip hides the preview pane *and* stops the per-row source fetch behind it. A **Scopes** menu excludes a scope from the always-on "All" fan-out while keeping its tab, so you can drop Methods (which queries the stone on every keystroke) without losing access to it. A **Fuzzy / Substring / Prefix** chip cycles the match algorithm from the panel. Each has a setting that supplies only the *starting* value — `gemstone.omniSearch.previewPane` and `gemstone.omniSearch.excludeFromAll`, alongside the existing `gemstone.omniSearch.matchMode` — and the in-panel control then owns it for the session without writing back to your settings. (That last part is load-bearing rather than tidy: writing a setting fires `onDidChangeConfiguration`, which would drop the cached search engine mid-session.) ([#428](https://github.com/GemTalk/Jasper/issues/428), [#448](https://github.com/GemTalk/Jasper/pull/448))
- **GemStone Search: a configurable scan ceiling, and a result count that admits when it's a floor.** The Methods scan short-circuits once it has enough matches, so its row count is a lower bound — but the footer derived "exact" from the display cap alone, so **Load all** would print a bare `200 results` over a slice that had in fact been cut off, and the load controls disappeared as though everything had been found. A provider now reports when its *own* fetch ceiling bound the results, naming the configured ceiling rather than a bare flag, and the new `gemstone.omniSearch.maxServerScan` setting (default 200) lets you raise it. The heavy scopes that only run when you pick them are also advertised now, with a hint when one was skipped — previously there was nothing to suggest they existed. ([#428](https://github.com/GemTalk/Jasper/issues/428), [#446](https://github.com/GemTalk/Jasper/pull/446))
- **GemStone Search: keyboard scope cycling, a marker for expensive scopes, and a References affordance.** **Tab** and **Shift+Tab** from the search field cycle the scope tabs (the JetBrains Search-Everywhere gesture), wrapping in render order, with a footer legend advertising it. The heavy scopes — Source, Literals, Class Categories — now carry an **⌛** marker instead of the same magnifier the rest of the field uses, so a full-image scan looks different from a cheap one before you start it. And a **↗ References** chip lights up whenever senders/references are on screen, in both the list pivot and the default sticky preview-pane list, and clicking it exits. ([#428](https://github.com/GemTalk/Jasper/issues/428), [#450](https://github.com/GemTalk/Jasper/pull/450))

### Changed

- **GemStone Explorer: clearer filtering, and no more "All methods" pseudo-category.** The filter controls now use a funnel icon (funnel = filter, magnifier = find), matching the funnel on the "filter is active" row, which is now labelled `Filter:` so an active filter is easier to notice. The filter box no longer implies you must press Enter — it filters as you type, and says so. Method **categories** are now filterable, not just selectors: typing `acc` surfaces the `accessing` category with its methods, in both the grouped and flat views. The Explorer's find action is titled **Find Class in Explorer** (it does its work in the Explorer, and is no longer confusable with the global **Find Class…**), and the flat-view toggle reads **Don't Group Methods by Category** rather than "Show Methods Without Categories", which sounded like it listed only uncategorized methods. The **`** ALL METHODS **`** pseudo-category is gone: it duplicated what the real categories already showed and, being first and expanded by default, pushed them below the fold — every method is still listed under its own category, and the flat/grouped toggle remains the see-everything view. A class **comment** now opens as a preview tab rather than being pinned, so a quick read is dismissed with one click instead of two and the next comment reuses the tab (the action is retitled **Open Comment** accordingly, and double-clicking the tab still keeps it). The comment button also appears only on classes that actually have a comment: it used to show on every class, and clicking it on a class without one opened GemStone's synthesized `No class-specific documentation for …` placeholder rather than anything the class's author wrote. A comment emptied and saved counts as no comment too — GemStone stores the empty string rather than dropping it, so the button used to survive its own comment being deleted. Writing a first comment is still possible from the Classes-pane toolbar button, which is deliberately not hidden. Finally, an empty variable section is now omitted rather than shown grayed: a class with instance variables but no class variables shows only the **instance variables** header (and vice versa), since a header for a definitively-empty section reads as something to open when there is nothing to find. ([#387](https://github.com/GemTalk/Jasper/issues/387), [#442](https://github.com/GemTalk/Jasper/pull/442))
- **The GemStone Search webview uses the full window width.** It was capped at a fixed 960px, which wasted a wide monitor — precisely the case the bottom panel is best at. ([#428](https://github.com/GemTalk/Jasper/issues/428), [#444](https://github.com/GemTalk/Jasper/pull/444))

### Removed

- **The GemStone Search Quick Pick UI is gone.** `gemstone.omniSearch.ui` no longer accepts `quickpick`; it takes `panel` (the default) or `spotter`. The Quick Pick was a second, independent search path with its own controller, and it could disagree with the webview UIs about what a query matched. The panel and Spotter now share the single search engine, so they can't drift apart. If you had set `quickpick`, VS Code falls back to the default `panel` — no migration needed. ([#428](https://github.com/GemTalk/Jasper/issues/428), [#443](https://github.com/GemTalk/Jasper/pull/443))

### Fixed

- **Picking a scope during a references search now works, instead of silently narrowing your next search.** The references pivot returned before the scope was ever consulted, so a scope chosen while viewing references had no effect on what was shown — yet the tab still lit up as though it had applied. The scope then took effect *invisibly* on the next real search, narrowing a restored search you never asked to narrow. Choosing a scope now leaves the references view and applies that scope to the restored search, so the highlighted tab and the visible list always agree. (A scope belongs to the search, not to a references view: every pivot row is a method, so a Classes or Globals filter over them would be meaningless.) ([#428](https://github.com/GemTalk/Jasper/issues/428), [#449](https://github.com/GemTalk/Jasper/pull/449))
- **Match highlighting in the source preview no longer lags the search box.** The blue match marks are recomputed against the *current* query on each run, so they track what you have typed rather than the debounced round trip that produced the preview. ([#443](https://github.com/GemTalk/Jasper/pull/443))
- **Literals search no longer reports methods that don't use the literal.** `sendersOf:` under-reports on 3.7.5, so searching for `#not` leaked in senders of `x not`. The search is now the intersection of a substring scan and a reference-to-literal query, covered by an integration test that fails on 3.7.5 without the fix. ([#443](https://github.com/GemTalk/Jasper/pull/443))
- **Search results no longer go stale after you change the image.** The cached corpora refresh instead of being built once: compiling a class folds it in live via a targeted, Unicode7-safe lookup rather than a full re-enumeration, dictionaries refresh immediately on create/remove/rename, and categories and every corpus rebuild on commit or abort. ([#443](https://github.com/GemTalk/Jasper/pull/443))
- **The "References to …" breadcrumb and the in-panel error banner were invisible.** Both were hidden by `display: none` in the stylesheet while the view "revealed" them by clearing an inline style that was never set — so neither ever appeared. Errors were still reaching you as toasts; this restores the in-context banner as a second layer. ([#450](https://github.com/GemTalk/Jasper/pull/450))
- **A Literals search failure is no longer indistinguishable from "no matches".** The provider swallowed every error, so a dropped GCI connection or an aborted transaction looked identical to an empty result. It now separates "still typing" (silently empty) from a real runner failure, which is reported to the **GemStone GCI** output channel. ([#428](https://github.com/GemTalk/Jasper/issues/428), [#445](https://github.com/GemTalk/Jasper/pull/445))
- **Jumping to a class category or dictionary that isn't loaded no longer disturbs the Explorer.** The category reveal verified the target existed only *after* selecting it had already mutated the panes, so a missing category left the Explorer scrolled to a node that wasn't there; it now checks first and warns instead. A dictionary-jump reveal failure is logged to the GCI channel rather than swallowed by a bare `catch`, matching what the category path already did. ([#428](https://github.com/GemTalk/Jasper/issues/428), [#445](https://github.com/GemTalk/Jasper/pull/445))
- **The search panel now reveals reliably after login.** It raced a fixed 400 ms wait, so on a slower login it could fail to appear. A settings description was also corrected: it named an "open editors" scope that does not exist. ([#428](https://github.com/GemTalk/Jasper/issues/428), [#444](https://github.com/GemTalk/Jasper/pull/444))

### Documentation

- **`docs/` now holds only documentation, and the GCI headers are version-mapped.** `docs/3.7/` held a single, ambiguously-named copy of the GCI headers with no record of which GemStone release it came from — so a signature found there couldn't be trusted against the stone in front of you. Those snapshots are now `vendor/gci-headers/`, one folder per distinct header revision, named for the earliest GemStone version that shipped it, with a `versions.md` mapping every locally-installed release (3.6.2 → 3.7.5) to its folder and a sha256 per file, so releases with byte-identical headers share one folder. `vendor/**` is reference material and is excluded from the packaged `.vsix`. The Enhanced Inspector install — the one substantial undocumented subsystem — gained a written explanation, its tooling moved out of `docs/`, and stale files were deleted. GemStone Search's `DESIGN.md` was also rewritten to match what actually shipped. ([#426](https://github.com/GemTalk/Jasper/pull/426), [#443](https://github.com/GemTalk/Jasper/pull/443))

## [1.8.11] - 2026-08-16

### Added

- **GemStone Search — one search box over everything browsable.** A global "search anything" for the IDE, opened with **Cmd+Shift+A** (Ctrl+Shift+A) in any session, the **GemStone Search** status-bar button, or the Command Palette. It fans out across **classes, methods, dictionaries, and globals** as you type, and offers heavier scopes you start explicitly: **Source** (substring over full method source), **Literals** (methods using a given `#symbol` or `'string'` literal), and **Categories** (class-category names). A result can pivot into a reference search — senders and implementors appear in the preview pane with inline source — and picking one jumps to it in the Explorer. The `gemstone.omniSearch.ui` setting chooses the experience: `panel` (default) docks a webview in the bottom panel beside Terminal/Output, `spotter` puts the same webview in an editor tab, and `quickpick` uses a native QuickPick. This is the first cut; follow-ups are tracked as their own issues. ([#378](https://github.com/GemTalk/Jasper/issues/378), [#423](https://github.com/GemTalk/Jasper/pull/423))
- **Refactoring: Extract Superclass and Insert Superclass.** Hoist a cohesive set of methods and instance variables out of one or more sibling classes into a brand-new common superclass (Extract Superclass), or simply insert a new empty superclass above a class (Insert Superclass — the degenerate no-sibling case, driven by the same engine). Members are classified as identical, divergent, partial, or unhoistable (a `super` send, a foreign instance variable, a foreign class or pool variable), so you see what can move before anything does. Offered from the Explorer's class row and hierarchy node, previewed, applied all-or-nothing server-side, and never committing; existing instances keep their prior class version. ([#379](https://github.com/GemTalk/Jasper/pull/379))
- **Refactoring: Split Class (Extract Class).** Pull a cohesive subset of a class's own instance variables — and the methods that use them — out into a new component class, leaving the original holding a lazily-created reference to it. The original class's external API is unchanged: each moved method leaves a delegating stub behind. Reached from the Explorer's class row or hierarchy node as **Split Class…** — pick the instance variables, name the new class, pre-flight, review a paginated preview, apply. Server-side, all-or-nothing, never commits. ([#252](https://github.com/GemTalk/Jasper/issues/252), [#394](https://github.com/GemTalk/Jasper/pull/394))
- **Refactoring: Add and Remove Instance Variable.** Add an instance variable to a class, or remove one. Because GemStone has no `addInstVarName:`/`removeInstVarName:`, this creates a new class version — methods are copied forward, the descendant subtree is re-parented top-down, and the class's compile options are preserved across the new version (earlier engines dropped them). A removal predicts, from bytecode-level variable access, which methods will not recompile afterwards and shows them in the preview before you commit to anything; an add declines up front — naming the offending subclass — when a subclass already declares that name itself, rather than stranding a half-versioned subtree mid-apply. Nothing commits unless you opt in. ([#346](https://github.com/GemTalk/Jasper/pull/346), [#360](https://github.com/GemTalk/Jasper/issues/360), [#368](https://github.com/GemTalk/Jasper/pull/368), [#392](https://github.com/GemTalk/Jasper/pull/392))
- **One unified Rename… that infers the target, plus Add Class Variable and Add Accessors.** A single `gemstone.rename` code action now classifies what's under the cursor — temporary or argument, then selector/method, instance variable, class variable, class reference — and dispatches to the right refactoring, instead of asking you to pick one first. Renaming an *inherited* instance variable no longer dead-ends: the defining class is resolved and, after a one-line confirmation, the rename runs there across the hierarchy. Two Explorer conveniences came along with it: **Add Class Variable**, and **Add Accessors**, which compiles the getter/setter pair atomically with the reshape. ([#328](https://github.com/GemTalk/Jasper/issues/328), [#392](https://github.com/GemTalk/Jasper/pull/392))
- **Explorer: Rename Class Category and Rename Dictionary.** Right-click (or use the pencil) on a category node to rename that segment of the dash-segmented category tree, carrying its whole subtree along; or on a dictionary node to rename a `SymbolDictionary`. A dictionary has no name slot — its name is a self-referential entry it holds by identity — so the rename is a reflective swap that leaves the symbol-list index and the classes it holds untouched. System dictionaries (Globals, Published, UserGlobals) and name collisions are refused, and source that names a dictionary literally is not rewritten. Neither operation recompiles or commits. ([#402](https://github.com/GemTalk/Jasper/pull/402))
- **Explorer: remove a method, a class, or a dictionary.** A 🗑 action on a method row removes it after a modal confirmation, and matching removal affordances now exist for classes and dictionaries. ([#372](https://github.com/GemTalk/Jasper/pull/372), [#397](https://github.com/GemTalk/Jasper/pull/397))
- **Uninstall Server Support.** The optional server support (Enhanced Inspector + refactoring engine) can now be removed again, not just installed: **GemStone: Uninstall Server Support** mirrors the install flow — SystemUser elevation, progress, verification — behind a confirmation modal, and is visible only when something is actually installed. To make the Enhanced Inspector removable as a unit, it moved out of the shared `Published` dictionary (where it sat commingled with unrelated content) into its own `GsEnhancedInspector` dictionary, the same isolation the refactoring engine already had with `GsRefactoring`. ([#318](https://github.com/GemTalk/Jasper/issues/318), [#384](https://github.com/GemTalk/Jasper/pull/384))
- **A login to a stopped database now offers to start it and connect.** Logging in to a database that isn't running used to fail with an unhelpful error, leaving you to find the database, start it by hand, and try again. Jasper now offers to start it and connect automatically — the prompt offers Now or Never, and Never is remembered. Recovery also handles the half-up case: anything that is *down* is offered first, so a wedged stone no longer leaves a stopped NetLDI stopped, and `not-responding` is reported only when both processes are up, where starting cannot help. The Admin output panel no longer pops open unbidden during a login-time auto-start, and a process killed by a signal now says so (e.g. "killed by signal SIGKILL") instead of the misleading "exit code null". ([#217](https://github.com/GemTalk/Jasper/pull/217))

### Changed

- **The GemStone Explorer is now the browser you meet first.** The two buttons that advertised the classic System Browser are gone: the inline action on session rows in **Logins & Sessions**, and the `$(book)` item in the status bar. The Explorer — the supported way to browse and edit code — is what you now discover instead of the older five-column browser. The System Browser itself is unchanged and still available via **Cmd+K B** (Ctrl+K B) or **GemStone: Open System Browser (Classic)** in the Command Palette, retitled so it's clear which browser it opens. It is best described as **frozen**: it works today and nothing about it changed here, but it is not being extended and no promise is made about how long it keeps working as the rest of Jasper moves. [docs/explanation/system-browser-and-explorer.md](docs/explanation/system-browser-and-explorer.md) records why, and notes that running SUnit tests on a class is still browser-only. Documentation follows suit: the README documents the Explorer in its own section, and the walkthrough, the **Welcome to GemStone Smalltalk** tutorial, class sync, the inspector, and Jupyter all point at it — each also saying where the Explorer lives, since it has its own activity-bar icon rather than sitting in the GemStone sidebar. Two setting descriptions were corrected as well: `gemstone.classSync.readOnlyMirror` no longer sends you to the System Browser to edit, and `gemstone.maxEnvironment` no longer describes itself as browser-only when it governs the Explorer and the hover, CodeLens, and Go to Definition providers too. ([#421](https://github.com/GemTalk/Jasper/issues/421))
- **Explorer source editors are now native preview tabs in one editor group, with pinning.** Method, class-definition, and class-comment editors used to be spread across up to three columns by a load balancer that ping-ponged unpredictably. They now behave the way VS Code's own editors do: a single click opens a **preview** tab that the next click replaces, a double click promotes it to a permanent tab, and the 📌 action (**Pin Method** / **Pin Definition**) pins one beside it. Pinning never steals the view. The senders/implementors CodeLens no longer pops in a moment late and shoves the source down on a method's first open. ([#372](https://github.com/GemTalk/Jasper/pull/372), [#383](https://github.com/GemTalk/Jasper/pull/383))
- **The Explorer's Methods pane is a leaner tree, and the Hierarchy pane starts collapsed.** Instance/class side and category grouping moved out of the tree and into title-bar toggles — category grouping is backed by the new `gemstone.explorer.groupMethodsByCategory` setting, and methods list flat when it's off, so a method is one click away rather than three. Methods can also be filtered to the readers and writers of a chosen instance variable. The Hierarchy pane is collapsed by default (leaving more room for the other panes) and is no longer force-opened when you select a class or method or filter by an instance variable. ([#259](https://github.com/GemTalk/Jasper/issues/259), [#372](https://github.com/GemTalk/Jasper/pull/372), [#383](https://github.com/GemTalk/Jasper/pull/383))
- **Full logical backup and restore now ask the stone where its files go, so they work over Windows/WSL.** Both used a client-side file picker for what is a *server-side* path — which only ever worked by coincidence when client and server shared a filesystem, and silently broke over WSL (GemStone's server is never Windows). Backup now prompts for a bare file name and joins it onto the backups directory the stone itself reports, handling the overwrite confirmation itself; restore lists the backups it finds by querying the stone and offers them in a quick pick. The Databases tree's **Backups** node is gone — it browsed the local filesystem for server-side files, which doesn't hold up over WSL — and restoring remains reachable from the Sessions view. Reveal-in-Explorer after a backup is offered only when the WSL bridge says the file is actually reachable. ([#391](https://github.com/GemTalk/Jasper/pull/391))
- **A rename that leaves methods un-recompiled now tells you which ones.** The apply toast could name only the first failure, and then it vanished. The full list now goes to the persistent **GemStone GCI** output channel under a heading naming the rename it belongs to, and the toast carries a **Show Details** button that reveals it. Three of the four rename refactorings could not report a failure at all: `Behavior>>compileMethod:dictionaries:category:` *answers* an array of error tuples rather than raising, so an unchecked send read as success — the method was never installed, yet the apply counted it as applied and said nothing. All four now check. ([#411](https://github.com/GemTalk/Jasper/pull/411))
- **Developer tooling and test-suite work.** No user-facing behavior change, but a substantial amount landed here: the deep GCI binding tests continued migrating out of the excluded on-demand `gci` project into the CI integration suite, where they run across the whole GemStone release matrix ([#344](https://github.com/GemTalk/Jasper/pull/344), [#371](https://github.com/GemTalk/Jasper/pull/371), [#393](https://github.com/GemTalk/Jasper/pull/393), [#420](https://github.com/GemTalk/Jasper/pull/420)); every harness session now arms GemStone's own session-level commit guard, so a stray commit fails at the commit site instead of leaking state into the next test, the parallel workers sharing the stone, or the second CI pass ([#420](https://github.com/GemTalk/Jasper/pull/420)); the test tiers and the rule that `useIntegrationTest` is a stone-dependent test's default home are now written down ([#373](https://github.com/GemTalk/Jasper/pull/373), [#420](https://github.com/GemTalk/Jasper/pull/420)); TypeScript moved to `node16` module resolution, retiring the `vscode-languageclient` v10 `paths` shim ([#355](https://github.com/GemTalk/Jasper/pull/355)); ESLint and Prettier caches make repeat local `lint`/`format:check` runs roughly ten times faster ([#376](https://github.com/GemTalk/Jasper/pull/376)); the vague `toBeTruthy`/`toBeFalsy` matchers and conditional `expect`s are now banned by lint ([#357](https://github.com/GemTalk/Jasper/pull/357), [#398](https://github.com/GemTalk/Jasper/pull/398)); duplicated refactoring code was consolidated onto one apply-result parser, one JSON-helper class, one move/push relocation abstraction, and one set of instance-variable queries ([#361](https://github.com/GemTalk/Jasper/pull/361), [#401](https://github.com/GemTalk/Jasper/issues/401), [#404](https://github.com/GemTalk/Jasper/pull/404), [#414](https://github.com/GemTalk/Jasper/pull/414)); and the release instructions now say to use `npm version --no-git-tag-version` rather than hand-editing `package-lock.json`, after an audit traced a corrupted lockfile entry to a find-and-replace during the 1.6.1 release ([#380](https://github.com/GemTalk/Jasper/pull/380)).

### Fixed

- **Class sync/export and the Rowan project diff now work on GemStone 3.6.x.** On 3.6.x every string literal inside a GCI-executed doit compiles to `Unicode7`, so comparing an image-derived value against a string literal misbehaves in one of two ways: `String = 'literal'` *raises* `ArgumentError` 2718, and `Symbol = 'literal'` silently answers `false`. Both had a live site. Class sync/export resolved its target dictionary with `name asString = '<dict>'` and so died outright on 3.6.x ([#399](https://github.com/GemTalk/Jasper/issues/399)); the Rowan project diff classified operations with `op class name = 'CypressAddition'`, which always answered `false`, so every row was silently labelled `M` ([#400](https://github.com/GemTalk/Jasper/issues/400)). Both now compare interned symbols with `==`, which is a no-op on 3.7.x and correct on 3.6.x. ([#405](https://github.com/GemTalk/Jasper/pull/405))
- **Refactorings no longer decline a method whose source contains a non-ASCII character.** Parsing a method whose stored source is a wide `DoubleByteString` — any non-ASCII character in a comment, string, or character literal — hit a `doesNotUnderstand` inside `RBParser` on 3.6.2. Callers wrap the parse and swallow the error, so this surfaced as a flat refusal ("the method source does not parse") rather than an error: convert-temp and the push-up/push-down accessor detection had been silently broken for such methods. A feature-detected `Character>>isSqueakSeparator` compatibility shim fixes the parse. ([#361](https://github.com/GemTalk/Jasper/pull/361), [#362](https://github.com/GemTalk/Jasper/issues/362), [#389](https://github.com/GemTalk/Jasper/pull/389))
- **Escape in an Explorer filter box now cancels the edit instead of applying it.** The panes filter live as you type, so by the time the box closed the pane had already changed — and VS Code fires the same hide event for Enter and Escape, so nothing distinguished an accepted edit from an abandoned one. Escaping left the half-typed filter applied, and because the box is seeded from the current filter, abandoning an edit of an established filter overwrote it with no way back short of retyping. The filter in force when the box opened is now restored when you escape. One shared code path backs all four panes — Dictionaries, Categories, Classes, and Methods — so all four are fixed together. ([#388](https://github.com/GemTalk/Jasper/issues/388), [#390](https://github.com/GemTalk/Jasper/pull/390))
- **Saving a class definition, and creating a new class, work again in the Explorer.** The new-class template used the 8-keyword `subclass:…category:options:` selector, which does not exist on base stones, so the save errored; Jasper now compiles the always-valid 7-keyword definition and applies the category separately, and refuses a new-class save that would overwrite an existing class in the target dictionary. The class-definition editor also shows the class category on its own line (`Class>>definition` never emits `category:`), and the New Class template always carries an editable `category:` line defaulting to `'User Classes'`. Two related annoyances went with them: clicking a category node no longer produces a "Select a class first" toast on **New Method**, nor empties the Hierarchy pane — the class stays selected when it remains under the clicked category. ([#397](https://github.com/GemTalk/Jasper/pull/397))
- **A rename preview no longer lets you deselect a change that the other changes depend on.** The instance-variable rename allowed unchecking the class-definition edit while keeping the method recompiles — which would recompile the bodies against a name the class doesn't declare, so every recompile fails or binds to a stray Undeclared global. The method rename allowed unchecking one implementor's rename while its senders' recompiles stayed checked, silently changing dispatch: call sites move to the new selector while that implementor keeps the old one, so instances fall through to an inherited method or land in `doesNotUnderstand`. Structural, required cards now render checked and disabled. ([#340](https://github.com/GemTalk/Jasper/issues/340), [#341](https://github.com/GemTalk/Jasper/pull/341))
- **Hardened three narrow checks on the refactoring paths.** The rename-class panel's returned scope was taken through an unchecked cast into a generated server query and is now validated as untrusted webview input — a malformed shape is rejected and the panel stays open. Extract Superclass now catches a name collision it previously let through. The class-by-prefix picker's strict prefix matching was extracted from an inline closure so it can be tested. ([#422](https://github.com/GemTalk/Jasper/pull/422))
- **Installing server support works from a Windows client against a WSL gem.** On Windows the gem always runs inside WSL, so it sees a Windows-drive checkout only through WSL's DrvFs mount (`/mnt/<drive>/…`) — never the `D:\…` path the client resolves. The refactoring and Enhanced Inspector installers now translate payload paths before they cross the GCI connection. ([#424](https://github.com/GemTalk/Jasper/pull/424))
- **The test suite now passes on Windows.** A batch of Windows-only failures, none of which affected the shipped extension: a missing `.gitattributes` let git's `core.autocrlf` rewrite fixture files to CRLF, silently mis-parsing them; several assertions compared a real `Uri#fsPath` against a hardcoded forward-slash literal; one test used a path name containing a backslash, which Win32 reserves outright; the supply-chain lint check invoked `npm` without a shell, so `CreateProcess` never consulted `PATHEXT` and failed with `ENOENT`; the MCP socket tests assumed a POSIX filesystem; and two `VersionManager` catalog tests used a platform key that is `undefined` on Windows without WSL. ([#348](https://github.com/GemTalk/Jasper/pull/348), [#406](https://github.com/GemTalk/Jasper/pull/406), [#407](https://github.com/GemTalk/Jasper/pull/407), [#410](https://github.com/GemTalk/Jasper/pull/410), [#416](https://github.com/GemTalk/Jasper/pull/416), [#424](https://github.com/GemTalk/Jasper/pull/424))

### Security

- **Hardened the repo against install-time supply-chain attacks (the Shai-Hulud / SHA1-Hulud worm class).** The dev-toolchain npm floor rises to 11.16 — the minimum that supports `strict-allow-scripts` — and `.npmrc` now sets `strict-allow-scripts=true` against a version-pinned `allowScripts` table in `package.json`, so an unreviewed dependency's install script fails closed instead of silently running. The tree's five current install-script dependencies are approved and `fsevents` is denied, and a new `lint:supply-chain` CI check means deleting `.npmrc` can't quietly disable any of it. A 7-day `min-release-age` cooldown guards local `npm install`/`update` (the only path that can still pull a freshly published malicious release, since the lockfile pins every version), mirrored by a matching Dependabot cooldown. ([#246](https://github.com/GemTalk/Jasper/issues/246), [#381](https://github.com/GemTalk/Jasper/pull/381))
- **Picked up upstream security fixes in six dependencies.** `hono` 4.12.34 (SSR `memo()` cross-user data disclosure, CORS ReDoS), `undici` 7.29.0 (cross-user information disclosure via malformed qualified `private` Cache-Control directives, plus a duck-typed blob body issue), `fast-uri` 3.1.5, `js-yaml` 4.3.1 (quadratic complexity in `!!omap` duplicate-key detection), `brace-expansion` 5.0.9, and `ip-address` 10.4.0. GitHub Actions dependencies were bumped as a group as well. ([#363](https://github.com/GemTalk/Jasper/pull/363), [#364](https://github.com/GemTalk/Jasper/pull/364), [#365](https://github.com/GemTalk/Jasper/pull/365), [#366](https://github.com/GemTalk/Jasper/pull/366), [#367](https://github.com/GemTalk/Jasper/pull/367), [#386](https://github.com/GemTalk/Jasper/pull/386), [#409](https://github.com/GemTalk/Jasper/pull/409))

## [1.8.10] - 2026-07-31

### Added

- **Refactoring: rename instance variable, class variable, method/selector, class, and temporary/argument.** A server-side refactoring engine (based on the Refactoring Browser) plus client commands with preview panels. The renames are offered from the Explorer's context menus, from the method source editor's **Refactor…** menu, and at the cursor. ([#191](https://github.com/GemTalk/Jasper/pull/191))
- **Refactoring: Extract Method and Inline Method.** Select code in a method and extract it into a new method, or inline a sent method back into its callers — each with a preview before applying. ([#222](https://github.com/GemTalk/Jasper/pull/222))
- **Refactoring: Extract Temporary and Inline Temporary.** Select an expression in a method and introduce a temporary variable for it (optionally replacing every occurrence in the declaring scope), or put the cursor on a temporary that is assigned once and inline its value back into each read, removing the now-dead declaration and assignment. Each previews before applying and never commits, and both are offered from the method source editor's **Refactor…** menu. ([#227](https://github.com/GemTalk/Jasper/pull/227))
- **Refactoring: Change Method Signature (add, remove, or reorder parameters).** Change a method's parameters across every implementor and sender at once — add a parameter (each call site gets a default value you supply), reorder parameters, or remove one (removing a parameter still referenced in a method body is declined, naming the class). Previewed before applying and applied server-side without committing. Offered from the Explorer's method context menu (**Change Signature…**) and the method source editor's **Refactor…** menu. ([#316](https://github.com/GemTalk/Jasper/pull/316))
- **Refactoring: Move Method.** Relocate one or more methods to a different class and/or flip them between the instance and class side, with a preview and selective apply (no commit). Drag one or more method rows onto a class in the Explorer to move or copy them, or use the right-click **Move Method to Class…** (a filterable picker over all classes) and **Move to Class/Instance Side**. A move is declined per method when it would not compile in the target — the method sends `super`, the target already implements the selector, or the target lacks an instance variable the method uses. After applying, the Explorer navigates to the moved method in its new class. ([#324](https://github.com/GemTalk/Jasper/pull/324))
- **Refactoring: Push Up Method and Push Down Method.** From a method row's inline ▲/▼ actions, move a method up to its immediate superclass, or push it down into each immediate subclass — same side, previewed, applied server-side without committing. A collision (the superclass already defines the selector, or a subclass overrides it) is not a hard stop but an opt-in overwrite row: unchecked by default and flagged with a data-loss warning and a before/after diff; push-down also lets you pick a subset of subclasses. A `super` send, a missing method, or a push-up onto a superclass that lacks a variable the method uses are declined. The moved method is revealed and highlighted after applying. ([#336](https://github.com/GemTalk/Jasper/pull/336))
- **Refactoring: instance-variable structure changes — push up, push down, move, and convert a temporary to an instance variable.** Push an instance variable up to a superclass or down into subclasses, move it to another class along the hierarchy via the ▲/▼ pickers (▲ chooses any ancestor, ▼ a subset of descendants at any depth), or convert a method temporary into an instance variable. Because GemStone has no `addInstVarName:`/`removeInstVarName:`, changing a class's instance-variable list creates a new class version — methods are copied forward and the subtree re-parented — so the change previews first, stays constrained to the class's own hierarchy (no unrelated-class move, so no instance-data-loss case is reachable), and never commits unless you opt in. ([#343](https://github.com/GemTalk/Jasper/pull/343), [#350](https://github.com/GemTalk/Jasper/pull/350))
- **Class History panel.** A **Class History…** action on a class shows its definition history across class versions. ([#191](https://github.com/GemTalk/Jasper/pull/191))
- **Unified optional server-support install.** The Enhanced Inspector and the refactoring engine now install together as one "server support" bundle: a single `gemstone.serverSupport.autoInstall` setting (`ask`/`always`/`never`), one **Install Server Support (Enhanced Inspector + Refactoring)** command, and one connect-time prompt. The refactoring engine loads on all supported GemStone versions; the loader's completeness report goes to a new **GemStone Refactoring** output channel. ([#191](https://github.com/GemTalk/Jasper/pull/191))
- **Rowan: manage a project's dependencies and load state.** A Rowan project can declare dependencies — by git URL or a local directory, pinned to an exact commit — and see, beside its packages, whether each dependency is committed to disk and loaded into the database. Adding one offers to load the project (the `gemstone.rowan.loadAfterAddingDependency` setting remembers the answer), and a project loads and unloads as the working user who asked, never SystemUser. ([#216](https://github.com/GemTalk/Jasper/pull/216))

### Fixed

- **Several debugger features now work on GemStone 3.6.2.** The stack-frame method location, the implementation-candidate class chain, the **Browse** target, and the `doesNotUnderstand` details (with its **Create** action) each built a tab separator with `String tab`, which `String class` does not implement on 3.6.2 (the minimum supported release). Each generator swallows its own error and returns nothing, so on 3.6.2 the four features silently degraded with no error surfaced. The tab is now built portably (`String with: Character tab`) — byte-identical output on newer releases — so all four work on 3.6.2. ([#342](https://github.com/GemTalk/Jasper/pull/342))
- **The `status`, `describe_test_failure`, and `list_failing_tests` MCP tools no longer fail on GemStone releases before 3.7.5.** Each embedded an em dash in the Smalltalk source it compiles over GCI, and certain non-ASCII characters in compiled source trip an internal compiler bug (`ComStrmSetCursor`, error 1001) on pre-3.7.5 releases, so the compile — and thus the tool — failed outright. Those em dashes are now plain ASCII hyphens. (Six further non-ASCII characters in the tutorial notebook were swept to ASCII for consistency, though they did not reproduce the crash.) ([#339](https://github.com/GemTalk/Jasper/pull/339))
- **Draining the server-side Transcript no longer garbles non-ASCII output or truncates past 1 MB.** The Transcript drain and live-toggle paths fetched their result as raw single-byte bytes capped at 1 MB; they now go through the same UTF-8-safe, paged fetch (`encodeAsUTF8` + `GciTsFetchBytes` paging) as the rest of the extension, so multi-byte characters in transcript output survive intact and a large drain is no longer cut off. ([#218](https://github.com/GemTalk/Jasper/pull/218))

### Security

- **Patched the `brace-expansion` denial-of-service advisory (GHSA-mh99-v99m-4gvg) by upgrading `vscode-languageclient` to 10.1.0.** Version 10 is an exports-only package, so `client/tsconfig.json` carries a `paths` mapping for `vscode-languageclient/node` until the repo moves off `node10` module resolution. ([#288](https://github.com/GemTalk/Jasper/pull/288), [#354](https://github.com/GemTalk/Jasper/pull/354))

## [1.8.9] - 2026-07-22

### Changed

- **The "Configure OS" view is gone on macOS and Linux; its shared-memory setup now runs as part of Start Stone.** On those platforms the view only ever held one or two items (shared memory, plus `RemoveIPC` on Linux) that, once set, left it as permanent clutter in the sidebar. Starting a stone now checks those prerequisites first: if shared memory is under the 1 GB GemStone needs (or, on Linux, `RemoveIPC` isn't set to survive logout), Jasper explains that it will open a terminal and run a setup script with `sudo` — where you enter your password — and offers Continue/Cancel. Cancel, or a setup that doesn't bring shared memory up to 1 GB, cancels the start. The view is unchanged on Windows/WSL, where it still hosts the several ongoing settings (WSL version, mirrored networking, `gs64ldi` services) that don't fit a one-shot prompt.
- **The "Get Started with GemStone" walkthrough now begins with getting a stone, not connecting to one.** A new first step introduces **Quick Setup**, which downloads a GemStone version, creates a database, starts the stone, and adds a login — so a brand-new user is no longer dropped at "connect to a stone" with nothing to connect to. The "Connect" step follows, explaining that Quick Setup's login is ready to click, with **Add a Login** for reaching a stone you set up yourself or a remote one.
- **Empty-view welcomes now offer the action that populates each view.** The Logins & Sessions welcome was a long, scrolling list of onboarding links (walkthrough, Quick Setup, tutorial, workspace) that mostly pointed "back" to stone-setup steps; it's now just **Add a Login** (with a one-line pointer to the Databases view if you have no database yet). **Quick Setup** moved to the Databases view's empty state — the natural place to surface "you have no stone" — alongside the manual **Create Database**. The full walkthrough still auto-opens on first activation and is reachable from Help → Welcome and the Versions view header.
- **The walkthrough now auto-opens on the first activation after install, rather than the first time the GemStone sidebar view is revealed.** The old trigger depended on the Logins & Sessions view being expanded — marking any GemStone view `"visibility": "collapsed"` would have silently disabled onboarding, far from the code that opens it. Keying off activation (the extension already declares `onStartupFinished`) removes that fragile coupling; it still opens once per machine and stays out of the way afterward. The **Reset Getting Started** command's title and message were updated to say the walkthrough returns on the next startup (not "on Next Connect").

### Fixed

- **The walkthrough's (and Logins view's) "Add a Login" button now works.** It was wired to `gemstone.login` — the command that connects a *selected* login — so clicking it from a static button (which passes no login) threw and did nothing. It now opens the new-login editor via `gemstone.addLogin`.
- **The Versions view's "Open Terminal" button now puts `$GEMSTONE/bin` on `PATH`.** It set `GEMSTONE` but not `PATH` (nor the dynamic-library/man paths), so tools like `topaz` weren't found — unlike the Databases view's terminal, which set them correctly. Both terminals (and the internal process listing) now share one version-environment builder, so `$GEMSTONE/bin` binaries are runnable from either and the two can't drift apart again.
- **A locally-built GemStone product tree placed directly in the versions folder is now recognized.** The Versions view only listed versions that were either symlinked local builds or on the download catalog, so a real product directory copied into `~/Documents/GemStone` (e.g. a private 4.0 build) was silently dropped — yet **Register Local Version** refused it with "already exists," leaving no way to surface it. Such directories now appear as extracted, ready-to-use versions (so you can create databases from them); and if you do run Register Local Version on one already in place, it reports that it's already present instead of erroring.

### Security

- **Patched the transitive dependency vulnerabilities flagged by Dependabot.** Added root `overrides` pinning `fast-uri` to `^3.1.4` (host-confusion, high — pulled in via the MCP SDK's `ajv`) and `js-yaml` to `^4.3.0` (quadratic-CPU merge keys, high — dev-only, via `@vscode/vsce`), guarded by a new `dependencyVulnFloors` test so a lockfile refresh can't silently regress below the patched floors. The `@hono/node-server` `serve-static` path-traversal advisory (moderate, Windows-only) is **not applicable**: `@hono/node-server` is not bundled into the extension, and Jasper's MCP server uses the SSE transport, not the hono-based Streamable-HTTP transport that reaches the vulnerable code. Its only fix is a 2.x major bump outside the MCP SDK's declared `^1.19.9` range, which marks the package "invalid" and breaks extension packaging (`vsce`'s dependency walk that ships koffi's native binary), so it is left at the SDK's version and the alert dismissed as not-affected.

## [1.8.8] - 2026-07-21

Maintenance release — no user-facing changes. Internal refactoring (migrating the shared query layer onto `defaultQueryExecutorUsing`, plus dead-code removal), developer-tooling tweaks (`dev:fresh`, ESLint ignore sync), and transitive dependency (lockfile) updates including `hono` and `linkify-it`.

## [1.8.7] - 2026-07-21

### Added

- **STON syntax highlighting.** `.ston` files (STON — Smalltalk Object Notation) now get syntax highlighting, bracket matching, and folding, via a TextMate grammar following GemStone's STON dialect. ([#177](https://github.com/GemTalk/Jasper/pull/177))
- **Rowan: create a new project.** A **New Rowan Project** action scaffolds `rowan/project.ston`, a load spec, a Core component, and `src/` by writing the files directly — matching the RowanV3 solo tool's default layout, with no solo gem or GemStone install required. New projects get a `.gitignore` for Jasper's local `.gemstone` class mirror. ([#180](https://github.com/GemTalk/Jasper/pull/180))
- **Rowan: recognize the open workspace as a project.** When the workspace folder is itself a Rowan project (has `rowan/project.ston`), the Rowan view now leads with a **This Project** section listing the project's Tonel packages and lists it under Repositories as the workspace repo. ([#179](https://github.com/GemTalk/Jasper/pull/179))

### Changed

- **The Getting Started walkthrough now opens on first reveal of the GemStone view**, rather than after your first successful connect — so its "how to connect" guidance arrives before you connect rather than after you have already worked it out. Still shown once per machine. ([#173](https://github.com/GemTalk/Jasper/pull/173))

### Fixed

- **GemStone 4.0 client libraries can now connect.** `GciTsEncrypt` — the one required GCI symbol a 4.0 library does not export — was bound eagerly, so loading a 4.0 library aborted with "Cannot find function 'GciTsEncrypt'" before login could even start. It is now bound optionally (Jasper never calls it on the connect path), matching the other version-gated symbols.
- **Display It renders non-ASCII results correctly.** Its result path fetched `printString`'s bytes raw, which only worked when the result was already single-byte-per-char and silently garbled real Unicode; it now uses the same UTF-8-safe fetch (`encodeAsUTF8` + paged fetch) used elsewhere. ([#176](https://github.com/GemTalk/Jasper/pull/176))
- **Class-definition syntax highlighting no longer mis-colors the superclass name.** The synthetic wrapper the LSP uses to reuse the method parser over a class-definition region leaked a token onto the real expression, splitting the superclass name into two colors.
- **Errors from Display/Execute/Debug/Inspect It are now surfaced instead of swallowed.** These command handlers did not await their async work, so a failure (an unresolved class oop, a failed GCI call, …) became an unhandled rejection logged only to the Extension Host console; they now flow through VS Code's command error handling and reach the user. ([#175](https://github.com/GemTalk/Jasper/pull/175))

## [1.8.6] - 2026-07-20

### Changed

- **Login editor: the NetLDI field now shows that it accepts a port number.** It is labeled **NetLDI (name or port)**, with a hint that it takes either a NetLDI service name (e.g. `gs64ldi`) or a port number (e.g. `50377`) — useful for connecting to remote stones.

## [1.8.5] - 2026-07-14

### Fixed

- **Minimum supported VS Code version is now 1.101.0** (bundled Node 22.15.1), up from 1.85.0. `@types/node`, `@types/vscode`, `tsconfig.base.json`'s `lib`, and `esbuild.mjs`'s bundle target are aligned to this floor so a passing type-check once again implies the extension runs on the oldest VS Code it declares support for; CI adds a floor smoke-test job (Node 22.15.1 against the oldest supported GemStone version) alongside its existing `.nvmrc`-Node matrix. See CONTRIBUTING.md's "Supported VS Code & Node versions" section for the policy and the full list of coordinated knobs.
- **`typescript` devDependency floor raised to `^5.7.2`**, the minimum version that recognizes the new `ES2024` lib entry declared above.

### Changed

- **The Jasper-hosted MCP server is renamed `gemstone` → `jasper`.** This frees the name `gemstone` for a forthcoming GemStone-native MCP server. Its tools now appear to AI clients as `mcp__jasper__*`, and the config entry Jasper writes is `mcpServers.jasper` in `~/.claude.json` and Claude Desktop's config. **Migration is automatic:** on the first activation after upgrading, Jasper writes the new `jasper` entry and removes the old `gemstone` entry it previously wrote (top-level and project-scope) — but only when that entry still points at Jasper's own proxy, so a `gemstone` entry belonging to something else (e.g. the native server) is left untouched. The HTTPS/SSE URL (`https://127.0.0.1:27101/sse`) and the socket/pipe path are unchanged. **Manual action needed only if you configured this server by hand:** clients where you hand-added the entry keep a stale `gemstone` key — change it to `jasper`. The MCP-related settings were renamed `gemstone.mcp.httpPort` → `jasper.mcp.httpPort` and `gemstone.mcp.registerWithClaudeDesktop` → `jasper.mcp.registerWithClaudeDesktop` (a value you set under the old key is still honored, so existing settings keep working); the command ids `gemstone.claimMcpServer`, `gemstone.copyMcpUrl`, `gemstone.copyMcpSocketPath`, `gemstone.installMcpTlsCertificate`, and `gemstone.openMcpInspector` were renamed to their `jasper.*` equivalents — **breaking for any custom keybinding referencing an old id**.
- **Backup actions regrouped to de-crowd the Sessions row.** **Online Extent Backup** is now an inline button on the running **Stone** row in the Databases view — its natural home, since it snapshots a local stone's extent files on the stone's own host — rather than being Command-Palette-only; run from there it binds to a live session on that stone. **Full Logical Backup** and **Full Logical Restore** moved off the session's inline button row into its right-click menu, so the everyday Commit/Abort/Logout actions are no longer crowded against (or one mis-click away from) the rarely-used backup pair.
- **GemStone Explorer: Refresh keeps your selection, and a session abort refreshes it in place.** The Refresh button no longer resets the navigator — your dictionary/class/method selection and per-pane filters are preserved (a failed fetch keeps the current listing rather than blanking it). Aborting a session now reloads the Explorer's listing too (previously it was left stale after uncommitted changes were discarded), without pulling focus away from wherever you pressed Abort.

## [1.8.4] - 2026-07-14

### Added

- **Generate a Grail (.py) stub from a Smalltalk class.** Reflects an existing Smalltalk class into an editable Grail `@smalltalk_class` module — `__slots__` from the class's own instance variables (in declaration order, as Grail validates), `@smalltalk` forwarders for the accessors it understands, and `@smalltalk` wrappers for the methods you pick (class-side as `@classmethod`); binary selectors are listed as commented candidates. Available via **GemStone: Generate Grail .py Stub…** from the GemStone Explorer class/hierarchy context menus, the System Browser class menu, and the Command Palette.
- **Online extent (snapshot) backup.** A new **GemStone Admin: Online Extent Backup** command takes a live file-system snapshot of a stone's extents, bracketed by checkpoint suspension (suspend → copy the frozen extents → always resume and verify the result), following `$GEMSTONE/examples/admin/onlinebackup.sh`. Scoped to extents only — the completion notice reminds you a restore also needs the stone's transaction logs — and limited to Jasper-managed local stones with full logging enabled.
- **Auto-create the DataCurator login when creating a database.** Creating a database now saves a DataCurator login for the new stone (unless one already targets it), so it can be connected to — and cleanly stopped — right away. Quick Setup already did this; this closes the gap for the plain Create Database command.

### Changed

- **"Find Method…" renamed to "Find Method in Class…" and now always shows a filterable class picker.** The command searches within a single class, so the title now says so. With no class selected in the System Browser it previously prompted with a plain text box and then failed to select or open the picked method; it now offers the same filterable class list as **Find Class**, and when a class *is* selected in the browser that class is pre-highlighted as the default (one Enter reproduces the old scoped behavior, but the list is right there to pick another). Picking a method navigates to and opens it. The command id changed from `gemstone.findMethod` to `gemstone.findMethodInClass` — **breaking for any custom keybinding referencing the old id** (the built-in `Ctrl/Cmd+K M` chord is unaffected).
- **Stopping a stone now resolves its DataCurator password from the stone's login, with a prompt/force-kill fallback.** `stopstone` needs a DataCurator password for a clean shutdown; it now uses the stored (or keychain) password of the stone's DataCurator login instead of assuming the stock default. When there is no usable credential — no login, or a password `stopstone` rejects — Jasper offers to enter one or to **force-stop** the stone (a hard stop it recovers from via its transaction log on next start), and never signals a PID that has been reused by an unrelated process.

### Fixed

- **Enhanced Debugger single-stepping no longer degrades silently across GemStone versions.** Stepping past a halt now starts execution interpreted via a GCI perform flag (`GCI_PERFORM_FLAG_INTERPRETED`) rather than toggling a kernel breakpoint on a method that didn't exist on every release — so single-stepping works on 3.6.x (where the old toggle method was absent) and no longer depends on ref-counted session state. Integration tests assert stepping across the CI version matrix.

## [1.8.3] - 2026-07-13

### Added

- **Full Logical Backup and Restore.** Two new Sessions-view actions. **Full Logical Backup** (`Repository>>fullBackupTo:`) backs up the connected stone over the active session to a server-side destination (default `<db>/backups`), with an always-visible status-bar progress item and a **Reveal in File Explorer** action on success; a browse-only **Backups** node appears under a managed database, newest-first. **Full Logical Restore** restores from a backup — closing the session, stopping the stone, saving the current extent aside (optionally starting from a fresh extent), restarting, then restoring and committing — driven from a live session so its credentials carry through the stop/start cycle. Restore is limited to Jasper-managed databases and confirms before the destructive step. ([#148](https://github.com/GemTalk/Jasper/pull/148))

### Changed

- **Logging in now shows progress, stays responsive, and de-duplicates repeat clicks.** Connecting wraps in a "Connecting to <stone>…" progress notification; the login handshake runs non-blocking (`GciTsNbLogin` with a polling loop, falling back to a blocking login on Windows / older libraries) so the window no longer freezes during connect; and repeat clicks on the same login while a connect is in flight are dropped instead of starting extra sessions.
- **A connected login's configuration can now be viewed.** Clicking a connected login row opens its settings read-only ("View Login") instead of going inert or refusing with "log out first". Editing still requires logging out (identity fields affect how the session's row is grouped), but inspecting a live login carries no such risk.

### Fixed

- **Login no longer fails on GCI libraries that don't export `GciI32ToOop` / `GciTsI32ToOop`** (e.g. GemStone 3.4.5). These session-free encoders were bound eagerly, so a library missing them threw inside the `GciLibrary` constructor and blocked login entirely; they are now bound optionally, like other version-gated GCI symbols. No production code path uses them.

## [1.8.2] - 2026-07-10

### Fixed

- **GemStone Explorer: "No view is registered with id: gemstoneExplorerOpenEditors" on login.** The Open Editors pane was gated on a context key that only becomes true once a `gemstone://` editor is open, but VS Code registers a contributed view only when its `when` clause is satisfied — so creating the pane at activation failed on every login (it never has an open editor yet). The pane is now gated on an active session, matching the other Explorer panes. As a result it no longer auto-hides when no editors are open.

## [1.8.1] - 2026-07-10

### Added

- **GemStone Explorer (experimental).** A new code browser on its own activity-bar container: four cascading panes (Dictionaries → Class Categories → Classes → Methods) that open real, editable `gemstone://` editors with full LSP. It adds a Class Hierarchy pane, per-pane type-to-filter, **Find Class** (cascades the panes to a class), **New** actions for dictionaries/categories/classes/methods, right-click Implementors/Senders/override navigation, drag-to-move a method between categories (drag-to-copy onto a class), an **Open Editors** pane mirroring open GemStone editors (with an unsaved-changes dot), and editor↔navigator selection sync. Offered alongside the existing System Browser for early feedback. ([#147](https://github.com/GemTalk/Jasper/pull/147))

### Fixed

- **The extension now activates on startup, so `gemstone://` editors keep working after a window reload.** Its only activation event was opening a Jupyter notebook, so on a normal launch the extension never activated — the `gemstone://` virtual filesystem was never registered and stale editor tabs restored from a previous session lingered unservable. Activation now also fires on startup and on any `gemstone://` file access, and orphaned tabs left by a reload or a logged-out session are reaped.
- **Binary selectors containing `/` (e.g. `/`, `//`) now open correctly from the browser.** VS Code path-normalization collapsed the slashes in the editor URI; they are now escaped and restored on the way back, so these methods open (fixes the System Browser too).

## [1.8.0] - 2026-07-08

### Added

- **Rowan package management (work in progress).** A new **Rowan** view lists tracked git repositories and the Rowan projects within them, and manages loading them into the image. Add a repository from a git URL (checked out into your workspace folder) and load/unload its projects; loads run non-blocking over a shared transient SystemUser session (Rowan loads require SystemUser). Git-backed repos get an inline **Update** that pulls with submodules and refreshes the row. A project can declare the gem cache it needs in a GemStone-native `rowan/gemstone.ston`; when the connected gem's cache falls short, Jasper flags the repo with a warning triangle and offers the fix before loading. Also adds **GemStone: Serve Seaside** / **GemStone: Stop Seaside Server** commands, which run a detached serving gem and open the app in the integrated browser. ([#144](https://github.com/GemTalk/Jasper/pull/144))

### Changed

- **New databases are created with a 500 MB gem cache, and existing databases are raised to 500 MB when Jasper starts the stone.** The former 50 MB default silently overflowed when loading a large Rowan project.

### Fixed

- **System Browser: clicking a class in the hierarchy view no longer reopens its source file.** The hierarchy click already refreshed the Class Definition pane; it also called `openClassFile`, shoving a file in front of whatever the user was editing. That call is removed, matching the column click's definition-only behavior.

## [1.7.8] - 2026-07-07

### Added

- **System Browser: prompt-based Browse Senders / Implementors / Methods Containing.** Three new method-list context-menu commands that prompt for text rather than acting on the selected method: **Browse Senders Of…** and **Browse Implementors Of…** (prompt for a selector) and **Browse Methods Containing…** (prompt for a string), each running the same ClassOrganizer-backed search and results view as the existing commands. They sit just after **New Method** and are always available since they take typed input and need no selection. The Command Palette's **Search Method Source** now delegates to the same single search path.
- **Sessions view: inline "Open Workspace" button.** Each session row gains an inline **Open Workspace** action (between Browser and Commit) that opens the scratch Workspace against that session — selecting the clicked session first, so with several sessions open, Execute It targets the one you clicked rather than whichever was already active.

### Changed

- **Session Abort and Logout now guard uncommitted work, and the inline buttons are reordered.** Logout prompts **Commit & Logout / Logout Anyway / Cancel** when the transaction is (or might be) dirty — committing first aborts the logout if the commit fails — and Abort's confirmation now fires on a dirty-or-unknown transaction, not only when editor buffers are unsaved. Session and login inline buttons are reordered so the most-used/safe action leads and the destructive one trails (Browser first, Logout last; Login first, Delete last).

### Fixed

- **System Browser resolves classes and methods by dictionary, not first-match name.** A class can be registered under more than one dictionary/key (e.g. `Globals>Object` and `Python>object`, `OrderedCollection` aliased as `Python>list`), and two SymbolDictionaries can even share a name. **Find Class** now lists every `(dictionary, key)` pair as its own navigable entry, and definition/comment/method operations carry the exact dictionary (by SymbolList index) so the right class backs every read, compile, delete, recategorize, rename, and copy — aliases that were previously unfindable now resolve correctly.
- **System Browser: companion tabs close with the browser, and methods keep their real category.** Tabs a browser opened (Globals, class definition, comment, method source, override diff) now close when the browser closes or the session logs out. Also, opening a method while a pseudo-category (**\*\* ALL METHODS \*\*** / **\*\* SESSION METHODS \*\***) was selected no longer mislabels it "as yet unclassified" nor recompiles it into that category on save — the method's actual category is used.
- **A fresh login no longer reports spurious uncommitted changes.** Beginning the login transaction rebuilds the session-method dictionary, bumping a change-counter on a persistent kernel singleton, so a session that only browsed showed "uncommitted changes" at logout and two concurrent committers could false-conflict on that object. Login now issues a single abort after setup to drop that spurious write; the transient session methods and Transcript sink survive it.

## [1.7.7] - 2026-07-07

### Added

- **System Browser: session methods, with a base-vs-override diff.** Session methods (transient extensions and overrides installed in the current session) now appear in the System Browser under a computed **\*\* SESSION METHODS \*\*** category, shown only when the current class side/environment actually has them. Session rows are italicized with a leading glyph (`+` extension, `±` override) and a hover tooltip. Clicking the `±` glyph on an override (or its context-menu item) opens a read-only base-vs-override diff in the source pane, comparing the override against the base method it shadows; clicking again toggles back, and it auto-closes on navigation. ([#143](https://github.com/GemTalk/Jasper/pull/143))
- **System Browser: an editable Comment tab.** A new **Comment** tab (beside the Globals/definition tab) fills with the selected class's comment; saving writes it back. It guards unsaved edits when you switch classes, shows a read-only indicator for locked classes, and never steals the active tab on (re)selection.

### Changed

- **System Browser: draggable column splitters, aligned indicators, and real column filtering.** The miller columns now have draggable splitters between them; method-list indicators (override arrows and the session glyph) sit in a fixed three-slot gutter so every method name aligns in its own column; and the per-column **Filter…** boxes now truly filter — non-matching rows are hidden, not merely left un-highlighted.
- **System Browser: class and method moves are now in the context menus.** Class/method drag-and-drop (and its grab cursor) is removed in favor of context-menu actions: class **Move to Category…** and method **Copy to Class…**.

### Fixed

- **Enhanced Inspector: drilling into a Raw-view row now opens the row's value.** Double-clicking a Raw-view row previously opened an inspector on the wrapping variable→value association rather than the value itself; rows are now resolved through GemStone's Phlow send-block (matching the forward view and GT's own navigation). Collection and custom views are unaffected.

## [1.7.6] - 2026-07-05

### Added

- **Enhanced Inspector — a GT-style, multi-column object inspector.** A new inspector modeled on Glamorous Toolkit's Phlow views: drilling into a field opens a new column immediately to the right of its source (rather than replacing the view), so a parent→child lineage reads left-to-right in a horizontal miller-column strip. Columns grow to fill spare space, can be pinned to an exact width by dragging an edge, and are closed independently. The required server-side support is offered for automatic install on connect — a tri-state **Ask / Always / Never** preference, also settable any time via the **GemStone: Enhanced Inspector Auto-Install…** command — and files in cleanly on both String- and Unicode-mode stones. **Inspect It** is now a single command that opens the Enhanced Inspector when a stone has the support installed and falls back to the classic sidebar Inspector otherwise (the separate "GT Inspect It" command and its `Ctrl+K O` keybinding are removed). Requires GemStone 3.7.5+ — earlier releases can't file in or render the payload, so they transparently use the classic Inspector. ([#137](https://github.com/GemTalk/Jasper/pull/137), [#138](https://github.com/GemTalk/Jasper/pull/138))
- **GemStone Transcript now streams live.** At login a small server-side sink class is installed behind the stream GemStone's `Transcript` actually writes to; the previous wrapper keyed a slot no supported version consults, so Transcript output was silently lost. `Transcript show:` from Execute/Display/Inspect It and notebook cells now appears in the **GemStone Transcript** output channel mid-execution, without blocking the extension host. Queries, MCP tools, and debugger stepping buffer their output server-side and drain it after each operation.
- **GemStone Smalltalk tutorial notebook.** A hands-on tutorial modeled on Prof Stef, opened via **GemStone: Open Tutorial Notebook** as an untitled Jupyter notebook — each lesson is a Markdown cell followed by runnable code cells (Shift+Enter). Adds an "Introduction to GemStone" section on persistence-by-reachability, transactions, and the shared multi-user repository; every snippet was validated against a live 3.7.5 stone.
- **Versions panel: inline Open Terminal button.** Opens a terminal rooted at a version's product directory, setting `GEMSTONE` and `GEMSTONE_GLOBAL_DIR` (a lighter environment than the Databases terminal, which configures the full stone environment). Available on extracted server versions and local builds.

### Changed

- **Minimum supported GemStone version is now 3.6.2.** Remote versions older than 3.6.2 are filtered out of the Versions panel and the Quick Setup picker; local (symlinked) installs are always kept regardless of age. ([#135](https://github.com/GemTalk/Jasper/pull/135))
- **GCI output channel renamed to "GemStone GCI", with timestamps and call durations.** Every log line is now prefixed with wall-clock time `[HH:MM:SS.mmm]`, and each call reports the time spent in it (tracked per session, so it stays exact even when sessions interleave). All output channels are now created up front at activation, so the full set is discoverable in the Output dropdown rather than appearing lazily on first use. Adds `docs/output-channels.md` summarizing every channel.
- **Integration test default version is now the oldest supported release.** `npm run test:server:start` (and the `--oldest` flag on `gemstone-integration-versions.js`) now defaults to the oldest version in `.gemstone-integration-releases.json` instead of the latest, ensuring new releases do not silently drop the minimum-version bar.

## [1.7.5] - 2026-07-02

### Changed

- **System Browser: auto-populate the next column on selection.** Selecting a dictionary now auto-selects the "All classes" pseudo-category so the Classes column fills immediately, and selecting a class (or toggling the instance/class side) auto-selects "All methods" so the Methods column fills immediately — in both cases without waiting for a further click on the pseudo-category itself.

## [1.7.4] - 2026-07-01

### Added

- **Enhanced Debugger: Browse a stack frame's method.** Right-click a stack frame → **Browse** opens a System Browser beside the debugger, navigated to the class and method running in that frame. An inherited method opens on its *defining* class (the source that is actually executing), resolved by method lookup on the receiver. Offered only for frames that resolve to a browsable class and selector — doit frames, unresolvable receivers, and classes outside the symbol list get an in-panel message instead. ([#130](https://github.com/GemTalk/Jasper/pull/130))
- **Enhanced Debugger: edit inline variable values from the source pane.** With the inline-value overlay on, double-click an editable variable's name in the companion source to set its value (Enter saves, Esc cancels). It reuses the Variables pane's in-frame write, so the pane, the overlay, undo/revert, and the GC-pin all update exactly as a pane edit does; a single click still just places the cursor (for navigation and Run to Cursor). Hovering a variable now shows its full printString along with a hint that editable ones can be set by double-clicking the name. ([#130](https://github.com/GemTalk/Jasper/pull/130))

### Changed

- **Enhanced Debugger: progress indicator and Cancel for long operations.** A busy spinner now appears over the panel for slow server round-trips — driven by the webview so it animates even while a synchronous GCI call has frozen the extension host, and never flashing on fast round-trips. Evaluate-in-frame is now non-blocking and interruptible: a single **Cancel** button (shown only for cancellable operations) sends a soft break on the first click and a hard break on the second, with acknowledgement text. Senders/implementors CodeLenses show a spinner placeholder while their counts compute. ([#130](https://github.com/GemTalk/Jasper/pull/130))
- **Developer test workflow.** Vitest now randomizes test order on every run (the separate `test:shuffle:*` scripts are removed), and the local test GemStone is managed by `npm run test:server:{start,stop,list}` (replacing `test:setup`). Integration tests no longer abort when `GEMSTONE_GLOBAL_DIR` is already set in the shell — `useIntegrationTest` saves, overrides, and restores it per suite. Adds a `CLAUDE.md` codebase guide and an overhauled `CONTRIBUTING.md`. ([#132](https://github.com/GemTalk/Jasper/pull/132))

### Fixed

- **Enhanced Debugger: restarting an "Executed Code" (doit) frame** now shows a clear message instead of the raw kernel `compiledMethodAt:` doesNotUnderstand — a classless doit home cannot be reset by the stack trim. ([#130](https://github.com/GemTalk/Jasper/pull/130))

## [1.7.3] - 2026-06-29

### Added

- **`default.conf` in new databases.** Creating a database now copies the product tree's `$GEMSTONE/data/system.conf` into the new database's `conf/` folder as `default.conf`, so the documented default configuration values are visible alongside the database without navigating into the GemStone install directory. The generated `system.conf` points at this local copy, and the step is skipped gracefully if the source is missing.

- **Enhanced Debugger: inline variable values in the source pane.** An
  **Inline values: on/off** toggle (a CodeLens at the top of the source pane)
  annotates the code with each in-scope variable's value — dimmed, inlay-hint-styled
  text aligned in a column to the right of the code (instance variables, arguments,
  temporaries, and `self`). By default each variable is shown once, at its first
  *use* — declarations (the `| temps |` line, block args `:x`, and the method
  signature) are skipped, so a tight loop doesn't repeat the same value on every
  line. A companion **Every line: on/off** toggle (shown while the overlay is on)
  switches to annotating every line that references a variable — handy in a long
  method. Only variables that actually appear in the visible source are shown
  (identifiers inside comments and string literals are ignored); hover an
  annotation for the full printString. Off by default; remembered for the session.
- **Enhanced Debugger: Run to Cursor.** A new **Run to Cursor** toolbar button (next
  to Resume) runs execution until it reaches the step point nearest the cursor in
  the companion source pane, then stops there like a halt (stack, variables, and
  the step-point highlight all refresh). It's column-aware — clicking `asInteger` in
  `x := (...) asInteger`, or inside a one-line block, breaks at that spot rather
  than the leftmost step point on the line. Under the cover it sets a temporary
  step-point breakpoint, resumes, and clears that break afterward — leaving any
  breakpoint you set yourself untouched. Works in "Executed Code" (doit) frames
  too — the temporary break is set on the doit's method by OOP. With no usable
  cursor target it falls back to a plain Resume with a brief notice.
- **Enhanced Debugger: richer Copy Stack and a new Dump Stack to File.** The Copy
  Stack toolbar button now copies the *full* stack with each frame's variable
  values (receiver / instance vars / args / temps), not just the frame labels. A
  new **Dump Stack to File** action writes that same detailed stack to a file,
  with a button to copy the saved path.
- **Enhanced Debugger: "Go to home method" for block frames.** Right-click a block
  frame → **Go to home method** to jump to its home method's activation on the
  stack. Navigate / Restart / recompile-and-continue on a block frame now act on
  that home-method activation, since a block can't be meaningfully restarted in
  isolation (matching GT).
  
- **File Out from the System Browser.** Right-click a class → **File Out Class…** writes the class's Topaz file-out to a path you choose (a trailing `TestCase` is dropped from the default file name, matching Jade). Right-click a dictionary → **File Out as Many Files…** writes one `.gs` file per class plus a loader file. The loader (following Grail's `install.gs`) first ensures the dictionary exists — creating it at the front of the symbol list, so its names resolve first, when absent — then forward-references every class (`dict at: #Name put: nil`) so methods that reference sibling classes — including circular references — compile against the dictionary association instead of failing on an unknown global, and finally inputs the class files superclass-first so each definition resolves its superclass.

- **Integration test infrastructure for the GCI layer.** A suite of shell scripts (`gs-install.sh`, `gs-start.sh`, `gs-stop.sh`, `gs-reset-extent.sh`, `gs-create-test-env-file.sh`, `gs-test-setup.sh`) automates downloading, installing, and running a local GemStone instance for integration tests; `gs-config.sh` is a shared configuration module sourced by the others. A `useIntegrationTest` vitest helper manages the session lifecycle (login, per-test begin/abort, logout). The CI health-check workflow runs a matrix job over the GemStone versions listed in `client/.gemstone-integration-releases.json`; to test against a new version, add an entry there.

  **To run integration tests locally** (Linux or macOS Apple Silicon only):
  ```
  npm run test:setup            # stops any running test stone, resets the database, starts fresh, writes .env.test
  npm run test:setup -- 3.7.2   # same, but pin to a specific version
  npm test                      # runs the full suite including integration tests
  ```
  `test:setup` always stops any previously running test stone, resets the database extent to a pristine state, and starts fresh — so it is safe to re-run. The generated `.env.test` file is gitignored.

  The `reasons` array in `.gemstone-integration-releases.json` is human-readable documentation only — it explains *why* each version is included in the matrix. It is not read by any script or CI step.

### Changed

- **CI moved back to GitHub Actions.** The 1.5.1 migration to GitLab has been reverted: `.gitlab-ci.yml` is removed and CI runs on the [Health Check workflow](.github/workflows/health-check.yml). The upstream repo lives on GitHub.

## [1.7.2] - 2026-06-26

### Added

- **Enhanced Debugger (work in progress): editable variables, implement-from-frame, and step/stop fixes.** Continuing the webview debugger introduced in 1.7.0:
  - **Editable Variables pane.** Left-click an instance variable or named arg/temp to edit it inline (prefilled with its `printString`); Enter evaluates the expression in the frame and assigns the result (`instVarAt:put:` / `_frameAt:tempAt:put:`). A single-level revert restores the original object — pinned against GC (`GciTsSaveObjs`) so undo can never hit a scavenged/reused OOP, and released on any stack-mutating op or dispose so the session's export set never leaks. Evaluator errors are now selectable/copyable. `self`, `(stack temps)`, and unaddressable slots stay read-only; GT Inspect moved to a right-click menu now that left-click edits.
  - **Implement-from-frame.** Right-click an inherited-method frame → **Implement in…** to add an override anywhere along the receiver's class chain (each candidate marked with its home dictionary and whether it already implements the selector; an existing implementation opens its source rather than being clobbered with a stub). When parked on a `subclassResponsibility`, an **Implement #sel** button does the same, bounded at the abstract definer. On a clean save the sender is re-entered so Resume re-dispatches into the new method, with an honest message when the call site (a workspace doit or the top frame) can't be re-entered in place.
  - **Step/stop fixes at a halt.** Step-point highlighting now works for Display It / Execute It / Inspect It (the offset is translated from the stored wrapped source into the displayed user code), and a Step on a halted "Executed Code" frame now advances exactly one user statement instead of running the process to completion. The companion source tab orphaned by closing a VS Code window with the debugger open is now reaped on the next launch. ([#124](https://github.com/GemTalk/Jasper/pull/124))

### Changed

- **Logging in no longer auto-opens a "Workspace" scratch buffer.** The old behavior opened an untitled `Workspace` document on every connect; because an untitled doc carrying content is permanently dirty, VS Code nagged to save it on exit and hot-exit kept restoring it. Instead, the **first** successful connect now opens a native **"Get Started with GemStone"** walkthrough — a dismissible Welcome-tab card with steps (connect → open a workspace → Display It → Inspect It), each of which checks itself off as you do it. The scratch workspace is still one click away on demand: a new **`GemStone: Open Getting Started Workspace`** command (also surfaced as a button in the empty **Logins & Sessions** view and as a walkthrough step) opens the same untitled buffer as before. The walkthrough shows once per machine; reopen it anytime from **Help → Welcome** or the Command Palette, and a **`GemStone: Reset Getting Started`** command makes it auto-open again on your next connect. A "Reopen this walkthrough later" step documents both inside the walkthrough itself.

### Fixed

- **`list_failing_tests` can no longer wedge a session by running the entire image.** Omitting `classNames` (or passing a very broad pattern) discovered every `TestCase` subclass in the symbolList — hundreds on a full image — and ran them all in one synchronous, blocking GCI call, tying up the session for minutes; the GCI smoke suite hung outright, since a blocking call can't be interrupted by a test timeout. The query now refuses a selection larger than 100 classes before running anything and asks you to narrow it with `classNamePattern` or explicit `classNames`. The SUnit smoke tests that drove the no-args path were rewritten to exercise the discovery fragment directly instead of running the whole image.

## [1.7.1] - 2026-06-24

### Fixed

- **The Marketplace build of 1.7.0 failed to activate at all** — every command (the first one most users hit being the Databases refresh button) reported `command 'gemstone.refreshDatabases' not found`, while the same build run from the Extension Development Host worked. The Enhanced Debugger's webview script, `client/src/debuggerView.js`, is read from disk at module load by `debuggerPanel.ts` (which `extension.ts` imports eagerly), but it was never whitelisted in `.vscodeignore`, so the broad `client/src/**` ignore rule dropped it from the packaged `.vsix`. Loading the bundled `extension.js` then threw `ENOENT` before `activate()` ran, leaving no commands registered. The file is now shipped, and a guard test asserts every runtime-read `client/src/*.js` asset is present on disk and whitelisted so this class of packaging regression can't recur.

## [1.7.0] - 2026-06-24

### Added

- **Enhanced Debugger (work in progress) — a webview, Smalltalk-style debugger offered alongside the existing DAP debugger.** When an error is debuggable, the notifier now offers **Enhanced Debug** beside the existing **Debug**; whichever you pick owns the suspended `GsProcess`, so the two debuggers never coexist on one process. The Enhanced Debugger opens a roomy panel modeled on the Pharo/GT debugger:
  - **Call stack** rendered as a numbered frame list with `Class>>#selector` labels, step point and source line (`@N line M`), a `[] in ` prefix for blocks, and `ReceiverClass (DefiningClass)` disambiguation for inherited methods (matching `GsNMethod>>_descrForStackPadTo:rcvr:`). The stack is filtered to user frames — the top exception/halt machinery and the bottom transcript-capture wrapper are trimmed, and frames renumbered 1..N.
  - **Companion source pane** docked below the panel with the selected frame's source and a step-point highlight on the current token (a darker amber override for light themes); read-only "Executed Code" doit frames show their unwrapped source.
  - **Variables pane** grouped into Receiver (`self`) / Instance variables / Arguments & Temps / a collapsed "(stack temps)" group, each row carrying its oop; click a row to open a GT Inspector on that object.
  - **Eval-in-frame bar** that evaluates an expression in the selected frame — binding the frame's named args/temps via a transient symbol dictionary (`evaluateInContext:symbolList:`) so locals resolve, not just `self`/globals.
  - **Toolbar** with the DAP codicon glyphs for Resume / Step Over / Step Into / Step Through / Restart Frame / Terminate. Stepping past a halt or error finally works: because GemStone can't single-step native code (error 6014), the debugger flips the gem to interpreted execution (ref-counted, via a benign kernel breakpoint, restoring the user's native-code state when the last debugger closes) before the run. Step and stack-trim run non-blocking (`GciTsNbPerform` + a shared poll loop) so a long step no longer freezes the extension host and is cancellable.
  - **Edit-and-continue:** saving a frame's companion source recompiles the method and re-enters that frame (`trimStackToLevel:`) so Resume re-runs it; the absolute top frame can't be reset in place (a GemStone limitation), so it's marked stale with guidance rather than hanging.
  - **Create-method-from-DNU:** when parked on a `doesNotUnderstand:`, offers "Create #&lt;selector&gt; in &lt;Class&gt;", opening a pre-filled new-method template; on a clean save it re-enters the sending frame so Resume runs into the new method.
  - **`Debug It`** command (`gemstone.debugIt`, editor context menu, `Ctrl+K R`) runs the selection with single-step so the server breaks on the first statement (no injected halt), opening the Enhanced Debugger directly on the halt.
  - **Display It / Inspect It / GT Inspect It** that halt now render their result (overlay / inspector / GT inspector) once resumed or stepped to completion; Execute It stays intentionally silent. ([#123](https://github.com/GemTalk/Jasper/pull/123))

### Changed

- **New class definitions now open automatically after compiling**, matching the new-method behavior. Previously, saving a new class compiled it silently but left you staring at the blank template — you had to close the tab and find the class in the browser yourself. Now the placeholder tab closes and the real definition tab opens; the same navigation also fires when saving an existing definition, in case the class name changed. The mirror sync now keys off the class name GemStone actually compiled rather than the URI, so it stays accurate even when the name changed on save. ([#121](https://github.com/GemTalk/Jasper/pull/121))
- Dependency update: undici 7.25.0 → 7.28.0. ([#122](https://github.com/GemTalk/Jasper/pull/122))

## [1.6.6] - 2026-06-18

### Added

- **Method override indicators (▲/▼) in the System Browser method list.** Each selector now shows ▲ when it overrides a superclass implementation, ▼ when it is overridden in a subclass (both glyphs when both apply). The bits are computed server-side over the full hierarchy (`whichClassIncludesSelector:` up the superclass chain, `allSubclasses` down) and ride along on the existing method-list query, so there is no extra round trip. The arrows are clickable: ▲ opens the superclass-chain implementations, ▼ opens the subclass overrides, via a new `hierarchyImplementorsOf` query that reuses the existing results UI. ([#120](https://github.com/GemTalk/Jasper/pull/120))

### Fixed

- **SUnit discovery no longer crashes when two TestCase subclasses share a name across dictionaries.** Previously, an image with (say) an app's own `AnnouncerTest` in `UserGlobals` plus the base image's in `Globals` crashed discovery with "Attempted to insert a duplicate test item ID …", blanking the entire GemStone test list; and even without the crash, running a test by bare name silently ran only the symbol-list winner and hid the other suite. The dictionary is now part of every test's identity end to end — dictionary-qualified item ids (`sunit/<sid>/<dict>/<class>[/<selector>]`), dictionary-scoped class resolution so each copy runs its own suite, the System Browser threading its tracked dictionary through the run commands, and the MCP `run_test_class` / `run_test_method` tools taking an optional `dictionary` arg (running the unique match when omitted, refusing-with-candidates when ambiguous). The class label shows the dictionary in braces only when the name is ambiguous (e.g. `AnnouncerTest {UserGlobals}`). ([#119](https://github.com/GemTalk/Jasper/pull/119), fixes [#117](https://github.com/GemTalk/Jasper/issues/117))
- **Class navigation and Find Implementors / Senders / References no longer mis-resolve aliased classes.** A class's home dictionary in the shared method-search serialization is now resolved by its own name key (`k = v name asSymbol`), so an alias entry that sorts ahead of the real home (e.g. Python's `#object -> Object` ahead of `Globals`) no longer masks it and breaks navigation. ([#120](https://github.com/GemTalk/Jasper/pull/120))

## [1.6.5] - 2026-06-16

### Added

- **Non-destructive (overlay) Display It** (`gemstone.displayItMode`, default `overlay`). Display It (`Cmd+K D` / `Ctrl+K D`) now shows its result as an inline overlay decoration instead of inserting text into the document, so the file is never modified, dirtied, or saved. While the result is shown, hover it for **Copy** / **Output** actions; **Backspace**, **Ctrl+Z**, or **Escape** dismiss it; **Enter** materializes the full value into the document. Set `gemstone.displayItMode` to `insert` for the classic insert-and-select behavior, which is preserved verbatim. ([#115](https://github.com/GemTalk/Jasper/pull/115))
- **GT Perf Tracker for round-trip tuning** (`gemstone.gtPerfTracking`, default off). A status-bar counter of GCI round trips per action, with a per-method Quick Pick breakdown, clipboard copy, and output-channel logging on reset — for diagnosing GT Inspector performance. A companion Pharo-side file-in script (`docs/gtSupport/gtPerfTracker.st`) counts GemStone RSR round trips from the GT image side. ([#108](https://github.com/GemTalk/Jasper/pull/108))

### Changed

- Updated the GT support installation script under `docs/gtSupport/`.
- Dependency updates: js-yaml, markdown-it, hono, vite, form-data, tmp.

### Fixed

- **Renaming a selector and saving now opens a tab for the new method.** Previously the old tab kept its original title but displayed the new source, and the new method had no tab at all. Jasper now detects when the compiled selector differs from the one being saved, opens the new method's tab, and reverts the old tab (the original method is left unchanged in GemStone). ([#109](https://github.com/GemTalk/Jasper/pull/109))

## [1.6.4] - 2026-06-13

### Added

- **GT Perf Tracker — a GCI round-trip counter for tuning GT Inspector performance.** A Proxy-based counter tallies GCI round trips per action; toggle it from the Command Palette or the `gemstone.gtPerfTracking` setting (default off). It shows a live count in the status bar, with a per-method Quick Pick breakdown, clipboard copy, and output-channel logging on reset. ([#106](https://github.com/GemTalk/Jasper/pull/106))
- **IMCSystem GT inspector views file-in.** A self-contained topaz installer under `docs/gtSupport/` adds four `<gtView>` tabs (Summary, Customer Invoices, Contracts, Overview) to `IMCSystem`, committing and running a smoke test on file-in. ([#106](https://github.com/GemTalk/Jasper/pull/106))

### Changed

- **Newly compiled methods now open automatically.** After compiling a method from the new-method editor, Jasper opens the resulting method in a permanent tab and closes the new-method placeholder; the success message names the actual selector (e.g. "Compiled method Array>>#foo"). ([#104](https://github.com/GemTalk/Jasper/pull/104))

### Fixed

- **The Versions sidebar now loads on Intel Macs instead of failing with a repeating "unable to download versions … 404" dialog.** GemStone's Darwin x86_64 server is published under the historic platform name `i386.Darwin`, but `getPlatformKey()` computed `x86_64.Darwin` — a path that does not exist on `downloads.gemtalksystems.com` and returns HTTP 404. Intel Macs now map to `i386.Darwin` (Apple silicon remains `arm64.Darwin`), so the version catalog, downloads, and product paths all resolve.
- **A failed version fetch no longer triggers an endless reload/error-dialog loop.** `VersionTreeProvider.getChildren()` re-triggered `loadVersions()` whenever the list was empty; a failed load left it empty and fired `refresh()`, which re-rendered and reloaded again, flickering error dialogs indefinitely. The initial load is now attempted once; explicit user actions (the refresh command, post-download, etc.) still re-fetch.
- **Switching environments in the System Browser keeps the method list populated.** Previously, switching environments cleared the selected method category and left the method list empty until the user clicked a category again. The browser now auto-selects the previously chosen category if it exists in the new environment (otherwise "** ALL METHODS **") and populates the method list immediately. ([#100](https://github.com/GemTalk/Jasper/pull/100))
- **GT Inspector styled-text tabs no longer stack one run per line after a table view.** `renderStyledText` now clears inline styles left on the shared content pane by a prior table/tree render, so styled-text tabs (Overview, Customer Invoices, …) lay out inline. ([#106](https://github.com/GemTalk/Jasper/pull/106))

## [1.6.3] - 2026-06-11

### Added

- **GT support docs, scripts, and files.** `docs/gtSupport/` now carries the `.gs` file-ins (gt4gemstone, gtoolkit-remote, STON, RemoteServiceReplication, …) and load/update shell scripts to install minimal support for Jasper's GT inspectors into a plain vanilla GemStone server, with a README. ([#101](https://github.com/GemTalk/Jasper/pull/101))
- **GemStone Smalltalk appears as a kernel in Microsoft's Jupyter Notebook extension.** A "GemStone Smalltalk" notebook controller runs each cell as an independent guarded doit (the same `wrapExecuteCode` contract as the MCP `execute_code` tool) in the active session, printing the last statement's value and rendering inline `Error: <class> — <messageText>` results as notebook error outputs. The Grail and Smalltalk kernels share a common `GemStoneNotebookKernel` base; unlike Grail there is no synthetic cross-cell scope — Smalltalk state persists through the session itself (`UserGlobals`, class definitions, commits).
- **Grail appears as a Python kernel in Microsoft's Jupyter Notebook extension.** Jasper now registers a "Grail (GemStone Python)" notebook controller for the `jupyter-notebook` notebook type, so opening a `.ipynb` and picking Grail from the kernel picker runs Python cells in the active GemStone session via Grail (GemStone-Python). Cells get Jupyter-style REPL semantics — globals persist across cells through `ModuleAst evaluateSource:usingModuleScope:`, with each notebook's module scope keyed by its URI in `SessionTemps` — and Grail compile/runtime errors (plus the "Grail not detected" hint) render as notebook error outputs. A new **GemStone: Reset Grail Notebook Scope** command drops the active notebook's globals, the "restart kernel" equivalent.

## [1.6.2] - 2026-06-10

### Fixed

- **New methods are now created in the environment selected in the System Browser, not always environment 0.** The `gemstone://` URI for a new method was built inline in `handleNewMethod` with a raw template string that duplicated `parseUri`'s encoding logic and omitted the `?env=N` query parameter, so a new method was always compiled into environment 0 regardless of the browser's selected environment. URI construction is now centralized in `buildNewMethodUri`, which threads the environment through. ([#99](https://github.com/GemTalk/Jasper/pull/99))
- **GT Inspector "Browse →" no longer destroys the panel layout or leaves the browser columns unselected.** Two regressions introduced when the live-search filter merged into main: (1) `getBrowserViewColumn()` called `setEditorLayout` when no `gemstone://` editor was open, clobbering the panel layout and removing the GT Inspector tab — the method source now opens in a new group below the browser (`workbench.action.newGroupBelow`) without disturbing other panels; (2) `populateColumn()` unconditionally called `refreshFilter()`, which is only attached after the user first types in a filter box, so before any typing it threw a `TypeError` that silently aborted column selection — category, class, method category, and method went unhighlighted after a Browse navigation. Fixed with optional chaining and by eagerly attaching `refreshFilter` once the filter element's DOM is constructed. ([#98](https://github.com/GemTalk/Jasper/pull/98))

## [1.6.1] - 2026-06-09

### Added

- **`gemstone.classSync.readOnlyMirror` setting (default on).** The local class-mirror `.gs` files are written read-only so they aren't edited by hand (edit via the System Browser instead). Turning it off writes them writable, roughly halving the filesystem operations per class — a useful speed-up when the workspace lives on a slow or network filesystem.
- **Disk-write time is now reported in the "GemStone Class Sync" output**, separately from server and network time, so a slow sync can be attributed to the local filesystem (e.g. a network drive, or antivirus scanning each write) rather than the GemStone connection.

### Changed

- **Class-mirror files are written to disk in parallel** (bounded concurrency) instead of one at a time, and a redundant `existsSync` probe per file was removed. On a slow or network filesystem — where thousands of tiny serial writes can dominate the sync far more than the network does — this overlaps the per-file latency and keeps the UI responsive during a large sync.

### Fixed

- **Search filter is re-applied after column repopulation even if never previously used.** When the server reloads a column's items (e.g. selecting a dictionary loads its class list), any active search query is now correctly re-applied to the new entries. Previously this failed silently if the user had not yet typed anything in the filter box before the first reload.

## [1.6.0] - 2026-06-08

### Added

- **GT Phlow inspector (`Cmd+K O` / `Ctrl+K O`).** Replaces the raw GCI-based Super Inspector with a full GT Phlow-driven inspector that calls `GtRemotePhlowViewedObject` server-side and renders declarative view specs as tab-based panels in a VS Code webview. Key capabilities: tab-per-view driven by server-side `<gtView>` pragma methods; text views with attribute-run styling (bold, color, italic, decorations) and JSON syntax highlighting; columned list/tree with cell-level background colors, icon column rendering, and resizable/sticky column headers; tree expand/collapse via `retrieveChildrenForNodeAtPath:`; load-more paging and a Ranges mode for large collections; double-click or right-click a row to inspect the item; a Meta tab with class name, superclass, package, instance/class method source, class definition, and comment sub-tabs; Browse → in the Meta tab opens the System Browser beside the inspector and navigates to the selected method; forward view support (`GtPhlowForwardViewSpecification`); Print tab with truncation detection and a **Show all…** link for large `printOn:` output. The command is gated on GT availability in the connected image — it is hidden on non-GT stones. ([#89](https://github.com/GemTalk/Jasper/pull/89), closes [#83](https://github.com/GemTalk/Jasper/issues/83))
- **The class-sync engine now audits itself and reports failures prominently.** The server states how many classes/methods each payload contains; the client checks that every requested class came back and that batch framing parsed cleanly, and surfaces any shortfall as a warning (with the missing class names in the "GemStone Class Sync" output) instead of failing silently. A missing class is not recorded in the persisted state, so the next sync re-fetches it.
- **Per-request sync timing in the "GemStone Class Sync" output.** Every log line is timestamped, each request logs its client wall-clock time, and the server returns its own build time (`Time millisecondsElapsedTime:`) in-band, so a slow sync can be attributed to the server (build) vs the network (net ≈ wall − server).

### Fixed

- **Classes whose source contains a non-ASCII character (e.g. an em dash) are no longer silently dropped from the `.gemstone` mirror.** Such a file-out is a wide (`Unicode16`) GemStone string, and the sync transport returned it via `GciTsExecuteFetchBytes` — whose bytes are not UTF-8 for a wide string — so the client's UTF-8 decode corrupted the payload and desynced the length-framed parser, dropping the rest of that batch (a large, stable fraction of classes on images with any Unicode in their source). Each transport chunk is now encoded to UTF-8 server-side (`encodeAsUTF8`) after slicing on code-point boundaries, so the decode is always correct. A GCI integration test round-trips a class containing an em dash.

## [1.5.8] - 2026-06-05

### Added

- **Live search filter in the System Browser.** A filter box now sits above every column in the System Browser. As you type, matching entries are highlighted in bold at the matching portion — non-matching items remain visible. The first match is automatically focused so you can press **Enter** to select it without touching the mouse. Use **↑ / ↓** to move through matches (wrapping at both ends), and **Escape** to clear the filter and restore the full list. A **✕** button in the filter box and a **Clear all filters** button in the toolbar let you reset filters with the mouse. Filters survive column selections and automatically re-focus the first matching entry whenever a list is refreshed from the server.

### Fixed

- **Session no longer gets stuck in executing state when execution fails before it starts.** The "Executing…" indicator (dimmed selection, spinner, and command context) is now set immediately before the GCI call, so if an early validation fails (e.g. the String class cannot be resolved) the session state is never dirtied.

## [1.5.7] - 2026-06-04

### Added

- **Replace a database's extent from any file on disk, not just the bundled starter extents.** The Databases panel's **Replace Extent** action (on a stopped stone) now offers a **"Browse for extent file…"** option alongside the vendor-supplied initial extents, so you can seed a database from an `extent0.dbf` copied from another machine. The selected file replaces the current extent (the old extent and transaction logs are cleared first, after the new source is confirmed to exist), and on Windows the copy bridges the Windows and WSL filesystems so a file picked from `C:\…` lands correctly in the WSL-side database.

## [1.5.6] - 2026-06-03

### Changed

- **Workspaces are now ordinary editable files.** A GemStone workspace opens as a plain untitled `gemstone-smalltalk` document instead of a virtual `gemstone://` buffer, so you can save it to disk and track it in git — saving as `.gst` gives automatic language recognition when you reopen it. The editor commands (Display It, Execute It, Inspect It, Senders, Implementors) and language features (hover, go-to-definition, completion) now work in any `gemstone-smalltalk` file, including saved workspaces. ([#85](https://github.com/GemTalk/Jasper/pull/85))
- **Editor commands now follow the file's language, not session state.** Display It / Execute It / Inspect It and friends appear whenever the active document is `gemstone-smalltalk`, so they survive logout (workspace tabs stay open) and no longer clutter unrelated `.ts` / `.json` files. Running one without a live session prompts you to log in first. ([#79](https://github.com/GemTalk/Jasper/pull/79))
- **Open tabs are preserved across session actions.** Committing, aborting, or logging out no longer closes your open GemStone editor tabs, so your workspace and tab selection survive a session action. ([#79](https://github.com/GemTalk/Jasper/pull/79))
- **Removed the redundant Dismiss button from debuggable-error dialogs** (closing the dialog already dismisses it), and consolidated the duplicated debug-dialog logic behind a single `handleDebuggableError`. ([#86](https://github.com/GemTalk/Jasper/pull/86))

### Fixed

- **Class Hierarchy view no longer comes up empty on GemStone 3.6.8.** An em dash embedded in a Smalltalk source comment tripped a compiler cursor bug (error 1001) on 3.6.8, blanking the hierarchy view; the source no longer relies on it. Verified across 3.6.1–3.7.5. ([#84](https://github.com/GemTalk/Jasper/pull/84), fixes [#78](https://github.com/GemTalk/Jasper/issues/78))
- **Navigating between classes no longer shows the previous class's methods.** A stale method list was being pushed to the System Browser view when a new class was selected. ([#81](https://github.com/GemTalk/Jasper/pull/81))

## [1.5.5] - 2026-06-03

### Changed

- **Class export is now an incremental sync, so the local `.gemstone` mirror stays fast on large or remote images.** The old exporter filed out one class per GCI round-trip, so the first export — and the re-export after *every* login, commit, and abort — scaled with class-count × network latency: a customer with ~5500 classes on a slow link waited minutes where a local 1200-class image took under a second. Jasper now builds a single server-side manifest of per-class md5 hashes, diffs it against a persisted state (`.manifest.json`), and re-fetches only the classes that actually changed, streaming them in a handful of round-trips through a chunked transport (one server-built payload, sliced on code-point boundaries; the small case is a single round-trip). The mirror is keyed by connection target (`{workspaceRoot}/.gemstone/{host}/{stone}/{user}/…`), shared across that target's sessions, and **kept across logout** so reconnecting re-syncs the difference instead of rebuilding from scratch. A new per-login **"Sync classes"** toggle (on by default) turns the mirror off for slow/remote connections, where server-side search still works. Sync runs in a cancellable foreground progress (a cancelled run leaves a consistent partial mirror that the next sync completes) and logs size / round-trip / timing to a **"GemStone Class Sync"** output channel. This also fixes a latent truncation bug where a class whose file-out exceeded 256 KB was silently cut off.
- **Every code mutation now updates the mirror immediately**, so Find in Files and Go to Definition reflect the change before the next commit/abort: saving a method, deleting/recategorizing a method, renaming a category, deleting/moving a class, and adding/removing/reordering a dictionary. A single-class update re-files-out just that class (its hash matches the manifest, so the next sync skips it); structural changes trigger a debounced re-sync. Replaces the previous ad-hoc `mkdir`/`rmdir` pokes that bypassed the persisted state.

### Fixed

- **Editor-cursor → System Browser sync** now fires. The handler parsed the dictionary directory with the wrong separator (it looked for a `.` where the on-disk layout uses `{index}-{dictName}`), so moving the cursor within a `.gs` file never drove the browser's selection.

## [1.5.4] - 2026-06-01

### Added

- **"Logins & Sessions" tree with single-session mode by default.** The Logins and Sessions panels are now a single tree: each configured login is a row, and the sessions started from it appear as children — so a login with children is visibly connected, with no separate panel to reconcile. Session rows carry **Logout**, **Abort**, **Commit**, **Ping**, and **Open Browser** inline (plus **Export** and **Make Active Session** in the context menu), and a login can no longer be edited or deleted while it has a live session (log out first), which also guarantees every active session keeps a matching login row to nest under. A new `gemstone.sessionMode` setting governs how many sessions a login may have at once: `single` (the **default**) keeps one session at a time for a simpler mental model — the active session, the System Browser, and any open workspace can never point at different sessions — while `multiple` (beta) re-enables concurrent sessions. Existing users who relied on multiple concurrent sessions can restore that behavior with `"gemstone.sessionMode": "multiple"`.
- **Ping a session** to confirm it is still active and responsive. Ping issues a low-level GCI round-trip (fetching the size of `nil`) that needs no Smalltalk compilation or execution, so it reports liveness without disturbing the session.

### Changed

  - Use a modal dialog when asking whether to debug an error raised during Display It, Inspect It, or Execute It. This prevents workspaces from becoming stuck in the executing state if the prompt is not answered.

### Fixed

- **Databases panel running/stopped indicators are now tied to the correct version.** With two versions installed (e.g. 3.6.2 and 3.7.5) that share a stone/NetLDI name, starting one stone lit up the Stone/NetLDI nodes under *both* versions — and trying to stop the wrong one failed with an incompatible-version error. `ProcessManager.isStoneRunning` / `isNetldiRunning` now match the gslist process version against the database's configured version (`versionsMatch`, prefix-tolerant so a gslist `3.7.4` still matches a `3.7.4.3` install), so each database reflects only its own running processes. The same version guard is applied to the delete / replace-extent safety checks.

## [1.5.3] - 2026-05-31

### Added

- **Bundled GCI client libraries for secure / air-gapped installs.** Some customers run in environments where Jasper cannot download the GemStone client from `downloads.gemtalksystems.com`. Native GCI libraries placed under `resources/gci/GemStone64BitClient<version>-x86.Windows_NT/bin/` now ship inside the extension and are detected automatically (`client/src/bundledGci.ts`): the login flow, Quick Setup, the new-login version dropdown, and the Versions view all recognize a bundled version, skip the download/file-picker step, and use it directly. This release bundles the **GemStone 3.6.2** Windows x64 client (`libgcits` + `libssl` + the `msvcr100` VC++ 2010 runtime, the only non-OS dependency).
- **ARM64 guidance for the bundled (x64) libraries.** A 64-bit process can only load DLLs of its own architecture, so the bundled x64 client cannot load in an ARM64 VS Code (Windows on ARM). Jasper now hides the bundled version on ARM64 and, on login, shows a clear message directing the user to the x64 build of VS Code (which runs under emulation) — instead of a cryptic native loader error.

### Changed

- **GemStone 3.6.2 compatibility.** Jasper now connects to and works against 3.6.2 servers:
  - GCI functions added after 3.6.2 (16 in total, found via a `gcits.hf` diff) are now bound optionally, so loading an older client no longer crashes at construction over a symbol that is never called. A build-time test (`gciVersionGated.test.ts`) gates any *new* use of a post-3.6.2 function behind an explicit allowlist, so requiring 3.7+ for a code path is always a conscious, reviewed decision.
  - Login uses `GciTsLogin` (folding the NetLDI into the NRS string) rather than the post-3.6.2 `GciTsLogin_`.
  - Debugger / Inspector variable display fetches named and indexed instance variables via absolute `GciTsFetchOops` (present in 3.6.2) instead of the post-3.6.2 `GciTsFetchNamedOops` / `GciTsFetchVaryingOops`.
  - Code execution (Execute It / Display It / Inspect It) polls for completion via `GciTsSocket` + a native socket poll (`WSAPoll` on Windows, `poll(2)` on macOS/Linux) when the post-3.6.2 `GciTsNbPoll` is unavailable — keeping execution interruptible and cancellable on 3.6.2.

### Fixed

- **Inspector welcome text now matches the actual Inspect It chord.** After the 1.5.1 chord-prefix migration the empty-Inspector hint still read `Cmd+I` / `Ctrl+I`; it now reads `Cmd+K I` / `Ctrl+K I`, with a test that keeps the welcome text in sync with the keybinding.

## [1.5.2] - 2026-05-28

### Added

- **Visual feedback when the Inspector is updated.** Inspect It now raises the Inspector panel and returns focus to the active editor, and shows an amber status-bar item plus an activity-bar badge for five seconds on each inspect. Closes the silent-update gap when the Inspector is occluded by other panels — previously the only signal that an inspect-it landed was the contents quietly changing wherever the panel happened to be.
- **`AlmostOutOfStack` guard on `execute_code`, `eval_python`, and `compile_python`.** User code is now wrapped with an inner `on: AlmostOutOfStack do:` (minimal fixed-literal handler — must run with ~30 frames of headroom) and an outer `on: AbstractException do:` (rich error string for the usual DNU / ZeroDivide / SyntaxError path). A runaway recursion (e.g. dataclass self-reference) now returns a clean `Error: AlmostOutOfStack — user code exhausted the call stack` instead of taking the gem down. Lives in `client/src/queries/executeCode.ts` and applies to both MCP transport surfaces (proxy mode via Jasper's extension host, and the standalone stdio/SSE mode). ([#74](https://github.com/GemTalk/Jasper/pull/74))

## [1.5.1] - 2026-05-26

### Changed

- **Keybinding chord prefix moved from `Cmd+;` / `Ctrl+;` to `Cmd+K` / `Ctrl+K`** for Display It, Execute It, Inspect It, Open Browser, Find Class, and Find Method. The `;` prefix didn't fire reliably on non-US keyboard layouts (German QWERTZ, French AZERTY, Spanish, Nordic), where the semicolon lives on a shifted key and VS Code's matcher on Linux/X11 couldn't agree with the OS about what the user actually pressed. Letter-key chord prefixes are layout-stable on every Latin keyboard. The one collision — `Ctrl+K M` ("change language mode") — is scoped to GemStone editors only via `when: "gemstone.hasActiveSession"`, and a GemStone editor's language is fixed anyway. ([#66](https://github.com/GemTalk/Jasper/issues/66), [#70](https://github.com/GemTalk/Jasper/pull/70))
- **Display It now auto-selects the inserted result** so a single Backspace removes it — the Smalltalk workspace convention from Pharo / Squeak / VAST / VisualWorks. Previously the result stayed unselected and required either Cmd+Z or manually selecting the text before deleting; users new to Smalltalk who had typed past the result lost their cursor position when backspacing through it. The selection covers the leading space + `printString`, so one keystroke restores the editor to its pre-execution state. Execute It is unchanged (no result is inserted).
- **CI migrated from GitHub Actions to GitLab.** `.github/workflows/health-check.yml` is replaced by `.gitlab-ci.yml`; the upstream repo now lives on GitLab and the pipeline runs there.

### Fixed

- **Extension folder (`~/.jasper`) is now created on activation** if it doesn't already exist. Previously, on a fresh install the folder was assumed to exist, so the first subsystem to write into it — the MCP Unix socket at `~/.jasper/mcp.sock`, the owner sidecar at `~/.jasper/mcp.owner.json`, or any other artifact resolved via `extensionPathFrom(...)` — would fail with `ENOENT`. Activation now calls `initializeExtensionFolder()` first, and a failure (e.g. permission denied) is surfaced as a VS Code error notification with a **Show Details** action that opens a dedicated "Jasper" output channel. Folder-path construction is also encapsulated behind `extensionPathFrom(...)` instead of being open-coded as `path.join(os.homedir(), '.jasper', ...)` in three places. ([#69](https://github.com/GemTalk/Jasper/pull/69))
- **VSIX packaging:** restored `vsce package` after 1.5.0's `.vscodeignore` rewrite excluded `docs/**` wholesale. That broke packaging because `docs/MCP_Server_Feedback.md` is a symlink into an external (Grail) repo. Switched to an allow-list — `docs/**` is ignored, then `docs/mcp-server.md`, `docs/windows-wsl.md`, and `docs/formatter.md` are unignored — so only the three user-facing docs the README links to ship in the VSIX.

### Documentation

- **README now advertises both marketplaces** (VS Code Marketplace and Open VSX) with direct links, matching the 1.4.5 dual-publish change.

## [1.5.0] - 2026-05-24

### Added

- **"MCP Server" view in the GemStone sidebar.** Tells you at a glance whether *this* Jasper window is the MCP owner, points at the owning workspace if a different window has the role, or marks the state as "no owner yet" when no window has logged in. When this window owns it, the view also surfaces the active GemStone session label (which can change as you switch sessions — that's the session MCP tools will act on), the socket path, and the HTTPS/SSE URL (click to copy). Backed by a `~/.jasper/mcp.owner.json` sidecar so other windows can answer "if not me, who?" without IPC.
- **Stale-process detection in the Processes view.** `gslist` rows with a non-OK status (`frozen`, `killed`, `exe deleted`, …) now render with a red icon and the status prefixed onto the description. A **Delete Stale Lock File** inline action is offered on stale rows; Jasper checks that the recorded PID is either gone or has been reused by some non-`stoned`/`netldid` process before removing the `*.LCK`. Required because on macOS GemStone's own `gslist -c` can't distinguish a recycled PID from a hung server.

### Changed

- **MCP ownership is now claimed on first GemStone login, not on extension activation.** Previously the first Jasper window to activate captured the socket regardless of whether it ever logged in — leaving Claude Code talking to a window with no GemStone session. Now the window the user actually works in is the one MCP talks to. Once a window owns the socket it keeps it bound for the lifetime of the VS Code run, including across logout/login cycles: tool calls during a logged-out gap return "no session selected" and resume working the moment the user logs back in. Claude Code's MCP connection stays alive throughout.
- **Configs (Claude Code + Desktop) are written on every activation regardless of ownership.** The entries point at the fixed well-known socket path, so they're correct no matter which Jasper window ends up owning the live socket. This decouples "is the gemstone server registered with Claude Code?" from "which window happens to be serving it?"

### Removed

- **`gemstone.userManagedDictionaries` setting.** It told the exporter to skip specific dictionary names (no write, no chmod, no stale-file cleanup) and dated from an earlier layout where exports lived alongside user code. Since exports now go to a hidden `.gemstone/` directory and exported `.gs` files are marked read-only on disk (editing is via the System Browser / `gemstone://` filesystem), there's no longer a reason to mix user-managed code into the export tree. **Breaking change for users with non-empty `gemstone.userManagedDictionaries`**: those dictionaries will be exported on the next run; if you have writable code in matching paths under a custom `gemstone.exportPath`, move it elsewhere first.

### Documentation

- **New `docs/mcp-server.md`** with the MCP architecture, ownership model, per-client registration paths (Claude Code, Claude Desktop on macOS/Linux/Windows, MCP Inspector, generic stdio clients), TLS, multi-window behavior, tool catalog, and limitations. The README MCP section now points at this doc instead of carrying the deep dive.
- **README split:** Windows/WSL detail moved to `docs/windows-wsl.md`, formatter reference to `docs/formatter.md`, contributor/release instructions to `CONTRIBUTING.md`. The README becomes a tighter pitch + sidebar tour + Documentation index. Out-of-date claims fixed along the way (exported `.gs` files are read-only, not edit-to-compile; CI runs on GitLab, not GitHub Actions).

## [1.4.5] - 2026-05-23

### Changed

- **Claude Code MCP registration switched from CLI shell-out to direct user-scope file write.** Earlier versions invoked `claude mcp add` in each workspace, which wrote a *per-project* `gemstone-<hash>` entry into `~/.claude.json`'s `projects.<cwd>.mcpServers` section and required the `claude` CLI on PATH. Jasper now writes a single user-scope `mcpServers.gemstone` entry at the top level of `~/.claude.json`, so the tools are visible in every Claude Code session regardless of working directory — same model as Anthropic's hosted Gmail / Drive / Calendar connectors. Any stale per-project `gemstone` entries from earlier versions are stripped on activation. The removed `claudeCodeMcpLifecycle.ts` / `claudeCodeMcpRegistration.ts` modules (and their tests) go away with the CLI dependency.

### Added

- **One-time "Reload Window" prompt when Jasper first registers with Claude Code in a window.** Claude Code snapshots its MCP server list at session start, so the session already running in the VS Code window where Jasper just wrote the entry won't see it via `/mcp` until it re-activates. Jasper now offers a one-click reload in that exact case. Subsequent VS Code launches are silent because the entry is already in place when Claude Code starts. Suppressible via "Don't show again"; re-fires only when the entry's contents actually change (e.g. extension upgrade changing the proxy script path).
- **Regression guards for the two thinnest spots in the MCP shared-query test suite**, prompted by external feedback from a downstream Grail (GemStone-Python) project that uses Jasper's MCP server as its primary edit-test surface:
  - Multi-line `eval_python` input now has a round-trip test in `structuredQueries.test.ts` that confirms a `def`/multi-line Python source embeds verbatim into the Smalltalk `src := '...'.` literal with its real LFs preserved, and asserts no `\n`-escape mutation appears. Guards against a future "improvement" to `escapeString` that would convert newlines into `\` + `n` and SyntaxError every multi-line eval.
  - `runFailingTests`'s `MAX_MSG = 1024` per-message cap now has a *mechanism* test in addition to the existing magic-number assertion: the full `s copyFrom: 1 to: (s size min: 1024)` slice form is pinned (a bare `min:` returns the integer size — no trim would happen), and the clip is positioned before the outer `ws contents encodeAsUTF8` so 1024 remains a character-count budget rather than a byte-count budget.
- **System Browser: Run SUnit Tests context menus.** Right-clicking in any of the following columns now offers a "Run SUnit Tests" action that scopes the test run to exactly what you clicked:
  - **Dictionary column** — runs every test class belonging to the selected dictionary.
  - **Class category column** — runs every test class belonging to the selected category.
  - **Method category column** — runs only the test methods grouped under the selected category within the currently selected class.
  - **Method column** — runs the single selected test method.

### Documentation

- **README "How the MCP server starts" section** documents the activation flow end-to-end: which window claims the socket, what gets written where, and why the first-launch reload exists.

## [1.4.4] - 2026-05-11

### Changed

- **Login passwords now use VS Code's `SecretStorage` API** instead of `keytar`. SecretStorage delegates to the same OS keychains keytar did (macOS Keychain, Windows Credential Manager, Linux libsecret) but ships with VS Code itself, so there is no native binary to bundle and no per-platform prebuild matrix to maintain. Side benefits: cross-platform credential storage that actually works in published builds (the keytar binding wasn't shipping at all in 1.4.x VSIXs — saved login passwords would have failed silently with `Cannot find module 'keytar'`), VSIX size dropped, and the `node_modules/keytar/**` re-include is gone from `.vscodeignore`. Storage key changed from keytar's `(service, account)` pair to a single namespaced key `jasper-gemstone-login:${user}@${host}/${stone}`; users with keychain-backed logins from prior installs will be re-prompted for their password once and the new entry will be written into SecretStorage.
- **Tightened `.vscodeignore`** so the published VSIX only contains the three esbuild bundles plus runtime assets (48 files, down from 904). Per-file `tsc` outputs in `*/out/`, `mcp-server/node_modules/**`, `.claude/`, `*.tsbuildinfo`, `TODO.md`, and koffi's vendor/source/doc trees are no longer shipped.
- **Multi-marketplace publishing.** `npm run publish` now publishes to both the Visual Studio Marketplace (`vsce publish`) and Open VSX (`ovsx publish`), so the extension is available to users of VSCodium, Gitpod, code-server, and other non-Microsoft VS Code distributions. Individual targets are also exposed as `npm run publish:vsce` and `npm run publish:ovsx`.

## [1.4.3] - 2026-04-29

### Added

- **Hidden-prefix class export directory** — exports default to `{workspaceRoot}/.gemstone/{session}/{index}-{dictName}` (was `{workspaceRoot}/gemstone/...`). The dot-prefix keeps it out of the way in file listings while remaining browseable in VS Code's Explorer, Quick Open, and Find in Files. Users with an existing `gemstone/` directory can either delete it or pin the prior layout via the `gemstone.exportPath` setting (e.g. `{workspaceRoot}/gemstone/{session}/{index}-{dictName}`).
- **GCI smoke-test harness** under `client/src/__tests__/gci/` (run via `npm run test:gci`, gated by `GCI_LIBRARY_PATH`). Runs each shared MCP query against a live stone, plus a curated selector probe that fails fast if any GemStone selector our queries hardcode goes missing. Skipped from the default `npm test` run; on the round it landed it caught the `sunitMatch:` / `match:` confusion the unit suite missed.

### Changed

- **`run_test_method` / `run_test_class` message column now carries the actual exception** (`MessageNotUnderstood: nil does not understand #foo`) instead of the SUnit debug recipe (`ClassTestCase debug: #testFoo`). Bypasses `TestCase>>run` and replicates `setUp` / `perform` / `tearDown` with our own `AbstractException` handler — same pattern `describe_test_failure` uses, now applied to the iterating runners.
- **`list_failing_tests` `classNamePattern` glob primitive** is now `CharacterCollection >> matchPattern:` (the public, base-class glob — works in any session) with a JS-side glob → Array parser. Agent-supplied globs like `Bytes*TestCase` are translated to the literal Array form `#('Bytes' $* 'TestCase')` server-side. Replaces an earlier `sunitMatch:` attempt that only existed when SUnit was loaded.
- **System Browser senders/implementors CodeLens split into two independent links.** The `N senders | M implementors` header row was a single `CodeLens` whose entire title was clickable but dispatched only to the senders view — half the displayed information was unreachable. Now emits a senders+implementors pair per method, matching the VS Code convention (TypeScript ships `X references | Y implementations` the same way). Each lens computes only its own count and dispatches to its own command (`gemstone.sendersOfSelector` / `gemstone.implementorsOfSelector`).
- **Single class-selection code path in the System Browser.** A hierarchy-view click and an external Implementors-of / Senders-of jump previously updated the column-list state inline without refreshing the Class Definition panel, leaving the right-hand definition stale relative to the column-list selection. Both paths now route through a shared `applyClassSelection` helper alongside the regular column click and the find-class quick-pick.

### Fixed

- **System Browser hierarchy view rendered superclasses in reverse.** `ClassOrganizer >> allSuperclassesOf:` returns root-first (`[Object, Collection, ...]`), but the query then sent `reverseDo:` to that collection — Object ended up at the deepest indent and the immediate parent appeared at indent 0. Replaced with `do:` so the order is root-first.
- **`list_failing_tests` no-args produced duplicate rows.** An SUnit abstract `TestCase`'s `suite` cascades into its concrete subclasses' suites, so when the discover-all walk also enumerated those leaves directly, every test under an abstract parent ran twice (45 duplicate `(className, selector)` pairs out of 99 unique on the probe stone). The discover-all walk now filters with `v isAbstract not`; explicit `classNames` / `classNamePattern` paths still let an agent target an abstract parent on purpose for the cascaded run.
- **`Utf8` was misidentified as an internal-storage class** in the 1.4.2 fix for the `eval_python` UTF-16 leak. `Utf8` is the *transfer protocol* — variable-byte, no character indexing, `at:put:` and `copyFrom:to:` undefined. `WriteStream on: Utf8 new` raised `rtErrShouldNotImplement` on buffer growth, breaking every error path on `eval_python` / `compile_python` and the entire output of `list_failing_tests`. The right model is to build internally in `Unicode7` (which transparently widens to `Unicode16` / `Unicode32` for non-ASCII codepoints), then call `encodeAsUTF8` once at the boundary to produce the transfer bytes — lossless, and consistent with GemStone's storage/transfer split.

## [1.4.2] - 2026-04-28

### Added

- **`list_failing_tests` `classNamePattern` parameter** — glob-filter discovered TestCase subclasses (`*` = any chars, `#` = one char) before running. E.g. `classNamePattern: "Bytes*TestCase"` runs every `Bytes*TestCase` in one round-trip. Composes with the existing `classNames` array (explicit names still win).
- **`list_failing_tests` message column now carries actual exception details** — `MessageNotUnderstood: nil does not understand #foo` instead of the SUnit debug recipe `ClassTestCase debug: #testFoo`. Each failing/erroring test is re-run with its own `AbstractException` handler to capture the live exception's `messageText`. Iteration stays in Smalltalk so it's still one GCI round-trip.

### Changed

- **`find_implementors` / `find_senders` / `find_references_to` auto-fall-back to env 1** when no `environmentId` is given and env 0 returns empty. Projects whose user code lives in env 1 (notably GemStone-Python) no longer get a misleading "no implementors found" when the method exists. Pass `environmentId` explicitly to limit to one environment.

### Fixed

- **UTF-16LE leak in `eval_python` / `compile_python` error returns.** Grail-side compile/runtime errors came back as `"E r r o r :   M e s s a g e N o t U n d e r s t o o d ..."` — `messageText` returns `Unicode16` for system errors, `, ` concatenation widened the result to Unicode16, and GCI's `Utf8`-class fetch forwarded the UTF-16LE bytes raw. The error string is now built through a `WriteStream on: Utf8 new`, which forces transcoding on write.
- **`list_failing_tests` with no arguments raised `CompileError 1001`.** The `DISCOVER_ALL_TEST_CLASSES` Smalltalk fragment had its own `| sl seen list |` temps, which can't appear inside `classes := <expr>`. The fragment is now wrapped as `[| sl seen list | ...] value` so it's a valid expression in any position.

## [1.4.1] - 2026-04-27

### Added

- **MCP `refresh` tool** — explicitly refresh the session's view of committed state (aborts only when no uncommitted changes are pending). Closes the silent-stale gap where the GCI pinned a session's read view to its transaction snapshot, so commits landed by another process (e.g. `install.sh`) were invisible until the session aborted or committed.
- **MCP `list_failing_tests` tool** — runs SUnit tests and returns only the failed/errored entries. Optional `classNames` filter for targeted subsets (otherwise discovers every TestCase subclass in the symbolList). Iteration runs in Smalltalk so an N-class invocation is one GCI round-trip.
- **MCP `list_test_classes` tool** — discovery primitive for filtering before `list_failing_tests`.
- **MCP `describe_test_failure` tool** — re-runs a single test with its own `AbstractException` handler (bypasses `TestCase>>run`, which would swallow the exception) and returns structured details: `exceptionClass`, GemStone `errorNumber`, clean `messageText`, `description`, plus `mnuReceiver` / `mnuSelector` for `MessageNotUnderstood`. Includes a multi-line `stackReport` when stack capture is supported (gem-level `GemExceptionSignalCapturesStack` is toggled around the run and restored via `ensure:`).
- **MCP `eval_python` and `compile_python` tools** — compile/transpile/execute Python source via Grail (GemStone-Python). Register unconditionally; gracefully report "Grail not detected" via runtime `objectNamed:` lookup when Grail isn't loaded. Grail-side compile and runtime errors are reported inline as `Error: <class> — <messageText>`.

### Changed

- **`status`, `run_test_class`, `run_test_method`, `list_failing_tests`, `describe_test_failure` auto-refresh-if-clean** before reading. Discards the stale-pinned view when (and only when) no uncommitted work is pending. `status` reports the new view state on a `View:` line.
- **`execute_code` accepts multi-statement bodies** — wrapped as `[<code>] value printString` so `| x | x := 42. x + 1` parses. Previously errored with "expected start of a statement" because the wrapper only accepted a single expression.
- **`find_implementors` / `find_senders` / `find_references_to` empty-result message hints at env 1** — projects whose user code lives in `environmentId: 1` (notably GemStone-Python) were getting a bare "No implementors found" that was easy to misread as "doesn't exist."
- **MCP tool validator errors name the offending parameter** — replaces zod's bare `"Invalid input: expected boolean, received undefined"` with `"Missing required parameter 'isMeta' (expected boolean)."` and `"Parameter 'isMeta' must be boolean, but received string."`. Implemented as a per-schema error map (a global one breaks the SDK's discriminated-union JSON-RPC parsing).

### Fixed

- **`runTestClass` / `runFailingTests` were sending `each testCase class name` to objects that don't respond to `#testCase`** — the items in `result failures` and `result errors` are TestCase instances themselves with only a `testSelector` ivar, not wrapper objects. On a real failure the queries would silently DNU; tests mocked the output so it wasn't caught. Now uses `each class name` / `each selector`, matching the `passed` branch.

## [1.4.0] - 2026-04-26

### Added

- **MCP HTTPS/SSE surface for URL-based connectors** — Jasper now serves the gemstone MCP server at `https://127.0.0.1:27101/sse` (port configurable via `gemstone.mcp.httpPort`) for clients whose connector UI takes a URL rather than a command to spawn (e.g. Claude Desktop's "Add custom connector" dialog). Uses the same `getSelectedSession()` routing as the stdio surface, so all 27 tools run against the user's currently active session. Binds 127.0.0.1 only — never exposed off-host.
- **Self-signed TLS certificate** — Generated on first activation and stored in the extension's global storage directory (shared across workspaces). Valid for `127.0.0.1` and `localhost`, 10-year validity, written with `0600` permissions. Required because Claude Desktop rejects plain-http URLs.
- **`GemStone: Install MCP TLS Certificate`** command — Palette action that surfaces the platform-specific trust-store install command (`security add-trusted-cert` on macOS, `certutil -user -addstore Root` on Windows, NSS db `certutil -A` on Linux) and offers to run it in a terminal, copy it to the clipboard, or copy the cert path.
- **`GemStone: Copy MCP Server URL`** command — One-click copy of the HTTPS URL for pasting into a connector dialog.
- **Claude Desktop auto-registration** — On activation, Jasper writes a per-workspace `gemstone-<hash>` entry into Claude Desktop's global `claude_desktop_config.json` and removes it on deactivation. Gated by `gemstone.mcp.registerWithClaudeDesktop` (default `true`).
- **Claude Code registration via `claude mcp add`** — Replaces the previous `.claude/settings.local.json` write with a `claude mcp add` invocation that targets `~/.claude.json`'s per-project scope (the location Claude Code actually reads). No-op when the `claude` CLI isn't on PATH.

### Changed

- **`Open MCP Inspector` is now a command-palette action** that points at the live HTTPS/SSE surface, replacing the per-database "MCP Server" tree row that previously spawned an isolated subprocess per stone with its own credentials. The Inspector terminal receives `NODE_EXTRA_CA_CERTS` so Node's TLS stack trusts Jasper's self-signed cert (the OS keychain trust does not extend to Node).

### Removed

- **Per-database "MCP Server" tree row** and the `gemstone.startMcpServer` / `gemstone.stopMcpServer` commands and their menu contributions. Superseded by the always-on HTTPS/SSE surface (net –846 lines).

### Fixed

- **Tonel method signature semantic tokens landing on the wrong column** — the selector column offset was not being threaded through `collectSemanticTokens`, causing semantic highlighting to land on the wrong column for the first line of Tonel method signatures. Thanks to @ericwinger (#52).

## [1.3.4] - 2026-04-22

### Added

- **WSL networking detection and configuration (Windows only)** — OS Configuration now surfaces a **WSL networking** row showing whether WSL is running in `networkingMode=mirrored` (where `localhost` on Windows reaches services inside WSL) or NAT mode. Detection reads `%USERPROFILE%\.wslconfig`, and `wsl --version` determines whether the installed WSL core is ≥ 2.0 (the minimum that supports mirrored mode).
- **Enable mirrored networking action** — when WSL core is ≥ 2.0 but NAT is active, a one-click action writes `networkingMode=mirrored` into `%USERPROFILE%\.wslconfig` (preserving existing sections, keys, comments, and line endings) and prompts to run `wsl --shutdown` so the change takes effect.
- **Update WSL core action** — when WSL core is < 2.0, a one-click action opens a terminal and runs `wsl --update`, then refreshes the OS Configuration state on terminal close.
- **Hosts-file fallback for Windows 10 / NAT** — under NAT networking, Jasper can write `<wsl-ip> wsl-linux` to `C:\Windows\System32\drivers\etc\hosts` so logins can use `wsl-linux` instead of a raw IP. The PowerShell script self-elevates via UAC and is idempotent — re-run it after each `wsl --shutdown` or Windows restart.
- **Services-file configuration** — detects whether `gs64ldi 50377/tcp` is present in `/etc/services` on Windows and inside WSL, and offers separate write actions for each side (PowerShell + UAC for Windows, `sudo` for WSL). With the entry in place, `startnetldi` binds to the conventional port 50377 and logins can name the port as `gs64ldi`.
- **NetLDI host tooltip and Copy Host action** — running NetLDI items on Windows+WSL now show a `Host:` line in their tooltip (`localhost` under mirrored networking, the current WSL IP otherwise) and expose a **Copy Host** inline/context action that writes the host to the clipboard for pasting into a login's Host field.

## [1.3.3] - 2026-04-19

### Fixed

- **WSL Support** — WSL support (Linux in Windows) now mostly works.
- **MCP Inspector launch on Windows** — the "Open MCP Inspector" button now invokes `npx.cmd` instead of `npx` on Windows, bypassing the `npx.ps1` PowerShell ExecutionPolicy block that prevented the inspector from starting.
- **`status` MCP tool on GemStone 3.7.x** — the Smalltalk query no longer calls `System stoneVersionReport` (which could return a SmallInteger, causing `does not understand #'do:'`) or `System modifiedObjects` (absent in some versions); it now reports user, stone, session, transaction state, and uncommitted-changes flag via reliable methods, with every streamed value coerced to a string.
- **Tree-view commands crashing from the Command Palette** — handlers for `gemstone.stopStone` and 8 other commands read `node.kind` without a guard, crashing with `Cannot read properties of undefined (reading 'kind')` when invoked from the palette (where `node` is `undefined`). All handlers now use optional chaining, and a source-scan regression test keeps them guarded.

## [1.3.2] - 2026-04-17

### Added

- **Windows client distribution support** — Jasper can now automatically download and extract the native Windows GCI client library (`libgcits-{version}-64.dll`) for connecting to remote GemStone servers from Windows without WSL. Available as a standalone **Download Windows Client** button in the Versions view and as an automatic prompt during login when the library is missing.
- **GCI auto-detection for Windows client** — the login flow checks extracted Windows client distributions (`GemStone64BitClient{version}-x86.Windows_NT/bin/`) before prompting the user to browse for a library.
- **Quick Setup downloads Windows client** — on Windows, Quick Setup now downloads and extracts both the WSL server distribution and the native Windows client distribution, then auto-registers the GCI library path.
- **Login editor shows Windows client versions** — the version dropdown in the login editor includes versions from extracted Windows client distributions on Windows.
- **Graceful handling of missing GCI functions** — the GCI library loader now tolerates functions absent from the Windows client DLL (`GciTsNbLogin`, `GciTsNbLogin_`, `GciTsNbLoginFinished`, `GciTsDebugConnectToGem`, `GciTsDebugStartDebugService`); calling them throws a descriptive error instead of failing at load time.

### Changed

- **README rewritten for Windows users** — Getting Started now leads with the simpler "connect to an existing server" path before the full local setup; new Windows Usage section explains client-only and WSL configurations; platform support table at the top.
- **`tar` instead of PowerShell for Windows extraction** — Windows client zip extraction uses `tar -xf` (built into Windows 10+) instead of `Expand-Archive`, avoiding PowerShell execution policy issues.
- **VS Code tasks use `cmd.exe` on Windows** — build tasks now specify `cmd.exe` as the shell on Windows to avoid `npm.ps1` execution policy errors.

## [1.3.1] - 2026-04-16

### Changed

- **MCP stdio now routes to the user's current session** — Jasper's extension host opens a local socket on activation and writes `.claude/settings.local.json` automatically; the MCP server runs as a thin proxy that forwards each tool call into the extension host, so Claude Code (and any other MCP client) sees exactly the session you are working in. No separate login, credentials, or keychain entries are required for the MCP flow. If no session is selected, tools return an error Claude can handle gracefully.
- **Removed "Configure Claude Code" setup** — no longer needed; the stdio MCP server is available as soon as a workspace is open.
- **Shared query layer (`client/src/queries/`)** — every GemStone query (read and write) now lives in a shared module parameterized by a `QueryExecutor` function. Both MCP surfaces (stdio proxy and SSE) and Jasper's own IDE code delegate through the same Smalltalk composition and result-parsing logic. Eliminates all duplicated inline Smalltalk between the client and MCP server.
- **`compileMethod` switched from GCI primitives to pure Smalltalk** — now uses `Behavior>>compileMethod:dictionaries:category:environmentId:` via the shared query layer instead of low-level GCI calls (`GciTsCompileMethod`, `GciTsPerform`, `GciTsNewString`, `GciTsNewSymbol`); returns a confirmation string instead of a method OOP (no caller used the OOP). Compile errors propagate through the GCI error path with line/position details as before.
- **`fileOutClass` uses global lookup by default** — resolves classes via `objectNamed:` across the symbolList instead of requiring a dictionary index. Optional `dict` parameter targets a specific dictionary when needed (e.g., export manager walking dicts to handle shadowed names correctly).
- **Class browser loads data in one round trip** — the class definition panel now fetches definition, comment, superclass dictionary name, and write-permission in a single GemStone query (`loadClassInfo`) instead of four separate calls.

### Added

- **Keychain-backed login passwords** — the login editor has a "Store password in OS keychain" checkbox. When enabled, the password is saved to the OS keychain (macOS Keychain, Windows Credential Vault, Linux libsecret) via `keytar`, keyed by `${user}@${host}/${stone}`; the settings file stores an empty password and a `password_in_keychain` flag. Editing the login reads the password back from the keychain; unchecking the box migrates the entry back to plaintext and deletes the keychain secret. Leaving the password blank still prompts on each login.
- **End-to-end MCP integration tests** — a real `McpSocketServer` is started in-process and driven by the MCP SDK's `Client` over a Unix socket (named pipe on Windows), verifying the full proxy path: tool discovery, tool dispatch to the current session, graceful "no active session" errors, and live session-switch behavior without stale caching.
- **27 MCP tools (up from 16)** — eleven new tools: `add_dictionary`, `compile_class_definition`, `delete_class`, `delete_method`, `describe_class`, `export_class_source`, `find_references_to`, `list_all_classes`, `list_dictionary_entries`, `remove_dictionary`, `set_class_comment`. Write tools flag "NOT committed automatically"; destructive tools start descriptions with "DESTRUCTIVE:".
- **`describe_class` combined tool** — returns class definition, comment, and own methods grouped by category (both sides) in one round trip; descriptions guide agents to prefer it over calling `get_class_definition` + `list_methods` separately.
- **`getClassNames` and `getDictionaryEntries` accept dictionary name or index** — MCP clients can pass a dictionary name string; Jasper's IDE callers continue using 1-based indices.
- **Shadow-safe class lookup (`classLookupExpr`)** — shared helper composes Smalltalk that resolves a class either globally (`objectNamed:`) or scoped to a specific dictionary, for correct behavior when class names are shadowed across dictionaries. Used by `describe_class`, `export_class_source`, `compile_method`, `delete_method`, `set_class_comment`, and `fileOutClass`.
- **Optional `dictionaryName` parameter on class-targeting tools** — `describe_class`, `export_class_source`, `compile_method`, `delete_method`, and `set_class_comment` accept an optional dictionary name to disambiguate shadowed class names.

## [1.3.0] - 2026-04-10

### Added

- **MCP Server for Claude Code integration** — an embedded MCP (Model Context Protocol) server that lets Claude Code interact with GemStone directly, without the Topaz CLI; the MCP server runs as a separate Node.js process with its own GCI session (isolated from the user's sessions), using SSE/HTTP transport on an auto-assigned port; lifecycle is managed via Start/Stop buttons in the Databases pane, with the port automatically written to `.claude/settings.local.json`
- **16 MCP tools** — `abort`, `commit`, `compile_method`, `execute_code`, `find_implementors`, `find_senders`, `get_class_definition`, `get_class_hierarchy`, `get_method_source`, `list_classes`, `list_dictionaries`, `list_methods`, `run_test_class`, `run_test_method`, `search_method_source`, and `status`; together these give Claude a full development workflow: browse, write, test, commit/abort, and inspect session state
- **Login selection for MCP server** — starting the MCP server prompts for a login matching the database's stone name (auto-selects if only one exists); the MCP server logs in with its own credentials, keeping full isolation from user sessions
- **Open MCP Inspector** — a button on a running MCP Server node opens the standard MCP Inspector (`@modelcontextprotocol/inspector`) in a VS Code terminal, pre-configured with the server's URL; the terminal is tracked and disposed on stop or re-open to prevent port conflicts
- **Auto-stop MCP server on stone shutdown** — stopping a stone automatically stops any running MCP server for that stone first, preventing orphaned sessions

## [1.2.3] - 2026-04-10

### Fixed

- **Parser support for `@envN:` on all message kinds** — the language server parser now correctly handles the optional `@envN:` environment specifier prefix on unary, binary, and keyword messages, including nested messages inside binary/keyword arguments and all three cascade message kinds; previously, expressions such as `Transcript @env0:show: 2 @env1:+ 3 @env2:squared` were silently dropped or had the env specifier consumed as the selector

## [1.2.2] - 2026-04-05

### Added

- **Quick Setup wizard** — one-click "Quick Setup" command that checks shared memory, downloads and extracts a GemStone version, creates a database, starts Stone and NetLDI, and creates a login — getting a new user from zero to a running environment in a single step; if shared memory is not configured, offers to run the setup script and resumes automatically when the terminal closes
- **Execution busy-state indicators** — executing code (Execute It, Display It, Inspect It) now provides layered visual feedback: the selected code dims to 40% opacity while running, a `$(sync~spin) GemStone: Executing…` spinner appears in the status bar, and the execute/display/inspect commands are disabled (greyed out in context menus, keybindings ignored) until the execution completes; all indicators clear automatically on completion or error
- **Workspace document on login** — logging in now automatically opens a "Workspace" scratch pad (`gemstone://{sessionId}/Workspace`) with a sample expression; edits are preserved in memory for the session; the document is not reopened if already open

### Changed

- **Keybindings moved to `Cmd+;` chord prefix** — all keybindings now use a two-key chord (`Cmd+; D`, `Cmd+; E`, `Cmd+; I`, `Cmd+; B`, `Cmd+; C`, `Cmd+; M`) to avoid conflicts with core VS Code shortcuts (`Cmd+D`, `Cmd+E`, `Cmd+I`) and Copilot (`Cmd+I`); `Shift` modifier removed from browser, class, and method bindings
- **Shared memory threshold lowered to 1 GB** — shared memory checks now apply settings immediately and use a 1 GB threshold instead of 4 GB
- **No breadcrumbs for Workspace documents** — Workspace (doIt) documents no longer show a misleading `_doIt` breadcrumb; document symbols are suppressed for code-only regions since they have no navigational structure

## [1.2.1] - 2026-03-26

### Added

- **Find Class command** (`Cmd+K C` / `Ctrl+K C`) — quick-pick search across all classes in all dictionaries; selecting a class navigates the System Browser to it (or opens the class definition if no browser is open)
- **Find Method command** (`Cmd+K M` / `Ctrl+K M`) — quick-pick search across all methods (instance and class side) of the currently selected class in the System Browser; if no class is selected, prompts for a class name; selecting a method navigates the browser and opens the method editor
- **FileSystem provider logging** — `gemstone://` file operations (`stat`, `readFile`, `writeFile`) now log to the GemStone output channel, making it easier to diagnose save/compile issues; entries show the URI, read-only status, and success/failure of each operation
- **Register local GemStone versions** — "Register Local Version…" button in the Versions view lets you point to an existing GemStone installation directory without downloading or extracting; registered versions appear alongside downloaded ones and can be used for databases and logins; "Unregister" removes the registration without deleting files
- **Login editor version picker** — the login editor now shows a dropdown of available GemStone versions (from extracted installations and configured GCI library paths) instead of a free-text field

### Changed

- **Selecting a class no longer opens the `.gs` file** — the class definition and method navigation are available from the browser; the file can still be opened from the file explorer if needed
- **Method category context menu simplified** — removed "New Method" from the method category context menu (it remains in the method list context menu where the new method will appear); the context menu now only shows "Rename Category" for real categories and no menu for virtual entries
- **Find Class/Method navigate only the active browser** — when multiple System Browser panels are open for the same session, Find Class, Find Method, and Implementors/Senders now navigate only the most recently focused browser instead of all of them
- **Pool Dictionaries dropdown expanded** — the Class Definition panel's Pool Dictionaries dropdown now shows all `SymbolDictionary` instances visible in the user's symbol list (not just the top-level dictionary names), so pool dictionaries stored inside other dictionaries are discoverable
- **Debugger opens methods in the bottom editor group** — clicking a stack frame in the debugger now opens the method source via a `gemstone://` URI (the same path the System Browser uses), so it appears in the bottom editor group alongside other method editors instead of the top half
- **Breadcrumbs no longer duplicate class and method names** — document symbols for `gemstone://` method editors now use just the selector as the symbol name instead of `ClassName >> selector`, since the class and method are already shown in the URI path breadcrumbs

### Fixed

- **Browser refresh preserves full selection state** — commit and abort now restore the selected class, instance/class side toggle, method category, and method list after refresh; previously only the dictionary and class category were restored
- **Method list refreshes after compile or delete** — saving a new or existing method now immediately updates the method categories and method list in the System Browser; previously the list was stale until a manual refresh or commit/abort
- **Method category defaults to "as yet unclassified"** — selecting a method or creating a new method when "** ALL METHODS **" (or no category) is selected now uses `as yet unclassified` as the category instead of the literal virtual-category name; previously saving in this state created a duplicate `** ALL METHODS **` category entry
- **New Method template opens in the bottom editor group** — "New Method" from the method list context menu now opens in the same bottom panel as other method editors instead of the top half

- **Single-quote handling in Execute It / Display It** — code containing Smalltalk string literals (e.g. `UserGlobals at: #'James' put: 'Foster'.`) no longer produces a syntax error; the wrapper had been incorrectly doubling single quotes as if embedding in a string literal, but the user code is placed directly in Smalltalk source
- **Inline diagnostics for syntax errors** — compilation and runtime errors from Execute It / Display It / Inspect It now appear as red squiggly underlines in the editor (visible in the Problems panel) instead of only as notification popups; when the GemStone compiler reports a character offset, the diagnostic highlights the specific error location; diagnostics clear automatically on the next successful execution or document edit

## [1.2.0] - 2026-03-16

### Added

- **Globals Browser** — selecting a dictionary in the System Browser opens a sortable "Globals" tab (below the browser) showing all non-class globals in that dictionary with Name, Class, and Value columns; double-clicking a row opens the global in the Inspector (or selects it if already present)
- **Class Browser** — selecting a dictionary or class in the System Browser opens a "Class Definition" tab for creating, viewing, and editing class definitions; identity row (superclass dictionary, superclass, subclass name, in dictionary, category) across the top; variable lists (instance, class, class instance, pool dictionaries) side-by-side below; options grid with hint tooltips explaining each GemStone class option; new classes default superclass to `Globals >> Object`
- **Windows support (WSL)** — system administration features (versions, databases, processes) now work on Windows by bridging commands through WSL2; auto-detects WSL availability and shows setup guidance when not installed
- **WSL bridge module** — path conversion between Windows UNC and WSL Linux paths, command spawning and synchronous execution routed through `wsl.exe`
- **Browser-driven method editing** — clicking a method in the System Browser opens it in a dedicated editor tab (via `gemstone://` URI scheme) showing only that method's source; saving the tab compiles the method in GemStone via GCI; compile errors appear as VS Code diagnostics (red squiggles) without a modal popup
- **Write-access check** — `gemstone://` editor tabs are marked read-only when the class cannot be written by the current user (`canBeWritten` is queried via GCI); new-class and new-method tabs are always writable
- **Implementors/Senders navigate the Browser** — selecting a result from "Implementors of" or "Senders of" now navigates the System Browser's five columns to the chosen method in addition to opening the method editor tab; the browser panel is revealed without stealing focus from the editor
- **Preview tabs for method editors** — method editor tabs open in VS Code preview mode (italic title) so navigating from method to method reuses the same tab; the tab becomes permanent once edited

### Changed

- **Editor layout set by System Browser** — the top/bottom split layout is now applied by the System Browser when selecting a dictionary, ensuring panels appear in the correct order; previously set by the Globals Browser
- **Removed `** GLOBALS **` category** — the System Browser's Class Categories column no longer shows a special `** GLOBALS **` entry; globals are now accessible via the dedicated Globals Browser tab
- **All exported `.gs` files are read-only** — exported files are for search and navigation only; all editing happens through the System Browser's method editor tabs; file permissions are set to 0o444 after export regardless of dictionary or user
- **`FileInManager` simplified** — removed save-interception machinery (`onWillSaveTextDocument`, content cache, differential compilation); file create/delete event handling is retained
- **Commit/abort closes method editor tabs** — open `gemstone://` method editor tabs are closed when a session commits or aborts (stale after re-export); `hasUnsavedChanges` now also checks for dirty `gemstone://` docs so commit/abort warns correctly
- Renamed extension to "Jasper: A GemStone Smalltalk IDE"
- **Auto-generated login labels** — login labels are now derived from `{user} on {stone} ({host})` instead of being manually entered; removed the label text field from the login editor
- **Simplified export paths** — removed per-login `exportPath` field; export path is now controlled solely by the global `gemstone.exportPath` setting with a new `{session}` variable; default changed from `{workspaceRoot}/gemstone/{host}/{stone}/{user}/...` to `{workspaceRoot}/gemstone/{session}/...`
- **Duplicate login** now opens the login editor (pre-filled) instead of silently creating a copy
- **Multi-session safety** — prevents multiple simultaneous logins when custom `exportPath` does not include `{session}`, avoiding file conflicts
- Reordered inline buttons: logins show delete/duplicate/login (left-to-right); sessions show logout/abort/commit
- Added icons to SysAdmin tree views (Configure OS, Versions, Databases, Processes)
- Updated repository URLs from `vscode-gemstone` to `Jasper`
- Renamed "GemStone Smalltalk Formatter" settings section to "Smalltalk Formatter"

## [1.1.1] - 2026-03-02

### Fixed

- **Linux support** — extension now runs on Linux in addition to macOS
- Pre-load `libnetldi` with `RTLD_GLOBAL` on Linux so the GCI library can resolve `HostCreateThread`
- Include the `koffi` native module in the packaged extension (`.vscodeignore` fix)
- Set `GEMSTONE` and `GEMSTONE_GLOBAL_DIR` environment variables at login so the in-process GCI library can locate the NetLDI lock file
- Reset the open-file limit (`ulimit -n 1024`) when spawning GemStone processes on Linux to prevent shared page cache sizing issues caused by Electron's high default limit
- Replace `curl`-based version download with native Node.js `https` (with redirect handling) for portability
- Use `spawnSync` instead of `execSync` for `unzip` with proper error handling

### Changed

- **Configure OS** view (formerly "Shared Memory") — now available on Linux in addition to macOS; detects shared memory via `sysctl kernel.shmmax`/`kernel.shmall` on Linux
- **RemoveIPC check** (Linux) — detects whether `RemoveIPC=no` is set in systemd logind configuration; provides a one-click setup script to prevent systemd from destroying GemStone shared memory on logout

## [1.1.0] - 2026-02-28

### Added

- **GemStone SysAdmin** — manage GemStone infrastructure directly from VS Code without needing a separate tool
- **Shared Memory view** (macOS) — detects whether macOS shared memory is configured for GemStone (requires 4 GB); when not configured, provides a one-click setup script that installs a LaunchDaemon plist
- **Version management** — browse available GemStone versions from the GemTalk downloads site; download, extract (automatic DMG mounting on macOS, unzip on Linux), and delete versions; supports both ARM and x86 on macOS and Linux
- **Database management** — create new databases via a multi-step wizard (select version, base extent, stone name, NetLDI name); automatically generates directory structure, configuration files, and copies the extent and key file; delete databases with safety checks
- **Start/Stop Stone** — start and stop GemStone stone processes with full environment configuration; inline tree view buttons with running/stopped status indicators
- **Start/Stop NetLDI** — start and stop NetLDI network listener processes; displays port number when running
- **Replace Extent** — replace a stopped stone's database extent with a fresh base extent; removes old extent and transaction logs
- **Process list** — view all running GemStone processes (stones and NetLDIs) parsed from `gslist -cvl` output with PID and port information
- **Database tree view** — hierarchical view showing each database with its stone status, NetLDI status, expandable log files, and expandable config files; click any file to open it in the editor
- **Open Terminal** — open a VS Code terminal pre-configured with all GemStone environment variables (`GEMSTONE`, `PATH`, `DYLD_LIBRARY_PATH`, etc.) and working directory set to the database path
- **Reveal in Finder** — open the database directory in the system file manager
- **Create Login from Database** — create an IDE login configuration pre-filled with the database's version, stone name, NetLDI, and auto-detected GCI library path
- **SysAdmin output channel** — all admin operations (create, delete, start, stop) are logged to the "GemStone Admin" output channel
- **Per-login export path template** — each login now has an optional `exportPath` field that accepts a template with variables `{workspaceRoot}`, `{host}`, `{stone}`, `{user}`, `{index}`, `{dictName}`; the per-login template takes precedence over the global `gemstone.exportPath` setting
- **User-managed dictionaries** — new `gemstone.userManagedDictionaries` setting lists dictionary names that the extension will never overwrite during export
- **Configurable export root** — `gemstone.exportPath` setting supports `{workspaceRoot}` variable substitution, absolute paths, and paths relative to the workspace root

### Changed

- Removed login reconciliation on connect (local/server conflict detection); replaced by user-managed dictionaries for controlling which dictionaries are owned by the developer
- Consolidated `language-configuration-tonel.json` into `language-configuration.json` (identical contents)

## [1.0.5] - 2026-02-26

### Added

- **File-based class browser** — export classes in Topaz format to the file system; open and edit classes with the standard VS Code file explorer; System Browser webview with five-column layout (dictionaries, class categories, classes, method categories, methods) with file editor below
- **Multiple browser windows** — each "Open Browser" creates a new panel; tab title updates to `Browser: ClassName` when a class is selected
- **Login export reconciliation** — on login, detects conflicts between local files and the GemStone image; offers Use Local, Use Server, Show Differences, or Skip options
- **New class template** — creating a `.gs` file in a dictionary directory auto-fills a class template and files it in to GemStone
- **Hierarchy view** — toggle between category and hierarchy views in the browser; shows superclass chain and subclasses
- **Context menus** — right-click dictionaries, classes, method categories, and methods for actions (add, delete, move, rename, run tests, inspect, senders, implementors, browse references)
- **Browse References** — right-click a dictionary or class to find all methods that reference that object via `ClassOrganizer >> referencesToObject:`
- **Drag-and-drop** — drag methods to recategorize; drag classes between dictionaries
- **Inspect non-class globals** — selecting a global in the `** GLOBALS **` category opens the object inspector
- **Multiple method environments** — `gemstone.maxEnvironment` setting controls how many method environments are displayed
- **Transcript channel** — GemStone Transcript output routed to a VS Code output channel
- **Semantic tokens** — language server provides semantic token highlighting for Smalltalk method source
- **Code lens** — inline code lens annotations in Smalltalk source files
- **Custom dictionary inspector** — inspector tree view supports drilling into SymbolDictionary entries
- **Large collection pagination** — inspector paginates large indexed collections instead of loading all elements at once

### Changed

- Dictionary directories renamed from `N. DictName` to `N-DictName` to avoid spaces in file paths (improves Topaz compatibility)
- Method reveal scrolls to top of editor pane instead of center when selecting a method in the browser

## [1.0.4] - 2026-02-19

### Added

- **SUnit Test Runner** — integrates with VS Code's native Test Explorer via the Test API; discovers all `TestCase` subclasses in the user's symbol list and their `test*` methods; run individual tests or entire test classes with pass/fail/error reporting and failure messages; test items link to method source via `gemstone://` URIs; right-click a class in the browser tree to run its SUnit tests; auto-discovers tests on session activation; refresh button in Test Explorer header
- **Line-based breakpoints** — click the gutter in a `gemstone://` method to set/clear breakpoints; maps editor lines to GemStone step points via `_sourceOffsets`; breakpoints are managed per-method and cleared on recompile
- **Selector breakpoints** — right-click a selector in a `gemstone://` method and choose "Toggle Selector Breakpoint" to set a breakpoint on that specific step point; breakpointed selectors are highlighted with a red border decoration; supports multi-keyword selectors (e.g., `assert:equals:` highlights all keyword parts); underscores recognized in selectors
- **Debug-enabled code execution** — Display It, Execute It, and Inspect It now pass `GCI_PERFORM_FLAG_ENABLE_DEBUG` so breakpoints fire during execution; errors offer a "Debug" button to open the VS Code debugger
- **Multi-environment method dictionaries** — new `gemstone.maxEnvironment` setting controls how many method environments are displayed (default 0 shows standard Smalltalk only; higher values show additional environments, e.g., Python)
- **Drag-and-drop in browser tree** — drag methods to a different category to recategorize them; drag classes to a different dictionary to move them; drag classes to a class category to reclassify them; validates same class/side/environment for method moves and rejects drops on synthetic categories
- **New Class Category command** — `+` button on dictionary nodes prompts for a category name, then opens a new-class template pre-filled with that category
- **Class categories in browser** — dictionaries now group classes by category with `** ALL CLASSES **` and `** OTHER GLOBALS **` synthetic categories; named categories show a `+` button for creating new classes in that category
- **`** ALL METHODS **` method category** — each side node includes a synthetic `** ALL METHODS **` category that lists every method alphabetically, making it easy to find methods without knowing their category
- **Index-based dictionary lookup** — all dictionary interactions (class lookup, delete, move, reclassify, reorder) now use the SymbolList index rather than name, avoiding ambiguity when two dictionaries share the same name
- **Bulk environment query** — single-round-trip `_unifiedCategorys:` query fetches all categories and selectors per environment, reducing GCI calls for remote databases
- **Object Inspector** — new sidebar tree view for inspecting GemStone objects with drill-down into named instance variables and indexed elements; pin objects via **Inspect It** (Cmd+I) or by clicking globals in the browser; reuses debugger's GCI introspection infrastructure
- **Senders Of / Implementors Of** — right-click a method in the browser tree or use the editor context menu to find senders or implementors across all dictionaries; results open in a QuickPick list and clicking an entry opens the method source
- **Token-aware selector detection** — Senders Of / Implementors Of in the editor use the language server to identify the selector at the cursor position, correctly composing multi-keyword selectors (e.g., `at:put:`)
- **Class Hierarchy** — right-click a class in the browser tree to view its superclass chain and subclasses in a QuickPick list; selecting an entry opens the class definition
- **Search Method Source** — toolbar button in the browser view to search method source code across all dictionaries using a GCI `includesString:` query
- **Workspace Symbol Provider** — Cmd+T / Ctrl+T now includes classes and methods from the active GemStone session alongside local file results
- **Browser tree sync** — the browser tree view automatically selects and reveals the node corresponding to the active `gemstone://` editor tab (methods, definitions, and comments); works with Senders Of, Class Hierarchy, back/forward navigation, and clicking tabs
- **LSP support for `gemstone-smalltalk`** — browser documents (`gemstone://` URIs) now get language server features: hover, completion, go-to-definition, find references, and diagnostics
- **Go to Definition** — Cmd+Click or F12 on a selector jumps to its implementor(s) via GCI; for class names, jumps to the class definition; uses the same LSP-based selector resolution as Senders/Implementors
- **Hover Documentation** — hovering over a selector shows its implementor count with class names and categories; hovering over a class name shows its dictionary and class comment (truncated to 500 chars)
- **Autocompletion** — GCI-backed `CompletionItemProvider` supplements LSP completions with class names from the image, instance variable names for the current class, and the full selector protocol (own + inherited); results are cached per session and class

## [1.0.3] - 2026-02-16

### Added

- **GCI library integration** — load the GemStone C Interface (`libgcits`) at runtime via [koffi](https://koffi.dev/) FFI; wrapper in `client/src/gciLibrary.ts` exposes 98 GCI functions covering login/logout, transactions, object creation/fetch/store, execution, compilation, traversal, debugging, and host utilities
- **Session management** — login button on saved logins now establishes a live GCI session; new **Sessions** tree view in the GemStone sidebar shows active connections with inline **Commit**, **Abort**, and **Logout** buttons; sessions are cleanly logged out on extension deactivation
- **GCI integration test suite** — separate vitest config (`vitest.gci.config.ts`) and `npm run test:gci` script for tests requiring the native library; 171 tests across 16 test files
- **GCI library file validation** — the login flow now validates the selected library filename against the expected `libgcits-<version>-64.<ext>` pattern
- **Login management UI** — sidebar tree view, editor panel for add/edit/duplicate/delete logins, stored in VS Code global settings
- **GCI documentation headers** — `docs/3.7/gcits.hf` and `docs/3.7/gcits.ht` for reference
- **Display It / Execute It** — execute Smalltalk code from the editor against a live GemStone session; Cmd+D inserts the `printString` result inline (with italic decoration), Cmd+E executes silently; non-blocking execution with exponential-backoff polling, progress notification after 2 seconds with soft/hard break support
- **Session selection** — selected session concept for keyboard-driven code execution; auto-selects when only one session exists, QuickPick prompt for multiple sessions; status bar item shows active session; tree view highlights selected session with distinct icon
- **Class/method browser** — sidebar tree view (Dict → Class → Definition/Comment/Instance/Class → Category → Method) with `gemstone://` virtual filesystem; click a method to open and edit in the standard editor, Cmd+S compiles; class definitions and comments are also editable documents
- **Browser operations** — new class (template), new method (template), delete method, move method to category, rename category, remove class, move class between dictionaries, add dictionary, reorder dictionaries; all accessible from tree context menus and inline buttons
- **GCI Output Channel** — all GCI queries, results, and errors are logged to a "GemStone" output channel for debugging; session login/logout events are also logged
- **Language ID reorganization** — `gemstone-topaz` for `.gs`/`.tpz` (Topaz files), `gemstone-smalltalk` for bare Smalltalk (browser documents, scratch files), `gemstone-tonel` for `.st` (Tonel files)
- **Tonel file format support** — `.st` files are now parsed as Tonel format (used by GemStone's Rowan package manager), while `.gs` and `.tpz` remain Topaz format
- New `gemstone-tonel` language ID with dedicated TextMate grammar and language configuration
- Tonel parser handles Class, Extension, and Package files with STON metadata headers
- Method bodies in Tonel files get full LSP support: hover, completion, go-to-definition, find references, document symbols, workspace symbols, diagnostics, and folding
- Tonel methods are included in the workspace index for cross-file implementor/sender lookup
- Bracket-aware method body extraction (correctly handles nested blocks, strings, and comments)
- **Debugger** — VS Code Debug Adapter Protocol (DAP) integration for debugging GemStone errors; when code execution hits an error, a "Debug" button offers to open the VS Code debugger with full stack trace, source viewing, variable inspection, stepping, continue, and expression evaluation
  - Stack trace with `ClassName>>#selector` frame names and source references
  - Click any frame to view its method source with GemStone (Smalltalk) syntax highlighting
  - "Executed Code" frame for doit expressions that triggered the error
  - Arguments & Temps scope and Receiver scope with drill-down into named/indexed instance variables
  - Step Over, Step Into, Step Out via blocking GCI calls (`gciStepOverFromLevel:` etc.)
  - Continue execution via `GciTsContinueWith` (resumes process; re-enters debug on subsequent errors)
  - Evaluate expressions in the Debug Console in the context of any stack frame
  - Restart Frame support via `trimStackToLevel:`
  - Disconnect clears the suspended GsProcess stack

## [1.0.2] - 2026-02-13

### Added

- **Workspace method index** — on startup, scans all `.gs`, `.st`, and `.tpz` files and builds an in-memory index of method selectors, class names, and message sends; incrementally updated on every edit and file-system change
- **Workspace Symbol search** (Ctrl+T / Cmd+T) — find methods across all files by selector or class name (e.g., `at:put:`, `Foo >> bar`)
- **Go to Implementors** — Cmd+click (or F12) on a message send jumps to its implementors across the workspace; correctly composes keyword selectors (`at:` vs `at:put:`)
- **Find Senders** (Find All References) — right-click a selector to find all methods that send it across the workspace
- **Configurable formatter** with settings under `gemstoneSmalltalk.formatter.*`:
  - `spacesInsideParens`, `spacesInsideBrackets`, `spacesInsideBraces`
  - `spacesAroundAssignment`, `spacesAroundBinarySelectors`, `spaceAfterCaret`
  - `blankLineAfterMethodPattern`
  - `maxLineLength` (line wrapping, 0 = off)
  - `continuationIndent` (for multi-line keyword messages)
  - `multiKeywordThreshold` (when to split keyword messages across lines)
  - `removeUnnecessaryParens` (based on Smalltalk message precedence)

### Fixed

- Hover tooltips now correctly identify instance/class variables as "variable" instead of "unary selector"

## [1.0.1] - 2026-02-10

### Fixed

- Fixed false positive "Expected ']' to close block" errors
- Fixed false positive "Expected ')' to close parenthesized expression" errors

## [1.0.0] - 2026-02-08

### Added

- GemStone Smalltalk syntax highlighting for `.gs`, `.st`, and `.tpz` files
- Topaz command language support with highlighting for 40+ commands (`run`, `doit`, `printit`, `commit`, `abort`, `login`, `logout`, `set`, `display`, `method`, `classmethod`, `category`, `fileout`, `filein`, and more)
- Topaz code block recognition for `run`, `doit`, `printit`, `method`, and `classmethod` blocks
- Smalltalk language constructs: strings, symbols, numbers, characters, arrays, byte arrays, booleans, `nil`, block syntax, pragmas, assignments, returns, and cascades
- Pseudo-variable highlighting for `self`, `super`, and `thisContext`
- Class and global variable recognition (capitalized identifiers)
- Double-quote comment syntax support
- Language configuration with bracket matching, auto-closing pairs, folding markers, and smart indentation
- Language Server Protocol (LSP) client/server architecture for advanced editor features
