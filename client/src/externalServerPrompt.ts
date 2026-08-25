import * as vscode from 'vscode';
import {
  ExternalServerReport,
  ReconcileChoice,
  RESTART_AND_CONNECT,
  RESTART_ONLY,
  reconcileMessage,
  reconcileTitle,
} from './externalServerReconcile';

const AS_IS = 'Connect as-is';
/** Same choice, from a caller with no login to attempt: it only means "leave
 *  the running servers alone". */
const LEAVE_AS_IS = 'Leave as-is';

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
  opts: { connects?: boolean } = {},
): Promise<ReconcileChoice> {
  // The Databases row's own action has no login to retry, so offering
  // "Restart & Connect" there promises something that will not happen.
  const connects = opts.connects !== false;
  const restart = connects ? RESTART_AND_CONNECT : RESTART_ONLY;
  const asIs = connects ? AS_IS : LEAVE_AS_IS;
  const actions = report.mayRestart ? [restart, asIs] : [asIs];
  const choice = await vscode.window.showWarningMessage(
    reconcileTitle(report),
    { modal: true, detail: reconcileMessage(report, restart) },
    ...actions,
  );
  if (choice === restart) return 'restart';
  if (choice === asIs) return 'as-is';
  return 'cancel';
}
