/**
 * The paginated rename-method preview panel. Shows the first page of changes and
 * fetches further pages on demand ("More" / "Load all"); Apply is server-side and
 * reports only the deselected ids (so unloaded changes apply by default). Resolves
 * with the apply result, or undefined if cancelled/closed. The caller supplies the
 * page/apply/cleanup handlers so this stays UI-only.
 *
 * Reuses Jasper's webview convention: DOM behaviour lives in
 * renameMethodPanelView.js (read at runtime, injected under a nonce).
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { StartPreview, PreviewPage, ApplyResult } from './renameMethodPreview';
import { renderMethodPanelHtml, renderMethodCards } from './renameMethodPanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('renameMethodPanelView.js', 'refactoring');

export interface RenameMethodPanelHandlers {
  /** Fetch the page starting at `offset` (1-based). */
  loadPage: (offset: number) => Promise<PreviewPage>;
  /** Apply server-side, skipping `deselectedIds`; no commit. */
  apply: (deselectedIds: string[]) => Promise<ApplyResult>;
  /** Drop the preview session (called exactly once when the panel closes). */
  cleanup: () => void;
}

/** Show the paginated preview; resolve with the apply result, or undefined if the
 *  user cancelled/closed it. */
export function showRenameMethodPanel(
  oldSelector: string,
  newSelector: string,
  start: StartPreview,
  handlers: RenameMethodPanelHandlers,
): Promise<ApplyResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneRenameMethod',
    `Rename ${oldSelector} → ${newSelector}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderMethodPanelHtml({
    oldSelector,
    newSelector,
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
      offset = page.nextOffset;
      done = page.done;
      void panel.webview.postMessage({
        command: 'appendChanges',
        html: renderMethodCards(page.changes),
        done,
      });
      return done;
    };

    // One page fetch (or the load-all loop) at a time — the session can't run
    // two GCI calls at once, and overlapping clicks would otherwise collide.
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
          void vscode.window.showErrorMessage(`Rename preview: ${msg}`);
          void panel.webview.postMessage({ command: 'busyDone' });
        }
      })();
    });

    panel.onDidDispose(() => finish(undefined));
  });
}
