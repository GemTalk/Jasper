/**
 * The class-definition history viewer panel (read-only, this-stone-only). Shows
 * every version of a class's definition, newest first, and offers a redo:
 * "Restore this version" recompiles a historical version's shape + methods as a
 * new version (never committing). The caller supplies the restore handler (which
 * performs the redo query and returns the refreshed version list) so this stays
 * UI-only; the panel confirms the redo, refreshes its list in place, and reports
 * the outcome.
 *
 * DOM behaviour lives in classHistoryPanelView.js (read at runtime, injected under
 * a nonce), matching Jasper's webview convention.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ClassVersion, RevertResult, RemoveResult } from './classHistoryModel';
import { renderClassHistoryHtml, renderVersionRows } from './classHistoryPanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('classHistoryPanelView.js', 'refactoring');

export interface ClassHistoryPanelHandlers {
  /** Perform the redo (restore version `index` as a new version, no commit) and
   *  return the refreshed version list plus the raw result. */
  restore: (index: number) => Promise<{ result: RevertResult; versions: ClassVersion[] }>;
  /** Remove version `index` from the class history; returns the refreshed list. */
  remove: (index: number) => Promise<{ result: RemoveResult; versions: ClassVersion[] }>;
}

/** Open the history viewer for a class. Resolves when the panel is closed. */
export function showClassHistoryPanel(
  className: string,
  versions: ClassVersion[],
  handlers: ClassHistoryPanelHandlers,
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneClassHistory',
    `Class History: ${className}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderClassHistoryHtml({ className, versions, nonce, script: panelJs });

  let busy = false;
  const doRestore = async (index: number): Promise<void> => {
    const CONFIRM = 'Restore';
    const choice = await vscode.window.showWarningMessage(
      `Restore ${className} to version [${index}]? This recompiles that version's shape and ` +
        'methods as a NEW version (a redo).',
      { modal: true },
      CONFIRM,
    );
    if (choice !== CONFIRM) return;
    const { result, versions: refreshed } = await handlers.restore(index);
    if (result.error) {
      void vscode.window.showErrorMessage(`Restore failed: ${result.error}`);
      return;
    }
    void panel.webview.postMessage({ command: 'refresh', html: renderVersionRows(refreshed) });
    const failedNote =
      result.failed && result.failed > 0 ? ` (${result.failed} change(s) failed to compile)` : '';
    const asName = result.name && result.name !== className ? ` as ${result.name}` : '';
    void vscode.window.showInformationMessage(
      `Restored ${className} to version [${index}]${asName} (now version ` +
        `[${result.newIndex ?? '?'}])${failedNote}. Compiled but NOT committed — commit when ready.`,
    );
  };
  const doRemove = async (index: number): Promise<void> => {
    const CONFIRM = 'Remove';
    const choice = await vscode.window.showWarningMessage(
      `Remove version [${index}] of ${className} from its class history? Any instances still on ` +
        'that version will refer to a version no longer in the history. Not committed — commit when ready.',
      { modal: true },
      CONFIRM,
    );
    if (choice !== CONFIRM) return;
    const { result, versions: refreshed } = await handlers.remove(index);
    if (result.error) {
      void vscode.window.showErrorMessage(`Remove version failed: ${result.error}`);
      return;
    }
    void panel.webview.postMessage({ command: 'refresh', html: renderVersionRows(refreshed) });
    void vscode.window.showInformationMessage(
      `Removed version [${index}] of ${className} (${result.remaining ?? '?'} version(s) remain). ` +
        'Not committed — commit when ready.',
    );
  };
  panel.webview.onDidReceiveMessage((message) => {
    void (async () => {
      const isRestore = message?.command === 'restore';
      const isRemove = message?.command === 'remove';
      if ((!isRestore && !isRemove) || typeof message.index !== 'number') return;
      if (busy) return;
      busy = true;
      try {
        if (isRestore) await doRestore(message.index);
        else await doRemove(message.index);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`Class history: ${msg}`);
      } finally {
        busy = false;
      }
    })();
  });

  return panel;
}
