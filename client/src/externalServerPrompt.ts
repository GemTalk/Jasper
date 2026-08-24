import * as vscode from 'vscode';
import {
  ExternalServerReport,
  ReconcileChoice,
  reconcileMessage,
  reconcileTitle,
} from './externalServerReconcile';

const RESTART = 'Restart & Connect';
const AS_IS = 'Connect as-is';

/**
 * Ask what to do about servers running outside Jasper's environment.
 *
 * Modal, like the other prompts that interrupt a connect the user is waiting
 * on: a toast auto-hides and is suppressed under Do Not Disturb, and this one
 * asks about stopping a running stone.
 *
 * "Restart & Connect" appears whenever Jasper may act — which is not the same
 * as being sure whose server it is. An unidentifiable NetLDI may be restarted
 * (it holds no data, and it can never be identified, so refusing would make the
 * action permanently unreachable); an unidentifiable stone may not. VS Code supplies the Cancel button on a modal dialog itself,
 * so there is none here — anything other than the two offered actions
 * (including dismissal) is a cancel.
 */
export async function confirmReconcileExternalServers(
  report: ExternalServerReport,
): Promise<ReconcileChoice> {
  const actions = report.mayRestart ? [RESTART, AS_IS] : [AS_IS];
  const choice = await vscode.window.showWarningMessage(
    reconcileTitle(report),
    { modal: true, detail: reconcileMessage(report) },
    ...actions,
  );
  if (choice === RESTART) return 'restart';
  if (choice === AS_IS) return 'as-is';
  return 'cancel';
}
