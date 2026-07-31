/**
 * The paginated push-up / push-down method (M7 / M8) preview panel. Shows every staged
 * change (a `methodAdd` on the target + a `methodRemove` on the source, per movable
 * selector) as a required row, lists any selectors that could not move, fetches further
 * pages on demand, and applies server-side (no commit). Resolves with the apply result,
 * or undefined if cancelled/closed. UI-only: the caller supplies the page/apply/cleanup
 * handlers.
 *
 * Reuses Jasper's webview convention and the shared renameMethodPanelView.js (read at
 * runtime, injected under a nonce) for diff/pagination/apply behaviour. Because every
 * row is required (checked + disabled), the deselected set the view reports is always
 * empty; apply passes it through unchanged.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { StartPushPreview, PushPreviewPage, PushApplyResult } from './pushMethodPreview';
import { renderPushPanelHtml, renderPushCards } from './pushMethodPanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('renameMethodPanelView.js', 'refactoring');

export interface PushMethodPanelHandlers {
  /** Fetch the page starting at `offset` (1-based). */
  loadPage: (offset: number) => Promise<PushPreviewPage>;
  /** Apply server-side, skipping `deselectedIds` (always empty here); no commit. */
  apply: (deselectedIds: string[]) => Promise<PushApplyResult>;
  /** Drop the preview session (called exactly once when the panel closes). */
  cleanup: () => void;
}

/** Show the paginated preview; resolve with the apply result, or undefined if the
 *  user cancelled/closed it. `heading` names the direction + target. */
export function showPushMethodPanel(
  heading: string,
  start: StartPushPreview,
  handlers: PushMethodPanelHandlers,
): Promise<PushApplyResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstonePushMethod',
    heading,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderPushPanelHtml({
    heading,
    total: start.total,
    changes: start.page.changes,
    done: start.page.done,
    outOfScope: start.outOfScope,
    skippedMethods: start.skippedMethods,
    nonce,
    script: panelJs,
  });

  let offset = start.page.nextOffset;
  let done = start.page.done;

  return new Promise<PushApplyResult | undefined>((resolve) => {
    let settled = false;
    const finish = (result: PushApplyResult | undefined): void => {
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
        html: renderPushCards(page.changes),
        done: page.done,
      });
      offset = page.nextOffset;
      done = page.done;
      return done;
    };

    let loading = false;
    // Apply is one-shot per panel: `handlers.apply` performs the change set server-side, so a
    // second dispatch (a double-click on Apply, or a replayed webview message) would apply it a
    // second time. Cleared only in the catch below, which leaves the panel open for a retry.
    let applying = false;
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
            if (applying) return;
            applying = true;
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
          applying = false;
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Push preview: ${msg}`);
          void panel.webview.postMessage({ command: 'busyDone' });
        }
      })();
    });

    panel.onDidDispose(() => finish(undefined));
  });
}
