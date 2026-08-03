/**
 * The paginated add / remove instance-variable (V1) preview panel. Shows every staged
 * class change (a definition edit or a reparent) as a required row, a prominent list of
 * methods that will not recompile, and migrate / delete-history checkboxes. Fetches
 * further pages on demand and applies
 * server-side. Applying with neither migrate nor delete-history does NOT commit; with
 * either, it commits — so the host confirms first. Resolves with the apply result, or
 * undefined if cancelled/closed. UI-only: the caller supplies the handlers.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { StartInstVarPreview, PreviewPage, ApplyResult } from './instVarRefactorPreview';
import { renderInstVarPanelHtml, renderInstVarCards } from './instVarRefactorPanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('instVarRefactorPanelView.js', 'refactoring');

export interface InstVarPanelHandlers {
  /** Fetch the page starting at `offset` (1-based). */
  loadPage: (offset: number) => Promise<PreviewPage>;
  /** Apply server-side. `options` (or null) replaces the acted-on class's options;
   *  migrate/deleteHistory commit. */
  apply: (
    options: string[] | null,
    migrate: boolean,
    deleteHistory: boolean,
  ) => Promise<ApplyResult>;
  /** Drop the preview session (called exactly once when the panel closes). */
  cleanup: () => void;
}

/** Show the paginated preview; resolve with the apply result, or undefined if the user
 *  cancelled/closed it. */
export function showInstVarRefactorPanel(
  title: string,
  start: StartInstVarPreview,
  handlers: InstVarPanelHandlers,
): Promise<ApplyResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneInstVarRefactor',
    title,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderInstVarPanelHtml({
    title,
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
      void panel.webview.postMessage({
        command: 'appendChanges',
        html: renderInstVarCards(page.changes),
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
                while (!done) await fetchOne();
              } else {
                await fetchOne();
              }
            } finally {
              loading = false;
            }
          } else if (message?.command === 'apply') {
            const options: string[] | null = Array.isArray(message.options)
              ? message.options.filter((o: unknown): o is string => typeof o === 'string')
              : null;
            const migrate = message.migrate === true;
            const deleteHistory = message.deleteHistory === true;
            if (migrate || deleteHistory) {
              const parts = [
                migrate ? 'migrate existing instances' : '',
                deleteHistory ? 'delete prior class versions' : '',
              ].filter(Boolean);
              const ok = await vscode.window.showWarningMessage(
                `This will COMMIT the transaction (${parts.join(' and ')}). Continue?`,
                { modal: true },
                'Apply & Commit',
              );
              if (ok !== 'Apply & Commit') {
                void panel.webview.postMessage({ command: 'busyDone' });
                return;
              }
            }
            const result = await handlers.apply(options, migrate, deleteHistory);
            finish(result);
          } else if (message?.command === 'cancel') {
            finish(undefined);
          }
        } catch (e: unknown) {
          loading = false;
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Instance-variable preview: ${msg}`);
          void panel.webview.postMessage({ command: 'busyDone' });
        }
      })();
    });

    panel.onDidDispose(() => finish(undefined));
  });
}
