# Omni Search (issue #378) — design

Global "search anything browsable" for the GemStone IDE — the Jasper answer to Pharo's
**Spotter** and IntelliJ's **Search Everywhere**, built to feel native to a VS Code user.

> Scope per the issue: this is the **basic implementation**. Follow-up issues cover the richer
> Spotter experience. Section "Deferred / follow-ups" lists what is intentionally out of scope.

## Prior art that shaped the design

- **Pharo Spotter (GTSpotter):** one unified search field over a **processor-per-category** model
  (classes, methods, implementors, …), results grouped by category, keyboard-first (Cmd+Enter / Cmd+/).
  → We adopt the _provider-per-category_ model and _grouped results_.
- **IntelliJ Search Everywhere:** double-Shift; **Tab** cycles category scopes (Classes / Symbols /
  Actions / All); recent items when empty. → We adopt _scope switching_ and (deferred) recents.
- **Apple Spotlight:** single field, instant grouped results, a "top hit", keyboard-first.
  → Grouped, instant (debounced), keyboard-first.
- **VS Code Quick Open / Command Palette:** the muscle memory a VS Code user already has —
  a `QuickPick` list with fuzzy filter, `$(icon)` per row, description/detail, item buttons.
  → **We build on the native `QuickPick`** so a VS Code user is immediately at home.

## Key decisions

1. **Native `vscode.QuickPick`, not a webview (for the basic impl).** It gives VS Code users the
   exact Quick-Open feel, live filtering, keyboard nav, theming, and category grouping (via
   `QuickPickItemKind.Separator`) for free, and it is far less code/risk than a webview. The
   pixel-faithful Pharo-Spotter look in the issue screenshots (a row of big filter buttons + an
   inspector preview) is a **documented Phase-2 webview**, not this issue. Eric explicitly wants a
   VS Code user to "feel at home" — QuickPick is that.

