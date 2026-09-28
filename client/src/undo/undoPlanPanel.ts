/**
 * Showing an undo plan and waiting for the user to accept it.
 *
 * The panel every non-refactoring undo opens, so that "Undo" means one thing regardless of which
 * machinery recorded the change (#396 review). A refactoring keeps its own panel: its reversal is
 * paged from the stone and can span a hierarchy, so it needs more than a plan this side can build.
 *
 * Answers true when the user accepted, false when they cancelled or closed the panel. There is no
 * partial answer: the rows are fixed, because the reversers apply a plan whole.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { UndoPlan } from './undoPlan';
import { renderUndoPlanHtml } from './undoPlanPanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('undoPlanPanelView.js', 'undo');

export function showUndoPlanPanel(plan: UndoPlan): Promise<boolean> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneUndoPlan',
    `${plan.verb} ${plan.label}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderUndoPlanHtml({ plan, nonce, script: panelJs });

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (accepted: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(accepted);
      panel.dispose();
    };
    panel.webview.onDidReceiveMessage((m: unknown) => {
      const command = (m as { command?: string } | undefined)?.command;
      if (command === 'apply') finish(true);
      if (command === 'cancel') finish(false);
    });
    // Closing the panel is a decline, not a hang: the undo stack is untouched either way.
    panel.onDidDispose(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });
  });
}
