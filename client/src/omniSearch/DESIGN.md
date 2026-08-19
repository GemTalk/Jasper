# Omni Search (issue #378) — design

Global "search anything browsable" for the GemStone IDE — the Jasper answer to Pharo's
**Spotter** and IntelliJ's **Search Everywhere**, built to feel native to a VS Code user.

> **History.** This feature began as a native `vscode.QuickPick` (`omniSearchController.ts`) and grew
> a webview UI alongside it. In #428 the QuickPick UI (`ui: "quickpick"`) and its controller were
> **removed**, leaving two webview surfaces — the docked bottom-panel view (`ui: "panel"`, default)
> and the editor-tab **Spotter** (`ui: "spotter"`). Both drive the single, `vscode`-free
> `omniEngine.ts`, so there is exactly one search path. This document describes the shipped design;
> where the QuickPick shaped a decision it's called out as origin, not current behaviour.

## Prior art that shaped the design

- **Pharo Spotter (GTSpotter):** one unified search field over a **processor-per-category** model
  (classes, methods, implementors, …), results grouped by category, keyboard-first (Cmd+Enter / Cmd+/).
  → We adopt the _provider-per-category_ model.
- **IntelliJ Search Everywhere:** double-Shift; **Tab** cycles category scopes (Classes / Symbols /
  Actions / All); recent items when empty. → We adopt _scope switching_ (as labeled tabs) and
  (deferred) recents.
- **Apple Spotlight:** single field, instant grouped results, a "top hit", keyboard-first.
  → Instant (debounced), keyboard-first, relevance-ranked.
- **VS Code Quick Open / Command Palette:** the muscle memory a VS Code user already has —
  fuzzy filter, `$(icon)` per row, keyboard nav. → The original QuickPick built directly on this; the
  webview keeps the same feel (fuzzy filter, keyboard-first, theming) with more chrome than a
  QuickPick title bar allows.

## Key decisions

1. **Webview UIs over a pure `vscode.QuickPick`.** The basic implementation shipped as a native
   QuickPick (least code/risk, exact Quick-Open feel). It was then superseded by a webview because the
   QuickPick title bar can't render labeled scope tabs, our own case-correct match highlights, an
   always-on case indicator, or a source-preview pane — all of which the issue's Pharo-Spotter
   screenshots call for. The two shipped surfaces are:
   - **`ui: "panel"` (default)** — a docked bottom-panel webview view (next to Terminal / Output).
     A tool that stays put: no pin, no auto-close; activating a result opens it in the editor area
     ABOVE the panel.
   - **`ui: "spotter"`** — an editor-tab webview that behaves like a dialog (closes on focus-out / on
     picking a result) unless **pinned** (📌), which keeps it open and switches activation to
     open-beside.

   Both share their HTML, tab/placeholder chrome, and engine-message plumbing via `omniSearchShared.ts`
   and drive the same `omniEngine.ts`.

