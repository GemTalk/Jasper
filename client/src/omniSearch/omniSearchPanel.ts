/**
 * GemStone Search Phase-2 "Spotter" — a webview panel that replaces the Phase-1 `vscode.QuickPick`
 * chrome (issue #378). The search behaviour is identical (it drives the pure `OmniEngine`); the
 * webview buys what the QuickPick title bar could not: real labeled scope TABS (not a cramped icon
 * row), our own case-correct match HIGHLIGHTS, an always-on case indicator, a source PREVIEW pane,
 * an exact/− total-count footer with elegant load-more controls, and — because a panel persists as
 * an editor tab — the ability to open a result BESIDE it without dismissing the search.
 *
 * This module is the thin `vscode` shell: panel lifecycle, the HTML/CSS shell, and the message pump
 * between the webview (`omniSearchView.js`) and the engine + injected activation/preview callbacks.
 * All search logic lives in the unit-tested `omniEngine.ts`; the DOM behaviour lives in the
 * jsdom-tested `omniSearchView.js`. The session-bound wiring (providers, activation, preview source)
 * is built by `omniSearchCommand.ts` and injected, so this file needs no stone session directly.
 */
import * as vscode from 'vscode';
import { OmniConfig, OmniResult } from './omniTypes';
import { createOmniEngine, OmniEngineDeps, OmniViewData } from './omniEngine';
import { revealTestForResult } from './omniActions';
import {
  configMessage,
  dispatchEngineMessage,
  renderOmniHtml,
  resultsMessage,
} from './omniSearchShared';

/** Everything the panel needs, injected by the command layer (keeps this file stone-free). */
export interface OmniPanelDeps extends OmniEngineDeps {
  /** The session these providers are bound to, so a class-compile / sync notification for a
   *  different session is ignored. */
  sessionId: number;
  /** Activate a result. `beside` opens it in a group beside the Spotter (pinned mode); when false it
   *  opens in the active group like the Phase-1 dialog. `preserveFocus` keeps the field focused. */
  activate: (
    result: OmniResult,
    opts: { beside: boolean; preserveFocus: boolean },
  ) => void | Promise<void>;
  /** Source text to preview for a result (method source / class definition); '' for none. */
  previewSource: (result: OmniResult) => string;
  onError?: (message: string) => void;
}

/** Messages the webview sends to the host. */
type OmniInbound =
  | { command: 'ready' }
  | { command: 'query'; value: string }
  | { command: 'setScope'; scopeId: OmniConfig['enabledCategories'][number] | null }
  | { command: 'toggleCase' }
  | { command: 'togglePin' }
  | { command: 'loadMore' }
  | { command: 'loadAll' }
  | { command: 'activate'; id: number; side: boolean }
  | { command: 'revealTest'; id: number }
  | { command: 'references'; id: number }
  | { command: 'referencesInline'; id: number }
  | { command: 'previewReference'; refId: number }
  | { command: 'openReference'; refId: number }
  | { command: 'back' }
  | { command: 'preview'; id: number }
  | { command: 'refresh' }
  | { command: 'close' };

export class OmniSearchPanel {
  private static current: OmniSearchPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  // Not readonly: `rebindTo` replaces it when the Spotter is pointed at a different session.
  private engine: ReturnType<typeof createOmniEngine>;
  private disposables: vscode.Disposable[] = [];
  // Dialog vs. pinned. Unpinned (default) makes the Spotter behave like the Phase-1 QuickPick: it
  // closes on focus-out and on picking a result. Pinned keeps it open and switches activation to
  // open-beside. "Pinned" IS VS Code's own tab-pin (right-click tab → Pin, or our 📌 button, which
  // drives the same native command) — one source of truth, so both act identically. Cached here and
  // refreshed from `onDidChangeTabs`.
  private pinned = false;
  // Guard so an initial "inactive" view-state event can't dispose the panel before it's ever focused.
  private hasBeenActive = false;

