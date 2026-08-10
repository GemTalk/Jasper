/**
 * Orchestrates the Omni Search QuickPick: parse the scope sigil, fan out to the in-scope providers,
 * group the ranked results under category separators, and activate the chosen result.
 *
 * We set `alwaysShow: true` on every item so VS Code's built-in filter does NOT re-filter our
 * already-matched, already-ranked list — our matcher is authoritative, which is what lets scope
 * sigils (`c `, `m `, …) and the fuzzy order survive the native list. The pure pieces
 * (`parseScope` / `gatherResults` / `buildItems`) are exported and unit-tested; the event wiring is
 * a thin shell that uses optional chaining so it also runs against the test's QuickPick mock.
 */
import * as vscode from 'vscode';
import {
  OMNI_CATEGORIES,
  OmniCancel,
  OmniCategoryId,
  OmniConfig,
  OmniProvider,
  OmniResult,
} from './omniTypes';

export interface OmniQuickItem extends vscode.QuickPickItem {
  result?: OmniResult;
}

const SIGIL_TO_ID: ReadonlyMap<string, OmniCategoryId> = new Map(
  OMNI_CATEGORIES.map((c) => [c.sigil, c.id]),
);

/**
 * Split a raw field value into an optional scope + the search term. A leading single-letter sigil
 * followed by a space (`c `, `m `, `d `, `e `) scopes to that category IF it is enabled; otherwise
 * the whole value is the term. Case-insensitive on the sigil.
 */
export function parseScope(
  value: string,
  enabled: readonly OmniCategoryId[],
): { scopeId: OmniCategoryId | null; term: string } {
  const m = /^([a-zA-Z]) (.*)$/.exec(value);
  if (m) {
    const id = SIGIL_TO_ID.get(m[1].toLowerCase());
    if (id && enabled.includes(id)) return { scopeId: id, term: m[2].trim() };
  }
  return { scopeId: null, term: value.trim() };
}

/** The enabled providers that are in scope: all of them, or just the scoped one. */
export function providersInScope(
  providers: readonly OmniProvider[],
  scopeId: OmniCategoryId | null,
): OmniProvider[] {
  return providers.filter((p) => scopeId === null || p.category.id === scopeId);
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
 * Lay results out as QuickPick items grouped by category (in canonical order), each group preceded
 * by a separator. Empty categories produce no separator. `result` is attached to each row so the
 * accept handler can activate it.
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
  onError?: (message: string) => void;
}

export interface OmniController {
  /** Prime load-once providers and show the picker. */
  start(): Promise<void>;
  /** Re-run the search for a raw field value (exposed for tests + the debounced handler). */
  refresh(rawValue: string): Promise<void>;
  dispose(): void;
}

const SCOPE_LABEL: Record<OmniCategoryId | 'all', string> = {
  all: 'everything',
  classes: 'classes',
  methods: 'methods',
  dictionaries: 'dictionaries',
  openEditors: 'open editors',
};

export function createOmniController(deps: OmniControllerDeps): OmniController {
  const { quickPick: qp, providers, config, activate } = deps;
  const disposables: vscode.Disposable[] = [];
  let generation = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const placeholderFor = (scopeId: OmniCategoryId | null): string => {
    const scope = SCOPE_LABEL[scopeId ?? 'all'];
    return `Search ${scope}…  (prefix c/m/d/e + space to scope)`;
  };

  async function refresh(rawValue: string): Promise<void> {
    const { scopeId, term } = parseScope(rawValue, config.enabledCategories);
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
      const results = await gatherResults(term, inScope, config, token);
      if (token.isCancelled) return; // a newer keystroke superseded this run
      qp.items = buildItems(results);
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

  const track = (d: vscode.Disposable | undefined): void => {
    if (d) disposables.push(d);
  };

  async function start(): Promise<void> {
    qp.placeholder = placeholderFor(null);
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;

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

    track(qp.onDidChangeValue?.((v: string) => scheduleRefresh(v)));
    track(
      qp.onDidAccept?.(() => {
        const picked = qp.selectedItems[0];
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

  return { start, refresh, dispose };
}
