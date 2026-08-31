/**
 * GemStone Search as a bottom-PANEL webview view (`ui: "panel"`), alongside Terminal / Output. Unlike the
 * editor-tab Spotter it's a docked tool: no pin, no auto-close, no open-beside — activating a result
 * just opens it in the editor area ABOVE the panel, and the search stays put below. It shares all the
 * chrome + engine plumbing with the tab host via `omniSearchShared.ts`.
 *
 * The provider is registered once at activation, before any session exists, and the view can be shown
 * at any time — so it resolves the session + builds its (session-bound) engine LAZILY, rebuilding when
 * the session changes. `resolveContext` (built by the command layer) yields the current session's deps
 * or null when there's nothing to search.
 *
 * The cached engine also captures the `gemstone.omniSearch` settings that were live when it was built,
 * so the command layer calls `onConfigChanged()` (from an `onDidChangeConfiguration` listener) to drop
 * the engine when those settings change — otherwise a settings edit made while the panel is open would
 * be silently ignored until the session changed or the window reloaded. Switching the SELECTED session
 * calls `onSessionSelectionChanged()` for the same reason, and additionally wipes the webview: the
 * engine is rebuilt lazily either way, but until it is, everything on screen — query, results, pivot,
 * preview — belongs to a session the user has left (issue #517).
 *
 * Every catch-up is gated on the view being VISIBLE, because the engine outlives a hidden panel and
 * reloading its corpora costs image-wide synchronous GCI executes. A hidden panel therefore only notes
 * that it is out of date — a dropped engine for config, `syncPending` for a commit/abort,
 * `refreshPending` for an explicit refresh — and pays for it on the next reveal or webview message,
 * never on the hidden path itself.
 */
import * as vscode from 'vscode';
import { createOmniEngine, OmniEngine, OmniViewData } from './omniEngine';
import { OmniPanelDeps } from './omniSearchPanel';
import { revealTestForResult } from './omniActions';
import {
  CommonInbound,
  configMessage,
  dispatchEngineMessage,
  NO_SESSION_MESSAGE,
  renderOmniHtml,
  resultsMessage,
} from './omniSearchShared';

export const OMNI_VIEW_ID = 'gemstoneOmniSearchView';

/** How long `focus()` waits for the workbench to instantiate the view before reporting that the reveal
 *  did not land. This is a give-up bound for REPORTING, not an estimate of how long a reveal takes: the
 *  happy path returns the moment the view resolves, so a generous deadline costs the fast path nothing
 *  and buys patience on a slow or busy window (remote, WSL, a crowded activation). */
export const REVEAL_DEADLINE_MS = 5000;

/** The session-bound deps plus the id they were built for (so we rebuild when the session changes). */
export interface OmniViewContext {
  deps: OmniPanelDeps;
  sessionId: number;
}

/** Webview messages this host handles beyond the common engine ones. */
type PanelInbound = CommonInbound & { id?: number; side?: boolean; refId?: number };

