/**
 * The paginated inline-method (M2) preview panel. Shows the required core change
 * (the rewritten caller) plus, when the inlined call was the target's last sender,
 * a deselectable removal of the now-unused target. Fetches further pages on demand
 * and applies server-side reporting only the DESELECTED ids (so the core recompile,
 * whose checkbox is disabled, always applies; the removal is unchecked by default and
 * applies only when the user ticks it — a method deletion is opt-in, never automatic).
 * Resolves with the apply result, or undefined if cancelled/closed. UI-only: the
 * caller supplies the page/apply/cleanup handlers.
 *
 * Reuses Jasper's webview convention and the shared renameMethodPanelView.js (read
 * at runtime, injected under a nonce) for checkbox/diff/pagination/apply behaviour.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { StartInlinePreview, PreviewPage, ApplyResult } from './inlineMethodPreview';
import { renderInlinePanelHtml, renderInlineCards } from './inlineMethodPanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('renameMethodPanelView.js', 'refactoring');

/** The one leading change (the rewritten caller) is always required. */
const CORE_COUNT = 1;

export interface InlineMethodPanelHandlers {
  /** Fetch the page starting at `offset` (1-based). */
  loadPage: (offset: number) => Promise<PreviewPage>;
  /** Apply server-side, skipping `deselectedIds` (the removal only); no commit. */
  apply: (deselectedIds: string[]) => Promise<ApplyResult>;
  /** Drop the preview session (called exactly once when the panel closes). */
  cleanup: () => void;
}

/** Show the paginated preview; resolve with the apply result, or undefined if the
 *  user cancelled/closed it. */
export function showInlineMethodPanel(
  targetSelector: string,
  start: StartInlinePreview,
  handlers: InlineMethodPanelHandlers,
): Promise<ApplyResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneInlineMethod',
    `Inline ${targetSelector}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderInlinePanelHtml({
    targetSelector,
    total: start.total,
    coreCount: CORE_COUNT,
    lastSender: start.lastSender,
    changes: start.page.changes,
    done: start.page.done,
    outOfScope: start.outOfScope,
    nonce,
    script: panelJs,
  });

  let offset = start.page.nextOffset;
  let done = start.page.done;
  let loaded = start.page.changes.length;

  return new Promise<ApplyResult | undefined>((resolve) => {
    let settled = false;
    const finish = (result: ApplyResult | undefined): void => {
      if (settled) return;
      settled = true;
      handlers.cleanup();
      resolve(result);
      panel.dispose();
    };

    const fetchOne = async (): Promise<boolean> => {
      const page = await handlers.loadPage(offset);
      void panel.webview.postMessage({
        command: 'appendChanges',
        html: renderInlineCards(page.changes, loaded, CORE_COUNT),
        done: page.done,
      });
      offset = page.nextOffset;
      done = page.done;
      loaded += page.changes.length;
      return done;
    };

    let loading = false;
    panel.webview.onDidReceiveMessage((message) => {
      void (async () => {
        try {
          if (message?.command === 'loadMore' || message?.command === 'loadAll') {
            if (loading) return;
            if (done) {
              void panel.webview.postMessage({ command: 'busyDone' });
              return;
            }
            loading = true;
            try {
              if (message.command === 'loadAll') {
                while (!done) {
                  await fetchOne();
                }
              } else {
                await fetchOne();
              }
            } finally {
              loading = false;
            }
          } else if (message?.command === 'apply') {
            const deselected: string[] = Array.isArray(message.deselected)
              ? message.deselected
              : [];
            const result = await handlers.apply(deselected);
            finish(result);
          } else if (message?.command === 'cancel') {
            finish(undefined);
          }
        } catch (e: unknown) {
          loading = false;
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Inline preview: ${msg}`);
          void panel.webview.postMessage({ command: 'busyDone' });
        }
      })();
    });

    panel.onDidDispose(() => finish(undefined));
  });
}
