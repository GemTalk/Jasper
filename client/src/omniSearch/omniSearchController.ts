/**
 * Orchestrates the Omni Search QuickPick: hold the active scope (set by the title buttons), fan out
 * to the in-scope providers, group the ranked results under category separators, and activate the
 * chosen result.
 *
 * Scope is a native QuickPick affordance: one title button per enabled category plus an "All"
 * button (`buildScopeButtons`). Clicking one narrows the search to that category and re-runs the
 * current term; the active scope is reflected in the picker title. (VS Code's QuickPick can render
 * icon title buttons but not labeled tabs or a pressed state — the labeled filter-button row is the
 * deferred Phase-2 webview.)
 *
 * We set `alwaysShow: true` on every item so VS Code's built-in filter does NOT re-filter our
 * already-matched, already-ranked list — our matcher is authoritative. The pure pieces
 * (`buildScopeButtons` / `providersInScope` / `gatherResults` / `buildItems`) are exported and
 * unit-tested; the event wiring is a thin shell that uses optional chaining so it also runs against
 * the test's QuickPick mock, and `setScope` is exposed so the button behavior is testable directly.
 */
import * as vscode from 'vscode';
import {
  CATEGORY_BY_ID,
  OMNI_CATEGORIES,
  OmniCancel,
  OmniCategory,
  OmniCategoryId,
  OmniConfig,
  OmniProvider,
  OmniResult,
} from './omniTypes';
import { match, compareMatches } from './omniMatch';
import { referenceRequestFor } from './references';

export interface OmniQuickItem extends vscode.QuickPickItem {
  result?: OmniResult;
  /** True on the synthetic "Load more…" row appended when a search fills its display cap. */
  loadMore?: boolean;
  /** True on the synthetic "Load all" row (jumps the cap to everything). */
  loadAll?: boolean;
}

/** A result the reference pivot loaded: its breadcrumb title + the reference rows. */
export interface ReferenceView {
  title: string;
  results: OmniResult[];
}

/** A QuickPick title button tagged with the scope it selects (`null` = the "All" button). */
export interface ScopeButton extends vscode.QuickInputButton {
  scopeId: OmniCategoryId | null;
}

/**
 * The scope title buttons: one button per enabled category, plus — only while a scope is active — a
 * leading "Clear filter" button that resets to searching everything. The clear button is shown
 * conditionally (rather than a permanent "All") so the picker's chrome reflects whether a filter is
 * on; the active filter's name is also shown in the title (`titleForScope`).
 */
export function buildScopeButtons(
  enabled: readonly OmniCategoryId[],
  activeScope: OmniCategoryId | null,
): vscode.QuickInputButton[] {
  const toButton = (c: OmniCategory): ScopeButton => ({
    iconPath: new vscode.ThemeIcon(c.icon),
    // Explicit-only categories START a search (you must pick them first); the rest FILTER the live
    // results. The verb signals which is which, reinforced by the divider between the two groups.
    tooltip: c.explicitOnly
      ? `Search ${c.label.toLowerCase()}…`
      : `Filter to ${c.label.toLowerCase()}`,
    scopeId: c.id,
  });
  const cats = OMNI_CATEGORIES.filter((c) => enabled.includes(c.id));
  const filters = cats.filter((c) => !c.explicitOnly).map(toButton);
  const searches = cats.filter((c) => c.explicitOnly).map(toButton);

  const buttons: vscode.QuickInputButton[] = [];
  if (activeScope !== null) {
    const clear: ScopeButton = {
      iconPath: new vscode.ThemeIcon('clear-all'),
      tooltip: 'Clear filter — search everything',
      scopeId: null,
    };
    buttons.push(clear);
  }
  buttons.push(...filters);
  // A non-interactive divider marking the boundary between the FILTER buttons (left) and the SEARCH
  // buttons (right, which start a heavyweight search). QuickPick can't group title buttons, so this
  // pseudo-button just draws the line; it has no scopeId, so a click on it is ignored.
  if (filters.length > 0 && searches.length > 0) {
    buttons.push({
      iconPath: new vscode.ThemeIcon('kebab-vertical'),
      tooltip: 'Left: filters · Right: searches — pick one to start a search',
    });
  }
  buttons.push(...searches);
  return buttons;
}

