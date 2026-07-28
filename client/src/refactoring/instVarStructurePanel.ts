/**
 * The paginated instance-variable structure (V2 / V3 / V5) preview panel. Shows every
 * staged change (a class-definition edit, a descendant reparent, or a method recompile)
 * as a required row, fetches further pages on demand, and applies server-side (no commit).
 * Resolves with the apply result, or undefined if cancelled/closed. UI-only: the caller
 * supplies the page/apply/cleanup handlers.
 *
 * Reuses Jasper's webview convention and the shared renameMethodPanelView.js (read at
 * runtime, injected under a nonce). Every row is required (checked + disabled), so the
 * deselected set the view reports is always empty.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { StartIvarPreview, IvarPreviewPage, IvarApplyResult } from './instVarStructurePreview';
import { renderIvarPanelHtml, renderIvarCards } from './instVarStructurePanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('renameMethodPanelView.js', 'refactoring');

export interface IvarStructurePanelHandlers {
  loadPage: (offset: number) => Promise<IvarPreviewPage>;
  apply: (deselectedIds: string[]) => Promise<IvarApplyResult>;
  cleanup: () => void;
}

/** Show the paginated preview; resolve with the apply result, or undefined if the user
 *  cancelled/closed it. `heading` names the operation + target. */
export function showInstVarStructurePanel(
  heading: string,
  start: StartIvarPreview,
  handlers: IvarStructurePanelHandlers,
): Promise<IvarApplyResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneInstVarStructure',
    heading,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderIvarPanelHtml({
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

  return new Promise<IvarApplyResult | undefined>((resolve) => {
    let settled = false;
    const finish = (result: IvarApplyResult | undefined): void => {
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
        html: renderIvarCards(page.changes),
        done: page.done,
      });
      offset = page.nextOffset;
      done = page.done;
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
          void vscode.window.showErrorMessage(`InstVar preview: ${msg}`);
          void panel.webview.postMessage({ command: 'busyDone' });
        }
      })();
    });

    panel.onDidDispose(() => finish(undefined));
  });
}
