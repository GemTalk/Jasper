/**
 * The rename-temporary/argument (R5) preview panel. Shows the single method
 * before/after; Apply is server-side (recompile the one method, no commit). R5 is
 * method-local and all-or-nothing, so there is no per-change selection — Apply
 * always sends an empty deselected set. Resolves with the apply result, or
 * undefined if cancelled/closed. The caller supplies the page/apply/cleanup
 * handlers so this stays UI-only.
 *
 * Reuses the SHARED webview behaviour renameMethodPanelView.js. Its DOM contract
 * (li.change[data-id], #apply/#cancel/#more/#loadAll, diff toggle) is satisfied by
 * our HTML; with no `.sel` checkboxes, its deselected-id computation is always
 * empty, so Apply reports `deselected: []`.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { StartTemporaryPreview, PreviewPage, ApplyResult } from './renameTemporaryPreview';
import { renderTemporaryPanelHtml, renderTemporaryCards } from './renameTemporaryPanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('renameMethodPanelView.js', 'refactoring');

export interface RenameTemporaryPanelHandlers {
  loadPage: (offset: number) => Promise<PreviewPage>;
  apply: () => Promise<ApplyResult>;
  cleanup: () => void;
}

/** Show the preview; resolve with the apply result, or undefined if the user
 *  cancelled/closed it. */
export function showRenameTemporaryPanel(
  oldName: string,
  newName: string,
  start: StartTemporaryPreview,
  handlers: RenameTemporaryPanelHandlers,
): Promise<ApplyResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneRenameTemporary',
    `Rename ${oldName} → ${newName}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderTemporaryPanelHtml({
    oldName,
    newName,
    total: start.total,
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
        html: renderTemporaryCards(page.changes),
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
            // All-or-nothing: ignore any reported deselection and apply everything.
            const result = await handlers.apply();
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