/** The enabled providers that are in scope. Under the all-scope (`null`), explicit-only categories
 *  (heavyweight, e.g. Source) are excluded so they don't run on every keystroke — they only fire when
 *  the user scopes directly to them. When a scope is set, exactly that category runs. */
export function providersInScope(
  providers: readonly OmniProvider[],
  scopeId: OmniCategoryId | null,
): OmniProvider[] {
  if (scopeId === null) return providers.filter((p) => !p.category.explicitOnly);
  return providers.filter((p) => p.category.id === scopeId);
}

/** Run each in-scope provider and collect its results (each already ranked + capped). */
export async function gatherResults(
  term: string,
  providers: readonly OmniProvider[],
  cfg: OmniConfig,
  token: OmniCancel,
): Promise<OmniResult[]> {
  const all: OmniResult[] = [];
  for (const p of providers) {
    if (token.isCancelled) break;
    const part = await p.search(term, cfg, token);
    all.push(...part);
  }
  return all;
}

/**
 * The reference button shown on a result row, if that result is referenceable (a class or method).
 * Its tooltip is the adaptive breadcrumb ("Senders of foo" / "References to Bar") so a single glance
 * says what the pivot will do. Rows with no reference sense (dictionaries) get no button.
 */
function referenceButtonFor(result: OmniResult): vscode.QuickInputButton[] | undefined {
  const req = referenceRequestFor(result);
  if (!req) return undefined;
  return [{ iconPath: new vscode.ThemeIcon('references'), tooltip: req.title }];
}

/**
 * Lay results out as QuickPick items grouped by category (in canonical order), each group preceded
 * by a separator. Empty categories produce no separator. `result` is attached to each row so the
 * accept handler can activate it, and referenceable rows carry the reference (↗) button.
 */
export function buildItems(results: readonly OmniResult[]): OmniQuickItem[] {
  const items: OmniQuickItem[] = [];
  for (const cat of OMNI_CATEGORIES) {
    const rows = results.filter((r) => r.categoryId === cat.id);
    if (rows.length === 0) continue;
    items.push({ label: cat.label, kind: vscode.QuickPickItemKind.Separator });
    for (const r of rows) {
      items.push({
        label: r.label,
        description: r.description,
        detail: r.detail,
        iconPath: new vscode.ThemeIcon(cat.icon),
        alwaysShow: true,
        buttons: referenceButtonFor(r),
        result: r,
      });
    }
  }
  return items;
}

export interface OmniControllerDeps {
  quickPick: vscode.QuickPick<OmniQuickItem>;
  providers: readonly OmniProvider[];
  config: OmniConfig;
  activate: (result: OmniResult) => void | Promise<void>;
  /** Load the references/senders of a result (senders of a method, references to a class). Omit to
   *  disable the reference pivot. Returns null when the result isn't referenceable. */
  resolveReferences?: (result: OmniResult) => Promise<ReferenceView | null> | ReferenceView | null;
  /** Notified when the reference view opens (`true`) or closes (`false`) — the command layer uses it
   *  to toggle the context key that scopes the Left-arrow "back" keybinding to the pivot. */
  onPivotChange?: (inPivot: boolean) => void;
  onError?: (message: string) => void;
}

export interface OmniController {
  /** Prime load-once providers and show the picker. */
  start(): Promise<void>;
  /** Re-run the search for a raw field value (exposed for tests + the debounced handler). */
  refresh(rawValue: string): Promise<void>;
  /** Narrow (or, with `null`, widen back to all) the active scope and re-run the current term. */
  setScope(scopeId: OmniCategoryId | null): Promise<void>;
  /** Pivot the list to the references/senders of a result (exposed for tests + the ↗ button). */
  pivotToReferences(result: OmniResult): Promise<void>;
  /** Pivot on the currently-highlighted row (the Alt+Enter keybinding target). No-op if none. */
  pivotActiveItem(): Promise<void>;
  /** Leave the reference view and restore the prior search (exposed for tests + the Back button). */
  exitPivot(): Promise<void>;
  /** Toggle case-sensitive matching and re-run (exposed for tests + the case toggle button). */
  toggleCase(): Promise<void>;
  /** Grow the scoped result cap and re-run (exposed for tests + the "Load more…" row). */
  loadMore(): Promise<void>;
  /** Jump the result cap to everything and re-run (exposed for tests + the "Load all" row). */
  loadAll(): Promise<void>;
  dispose(): void;
}