export class OmniSearchViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private engine: OmniEngine | undefined;
  private deps: OmniPanelDeps | undefined;
  private builtForSession: number | undefined;
  // A focus() that arrives before the webview has loaded can't deliver `focusInput`; remember it and
  // replay once the webview signals `ready`, so the open shortcut always lands the cursor in the field.
  private focusPending = false;
  // A session sync that landed while the view was hidden: the cached corpora are stale but we have NOT
  // reloaded them yet (see onSessionSynced). Cleared by flushPendingSync, and whenever the engine is
  // dropped or rebuilt — a fresh engine primes its corpora, so there is nothing left to catch up on.
  private syncPending = false;
  // A `gemstone.search.refresh` that arrived while the panel was collapsed. Same bargain as syncPending
  // — don't pay three image-wide GCI executes to redraw a view nobody can see — but a refresh is the
  // stronger debt: it also re-fetches an open references list, so when both are outstanding this one
  // wins. Cleared by the flush, and whenever the engine is dropped or rebuilt (a fresh engine primes
  // every corpus, which is the reload this flag was owed).
  private refreshPending = false;
  // A newly resolved webview starts with none of the chrome state — no scope tabs, no case flag, no
  // debounce. `ensureEngine` pushes the config when it BUILDS an engine, which covers the first open
  // but not a reopen: collapsing the panel disposes the view, and the engine that outlives it still
  // matches the session, so ensureEngine short-circuits and the fresh webview is never told anything.
  // This flag makes the `ready` handler responsible for the push when the engine did not do it.
  private webviewNeedsConfig = false;
  // Fires when the workbench has actually instantiated the view. `focus()` waits on this rather than
  // inspecting `this.view`, which only reports whether the view has EVER been built (it is set once in
  // `resolveWebviewView` and never cleared) and so cannot tell a landed reveal from a lost one.
  private readonly onDidResolveView = new vscode.EventEmitter<void>();

  constructor(private readonly resolveContext: () => Promise<OmniViewContext | null>) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.webviewNeedsConfig = true; // brand-new webview, whether this is the first open or a reopen
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = renderOmniHtml({ showPin: false });
    view.webview.onDidReceiveMessage((m: PanelInbound) => void this.onMessage(m));
    // The engine is session-bound; rebuild it if the session changed while the view was hidden, and
    // catch up on any sync that we deliberately skipped while hidden.
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.onShown();
    });
    this.onDidResolveView.fire(); // the definitive "the view exists now" signal — see focus()
  }

  /** A `gemstone.omniSearch` setting changed: drop the cached engine (which baked in the old config)
   *  so it's rebuilt with the fresh config. If the view is visible, rebuild now so the change shows up
   *  live (scope tabs, case flag, limits); otherwise the next webview message rebuilds it lazily. */
  onConfigChanged(): void {
    this.engine = undefined;
    this.deps = undefined;
    this.builtForSession = undefined;
    this.syncPending = false; // the replacement engine primes from scratch
    this.refreshPending = false;
    if (this.view?.visible) void this.ensureEngine();
  }

  /** The user made a different session active (`SessionManager.onDidChangeSelection`). The engine is
   *  bound to a session, so it has to go — but unlike a config change this also invalidates everything
   *  the webview is showing: the results, the query that produced them, any references pivot and the
   *  previewed source were all read out of the session just left. Leaving them on screen is worse than
   *  showing nothing, because the rows still look live and activating one opens a document against the
   *  session that is now current. So the webview is reset as well as the engine.
   *
   *  Logging out of the last session lands here too (there is no context to resolve): the panel resets
   *  and, when visible, says to log in — rather than keeping the departed session's results.
   *
   *  A no-op when the selection lands back on the session we already built for — re-priming three
   *  image-wide GCI executes to arrive where we already are is exactly what `builtForSession` exists to
   *  avoid. */
  async onSessionSelectionChanged(): Promise<void> {
    const ctx = await this.resolveContext();
    if (this.engine && this.builtForSession !== ctx?.sessionId) {
      this.engine = undefined;
      this.deps = undefined;
      this.builtForSession = undefined;
      this.syncPending = false; // a replacement engine primes from scratch
      this.refreshPending = false;
      this.post({ command: 'reset' });
    }
    // Hidden: the next reveal or webview message builds the engine for the now-current session.
    if (this.view?.visible) await this.ensureEngine();
  }

  /** The user asked for a refresh (the panel's ⟳ button / `gemstone.search.refresh`): reload every
   *  cached corpus from the stone and re-run the current search.
   *
   *  This is the only way to pick up work done by EXECUTING code — a class created or removed from a
   *  workspace, a method compiled by evaluating `compileMethod:`, a new global. Those changes announce
   *  nothing the panel can listen for, so short of a commit or abort (which do trigger a resync) the
   *  cached corpora stay stale, and the staleness window has no upper bound. An explicit refresh closes
   *  it on demand (issue #517).
   *
   *  It clears any pending hidden sync, since a full reload is strictly more than that sync owed. And it
   *  calls the engine's `refresh` rather than its `resync`, which is what makes it re-fetch an open
   *  references list instead of leaving it stale (see the engine). */
  async refresh(): Promise<void> {
    // Never instantiated: there is nothing on screen to refresh, and building an engine here would pay
    // three image-wide GCI executes for a panel the user has not opened (the `gemstone.search.refresh`
    // command reaches both hosts, so this fires even when the Spotter is the chosen UI).
    if (!this.view) return;
    // Collapsed: the view is disposed, so the reload would pay those same three executes to post its
    // results to a webview nobody is looking at — the cost every other catch-up path in this file gates
    // on `visible` to avoid. The request is not dropped, though: note it and pay on the next reveal, so
    // the panel the user comes back to is the fresh one they asked for.
    if (!this.view.visible) {
      this.refreshPending = true;
      return;
    }
    await this.reload();
  }

  /** The reload itself, with no visibility gate. Reached from `refresh()` once the panel is known to be
   *  on screen, from the flush when a collapsed panel reopens, and from the webview's own ⟳ button —
   *  which is proof enough on its own that someone is looking. */
  private async reload(): Promise<void> {
    if (!(await this.ensureEngine())) return;
    this.syncPending = false;
    this.refreshPending = false;
    this.post({ command: 'busy', on: true });
    let view: OmniViewData | null = null;
    try {
      // `refresh`, not `resync`: a references list is exactly as stale as the corpora, so an explicit
      // refresh re-fetches it rather than leaving it alone the way a commit does.
      view = await this.engine!.refresh(this.deps?.onError);
    } catch (e: unknown) {
      // `refresh()` is called as a bare `void` from the palette command and the title-bar button, so
      // without this a rejection — `resolveReferences` against a busy session, say — would go unhandled
      // and strand the panel faded.
      const message = e instanceof Error ? e.message : String(e);
      this.deps?.onError?.(message);
      this.post({ command: 'error', message });
    }
    // A view takes the spinner off by replacing the results. Without one — superseded by a newer call,
    // or the throw above — it has to come off explicitly, or the panel stays faded for good.
    if (view) this.postView(view);
    else this.post({ command: 'busy', on: false });
  }

  /** A class was compiled locally in `sessionId`: fold it into the live engine's cache (a cheap
   *  single-class lookup, no full reload) and redraw only if it affects the current results. No-op
   *  unless we have an engine built for that same session. */
  async onClassCompiled(sessionId: number, className: string, dictName?: string): Promise<void> {
    if (!this.engine || this.builtForSession !== sessionId) return;
    const view = await this.engine.applyChange({ kind: 'class', className, dictName });
    if (view) this.postView(view);
  }

  /** The session synced (commit/abort — and dictionary add/remove/rename, which route here too): every
   *  cached corpus is now stale, so changes from elsewhere — including other sessions — can appear.
   *
   *  Rebuilding is expensive: `resync` re-primes EVERY provider, and three of those loads are
   *  image-wide synchronous GCI executes (`getAllClassNames` / `getDictionaryNames` /
   *  `getAllGlobalNames`), i.e. a UI-thread stall on a big image. Commit and abort are run constantly,
   *  and this panel is the default UI that stays alive once shown — so when it is HIDDEN we only mark
   *  the corpora stale and let the next visible use rebuild them, mirroring the `visible` gate in
   *  `onConfigChanged`. A VISIBLE panel still refreshes live. */
  async onSessionSynced(sessionId: number): Promise<void> {
    if (!this.engine || this.builtForSession !== sessionId) return;
    this.syncPending = true;
    if (this.view?.visible) await this.flushPendingSync();
  }

  /** Reveal-time catch-up: make sure the engine matches the current session, then pay for whatever we
   *  skipped while hidden. */
  private async onShown(): Promise<void> {
    if (await this.ensureEngine()) await this.flushDeferred();
  }

  /** Pay for whatever a hidden panel deferred. A pending refresh subsumes a pending sync — it rebuilds
   *  every corpus and re-fetches the references list on top — so it wins and the sync is dropped, rather
   *  than the two paying for the same image-wide walk twice. */
  private async flushDeferred(): Promise<void> {
    if (this.refreshPending) {
      this.syncPending = false;
      await this.reload();
      return;
    }
    await this.flushPendingSync();
  }

  /** Rebuild the corpora a hidden sync left stale, then redraw the current search. No-op when nothing
   *  is pending — this is called on every reveal and before every webview-driven engine operation. */
  private async flushPendingSync(): Promise<void> {
    if (!this.syncPending || !this.engine) return;
    this.syncPending = false;
    const view = await this.engine.resync(this.deps?.onError);
    if (view) this.postView(view);
  }

  /** Resolves true once the workbench has instantiated the view, false if it never does within
   *  `deadlineMs`. An already-resolved view short-circuits, which is correct here: the view genuinely
   *  exists, so `<viewId>.focus` had something to reveal. */
  private whenResolved(deadlineMs: number): Promise<boolean> {
    if (this.view) return Promise.resolve(true);
    return new Promise((resolve) => {
      // `timer` is declared after `sub` but only ever read from inside its callback, which cannot run
      // until both exist.
      const sub = this.onDidResolveView.event(() => {
        clearTimeout(timer);
        sub.dispose();
        resolve(true);
      });
      const timer = setTimeout(() => {
        sub.dispose();
        resolve(false);
      }, deadlineMs);
    });
  }

  /** Reveal + focus the view and its search field (the `ui: "panel"` entry point).
   *
   *  Reports whether THIS reveal landed — i.e. whether the view is instantiated by the time we return.
   *  A reveal can come back before the workbench has built the provider, and one attempted while the
   *  view's `when` clause is still false shows nothing at all, so a caller revealing on a login needs
   *  to know rather than assume (see `revealPanelAfterLogin`). The wait is on the resolve event, not a
   *  poll: `resolveWebviewView` is the only definitive signal that the view exists. */
  async focus(): Promise<boolean> {
    this.focusPending = true;
    // Reveal (and, if needed, create) the view; then ask the field to take the cursor. If the webview
    // is still loading, the message is lost — the `ready` handler replays it (see onMessage).
    await vscode.commands.executeCommand(`${OMNI_VIEW_ID}.focus`);
    const resolved = await this.whenResolved(REVEAL_DEADLINE_MS);
    this.deliverFocus();
    return resolved;
  }

  private deliverFocus(): void {
    if (!this.focusPending || !this.view) return;
    this.focusPending = false;
    this.view.webview.postMessage({ command: 'focusInput' });
  }

  private post(msg: Record<string, unknown>): void {
    this.view?.webview.postMessage(msg);
  }

  /** Ensure the engine matches the current session; (re)build + prime + push config when it changes.
   *  Returns false (and shows an inline notice) when there's no session to search. */
  private async ensureEngine(): Promise<boolean> {
    const ctx = await this.resolveContext();
    if (!ctx) {
      this.engine = undefined;
      this.deps = undefined;
      this.builtForSession = undefined;
      this.syncPending = false;
      this.refreshPending = false;
      this.post({ command: 'error', message: NO_SESSION_MESSAGE });
      return false;
    }
    if (this.engine && this.builtForSession === ctx.sessionId) return true;
    this.deps = ctx.deps;
    this.engine = createOmniEngine(ctx.deps);
    this.builtForSession = ctx.sessionId;
    this.syncPending = false; // a brand-new engine primes below, so there is no stale corpus to catch up
    this.post({ command: 'error', message: '' }); // clear any prior "log in" notice
    this.post(configMessage(ctx.deps.config, false));
    this.webviewNeedsConfig = false; // just pushed it
    await this.engine.prime(ctx.deps.onError);
    return true;
  }

  private postView(view: OmniViewData): void {
    if (!this.engine || !this.deps) return;
    const st = this.engine.state();
    this.post(
      resultsMessage(view, {
        config: this.deps.config,
        scopeId: st.scopeId,
        caseSensitive: st.caseSensitive,
        pinned: false,
        excludedFromAll: st.excludedFromAll,
        matchMode: st.matchMode,
      }),
    );
  }

  private async onMessage(m: PanelInbound): Promise<void> {
    try {
      if (m.command === 'ready') {
        await this.ensureEngine();
        // A reopen reaches here with an engine that ensureEngine had no reason to rebuild, so the
        // config it would have pushed never went out. Push it now, or the fresh webview runs with an
        // empty tab row and a zero debounce until the first search happens to refill them.
        if (this.webviewNeedsConfig && this.deps) {
          this.webviewNeedsConfig = false;
          this.post(configMessage(this.deps.config, false));
        }
        await this.flushDeferred();
        this.deliverFocus(); // a focus() that raced the webview load lands the cursor now
        return;
      }
      if (!this.engine && !(await this.ensureEngine())) return;
      // Handled BEFORE the deferred-sync flush: a refresh already rebuilds every corpus, so letting the
      // flush run first would pay for two full re-primes back to back.
      if (m.command === 'refresh') {
        await this.reload();
        return;
      }
      // Searching stale corpora would show deleted classes / miss new ones: pay the deferred rebuild.
      await this.flushPendingSync();
      const engine = this.engine!;

      const engineOp = dispatchEngineMessage(engine, m);
      if (engineOp) {
        const view = await engineOp;
        if (view) this.postView(view);
        return;
      }
      switch (m.command) {
        case 'activate': {
          // Open in the editor area above the panel; the docked view stays put (no beside/close).
          const result = engine.resultFor(m.id ?? -1);
          if (result) await this.deps!.activate(result, { beside: false, preserveFocus: false });
          return;
        }
        case 'revealTest': {
          // Shift+Enter: select the result in the Testing view (see omniSearchView.js).
          const result = engine.resultFor(m.id ?? -1);
          if (result) await revealTestForResult(result);
          return;
        }
        case 'preview': {
          const result = engine.resultFor(m.id ?? -1);
          if (!result) return;
          let source = '';
          try {
            source = this.deps!.previewSource(result);
          } catch {
            source = '';
          }
          this.post({ command: 'preview', id: m.id, source, title: result.label });
          return;
        }
        case 'referencesInline': {
          // Load a row's senders/references into the sticky preview-pane list (leaves the search list
          // and its state untouched). `forId` lets the webview drop a stale reply if the row moved on.
          const preview = await engine.referencesFor(m.id ?? -1);
          if (preview) {
            this.post({
              command: 'refPreview',
              forId: m.id,
              title: preview.title,
              highlightTerm: preview.highlightTerm,
              rows: preview.rows,
            });
          }
          return;
        }
        case 'previewReference': {
          // Source of a single reference row, for the inline (EI Meta-tab style) expand in the list.
          const result = engine.referenceResultFor(m.refId ?? -1);
          let source = '';
          if (result) {
            try {
              source = this.deps!.previewSource(result);
            } catch {
              source = '';
            }
          }
          this.post({ command: 'referenceSource', refId: m.refId, source });
          return;
        }
        case 'openReference': {
          // Open the picked reference's source in the editor area above the docked panel — but keep
          // focus in the panel (preserveFocus) so the sticky refs list stays keyboard-navigable for
          // the next pick (Enter from the list must not fling focus into the opened editor).
          const result = engine.referenceResultFor(m.refId ?? -1);
          if (result) await this.deps!.activate(result, { beside: false, preserveFocus: true });
          return;
        }
        case 'close':
          // A docked view has nothing to close — just hand focus back to the editor.
          await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
          return;
        // 'togglePin' is meaningless for a panel view (no tab to pin) — ignored.
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.deps?.onError?.(message);
      this.post({ command: 'error', message });
    }
  }
}
