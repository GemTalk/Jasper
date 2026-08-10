/**
 * The paginated split-class (V8 / extract class) preview panel. Shows every staged change (the new
 * component class, each moved method, the source's reversioned definition + lazy accessor +
 * delegators, each re-parented descendant) as a required row, fetches further pages on demand, and
 * applies server-side (no commit). Resolves with the apply result, or undefined if cancelled/closed.
 * UI-only: the caller supplies the page/apply/cleanup handlers.
 *
 * Reuses Jasper's webview convention and the shared renameMethodPanelView.js (read at runtime,
 * injected under a nonce). Every row is required (checked + disabled), so the deselected set the
 * view reports is always empty.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { StartSplitPreview, SplitPreviewPage, SplitApplyResult } from './splitClassPreview';
import { renderSplitPanelHtml, renderSplitCards } from './splitClassPanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('renameMethodPanelView.js', 'refactoring');

export interface SplitPanelHandlers {
  loadPage: (offset: number) => Promise<SplitPreviewPage>;
  apply: (deselectedIds: string[]) => Promise<SplitApplyResult>;
  cleanup: () => void;
}

/** Show the paginated preview; resolve with the apply result, or undefined if the user
 *  cancelled/closed it. `heading` names the operation + target. */
export function showSplitClassPanel(
  heading: string,
  start: StartSplitPreview,
  handlers: SplitPanelHandlers,
): Promise<SplitApplyResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneSplitClass',
    heading,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderSplitPanelHtml({
    heading,
    total: start.total,
    changes: start.page.changes,
    done: start.page.done,
    outOfScope: start.outOfScope,
    nonce,
    script: panelJs,
  });

  let offset = start.page.nextOffset;
  let done = start.page.done;

  return new Promise<SplitApplyResult | undefined>((resolve) => {
    let settled = false;
    const finish = (result: SplitApplyResult | undefined): void => {
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
        html: renderSplitCards(page.changes),
        done: page.done,
      });
      offset = page.nextOffset;
      done = page.done;
      return done;
    };

    let loading = false;
    // Apply is one-shot per panel: `handlers.apply` creates the component class and moves methods
    // + ivars server-side, so a second dispatch (a double-click on Apply, or a replayed/synthetic
    // webview message that bypasses the view's own guard) would re-apply it — hitting "class
    // already exists" and surfacing a spurious failure after a real success. The latch is set
    // BEFORE the first await, and cleared only in the catch below, which leaves the panel open for
    // a retry.
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
          void vscode.window.showErrorMessage(`Split-class preview: ${msg}`);
          void panel.webview.postMessage({ command: 'busyDone' });
        }
      })();
    });

    panel.onDidDispose(() => finish(undefined));
  });
}
