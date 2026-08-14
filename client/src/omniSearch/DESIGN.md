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
     **client-side**.
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
       so a raw expression is never eval'd against the stone (#428 #5).
     - _Categories_ — class-category names; a whole-image scan (`getAllClassCategories`) so it
       **lazy-loads on first search**, not on open.

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
   earlier `shift+enter` default shadowed the notebook's run-cell (#428 #2). The double-Shift aspiration
   is a follow-up (would need a fragile keystroke hack).

6. **Reference Search (Wishlist Task 1).** A result can pivot to "who references it": a **method** row →
   **senders** of its selector, a **class** row → **references to** it (via the shared
   `sendersOf` / `referencesToObject` queries). Two entry points: the per-row **↗ button** and
   **Alt+Enter** on the highlighted row. `references.ts` is the pure glue (no `vscode`, no session).
   The setting **`referencesInPreview`** (default `true`) shows the references as a sticky list in the
   preview pane, leaving the results list in place; set it `false` for the classic pivot that replaces
   the whole list (backed out with ← / Esc).

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
- `maxResultsPerCategory`: number (default `20`).
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
  so a raised "Load all" cap never silently persists into the next search (#428 #1/#6/#7).
- **Activation:** in the Spotter, unpinned Enter opens in the active group and dismisses it; pinned,
  Enter opens beside and Ctrl+Enter opens beside keeping the field focused. Alt+Enter → references.

## Overlap with #377 / #387 (documented, not silently merged)

- **#377 (method-signature search in the Explorer):** its backend _is_ this feature's `methodsProvider`
  \+ `omniMatch`, scoped to a class/subtree. Built here to be reusable; #377 is a **separate
  worktree/branch** that calls the scoped backend + adds the Explorer title button.
- **#387 items 1–5 (funnel=filter, magnifier=find, wording):** the "find" affordance #387 wants to
  free up is the same entry point #377 adds. Kept out of this branch; noted for the #377/#387 work.

## Deferred / follow-ups (tracked in issue #428)

- **Recents / empty-state** (IntelliJ shows recent files when the field is empty).
- **Top-hit** promotion.
- Corpus refresh: `prime()` loads the class/global/dictionary corpus **once**, so a class created after
  the UI opened won't appear until reopen (#428).
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
(`queries/__tests__/methodSearch.integration.test.ts`) covers the Literals symbol query (#428 #9).
