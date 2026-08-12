/**
 * Omni Search as a bottom-PANEL webview view (`ui: "panel"`), alongside Terminal / Output. Unlike the
 * editor-tab Spotter it's a docked tool: no pin, no auto-close, no open-beside — activating a result
 * just opens it in the editor area ABOVE the panel, and the search stays put below. It shares all the
 * chrome + engine plumbing with the tab host via `omniSearchShared.ts`.
 *
 * The provider is registered once at activation, before any session exists, and the view can be shown
 * at any time — so it resolves the session + builds its (session-bound) engine LAZILY, rebuilding when
 * the session changes. `resolveContext` (built by the command layer) yields the current session's deps
 * or null when there's nothing to search.
 */
import * as vscode from 'vscode';
import { createOmniEngine, OmniEngine, OmniViewData } from './omniEngine';
import { OmniPanelDeps } from './omniSearchPanel';
import {
  CommonInbound,
  configMessage,
  dispatchEngineMessage,
  renderOmniHtml,
  resultsMessage,
} from './omniSearchShared';

export const OMNI_VIEW_ID = 'gemstoneOmniSearchView';

/** The session-bound deps plus the id they were built for (so we rebuild when the session changes). */
export interface OmniViewContext {
  deps: OmniPanelDeps;
  sessionId: number;
}

/** Webview messages this host handles beyond the common engine ones. */
type PanelInbound = CommonInbound & { id?: number; side?: boolean };

export class OmniSearchViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private engine: OmniEngine | undefined;
  private deps: OmniPanelDeps | undefined;
  private builtForSession: number | undefined;
  // A focus() that arrives before the webview has loaded can't deliver `focusInput`; remember it and
  // replay once the webview signals `ready`, so Shift+Enter always lands the cursor in the field.
  private focusPending = false;

  constructor(private readonly resolveContext: () => Promise<OmniViewContext | null>) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = renderOmniHtml({ showPin: false });
    view.webview.onDidReceiveMessage((m: PanelInbound) => void this.onMessage(m));
    // The engine is session-bound; rebuild it if the session changed while the view was hidden.
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.ensureEngine();
    });
  }

  /** Reveal + focus the view and its search field (the `ui: "panel"` entry point). */
  async focus(): Promise<void> {
    this.focusPending = true;
    // Reveal (and, if needed, create) the view; then ask the field to take the cursor. If the webview
    // is still loading, the message is lost — the `ready` handler replays it (see onMessage).
    await vscode.commands.executeCommand(`${OMNI_VIEW_ID}.focus`);
    this.deliverFocus();
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
      this.post({ command: 'error', message: 'Log in to a GemStone session to search.' });
      return false;
    }
    if (this.engine && this.builtForSession === ctx.sessionId) return true;
    this.deps = ctx.deps;
    this.engine = createOmniEngine(ctx.deps);
    this.builtForSession = ctx.sessionId;
    this.post({ command: 'error', message: '' }); // clear any prior "log in" notice
    this.post(configMessage(ctx.deps.config, false));
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
      }),
    );
  }

  private async onMessage(m: PanelInbound): Promise<void> {
    try {
      if (m.command === 'ready') {
        await this.ensureEngine();
        this.deliverFocus(); // a focus() that raced the webview load lands the cursor now
        return;
      }
      if (!this.engine && !(await this.ensureEngine())) return;
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