2. **Provider-per-category model** (mirrors Spotter processors). `OmniProvider` = `{ category,
   prime?, search(query, cfg, token) }`. Providers in the default fan-out: **Classes, Methods,
   Dictionaries, Globals**; plus the **explicit-only** **Source, Literals, Categories** (see #3).
   Adding a category is a new provider — no engine change. (An Open Editors provider shipped initially
   but was **dropped** — the open-tab list is tiny and VS Code's own Open Editors view covers it.)

3. **Load-once vs per-query vs lazy vs explicit-only providers** (performance — search runs on every
   keystroke):
   - _Classes_, _Dictionaries_, _Globals_: enumerate the stone **once** when the UI opens, via the
     provider's `prime()` (`getAllClassNames` / `getDictionaryNames` / `getAllGlobalNames`), then match
     **client-side**. Those three loads are image-wide **synchronous GCI executes**, so reloading them
     is never done on a background path: a **hidden** docked panel that hears a session sync only marks
     its corpora stale (`syncPending`) and rebuilds on the next reveal or search — the same `visible`
     gate `onConfigChanged` uses. A visible panel still refreshes live.
   - Keeping those cached corpora honest between primes — **who announces what**:

     | Change in the image | Hook | Cost |
     | --- | --- | --- |
     | A class compiled locally | `notifyClassCompiled` → `applyChange` | re-fetch that ONE class name |
     | A class removed (Explorer → Remove Class) | `notifyClassRemoved` → `applyChange`, fired **once per class** because the delete takes the subtree | re-fetch per name; the lookup comes back empty and the entry drops |
     | Dictionary add / remove / rename | `onSymbolListChanged` → `notifySessionSynced` | full `resync` |
     | Commit / abort / file-in | `notifySessionSynced` | full `resync`, deferred while hidden |

     Everything else — a global created by evaluating code, a class removed by another session — is
     only picked up by the next commit/abort `resync`. That is the by-design staleness window.
   - _Methods_: the selector space is too large to preload, so this provider queries the stone
     **per search term** (debounced, min query length `methodMinQueryLength`), reusing the
     `searchSelectors` machinery.
   - **Explicit-only** categories (`OmniCategory.explicitOnly`) are **excluded from the all-scope
     fan-out** — they run only when the user scopes to them, so heavyweight work never fires on a plain
     search:
     - _Source_ — full method-source substring (`searchMethodSource`), per-keystroke-when-scoped.
     - _Literals_ — find methods that use a value **as a literal** (not as a message send, not merely
       as source text). Two forms: a **symbol** (`#at:put:`) via `literalSymbolReferences`, and a
       **string** via `stringLiteralReferences`. The symbol branch is shape-gated by `isSymbolLiteral`
       so a raw expression is never eval'd against the stone.
     - _Categories_ — class-category names; a whole-image scan (`getAllClassCategories`) so it
       **lazy-loads on first search**, not on open.

     ⚠️ Being excluded from the all-scope fan-out has a UX cost that has to be paid for explicitly: an
     All-scope search silently returns nothing for a term only those scopes could find, so "no results"
     is indistinguishable from "not in the image". Reproduced with `no such element` — 4 hits under
     Source, 0 under All. So while the All scope is active **and** something is typed, the view shows a
     hint under the field naming the skipped scopes, each one a button that switches to it:
     `Not searched here: Source · Literals · Categories — click one to search it` (`updateScopeHint` in
     `omniSearchView.js`). It stays silent when a heavy scope is already active (its own
     placeholder hint applies then), when the field is empty, and when the user has disabled the heavy
     scopes via the `categories` setting. Enter was deliberately left alone — it activates the selected
     row, and making it scope-dependent would trade one surprise for another.

4. **Pluggable, savable match algorithm** (the issue asks for this). A pure matcher (`omniMatch.ts`)
   with modes `fuzzy` (subsequence, default) | `substring` | `prefix`, plus case-sensitivity — read
   from settings (`gemstone.omniSearch.matchMode`, `…caseSensitive`). It returns match **ranges**,
   which the webview renders as `<mark>` highlights. `rank.ts` is the shared per-provider helper: match
   every candidate, drop non-matches, sort by the matcher's total order, cap to `maxResultsPerCategory`.

5. **Trigger.** VS Code cannot bind _double-tap-Shift_ (keybindings are chords, not double-taps), so we
   ship a command `gemstone.omniSearch` + a default keybinding **`ctrl+shift+a`** (`cmd+shift+a` on
   macOS), `when: gemstone.hasActiveSession && !terminalFocus` (a Jasper window, not the terminal),
   configurable, plus a palette entry. A single simultaneous chord (not a sequential `ctrl+k` two-step)
   that stays clear of the notebook cell-run gestures (`shift+enter` / `ctrl+enter` / `alt+enter`) — an
   earlier `shift+enter` default shadowed the notebook's run-cell. The double-Shift aspiration
   is a follow-up (would need a fragile keystroke hack).

6. **Reference Search (Wishlist Task 1).** A result can pivot to "who references it": a **method** row →
   **senders** of its selector, a **class** row → **references to** it (via the shared
   `sendersOf` / `referencesToObject` queries). The pivot sweeps every method environment
   (`0..maxEnvironment`) and dedups by class/selector — matching the `sendersOfSelector` /
   `implementorsOfSelector` commands — so hits in a non-zero environment aren't missed, and each opens
   in the environment it was found in. Two entry points: the per-row **↗ button** and
   **Alt+Enter** on the highlighted row. `references.ts` is the pure glue (no `vscode`, no session).
   The setting **`referencesInPreview`** (default `true`) shows the references as a sticky list in the
   preview pane, leaving the results list in place; set it `false` for the classic pivot that replaces
   the whole list (backed out with ← / Esc).

6a. **A scope belongs to the search, not to a references view.** The pivot is not a search: it
   is a fixed list of rows already fetched from the stone, and **every one of them is a method**
   (`methodRowsToResults`), so a Classes/Globals/Dictionaries filter has nothing meaningful to do to
   them. Picking a scope while pivoted therefore **leaves the pivot** and applies that scope to the
   restored search. The rejected alternatives, for the record: *filtering the pivot rows by scope*
   (meaningless — one category, so every tab is either a no-op or empties the list) and *making the
   tabs inert while pivoted* (honest, but it hides a control rather than giving it a meaning, and it
   lives in the webview rather than the engine). What must never happen again is the original
   behaviour: the tab lit up as active while the list was left untouched, so the chrome advertised a
   filter that was never applied — and the scope then took effect **invisibly** when the pivot was
   dismissed, narrowing a search the user never asked to narrow.
   **The pivot names its own exit.** Its only ways out are `Esc` and `←` (the latter only with the
   caret at the start of the field), neither of them visible, and clearing the box does *not* escape —
   an empty filter matches every reference row, so clearing widens the list instead. Rather than
   overload the clear gesture, the breadcrumb carries the exit: `PIVOT_EXIT_HINT` ("Esc to go back")
   travels as its own field, **`OmniViewData.pivotHint`**, beside the plain `pivotTitle` — *not*
   concatenated into it. That keeps the wording and the styling a **view** decision: the webview renders
   the hint as a quieter aside (`.crumb-hint`) next to the title, and a host whose own chrome already
   shows a way out ignores the field instead of having to split a string on its separator. It is
   deliberately **not** added to `ReferencePreview.title` — in `referencesInPreview` mode there is no
   pivot and `Esc` closes the panel, so the same words there would be false. The hint is only as visible
   as the breadcrumb, which needs the *explicit* `display: block` that `setBreadcrumb` sets — clearing
   the inline style falls back to the stylesheet's `display: none` and the whole breadcrumb disappears.

7. **Scope filtering** ("filter buttons on top", per the issue). The webview renders one **labeled tab**
   per enabled category plus an "All" tab; picking one narrows the search to that category and re-runs
   the current term. (The origin QuickPick could only express scope with cramped icon title buttons +
   the title text — the webview tabs are the intended affordance.)

## Module map (`client/src/omniSearch/`)

| File                         | Responsibility                                                        | Stone?    | Tested                 |
| ---------------------------- | -------------------------------------------------------------------- | --------- | ---------------------- |
| `omniTypes.ts`               | `OmniProvider`, `OmniResult`, `OmniCategory`, config types            | no        | —                      |
| `omniConfig.ts`              | read `gemstone.omniSearch.*` → typed `OmniConfig`                     | no        | ✅                     |
| `omniMatch.ts`               | pure matcher/ranker (modes, score, ranges)                           | no        | ✅                     |
| `rank.ts`                    | shared provider helper: match → sort → cap                           | no        | ✅ (via providers)     |
| `omniActions.ts`             | dispatch an `OmniAction` to injected handlers (open / reveal)        | no        | ✅                     |
| `references.ts`              | pure glue: `OmniResult` → reference/senders query request           | no        | ✅                     |
| `omniEngine.ts`              | the search engine: scope, case, load-more/all, count, ref pivot → `OmniViewData` | no | ✅            |
| `omniSearchShared.ts`        | shared webview chrome (HTML, tabs, placeholder) + engine-message pump | no       | ✅                     |
| `omniSearchView.js`          | webview DOM (tabs, ranked rows, `<mark>` highlights, preview pane)   | no        | ✅ (jsdom)             |
| `omniSearchViewProvider.ts`  | host for `ui: "panel"` — the docked bottom-panel view                | no        | ✅                     |
| `omniSearchPanel.ts`         | host for `ui: "spotter"` — the editor-tab webview                    | no        | thin                   |
| `omniSearchCommand.ts`       | entry: read config, resolve session, wire providers, open the chosen UI | no     | ✅                     |
| `providers/classesProvider.ts`      | classes (load-once + match)                                  | preload   | ✅                     |
| `providers/dictionariesProvider.ts` | dictionaries (load-once + match)                             | preload   | ✅                     |
| `providers/globalsProvider.ts`      | non-class globals (load-once + match)                        | preload   | ✅                     |
| `providers/methodsProvider.ts`      | selector search (per-query)                                  | per-query | ✅                     |
| `providers/sourceProvider.ts`       | method-source substring (explicit-only, per-query)          | per-query | ✅                     |
| `providers/literalsProvider.ts`     | symbol/string literal references (explicit-only)            | per-query | ✅                     |
| `providers/categoriesProvider.ts`   | class-category names (explicit-only, lazy-loaded)           | lazy      | ✅                     |

New shared query (if needed) lives under `client/src/queries/` per repo convention.

## Settings (`gemstone.omniSearch.*`)

- `ui`: `panel` (default) | `spotter` — which webview surface the command opens.
- `matchMode`: `fuzzy` | `substring` | `prefix` (default `fuzzy`).
- `caseSensitive`: boolean (default `false`).
- `categories`: which providers are enabled (default: all seven —
  `classes, methods, dictionaries, globals, source, literals, categories`).
- `maxResultsPerCategory`: number (default `20`) — how many rows are **shown** per scope.
- `maxServerScan`: number (default `200`, clamped 20–20 000) — how many matches a scope's
  **server-side scan** collects before it stops. A different bound from `maxResultsPerCategory`; see
  "Two different limits bound a result set" below.
- `debounceMs`: number (default `120`).
- `methodMinQueryLength`: number (default `2`) — min chars before the Methods provider queries the stone.
- `referencesInPreview`: boolean (default `true`) — references as a sticky preview list vs a full-list pivot.

## The webview UIs

Both hosts render the same DOM (`omniSearchView.js`, read at runtime and jsdom-tested like the other
`*View.js`) and share their chrome + engine plumbing via `omniSearchShared.ts`:

- labeled scope **tabs**, a **flat relevance-ranked** row list (see below), OUR case-correct
  **highlighting** (`<mark>`), an always-on **case indicator** chip, a **source-preview pane** (fills
  as the active row moves), a **clear (×)** button, and an elegant footer **count + Load more/all**.
- `omniSearchViewProvider.ts` (`ui: "panel"`) is a docked tool: no pin, no auto-close, no open-beside.
- `omniSearchPanel.ts` (`ui: "spotter"`) behaves like a dialog: unpinned it closes on focus-out and on
  picking a result; the **📌 pin** keeps it open and switches activation to open-beside.

Behaviour decisions (Eric's review of the first webview cut):

- **Flat, globally relevance-ranked results — no category grouping.** Typing "foo" should surface the
  closest "foo" first regardless of kind, so `buildView` ranks every result together by match score.
  Each row wears a small **category tag** (Class / Method / Global / …) so you still see what it is.
- **Scroll resets to the top** on a fresh query / clear / scope / case change, but NOT on Load-more.
- **The result cap resets** to the base `maxResultsPerCategory` on a genuine term change (and on clear),
  so a raised "Load all" cap never silently persists into the next search.
- **Activation:** in the Spotter, unpinned Enter opens in the active group and dismisses it; pinned,
  Enter opens beside and Ctrl+Enter opens beside keeping the field focused. Alt+Enter → references.

## Overlap with #377 / #387 (documented, not silently merged)

- **#377 (method-signature search in the Explorer):** its backend _is_ this feature's `methodsProvider`
  \+ `omniMatch`, scoped to a class/subtree. Built here to be reusable; #377 is a **separate
  worktree/branch** that calls the scoped backend + adds the Explorer title button.
- **#387 items 1–5 (funnel=filter, magnifier=find, wording):** the "find" affordance #387 wants to
  free up is the same entry point #377 adds. Kept out of this branch; noted for the #377/#387 work.

## Two different limits bound a result set

The display cap (`maxResultsPerCategory`, raised by Load-more/Load-all) is not the only bound — the
**Methods** scope also has a server-side one. `searchSelectors` short-circuits the moment it has
`limit` matches, and `methodsProvider` clamps that limit to `maxServerScan` (default 200) however high
the display cap goes. So with the default a broad selector term can never yield more than 200 rows,
Load-all included. That ceiling is a **setting** rather than a constant precisely because the honest
answer to "I want more than 200" is "raise the scan, and accept a slower search".

The two bounds mean different things to the user, so a provider reports when its OWN ceiling was the
one that bound it (`OmniTruncationSink`, an optional 4th argument to `OmniProvider.search`, carrying
the category and the number it stopped at; providers that scan exhaustively and cap client-side never
report). The engine collects those into `OmniViewData.truncations`:

- **display cap reached** → `hasMore`; more rows are one Load-more away → `N+ shown` + the Load buttons.
- **fetch ceiling reached** → a `truncations` entry; that scope's rows are a floor and raising the cap
  cannot reveal more *of it* → `N+ shown` **and a visible note beside the count** naming the scope and
  its limit: `⚠ Methods scan capped at 200 — narrow the search for the rest`. The Load buttons are
  **not** hidden — `updateFooter` keys them off `hasMore && !exact` alone, deliberately: they raise the
  display cap for the whole view, which still widens any *other* in-scope provider that has more to
  show; only the capped scope can't grow, and the note (not a vanished button) is what says so.
- **neither** → `exact`; `shownCount` is the real total → `N results`.

There is a third case, and getting it wrong was a bug worth remembering. The server slice is
`min(maxResultsPerCategory × SERVER_OVERFETCH, maxServerScan)`, so the **over-fetch** can be the
tighter bound — with the cap at 60 and `maxServerScan` at 400 the scan is `min(240, 400)` = 240. Those
results are incomplete, so the count keeps its `+`, but this is NOT a wall: Load-more raises the cap
and genuinely widens the scan (240 → 400). So `OmniTruncation` carries `atCeiling`, and:

- the **`+`** on the count is driven by any truncation;
- the **note** only appears for `atCeiling` entries — warning while "Load more" is right there and
  working would tell the user to narrow their search for no reason;
- the note shows **`ceiling`** (the configured `maxServerScan`), never `scanned`. Reporting `scanned`
  displayed a limit the user never set and made the number climb on every Load-more — Eric saw
  "capped at 240" become "capped at 400".

Footer layout: the note is `flex: 1 1 auto` and is the footer's only slack absorber, so it stays a flex
item at all times and the view toggles **`visibility`**, never `display`. Removing it from the flow
hands the slack to another item and drops one of the footer's `10px` gaps, which slid the Load buttons
sideways whenever the note appeared — and both can be on screen together.

`exact` therefore requires Load-all **and** an empty `truncations`. Deriving it from the cap alone was
the bug behind the truncation notice: at the ceiling the footer printed a bare `200 results` over a
slice that had been cut off, with nothing on screen saying the scan had given up rather than run out.

Because the cap is reported per scope rather than as one boolean, any provider that gains a server
ceiling later is surfaced by the same note with no view changes.

⚠️ **`resultsMessage` (omniSearchShared.ts) lists the view's fields one by one instead of spreading
it**, so a new `OmniViewData` field reaches the engine but never the webview. That is how the
truncation notice first shipped broken — the flag was computed and never forwarded, so the count still
read `200 results`. A test in `omniSearchShared.test.ts` now fails if a field is added without forwarding.

## Controlling what a search costs (#428 items #40 / #41)

Two panel controls let the user decide what a search spends, instead of that being fixed in the code
or reachable only by editing settings.json. Both follow the **`caseSensitive` contract**: a setting
supplies the STARTING value, the in-panel control owns it for the rest of the session, and toggling
never rewrites the user's settings. That matters here — writing a setting fires
`onDidChangeConfiguration`, which drops the cached engine and re-primes the corpus, so a UI toggle
that persisted itself would pay a stone round-trip for a cosmetic change.

- **Preview-pane toggle (◧, `gemstone.omniSearch.previewPane`).** `#body` is a flex row: `#results`
  is `flex: 1 1 55%` and `#preview` `flex: 1 1 45%`. The docked panel is wide but SHORT, so that 45%
  buys a source view only a few lines tall while costing the result labels nearly half their width —
  the host that pays most gets least. Off adds `body.no-preview` (which outranks
  `#preview.has-content` on specificity) and short-circuits `requestPreview()`, so it also stops the
  per-row source fetch as you arrow down. The toggle never reaches the host: hiding a pane has no
  effect on the search. One exception — asking for references while the pane is hidden switches it
  back on, since the references list lives in that pane and the gesture would otherwise do nothing
  visible.
- **All-scope filter (the `Scopes` button, `gemstone.omniSearch.excludeFromAll`).** `providersInScope` already held
  `explicitOnly` categories (Source/Literals/Categories) out of the "All" fan-out by design; this
  lets the user put an ordinary category — in practice **Methods**, which queries the stone on every
  keystroke — into that same state. Scoping directly to a category always runs it, so an exclusion
  never makes a scope unreachable. That is precisely what distinguishes it from
  `gemstone.omniSearch.categories`, which removes the provider AND the tab; conflating the two is
  the defect #41 reports. The engine owns the set (`setExcludedFromAll` re-runs the term and resets
  the page cap, as `setScope` does) and echoes it on every results message, so the menu can never
  drift from what the search actually did.

- **Match algorithm (the `Fuzzy`/`Substring`/`Prefix` chip, `gemstone.omniSearch.matchMode`).** The
  algorithm was settings-only, so comparing two of them meant leaving the search, editing
  settings.json and starting over — for a choice whose whole point is that the right answer depends
  on what you are hunting for. The chip shows the current algorithm as its own label (no legend
  needed) and cycles on click. The engine owns the live value, exactly as it owns case sensitivity,
  and echoes it on every results message.
  ⚠️ **A live algorithm has to reach `filterPivot` too.** That function read `config.matchMode` — the
  value baked in when the engine was constructed — so switching algorithms did nothing while a
  references list was open. It now reads the engine's live `matchMode`; there is a test pinning it.

## Why the matcher stays hand-rolled (#428 item #44)

`fuzzysort` was weighed against `omniMatch` and **not adopted**. Measured, not assumed: the real
`omniMatch.ts` was compiled out of the worktree and benchmarked against `fuzzysort` 4.0.2 on three
corpora — the repo's own vendored Smalltalk class names (2 063) and selectors (8 230), plus a 20 000
name corpus scaled from those (synthetic, but with authentic name shapes) to stand in for a real
image. The benchmark ran outside the repo so no dependency was added to answer the question.

- **Speed: fuzzysort wins, and it does not matter.** It is 3–24× faster (4.4× overall on 20 000
  names). But `omniMatch`'s absolute worst case there is **16 ms for a single-character query**, and
  3–8 ms for realistic ones — inside one frame, behind a 120 ms debounce. Nobody is waiting on it.
- **Recall is identical.** Both returned exactly the same number of hits for every query on all three
  corpora, so the hand-rolled subsequence matcher is not missing results.
- **Ranking is at least as good, and arguably better.** For `oc`, `omniMatch` gives
  `OCCURRENCE, Once, ONCE, OrderedCollection` where fuzzysort gives
  `OCCURRENCE, SubOnlyCVar, OrderedCollection, Lock` — our word-start and contiguity weights are
  tuned for camelCase identifiers.
- **It would cost two shipped features.** fuzzysort is **fuzzy-only** — no `substring` or `prefix` —
  and has **no case-sensitive option** (it always folds case; `single('OC', 'OrderedCollection')`
  matches). Jasper exposes both as user settings, and the chip above just made the mode switchable
  mid-search. Adopting fuzzysort would mean removing them.
- **Plus a runtime dependency** (17.2 kB minified, no transitive deps — cheap, but not free on a
  supply-chain surface this repo has been deliberately hardening).

Revisit only if the corpus grows by an order of magnitude AND the matcher shows up in a profile.

## Deferred / follow-ups (tracked in issue #428)

- **Recents / empty-state** (IntelliJ shows recent files when the field is empty).
- **Top-hit** promotion.
- Corpus refresh — the remaining gaps. The refresh model itself is built (see §3: compiles and class
  removals fold per class, dictionary changes and commit/abort re-scan), so a class created after the
  UI opened DOES appear now. Still stale until the next commit/abort `resync`: a **global created by
  evaluating code** (nothing announces a new global), a **brand-new class category** when the
  Categories scope is already loaded, and anything changed by **another session**.
- Extra providers / scopes: **dedicated Symbols scope**, **method-categories scope**,
  senders/implementors, commands, settings.
- **Double-tap-Shift** trigger.
- Naming: settle on "Omni Search" vs "GemStone Search" across command titles and UI (#428).

## Testing

Every pure module is unit-tested: the matcher/ranker (`omniMatch`, via providers `rank`), the engine
(`omniEngine`), config, actions, and references. Query providers test the generated Smalltalk + result
parsing against a mocked `QueryExecutor` (the `methodSearch.test.ts` pattern). The webview DOM
(`omniSearchView.js`) is jsdom-tested. `omniSettings.test.ts` guards the contributed `ui` enum (exactly
`panel` + `spotter`); `keybindings.test.ts` covers the trigger. A live-stone integration test
(`queries/__tests__/methodSearch.integration.test.ts`) covers the Literals symbol query.
