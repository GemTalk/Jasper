import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import * as queries from './browserQueries';

/** How long a class selection settles before its completions are fetched. Clicking
 *  through classes is a navigation gesture, so a prime must not fire once per row
 *  passed through on the way to the one wanted. */
const PRIME_DEBOUNCE_MS = 250;

export class GemStoneCompletionProvider implements vscode.CompletionItemProvider {
  private classNameCache = new Map<unknown, vscode.CompletionItem[]>();
  private selectorCache = new Map<string, vscode.CompletionItem[]>();
  private instVarCache = new Map<string, vscode.CompletionItem[]>();
  private primeTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The cache lifecycle lives here rather than at the call sites, because these
   * three maps are only correct for as long as the image they were read from is.
   *
   * Session selection and removal clear EVERYTHING rather than the entries for one
   * session. The two per-class maps are keyed by session id, but classNameCache is
   * keyed by the session HANDLE — deliberately, so a reconnect that hands back a new
   * handle cannot serve a class list from the old connection — and a handle cannot be
   * mapped back to the id being removed. A full clear is also what the workspace
   * symbol provider does on the same signal, and the cost is one refetch on the next
   * request. It doubles as the only bound on how much these maps hold: there is no
   * LRU or TTL, so without this a long session accumulated one selector array per
   * class ever browsed.
   */
  constructor(private sessionManager: SessionManager) {
    sessionManager.onDidChangeSelection(() => this.invalidateCache());
    sessionManager.onDidRemoveSession(() => this.invalidateCache());
  }

  invalidateCache(): void {
    this.classNameCache.clear();
    this.selectorCache.clear();
    this.instVarCache.clear();
  }

  /**
   * Drop one class's selectors and instance variables, for a compile that changed
   * exactly that class. Kept narrow on purpose: a compile is the commonest way these
   * go stale, and dropping all three maps over it would throw away the image-wide
   * class list — much the most expensive of the three to refetch — every time a
   * method is saved.
   */
  invalidateClass(sessionId: number, className: string): void {
    const key = `${sessionId}:${className}`;
    this.selectorCache.delete(key);
    this.instVarCache.delete(key);
  }

  /** Drop the image-wide class-name list, for a change that can add or remove a
   *  class rather than alter one. */
  invalidateClassNames(): void {
    this.classNameCache.clear();
  }

  /**
   * A method or class definition was just compiled at `uri`, so whatever that URI's
   * class had cached is now a version behind. A class-definition compile can also
   * introduce a name the class list has never seen, hence the second drop.
   *
   * The session is read off the URI's authority, which is where a `gemstone://` URI
   * carries the session it belongs to, and where the Explorer and GemStone Search
   * hooks registered beside this one read it from. NOT from the current selection:
   * with two sessions open, a compile can land on a document belonging to the one
   * that is not selected, and keying off the selection there would drop the SELECTED
   * session's entry and leave the genuinely stale one in the cache — worse than not
   * invalidating at all, because a cache was cleared and the staleness survived.
   */
  invalidateForCompiledUri(uri: vscode.Uri, definitionChanged = false): void {
    const sessionId = parseInt(uri.authority, 10);
    const className = this.extractClassName(uri);
    if (!Number.isNaN(sessionId) && className) this.invalidateClass(sessionId, className);
    if (definitionChanged) this.invalidateClassNames();
  }

  /**
   * Warm a class's completions ahead of the first request for them.
   *
   * Selecting a class in the Explorer is the strongest available signal that its
   * methods are about to be read or edited, and provideCompletionItems is
   * SYNCHRONOUS — the first request for a class pays getAllSelectors and
   * getInstVarNames inline, on the keystroke. Priming here is about removing that
   * stall, not merely moving it.
   *
   * Deliberately not seeded from the class's own selectors, which the Explorer
   * already has in hand: completion asks for `allSelectors`, which includes the
   * inherited chain and is a strictly larger set. A warm-but-partial list is worse
   * than a cold correct one, because nothing would later notice it was short.
   *
   * Warms the session the class was selected IN, which the Explorer passes through,
   * rather than whatever is selected when the debounce expires: the two can differ,
   * because the fetch is deliberately a quarter-second behind the gesture.
   *
   * Best-effort throughout. Debounced, so clicking through classes does not fire a
   * fetch per row; off the gesture, so selection stays immediate; and failures are
   * swallowed exactly as the fetches below already swallow them — a prime that does
   * not happen costs a slow first completion, which is where this started.
   */
  primeClass(sessionId: number, className: string): void {
    if (this.primeTimer) clearTimeout(this.primeTimer);
    this.primeTimer = setTimeout(() => {
      this.primeTimer = undefined;
      // Gone in the meantime (logged out, session closed) — nothing to warm, and the
      // caches for it were cleared by onDidRemoveSession anyway.
      const session = this.sessionManager.getSession(sessionId);
      if (!session) return;
      // Straight through the same getters the provider uses, so a primed entry is
      // byte-for-byte what a request would have cached and can never disagree with it.
      this.getInstVarItems(session, className);
      this.getSelectorItems(session, className);
    }, PRIME_DEBOUNCE_MS);
  }

  /** Cancels a prime still waiting out its debounce. */
  dispose(): void {
    if (this.primeTimer) clearTimeout(this.primeTimer);
    this.primeTimer = undefined;
  }

  provideCompletionItems(document: vscode.TextDocument): vscode.CompletionItem[] {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return [];

    const items: vscode.CompletionItem[] = [];

    items.push(...this.getClassNameItems(session));

    const className = this.extractClassName(document.uri);
    if (className) {
      items.push(...this.getInstVarItems(session, className));
      items.push(...this.getSelectorItems(session, className));
    }

    return items;
  }

  private extractClassName(uri: vscode.Uri): string | null {
    if (uri.scheme !== 'gemstone') return null;
    const parts = uri.path.split('/').filter((s) => s.length > 0);
    // path: /{dictName}/{className}/{side}/{category}/{selector}
    if (parts.length < 2) return null;
    return decodeURIComponent(parts[1]);
  }

  private getClassNameItems(session: ActiveSession): vscode.CompletionItem[] {
    const cached = this.classNameCache.get(session.handle);
    if (cached) return cached;

    try {
      const entries = queries.getAllClassNames(session);
      const seen = new Set<string>();
      const items: vscode.CompletionItem[] = [];
      for (const e of entries) {
        if (seen.has(e.className)) continue;
        seen.add(e.className);
        const item = new vscode.CompletionItem(e.className, vscode.CompletionItemKind.Class);
        item.detail = e.dictName;
        items.push(item);
      }
      this.classNameCache.set(session.handle, items);
      return items;
    } catch {
      return [];
    }
  }

  private getInstVarItems(session: ActiveSession, className: string): vscode.CompletionItem[] {
    const key = `${session.id}:${className}`;
    const cached = this.instVarCache.get(key);
    if (cached) return cached;

    try {
      const names = queries.getInstVarNames(session, className);
      const items = names.map((name) => {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Field);
        item.detail = `${className} inst var`;
        return item;
      });
      this.instVarCache.set(key, items);
      return items;
    } catch {
      return [];
    }
  }

  private getSelectorItems(session: ActiveSession, className: string): vscode.CompletionItem[] {
    const key = `${session.id}:${className}`;
    const cached = this.selectorCache.get(key);
    if (cached) return cached;

    try {
      const selectors = queries.getAllSelectors(session, className);
      const items = selectors.map(
        (sel) => new vscode.CompletionItem(sel, vscode.CompletionItemKind.Method),
      );
      this.selectorCache.set(key, items);
      return items;
    } catch {
      return [];
    }
  }
}
