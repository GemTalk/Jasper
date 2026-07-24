/**
 * The paginated extract-method (M1) preview panel. Shows the two required core
 * changes plus any deselectable duplicate sites, fetches further pages on demand,
 * and applies server-side reporting only the DESELECTED ids (so the core changes,
 * whose checkboxes are disabled, always apply). Resolves with the apply result, or
 * undefined if cancelled/closed. UI-only: the caller supplies the page/apply/cleanup
 * handlers.
 *
 * Reuses Jasper's webview convention and the shared renameMethodPanelView.js (read
 * at runtime, injected under a nonce) for checkbox/diff/pagination/apply behaviour.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { StartExtractPreview, PreviewPage, ApplyResult } from './extractMethodPreview';
import { renderExtractPanelHtml, renderExtractCards } from './extractMethodPanelHtml';
import { readRefactoringWebviewScript } from './webviewAssets';

const panelJs = readRefactoringWebviewScript('renameMethodPanelView.js');

/** The two leading changes (new method + rewritten original) are always required. */
const CORE_COUNT = 2;

export interface ExtractMethodPanelHandlers {
  /** Fetch the page starting at `offset` (1-based). */
  loadPage: (offset: number) => Promise<PreviewPage>;
  /** Apply server-side, skipping `deselectedIds` (duplicates only); no commit. */
  apply: (deselectedIds: string[]) => Promise<ApplyResult>;
  /** Drop the preview session (called exactly once when the panel closes). */
  cleanup: () => void;
}

/** Show the paginated preview; resolve with the apply result, or undefined if the
 *  user cancelled/closed it. */
export function showExtractMethodPanel(
  newSelector: string,
  start: StartExtractPreview,
  handlers: ExtractMethodPanelHandlers,
): Promise<ApplyResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneExtractMethod',
    `Extract method ${newSelector}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderExtractPanelHtml({
    newSelector,
    total: start.total,
    coreCount: CORE_COUNT,
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
        html: renderExtractCards(page.changes, loaded, CORE_COUNT),
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
          void vscode.window.showErrorMessage(`Extract preview: ${msg}`);
          void panel.webview.postMessage({ command: 'busyDone' });
        }
      })();
    });

    panel.onDidDispose(() => finish(undefined));
  });
}
