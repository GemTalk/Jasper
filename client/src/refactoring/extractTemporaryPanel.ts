/**
 * The Extract Temporary (M3) preview panel. Shows the single method before/after;
 * Apply is server-side (recompile the one method, no commit). M3 is method-local and
 * all-or-nothing, so there is no per-change selection — Apply always sends an empty
 * deselected set. Resolves with the apply result, or undefined if cancelled/closed.
 * The caller supplies the page/apply/cleanup handlers so this stays UI-only.
 *
 * Reuses the SHARED webview behaviour renameMethodPanelView.js (same DOM contract as
 * the rename-temporary panel).
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { StartExtractTemporaryPreview, PreviewPage, ApplyResult } from './extractTemporaryPreview';
import {
  renderExtractTemporaryPanelHtml,
  renderExtractTemporaryCards,
} from './extractTemporaryPanelHtml';
import { readRefactoringWebviewScript } from './webviewAssets';

const panelJs = readRefactoringWebviewScript('renameMethodPanelView.js');

export interface ExtractTemporaryPanelHandlers {
  loadPage: (offset: number) => Promise<PreviewPage>;
  apply: () => Promise<ApplyResult>;
  cleanup: () => void;
}

/** Show the preview; resolve with the apply result, or undefined if the user
 *  cancelled/closed it. */
export function showExtractTemporaryPanel(
  newName: string,
  start: StartExtractTemporaryPreview,
  replaceAll: boolean,
  handlers: ExtractTemporaryPanelHandlers,
): Promise<ApplyResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneExtractTemporary',
    `Extract ${newName}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderExtractTemporaryPanelHtml({
    newName,
    total: start.total,
    occurrenceCount: start.occurrenceCount,
    replaceAll,
    changes: start.page.changes,
    done: start.page.done,
    outOfScope: start.outOfScope,
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
        html: renderExtractTemporaryCards(page.changes),
        done,
      });
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
            const result = await handlers.apply();
            finish(result);
          } else if (message?.command === 'cancel') {
            finish(undefined);
          }
        } catch (e: unknown) {
          loading = false;
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Extract preview: ${msg}`);
          void panel.webview.postMessage({ command: 'busyDone' });
        }
      })();
    });

    panel.onDidDispose(() => finish(undefined));
  });
}
