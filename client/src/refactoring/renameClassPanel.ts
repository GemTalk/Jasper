/**
 * The paginated rename-class (R3) preview panel. Shows the first page of changes
 * and fetches more on demand ("More" / "Load all"); Apply is server-side and
 * reports only the deselected ids. Resolves with the apply result, or undefined
 * if cancelled/closed. The caller supplies the page/apply/cleanup handlers so this
 * stays UI-only.
 *
 * Reuses the SHARED webview behaviour renameMethodPanelView.js (checkbox
 * bookkeeping, diff toggle, pagination, apply dispatch) — the DOM contract
 * (li.change[data-id], .sel checkboxes, #apply/#cancel/#more/#loadAll) is
 * identical, and structural changes render as disabled checkboxes so they are
 * never reported as deselected.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { StartClassPreview, PreviewPage, ApplyResult } from './renameClassPreview';
import { renderClassPanelHtml, renderClassCards } from './renameClassPanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('renameMethodPanelView.js', 'refactoring');

export interface RenameClassPanelHandlers {
  loadPage: (offset: number) => Promise<PreviewPage>;
  apply: (deselectedIds: string[]) => Promise<ApplyResult>;
  cleanup: () => void;
}

/** The chosen options that affect how the preview banner describes the outcome. */
export interface RenameClassPanelOptions {
  recompileSubclasses: boolean;
  migrateInstances: boolean;
}

/** Show the paginated preview; resolve with the apply result, or undefined if the
 *  user cancelled/closed it. */
export function showRenameClassPanel(
  oldName: string,
  newName: string,
  start: StartClassPreview,
  options: RenameClassPanelOptions,
  handlers: RenameClassPanelHandlers,
): Promise<ApplyResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneRenameClass',
    `Rename ${oldName} → ${newName}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderClassPanelHtml({
    oldName,
    newName,
    total: start.total,
    changes: start.page.changes,
    done: start.page.done,
    outOfScope: start.outOfScope,
    skippedMethods: start.skippedMethods,
    recompileSubclasses: options.recompileSubclasses,
    migrateInstances: options.migrateInstances,
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
        html: renderClassCards(page.changes),
        done,
      });
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
          void vscode.window.showErrorMessage(`Rename preview: ${msg}`);
          void panel.webview.postMessage({ command: 'busyDone' });
        }
      })();
    });

    panel.onDidDispose(() => finish(undefined));
  });
}
