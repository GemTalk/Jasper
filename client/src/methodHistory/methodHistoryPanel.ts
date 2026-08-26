/**
 * The per-method history viewer panel (read-only, this-stone-only). Shows every
 * recorded version of a method, newest first, with an inline diff against the
 * currently-installed version and offers a redo: "Restore this version" recompiles
 * a historical version's source as the new current version (never committing). The
 * caller supplies the handlers (which perform the restore/diff and return the
 * refreshed version list) so this stays UI-only; the panel confirms the redo,
 * refreshes its list in place, and reports the outcome.
 *
 * Undo is inherent and needs no special command: because a restore is itself
 * recorded, the version that was current just before it is still in the list, one
 * click away from being restored back.
 *
 * DOM behaviour lives in methodHistoryPanelView.js (read at runtime, injected
 * under a nonce), matching Jasper's webview convention.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { MethodVersion } from './methodHistoryModel';
import { renderMethodHistoryHtml, renderVersionRows } from './methodHistoryPanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('methodHistoryPanelView.js', 'methodHistory');

export interface MethodHistoryPanelHandlers {
  /** Recompile version `index` as the new current version (no commit) and return
   *  the refreshed version list. `error` is set (and versions unchanged) on
   *  failure — e.g. the version no longer compiles against the current class. */
  restore: (index: number) => Promise<{ versions: MethodVersion[]; error?: string }>;
  /** Open a side-by-side editor diff of version `index` against the current one. */
  diff: (index: number) => void | Promise<void>;
}

/** Open the history viewer for a method. Returns the panel. */
export function showMethodHistoryPanel(
  methodLabel: string,
  versions: MethodVersion[],
  handlers: MethodHistoryPanelHandlers,
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneMethodHistory',
    `Method History: ${methodLabel}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderMethodHistoryHtml({ methodLabel, versions, nonce, script: panelJs });

  let busy = false;
  const doRestore = async (index: number): Promise<void> => {
    const CONFIRM = 'Restore';
    const choice = await vscode.window.showWarningMessage(
      `Restore ${methodLabel} to version [${index}]? This recompiles that version's source as ` +
        'the new current version (a redo). Not committed — commit when ready.',
      { modal: true },
      CONFIRM,
    );
    if (choice !== CONFIRM) return;
    const { versions: refreshed, error } = await handlers.restore(index);
    if (error) {
      void vscode.window.showErrorMessage(`Restore failed: ${error}`);
      return;
    }
    void panel.webview.postMessage({ command: 'refresh', html: renderVersionRows(refreshed) });
    void vscode.window.showInformationMessage(
      `Restored ${methodLabel} to version [${index}] — recompiled as the new current version. ` +
        'Not committed — commit when ready. (Undo by restoring the previous version.)',
    );
  };
  panel.webview.onDidReceiveMessage((message) => {
    void (async () => {
      const isRestore = message?.command === 'restore';
      const isDiff = message?.command === 'diff';
      if ((!isRestore && !isDiff) || typeof message.index !== 'number') return;
      if (isDiff) {
        await handlers.diff(message.index);
        return;
      }
      if (busy) return;
      busy = true;
      try {
        await doRestore(message.index);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`Method history: ${msg}`);
      } finally {
        busy = false;
      }
    })();
  });

  return panel;
}
