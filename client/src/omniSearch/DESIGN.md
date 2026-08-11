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
icon, isEnabled, search(query, token) }`. Basic providers: **Classes, Methods, Dictionaries**.
   Adding a category later (senders/implementors, commands, settings, globals) is a new provider —
   no controller change. (An Open Editors provider shipped initially but was **dropped** — the open-tab
   list is tiny, and VS Code's own Open Editors view already covers it, so filtering/searching it here
   was noise.)

3. **Load-once vs per-query providers** (performance — omni runs on every keystroke):
   - _Classes_, _Dictionaries_: enumerate the stone **once** when the picker opens, then match
     **client-side** on each keystroke (reuses the existing `getAllClassNames` / `getDictionaryNames`
     approach that `Find Class` already uses — a proven, fast pattern).
   - _Methods_: the selector space is too large to preload, so this provider queries the stone
     **per search term** (debounced, min query length), reusing the `methodSearch` machinery.

4. **Pluggable, savable match algorithm** (the issue asks for this). A pure matcher
   (`omniMatch.ts`) with modes `fuzzy` (subsequence, default) | `substring` | `prefix`, plus
   case-sensitivity — read from settings (`gemstone.omniSearch.matchMode`,
   `…caseSensitive`). Ranges are returned for future highlighting.

5. **Trigger.** VS Code cannot bind _double-tap-Shift_ (keybindings are chords, not
   double-taps), so we ship a command `gemstone.omniSearch` + a default keybinding **`shift+enter`**
   (`when: gemstone.hasActiveSession && !terminalFocus` — a Jasper window, not the terminal),
   configurable, plus a palette entry. Trade-off: Shift+Enter is shadowed inside other text-input
   boxes (e.g. the SCM commit field); the conflict-free fallback is a `ctrl+k` chord. The double-Shift
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
