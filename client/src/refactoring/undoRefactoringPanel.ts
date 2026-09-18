/**
 * The paginated UNDO-a-refactoring preview panel (issue #434). Shows the first page
 * of inverse changes and fetches further pages on demand ("More" / "Load all"); Undo
 * is server-side and reports only the deselected ids (so unloaded changes are undone
 * by default, exactly as a forward apply works). Resolves with the apply result, or
 * undefined if cancelled/closed. The caller supplies the page/apply/cleanup handlers
 * so this stays UI-only.
 *
 * Reuses renameMethodPanelView.js verbatim: the undo panel's DOM contract is
 * identical (same element ids, same `apply` / `loadMore` / `loadAll` / `cancel`
 * messages), so the checkbox bookkeeping, diff toggle and pagination have one
 * implementation rather than a second near-copy that could drift.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { UndoStartPreview, UndoPreviewPage, ApplyResult } from './undoRefactoringPreview';
import { renderUndoPanelHtml, renderUndoCards } from './undoRefactoringPanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('renameMethodPanelView.js', 'refactoring');

export interface UndoRefactoringPanelHandlers {
  /** Fetch the page starting at `offset` (1-based). */
  loadPage: (offset: number) => Promise<UndoPreviewPage>;
  /** Undo server-side, skipping `deselectedIds`; no commit. */
  apply: (deselectedIds: string[]) => Promise<ApplyResult>;
  /** Drop the preview session (called exactly once when the panel closes). */
  cleanup: () => void;
}

/** Show the paginated undo preview; resolve with the apply result, or undefined if
 *  the user cancelled/closed it. */
export function showUndoRefactoringPanel(
  start: UndoStartPreview,
  handlers: UndoRefactoringPanelHandlers,
): Promise<ApplyResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneUndoRefactoring',
    `Undo ${start.label}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderUndoPanelHtml({
    refactoringLabel: start.label,
    mechanism: start.mechanism,
    reverseKind: start.reverseKind,
    deselection: start.deselection,
    dropCount: start.dropCount,
    total: start.total,
    drifted: start.drifted,
    changes: start.page.changes,
    done: start.page.done,
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
        html: renderUndoCards(page.changes, start.mechanism, start.deselection),
        done,
      });
      return done;
    };

    // One page fetch (or the load-all loop) at a time — the session can't run two GCI
    // calls at once, and overlapping clicks would otherwise collide.
    let loading = false;
    // Undo is one-shot per panel: `handlers.apply` performs the inverse change set
    // server-side, so a second dispatch (a double-click, or a replayed webview message)
    // would run it twice. Cleared only in the catch below, which leaves the panel open
    // for a retry.
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
          void vscode.window.showErrorMessage(`Undo preview: ${msg}`);
          void panel.webview.postMessage({ command: 'busyDone' });
        }
      })();
    });

    panel.onDidDispose(() => finish(undefined));
  });
}
