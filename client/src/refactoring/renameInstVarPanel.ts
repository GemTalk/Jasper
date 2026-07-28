/**
 * A custom webview panel that previews a rename-instance-variable change set:
 * one card per staged change, each with a checkbox (all checked by default), a
 * label + category, and an inline before/after diff. The user unchecks any
 * change they don't want and hits Apply — one click applies everything by
 * default. `show` resolves with the selected change ids, or undefined if the
 * user cancels or closes the panel; the caller performs the (non-committing)
 * recompile so this stays UI-only and testable.
 *
 * Follows Jasper's webview conventions: the DOM logic lives in the sibling
 * renameInstVarPanel.js (read at runtime, injected under a nonce) so it can be
 * unit-tested in jsdom, and the HTML is themed with vscode CSS variables.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { RenameChange } from './renameInstVarPreview';
import { renderRenamePanelHtml } from './renameInstVarPanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('renameInstVarPanelView.js', 'refactoring');

/**
 * Show the rename preview and resolve with the ids of the changes the user chose
 * to apply (in the order given), or undefined if they cancelled/closed it.
 */
export function showRenameInstVarPanel(
  oldName: string,
  newName: string,
  changes: RenameChange[],
): Promise<string[] | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneRenameInstVar',
    `Rename ${oldName} → ${newName}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderRenamePanelHtml({ oldName, newName, changes, nonce, script: panelJs });

  return new Promise<string[] | undefined>((resolve) => {
    let settled = false;
    const finish = (result: string[] | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(result);
      panel.dispose();
    };
    panel.webview.onDidReceiveMessage((message) => {
      if (message?.command === 'apply') {
        const ids: string[] = Array.isArray(message.ids) ? message.ids : [];
        // Preserve the caller's ordering (class definition first) regardless of
        // the order the webview reported the checked ids.
        finish(changes.map((c) => c.id).filter((id) => ids.includes(id)));
      } else if (message?.command === 'cancel') {
        finish(undefined);
      }
    });
    panel.onDidDispose(() => finish(undefined));
  });
}