// "Load all" jumps the display cap here — big enough to mean "everything" in practice; the true
// ceiling is each provider's own server fetch cap (a few hundred), so this never runs away.
const LOAD_ALL_LIMIT = 100_000;

const SCOPE_LABEL: Record<OmniCategoryId | 'all', string> = {
  all: 'everything',
  classes: 'classes',
  methods: 'methods',
  dictionaries: 'dictionaries',
  globals: 'globals',
  source: 'source',
  literals: 'literals',
  categories: 'categories',
};

/** Picker title reflecting the active scope, e.g. `Omni Search` (all) or `Omni Search — Methods`. */
export function titleForScope(scopeId: OmniCategoryId | null): string {
  return scopeId === null ? 'Omni Search' : `Omni Search — ${CATEGORY_BY_ID[scopeId].label}`;
}

export function createOmniController(deps: OmniControllerDeps): OmniController {
  const { quickPick: qp, providers, config, activate } = deps;
  const disposables: vscode.Disposable[] = [];
  let generation = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let scopeId: OmniCategoryId | null = null;
  let lastRawValue = '';
  // When non-null, the list is showing the references/senders of a result (a "pivot"), not a live
  // search. Typing filters within these rows; the Back button restores the prior search.
  let pivot: ReferenceView | null = null;
  // Live case-sensitivity (seeded from settings, toggled by the case button).
  let caseSensitive = config.caseSensitive;
  // Per-search display cap; grows when the user clicks "Load more…", resets when the term changes.
  let scopeLimit = config.maxResultsPerCategory;

  // The effective config for a search run: the static settings, overlaid with the live case toggle
  // and the current (possibly grown-by-"Load more") result cap.
  const effectiveConfig = (): OmniConfig => ({
    ...config,
    caseSensitive,
    maxResultsPerCategory: scopeLimit,
  });

  // The gesture hints ride in the (greyed) placeholder, not the title: it teaches on open and then
  // disappears as soon as you type — once learned, it's out of the way, and the title stays focused
  // on the filter. An explicit-only scope shows its own instruction (what to type + an example) so it
  // reads as a search you start, not a filter over existing rows.
  const placeholderFor = (id: OmniCategoryId | null): string => {
    if (id) {
      const hint = CATEGORY_BY_ID[id].searchHint;
      if (hint) return `${hint}   ·   Enter to open`;
    }
    return `Search ${SCOPE_LABEL[id ?? 'all']}…   Enter to open · Alt+Enter for references`;
  };

  const backButton = (): vscode.QuickInputButton & { back: true } => ({
    iconPath: new vscode.ThemeIcon('arrow-left'),
    tooltip: 'Back to search',
    back: true,
  });

  const caseButton = (): vscode.QuickInputButton & { toggleCase: true } => ({
    iconPath: new vscode.ThemeIcon('case-sensitive'),
    tooltip: caseSensitive
      ? 'Case-sensitive matching: ON — click to turn off'
      : 'Case-sensitive matching: OFF — click to turn on',
    toggleCase: true,
  });

  // The full title-bar button set for the search view: the scope buttons (+ divider) plus the
  // case-sensitivity toggle on the end.
  const searchButtons = (): vscode.QuickInputButton[] => [
    ...buildScopeButtons(config.enabledCategories, scopeId),
    caseButton(),
  ];

  // The two "load" rows shown when a search filled its cap. Both carry the running shown-count so the
  // user sees how many are on screen; "Load all" jumps to everything (bounded by the server fetch
  // caps) so they don't have to click "Load more" repeatedly.
  const loadMoreItem = (shown: number): OmniQuickItem => ({
    label: '$(chevron-down) Load more…',
    detail: `Showing ${shown} — more available`,
    alwaysShow: true,
    loadMore: true,
  });
  const loadAllItem = (shown: number): OmniQuickItem => ({
    label: '$(unfold) Load all',
    detail: `Showing ${shown} — more available`,
    alwaysShow: true,
    loadAll: true,
  });

  // Append a visible case-sensitivity marker to a title when it's ON (the button alone gives no
  // at-a-glance state). Nothing is added in the default OFF state, so the title stays clean.
  const decorateTitle = (base: string): string => (caseSensitive ? `${base}   ·   Aa` : base);

  /** Client-side filter of the pivot rows by the typed term (empty term = show them all). */
  function filterPivot(rows: readonly OmniResult[], term: string): OmniResult[] {
    if (term.length === 0) return [...rows];
    const scored: OmniResult[] = [];
    for (const r of rows) {
      const m = match(term, r.label, {
        mode: config.matchMode,
        caseSensitive,
      });
      if (m) scored.push({ ...r, score: m.score, ranges: m.ranges });
    }
    scored.sort((a, b) =>
      compareMatches({ score: a.score, label: a.label }, { score: b.score, label: b.label }),
    );
    return scored;
  }

  async function refresh(rawValue: string): Promise<void> {
    // In the reference view, typing filters the loaded rows client-side — no provider fan-out, and
    // don't touch `lastRawValue` (it holds the search to restore when the pivot is dismissed).
    if (pivot) {
      qp.items = buildItems(filterPivot(pivot.results, rawValue.trim()));
      return;
    }
    lastRawValue = rawValue;
    const term = rawValue.trim();
    qp.placeholder = placeholderFor(scopeId);
    // Empty term: show nothing rather than dumping the whole image (recents is a follow-up).
    // Bump the generation so any in-flight search is superseded — otherwise a slow query dispatched
    // just before the field was cleared would resolve and repopulate the just-emptied list.
    if (term.length === 0) {
      ++generation;
      qp.items = [];
      qp.busy = false;
      return;
    }
    const gen = ++generation;
    const token: OmniCancel = {
      get isCancelled() {
        return gen !== generation;
      },
    };
    qp.busy = true;
    try {
      const inScope = providersInScope(providers, scopeId);
      const results = await gatherResults(term, inScope, effectiveConfig(), token);
      if (token.isCancelled) return; // a newer keystroke superseded this run
      const items = buildItems(results);
      // Offer "Load more" whenever ANY category filled its cap (so it works in the all-scope too, not
      // just a single scope). Growing the cap re-runs every in-scope provider with more headroom.
      const perCategory = new Map<string, number>();
      for (const r of results)
        perCategory.set(r.categoryId, (perCategory.get(r.categoryId) ?? 0) + 1);
      if ([...perCategory.values()].some((n) => n >= scopeLimit)) {
        items.push(loadMoreItem(results.length), loadAllItem(results.length));
      }
      qp.items = items;
    } catch (e: unknown) {
      if (!token.isCancelled) {
        qp.items = [];
        deps.onError?.(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (!token.isCancelled) qp.busy = false;
    }
  }

  function scheduleRefresh(value: string): void {
    if (debounce) clearTimeout(debounce);
    if (config.debounceMs <= 0) {
      void refresh(value);
      return;
    }
    debounce = setTimeout(() => void refresh(value), config.debounceMs);
  }

  async function setScope(newScope: OmniCategoryId | null): Promise<void> {
    scopeId = newScope;
    scopeLimit = config.maxResultsPerCategory; // a fresh scope starts at the base cap
    qp.title = decorateTitle(titleForScope(scopeId));
    // Rebuild so the Clear-filter button appears/disappears with the active scope.
    qp.buttons = searchButtons();
    await refresh(lastRawValue);
  }

  async function toggleCase(): Promise<void> {
    caseSensitive = !caseSensitive;
    qp.title = decorateTitle(titleForScope(scopeId)); // show/hide the "Aa" marker
    qp.buttons = searchButtons(); // refresh the toggle's tooltip
    await refresh(lastRawValue);
  }

  async function loadMore(): Promise<void> {
    // Grow the cap and re-run WITHOUT going through onDidChangeValue (which would reset it).
    scopeLimit += config.maxResultsPerCategory;
    await refresh(lastRawValue);
  }

  async function loadAll(): Promise<void> {
    // Jump the cap to effectively everything (real ceiling is the providers' server fetch caps).
    scopeLimit = LOAD_ALL_LIMIT;
    await refresh(lastRawValue);
  }

  async function pivotToReferences(result: OmniResult): Promise<void> {
    if (!deps.resolveReferences) return;
    ++generation; // supersede any in-flight search so its late result can't land over the pivot
    qp.busy = true;
    try {
      const view = await deps.resolveReferences(result);
      if (!view) return; // not referenceable — leave the current list as-is
      pivot = view;
      deps.onPivotChange?.(true);
      qp.title = decorateTitle(view.title); // breadcrumb, e.g. "Senders of printString"
      qp.buttons = [backButton()];
      qp.value = ''; // fresh filter box over the reference rows
      qp.placeholder = 'Filter these results · ← back to search';
      qp.items = buildItems(view.results);
    } catch (e: unknown) {
      deps.onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      qp.busy = false;
    }
  }

  async function pivotActiveItem(): Promise<void> {
    const active = qp.activeItems[0];
    if (active?.result) await pivotToReferences(active.result);
  }

  async function exitPivot(): Promise<void> {
    if (!pivot) return;
    pivot = null;
    deps.onPivotChange?.(false);
    qp.title = decorateTitle(titleForScope(scopeId));
    qp.buttons = searchButtons();
    qp.value = lastRawValue;
    await refresh(lastRawValue);
  }

  const track = (d: vscode.Disposable | undefined): void => {
    if (d) disposables.push(d);
  };

  async function start(): Promise<void> {
    qp.title = decorateTitle(titleForScope(scopeId));
    qp.placeholder = placeholderFor(scopeId);
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;
    qp.buttons = searchButtons();

    // Prime load-once providers concurrently (best-effort; a failing prime just yields no results).
    qp.busy = true;
    await Promise.all(
      providers.map(async (p) => {
        try {
          await p.prime?.({ isCancelled: false });
        } catch (e: unknown) {
          deps.onError?.(e instanceof Error ? e.message : String(e));
        }
      }),
    );
    qp.busy = false;

    track(
      qp.onDidChangeValue?.((v: string) => {
        scopeLimit = config.maxResultsPerCategory; // a new term starts back at the base cap
        scheduleRefresh(v);
      }),
    );
    track(
      qp.onDidTriggerButton?.((button: vscode.QuickInputButton) => {
        if ('back' in button) void exitPivot();
        else if ('toggleCase' in button) void toggleCase();
        else if ('scopeId' in button) void setScope((button as ScopeButton).scopeId);
        // A button with none of those (the divider) is inert.
      }),
    );
    track(
      qp.onDidTriggerItemButton?.((e: vscode.QuickPickItemButtonEvent<OmniQuickItem>) => {
        if (e.item.result) void pivotToReferences(e.item.result);
      }),
    );
    track(
      qp.onDidAccept?.(() => {
        const picked = qp.selectedItems[0];
        if (picked?.loadMore) {
          void loadMore();
          return;
        }
        if (picked?.loadAll) {
          void loadAll();
          return;
        }
        if (picked?.result) {
          const r = picked.result;
          qp.hide();
          // Activation touches vscode + the fs-provider (buildMethodUri can throw, showTextDocument
          // can reject) — route any failure to onError instead of an unhandled rejection.
          void Promise.resolve(activate(r)).catch((e: unknown) =>
            deps.onError?.(e instanceof Error ? e.message : String(e)),
          );
        }
      }),
    );
    track(qp.onDidHide?.(() => dispose()));
    qp.show();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (debounce) clearTimeout(debounce);
    for (const d of disposables) d.dispose();
    qp.dispose();
  }

  return {
    start,
    refresh,
    setScope,
    pivotToReferences,
    pivotActiveItem,
    exitPivot,
    toggleCase,
    loadMore,
    loadAll,
    dispose,
  };
}