2. **Provider-per-category model** (mirrors Spotter processors). `OmniProvider` = `{ id, label,
icon, isEnabled, search(query, token) }`. Providers: **Classes, Methods, Dictionaries, Globals** in
   the default fan-out, plus the **explicit-only** **Source, Literals, Categories** (see #3). Adding a
   category is a new provider — no controller change. (An Open Editors provider shipped initially but
   was **dropped** — the open-tab list is tiny and VS Code's own Open Editors view covers it.)

3. **Load-once vs per-query vs explicit-only providers** (performance — omni runs on every keystroke):
   - _Classes_, _Dictionaries_, _Globals_: enumerate the stone **once** when the picker opens
     (`getAllClassNames` / `getDictionaryNames` / `getAllGlobalNames`), then match **client-side**.
   - _Methods_: the selector space is too large to preload, so this provider queries the stone
     **per search term** (debounced, min query length), reusing the `methodSearch` machinery.
   - **Explicit-only** categories (`OmniCategory.explicitOnly`) are **excluded from the all-scope
     fan-out** — they run only when the user picks that scope button, so heavyweight work never fires
     on a plain search:
     - _Source_ — full method-source substring (`searchMethodSource`), per-keystroke-when-scoped.
     - _Literals_ — user types a **compilable expression**; `referencesToLiteral` compiles it and
       finds methods referencing that value (interned literals match; a fresh String won't).
     - _Categories_ — class-category names; a whole-image scan (`getAllClassCategories`) so it
       **lazy-loads on first search**, not on picker open.

4. **Pluggable, savable match algorithm** (the issue asks for this). A pure matcher
   (`omniMatch.ts`) with modes `fuzzy` (subsequence, default) | `substring` | `prefix`, plus
   case-sensitivity — read from settings (`gemstone.omniSearch.matchMode`,
   `…caseSensitive`). Ranges are returned for future highlighting.

5. **Trigger.** VS Code cannot bind _double-tap-Shift_ (keybindings are chords, not
   double-taps), so we ship a command `gemstone.omniSearch` + a default keybinding
   **`ctrl+shift+a`** (`cmd+shift+a` on macOS)
   (`when: gemstone.hasActiveSession && !terminalFocus` — a Jasper window, not the terminal),
   configurable, plus a palette entry. A single simultaneous chord (not a sequential `ctrl+k` two-step)
   that stays clear of the notebook cell-run gestures (`shift+enter` / `ctrl+enter` / `alt+enter`) — an
   earlier `shift+enter` default shadowed the notebook's run-cell. The double-Shift
   aspiration is noted as a follow-up (would need a fragile keystroke hack). The primary-gesture hints
   ("Enter to open · Alt+Enter for references") ride in the **placeholder**, not the title — greyed and
   gone as soon as you type, keeping the title focused on the filter.

5b. **Reference Search (Wishlist Task 1).** A result you find can pivot to "who references it": a
   **method** row → **senders** of its selector, a **class** row → **references to** it (via the shared
   `sendersOf`/`referencesToObject` queries). Two entry points, both minimal-friction: the per-row **↗
   button** (`onDidTriggerItemButton`), and **`alt+enter`** on the highlighted row — a keybinding gated
   on a `gemstone.omniSearchActive` context key set only while the picker is open, dispatched to the
   open controller's `pivotActiveItem`. The pivot swaps the title to a breadcrumb + a Back button;
   typing filters the reference rows client-side; Back restores the prior search. (`references.ts` is
   the pure glue; the controller owns the pivot state.)

5c. **A scope belongs to the search, not to a references view** (#20). The pivot is not a search: it
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
   overload the clear gesture, the breadcrumb carries the exit: `PIVOT_EXIT_HINT` ("Esc to go back") is
   appended to `OmniViewData.pivotTitle`. It is deliberately **not** added to `ReferencePreview.title`
   — in `referencesInPreview` mode there is no pivot and `Esc` closes the panel, so the same words
   there would be false. ⚠️ The hint is only as visible as the breadcrumb: while `#breadcrumb` carries
   a stylesheet `display: none` that the view tries to undo by clearing an *inline* style, it renders
   nowhere at all.

6. **Scope filtering** ("filter buttons on top", per the issue). Native QuickPick can't render a row
   of labeled toggle buttons or a pressed state, so scope is expressed with **title buttons**: one
   icon button per enabled category plus an "All" button (`buildScopeButtons`). Clicking one narrows
   the search to that category and re-runs the current term; the active scope is reflected in the
   picker **title** (`Omni Search — Methods`), since the buttons themselves can't show which is
   selected. The labeled filter-button row (and any typed-prefix scoping) is part of the Phase-2
   webview.

## Module map (`client/src/omniSearch/`)

| File                                | Responsibility                                             | Stone?    | Unit-tested              |
| ----------------------------------- | ---------------------------------------------------------- | --------- | ------------------------ |
| `omniMatch.ts`                      | pure matcher/ranker (modes, score, ranges)                 | no        | ✅                       |
| `omniTypes.ts`                      | `OmniProvider`, `OmniResult`, `OmniCategory`, config types | no        | —                        |
| `omniConfig.ts`                     | read `gemstone.omniSearch.*` → typed `OmniConfig`          | no        | ✅                       |
| `providers/classesProvider.ts`      | classes (load-once + match)                                | preload   | ✅ (match/parse)         |
| `providers/dictionariesProvider.ts` | dictionaries (load-once + match)                           | preload   | ✅                       |
| `providers/methodsProvider.ts`      | selector search (per-query)                                | per-query | ✅ (builder/parse)       |
| `omniSearchController.ts`           | QuickPick orchestration: debounce, scope, group, activate  | no        | ✅ (mocked QP+providers) |
| `omniSearchCommand.ts`              | entry: resolve session, wire providers, show               | no        | thin                     |

New shared query (if needed) lives under `client/src/queries/` per repo convention.

## Settings (`gemstone.omniSearch.*`)

- `matchMode`: `fuzzy` | `substring` | `prefix` (default `fuzzy`)
- `caseSensitive`: boolean (default `false`)
- `categories`: which providers are enabled (default all)
- `maxResultsPerCategory`: number (default 20)
- `debounceMs`: number (default 120)

## Overlap with #377 / #387 (documented, not silently merged)

- **#377 (method-signature search in the Explorer):** its backend _is_ this feature's `methodsProvider`
  - `omniMatch`, scoped to a class/subtree. Built here to be reusable; #377 will be a **separate
    worktree/branch** that calls the scoped backend + adds the Explorer title button. No code moved
    between issues without a note in both.
- **#387 items 1–5 (funnel=filter, magnifier=find, wording):** the "find" affordance #387 wants to
  free up is the same entry point #377 adds. Kept out of this branch; noted for the #377/#387 work.

## Phase 2 — the webview "Spotter" (`ui: spotter`, default)

Phase 2 replaces the QuickPick CHROME with a webview panel while keeping the exact search behaviour.
The setting **`gemstone.omniSearch.ui`** switches between `spotter` (default) and `quickpick` so the
two can be A/B compared; the command/keybinding (`gemstone.omniSearch`, Ctrl/Cmd+Shift+A) is unchanged.

- **`omniEngine.ts`** — the search behaviour extracted from the QuickPick controller as a pure,
  `vscode`-free engine (scope, case, load-more/all, count, reference pivot → serialisable
  `OmniViewData`). Reused by the panel; the QuickPick controller is untouched. Unit-tested.
- **`omniSearchPanel.ts`** — the `vscode` shell: panel lifecycle, HTML/CSS, and the message pump
  between the webview and the engine + injected activation/preview callbacks (built stone-bound by
  the command layer). One panel at a time; opens in an editor tab (VS Code has no floating-modal
  webview — that Pharo-Spotter float stays the QuickPick's domain).
- **`omniSearchView.js`** — the webview DOM (read at runtime, jsdom-tested like the other `*View.js`):
  labeled scope **tabs**, a **flat relevance-ranked** row list (see below), OUR case-correct
  **highlighting** (`<mark>`), an always-on **case indicator** chip, a **source-preview pane** (fills
  as the active row moves — the per-item "hover" a QuickPick can't do), a **clear (×)** button, a
  **pin (📌)** toggle, and an elegant footer **count + Load more/all** (not synthetic list rows). The
  cluttered field-hover gesture hint is intentionally NOT reproduced.

Behaviour decisions (Eric's review of the first cut):

- **Dialog, not a persistent tab.** Unpinned (default) the panel closes on focus-out and on picking
  a result — the same "click away and it's gone" feel as the QuickPick. The **📌 pin** keeps it open
  as a tab for people who always want it up (and switches activation to open-beside). It still renders
  in the editor area — VS Code has no floating-modal webview — but *behaves* like a dialog.
- **Flat, globally relevance-ranked results — no category grouping.** Typing "foo" should surface the
  closest "foo" first regardless of kind, so `buildView` ranks every result together by match score.
  Each row wears a small **category tag** (Class / Method / Global / …) so you still see what it is.
  (Grouping/dividers were tried and dropped; re-grouping later is a pure view concern.)
- **Scroll resets to the top** on a fresh query / clear / scope / case change, but NOT on Load-more.
- **Activation:** unpinned Enter opens in the active group and dismisses the Spotter; pinned, Enter
  opens beside and Ctrl+Enter opens beside keeping the field focused. Alt+Enter → references; ←/Esc →
  back/close; the × clears without closing.

Task status against the pinned Phase-2 plan: **1 (webview)**, **2 (own highlights)**, **4 (case
indicator)** done; **3 (hover)** delivered as a preview pane; **5 (count)** shows an exact count once
Load-all makes it exact, else `N+` (a true pre-count query stays a follow-up).

## Deferred / follow-ups (explicitly NOT in this issue)

- Phase-2 **webview Spotter** (labeled filter-button row, inspector preview, screenshots' look).
- **Recents / empty-state** (IntelliJ shows recent files when the field is empty).
- **Top-hit** promotion; result **highlight ranges** rendering (matcher already returns ranges).
- Extra providers: **senders/implementors, commands, settings, globals/variables**.
- **Double-tap-Shift** trigger.
- Live **integration tests** against a stone (this branch is unit-tested only; no stone provisioned).

## Testing

Unit-only (no stone provisioned — other Claude sessions are live). Every pure module is tested;
query providers test the generated Smalltalk + result parsing against a mocked `QueryExecutor`
(the `methodSearch.test.ts` pattern); the controller is tested against the mocked `createQuickPick`
and fake providers. Full `npm test` (which hits a stone) is intentionally NOT run here.