  /** Open (or reveal) the Spotter. Only one exists at a time. A second invocation for the SAME
   *  session just refocuses it; one for a DIFFERENT session re-points it at that session's deps. */
  static show(deps: OmniPanelDeps): void {
    const existing = OmniSearchPanel.current;
    if (existing) {
      if (existing.deps.sessionId !== deps.sessionId) {
        // Different session: the open Spotter's engine — and the providers, activation and preview
        // inside it — came from the OLD session's `deps`, so a bare reveal would keep searching and
        // opening against the previous session with no sign anything is wrong (the reported
        // two-session bug). Re-point it, which also clears the old session's results off the screen.
        existing.rebindTo(deps);
      }
      existing.panel.reveal(existing.panel.viewColumn);
      existing.panel.webview.postMessage({ command: 'focusInput' });
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'gemstoneOmniSearch',
      'GemStone Search',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    OmniSearchPanel.current = new OmniSearchPanel(panel, deps);
  }

  /** Fold a locally-compiled class into the open Spotter's cache (if any), redrawing only if it
   *  affects the current results. No-op unless a Spotter bound to that session is open (typically a
   *  pinned one — an unpinned Spotter has already closed on focus-out by the time you compile). */
  static onClassCompiled(sessionId: number, className: string, dictName?: string): void {
    const panel = OmniSearchPanel.current;
    if (!panel || panel.deps.sessionId !== sessionId) return;
    void panel.engine
      .applyChange({ kind: 'class', className, dictName })
      .then((view) => view && panel.postView(view));
  }

  /** Rebuild the open Spotter's cached corpora on a session sync (commit/abort), then redraw. */
  static onSessionSynced(sessionId: number): void {
    const panel = OmniSearchPanel.current;
    if (!panel || panel.deps.sessionId !== sessionId) return;
    void panel.engine.resync(panel.deps.onError).then((view) => view && panel.postView(view));
  }

  /** The user made a different session active. An open Spotter is bound to ONE session — its
   *  providers, activation and preview all close over it — so it has to be re-pointed at the new one,
   *  and everything on screen (results, query, pivot, preview) has to go with it: those rows were read
   *  out of the session just left, yet activating one would open a document against the session that is
   *  now current (issue #517).
   *
   *  `resolveDeps` is a thunk so nothing is built when no Spotter is open. It answering null means
   *  there is nothing left to search (the last session logged out): the Spotter stays open — it is an
   *  editor tab the user put there — but resets and says so, rather than showing a departed session's
   *  results. */
  static onSessionSelectionChanged(resolveDeps: () => OmniPanelDeps | null): void {
    const panel = OmniSearchPanel.current;
    if (!panel) return; // nothing open — don't build providers for a Spotter that isn't there
    const deps = resolveDeps();
    if (!deps) {
      panel.reset();
      panel.panel.webview.postMessage({
        command: 'error',
        message: 'Log in to a GemStone session to search.',
      });
      return;
    }
    if (panel.deps.sessionId === deps.sessionId) return;
    panel.rebindTo(deps);
  }

  /** The user asked for a refresh (⟳ in the panel / `gemstone.search.refresh`): rebuild every cached
   *  corpus from the stone and re-run the current search, so code created or removed by EXECUTING it
   *  (a workspace doit, a `compileMethod:`) is picked up without waiting for a commit or abort. */
  static refresh(): void {
    void OmniSearchPanel.current?.refresh();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private deps: OmniPanelDeps,
  ) {
    this.panel = panel;
    this.engine = createOmniEngine(deps);
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (m: OmniInbound) => void this.onMessage(m),
      null,
      this.disposables,
    );
    // Dialog behaviour: when unpinned, close on focus-out — the same "disappears when you click
    // away" feel as the Phase-1 QuickPick. Pinned panels (native tab pin) stay put.
    this.panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.active) this.hasBeenActive = true;
        else if (this.hasBeenActive && !this.pinned) this.panel.dispose();
      },
      null,
      this.disposables,
    );
    // Keep our pinned state in lockstep with VS Code's own tab pin, so pinning the tab natively (or
    // via our 📌, which runs the same command) behaves identically.
    this.panel.onDidChangeViewState(() => this.syncPinnedFromTab(), null, this.disposables);
    vscode.window.tabGroups.onDidChangeTabs(() => this.syncPinnedFromTab(), null, this.disposables);
  }

  /** Our webview's editor tab, located by its webview view-type, or undefined if not found. */
  private ourTab(): vscode.Tab | undefined {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (
          tab.input instanceof vscode.TabInputWebview &&
          tab.input.viewType.includes('gemstoneOmniSearch')
        ) {
          return tab;
        }
      }
    }
    return undefined;
  }

  /** Re-read the native tab-pin state; if it changed, cache it and tell the webview to update the
   *  pin button (so our 📌 and the native pin always show the same state). */
  private syncPinnedFromTab(): void {
    const nowPinned = this.ourTab()?.isPinned ?? false;
    if (nowPinned === this.pinned) return;
    this.pinned = nowPinned;
    this.panel.webview.postMessage({ command: 'pinned', pinned: this.pinned });
  }

  /** Point this Spotter at another session: a new engine over the new deps, a cleared webview, and a
   *  fresh prime. Everything else about the panel — the tab, its pin, the loaded HTML and the message
   *  wiring — is session-independent and stays, so the user keeps the tab they opened. */
  private rebindTo(deps: OmniPanelDeps): void {
    this.deps = deps;
    this.engine = createOmniEngine(deps);
    this.reset();
    this.panel.webview.postMessage(configMessage(deps.config, this.pinned));
    void this.engine.prime(deps.onError);
  }

  /** Clear the webview back to an empty search (no query, no results, no pivot, no preview). */
  private reset(): void {
    this.panel.webview.postMessage({ command: 'reset' });
  }

  /** Reload every cached corpus and re-run the current term. See the static `refresh` for why. */
  private async refresh(): Promise<void> {
    this.panel.webview.postMessage({ command: 'busy', on: true });
    const view = await this.engine.resync(this.deps.onError);
    // No view means a pivot is showing — its rows are a fixed list, not a search, so there is nothing
    // to re-run. The corpora were still rebuilt; just drop the spinner.
    if (view) this.postView(view);
    else this.panel.webview.postMessage({ command: 'busy', on: false });
  }

  /** Send a fresh view to the webview, decorated with the current chrome state. */
  private postView(view: OmniViewData): void {
    const st = this.engine.state();
    this.panel.webview.postMessage(
      resultsMessage(view, {
        config: this.deps.config,
        scopeId: st.scopeId,
        caseSensitive: st.caseSensitive,
        pinned: this.pinned,
        excludedFromAll: st.excludedFromAll,
        matchMode: st.matchMode,
      }),
    );
  }

  private async onMessage(m: OmniInbound): Promise<void> {
    try {
      const engineOp = dispatchEngineMessage(this.engine, m);
      if (engineOp) {
        await this.run(() => engineOp);
        return;
      }
      switch (m.command) {
        case 'ready': {
          this.panel.webview.postMessage(configMessage(this.deps.config, this.pinned));
          await this.engine.prime(this.deps.onError);
          return;
        }
        case 'togglePin':
          // Drive VS Code's OWN tab pin so our 📌 and the native pin are the same control. The
          // webview is focused when the button is clicked, so our tab is the active editor these
          // commands target; `onDidChangeTabs` then syncs `this.pinned` + the button state.
          await vscode.commands.executeCommand(
            this.pinned ? 'workbench.action.unpinEditor' : 'workbench.action.pinEditor',
          );
          return;
        case 'activate': {
          const result = this.engine.resultFor(m.id);
          if (!result) return;
          // Unpinned = dialog: open in the active group and dismiss the Spotter (Phase-1 feel).
          // Pinned = persistent: open BESIDE, and Ctrl+Enter (side) keeps focus in the field.
          await this.deps.activate(result, {
            beside: this.pinned,
            preserveFocus: this.pinned && m.side,
          });
          if (!this.pinned) this.panel.dispose();
          return;
        }
        case 'revealTest': {
          // Shift+Enter: go to the result in the Testing view instead of opening it.
          // The Spotter stays put — you are moving to another view, not dismissing this one.
          const result = this.engine.resultFor(m.id);
          if (result) await revealTestForResult(result);
          return;
        }
        case 'preview': {
          const result = this.engine.resultFor(m.id);
          if (!result) return;
          let source = '';
          try {
            source = this.deps.previewSource(result);
          } catch {
            source = ''; // a failed preview is non-fatal — just show nothing
          }
          this.panel.webview.postMessage({
            command: 'preview',
            id: m.id,
            source,
            title: result.label,
          });
          return;
        }
        case 'referencesInline': {
          // Load a row's senders/references into the sticky preview-pane list (leaves the search list
          // and its state untouched). `forId` lets the webview drop a stale reply if the row moved on.
          const preview = await this.engine.referencesFor(m.id);
          if (preview) {
            this.panel.webview.postMessage({
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
          const result = this.engine.referenceResultFor(m.refId);
          let source = '';
          if (result) {
            try {
              source = this.deps.previewSource(result);
            } catch {
              source = '';
            }
          }
          this.panel.webview.postMessage({ command: 'referenceSource', refId: m.refId, source });
          return;
        }
        case 'openReference': {
          const result = this.engine.referenceResultFor(m.refId);
          if (!result) return;
          // Opening source from the refs list must NOT dismiss the Spotter — open beside it and keep
          // focus in the field so the sticky list stays put for the next pick.
          await this.deps.activate(result, { beside: true, preserveFocus: true });
          return;
        }
        case 'refresh':
          await this.refresh();
          return;
        case 'close':
          this.panel.dispose();
          return;
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.deps.onError?.(message);
      this.panel.webview.postMessage({ command: 'error', message });
    }
  }

  /** Run an engine call that returns a view (or null if superseded) and post it if fresh. */
  private async run(op: () => Promise<OmniViewData | null>): Promise<void> {
    const view = await op();
    if (view) this.postView(view);
  }

  private dispose(): void {
    if (OmniSearchPanel.current === this) OmniSearchPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private getHtml(): string {
    return renderOmniHtml({ showPin: true });
  }
}
