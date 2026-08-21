import * as vscode from 'vscode';
import { ExternalServerReport, ReconcileChoice } from './externalServerReconcile';
import { reconcileMessage } from './externalServerReconcile';

const RESTART = 'Restart & Connect';
const AS_IS = 'Connect as-is';

/**
 * Ask what to do about servers running outside Jasper's environment.
 *
 * Modal, like the other prompts that interrupt a connect the user is waiting
 * on: a toast auto-hides and is suppressed under Do Not Disturb, and this one
 * asks about stopping a running stone.
 *
 * "Restart & Connect" appears only when the running server is confirmed to be
 * this database's. VS Code supplies the Cancel button on a modal dialog itself,
 * so there is none here — anything other than the two offered actions
 * (including dismissal) is a cancel.
 */
export async function confirmReconcileExternalServers(
  report: ExternalServerReport,
): Promise<ReconcileChoice> {
  const actions = report.confirmed ? [RESTART, AS_IS] : [AS_IS];
  const choice = await vscode.window.showWarningMessage(
    `"${report.stoneName}" was started outside Jasper`,
    { modal: true, detail: reconcileMessage(report) },
    ...actions,
  );
  if (choice === RESTART) return 'restart';
  if (choice === AS_IS) return 'as-is';
  return 'cancel';
}
