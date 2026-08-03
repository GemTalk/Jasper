/**
 * The shared paginated preview-panel scaffold for the method-relocation families
 * (move-method M6, push-up / push-down M7 / M8). The two families' panels were
 * line-for-line identical except for the webview view-type, the render functions, and
 * the error-toast prefix; this module holds the one copy. UI-only: the caller supplies
 * the render/page/apply/cleanup handlers.
 *
 * Reuses Jasper's webview convention and the shared renameMethodPanelView.js (read at
 * runtime, injected under a nonce) for diff/pagination/apply behaviour. The view derives
 * the deselected set from UNCHECKED boxes, so families whose rows are all required
 * report an empty set (apply passes it through unchanged).
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { readWebviewScript } from '../webviewAssets';
import {
  BaseMethodChange,
  RelocationApplyResult,
  RelocationPreviewPage,
  StartRelocationPreview,
} from './methodRelocationPreview';

const panelJs = readWebviewScript('renameMethodPanelView.js', 'refactoring');

export interface MethodRelocationPanelHandlers<C extends BaseMethodChange> {
  /** Fetch the page starting at `offset` (1-based). */
  loadPage: (offset: number) => Promise<RelocationPreviewPage<C>>;
  /** Apply server-side, skipping `deselectedIds`; no commit. */
  apply: (deselectedIds: string[]) => Promise<RelocationApplyResult>;
  /** Drop the preview session (called exactly once when the panel closes). */
  cleanup: () => void;
}

export interface MethodRelocationPanelConfig<C extends BaseMethodChange> {
  /** The webview view-type id, e.g. `gemstoneMoveMethod`. */
  viewType: string;
  /** The panel's window title. */
  title: string;
  /** Render the whole panel document for the first page. */
  renderHtml: (nonce: string, script: string) => string;
  /** Render a batch of cards to append when a further page loads. */
  renderCards: (changes: C[]) => string;
  /** Prefix for error toasts, e.g. "Move preview" / "Push preview". */
  errorPrefix: string;
}

/** Show the paginated preview; resolve with the apply result, or undefined if the
 *  user cancelled/closed it. */
export function showMethodRelocationPanel<C extends BaseMethodChange>(
  start: StartRelocationPreview<C>,
  config: MethodRelocationPanelConfig<C>,
  handlers: MethodRelocationPanelHandlers<C>,
): Promise<RelocationApplyResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    config.viewType,
    config.title,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = config.renderHtml(nonce, panelJs);

  let offset = start.page.nextOffset;
  let done = start.page.done;

  return new Promise<RelocationApplyResult | undefined>((resolve) => {
    let settled = false;
    const finish = (result: RelocationApplyResult | undefined): void => {
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
        html: config.renderCards(page.changes),
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
          void vscode.window.showErrorMessage(`${config.errorPrefix}: ${msg}`);
          void panel.webview.postMessage({ command: 'busyDone' });
        }
      })();
    });

    panel.onDidDispose(() => finish(undefined));
  });
}
