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

/**
 * The plan panel currently open, if any.
 *
 * One at a time. The panel is not modal, so a second Undo while one is open used to raise a
 * second panel for the SAME entry; applying both reversed it twice and spent an unrelated entry
 * (#396 review). A second Undo now reveals the open panel instead.
 */
let openPanel: vscode.WebviewPanel | undefined;

export function showUndoPlanPanel(plan: UndoPlan): Promise<boolean> {
  if (openPanel) {
    openPanel.reveal();
    // Not a decline and not an apply: the question is already on screen, and answering it is
    // what spends the entry.
    return Promise.resolve(false);
  }
  const panel = vscode.window.createWebviewPanel(
    'gemstoneUndoPlan',
    `${plan.verb} ${plan.label}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  openPanel = panel;
  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderUndoPlanHtml({ plan, nonce, script: panelJs });

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (accepted: boolean): void => {
      if (settled) return;
      settled = true;
      openPanel = undefined;
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
      openPanel = undefined;
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });
  });
}
