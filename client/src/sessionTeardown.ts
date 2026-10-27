import * as vscode from 'vscode';
import type { SessionManager } from './sessionManager';
import { forgetSession as forgetSessionPins } from './exportSetPins';
import { EnhancedInspector } from './enhancedInspector/enhancedInspector';
import { BasicInspector } from './basicInspector/basicInspector';
import { DebuggerPanel } from './debugger/debuggerPanel';

/**
 * Close a session's inspectors and debuggers and clear its breakpoints and pins
 * whenever any logout removes it from the manager — stopping its stone and a
 * logical restore as well as the Logout command.
 *
 * The manager announces a removal only once the logout has freed the session
 * (or found it already gone), so whatever a closing panel still sends it fails
 * at once instead of waiting on the gem. Its `gemstone://` tabs are closed by the stale-tab reaper, which
 * listens for the same removal.
 */
export function registerSessionTeardown(
  sessions: Pick<SessionManager, 'onDidRemoveSession'>,
  breakpoints: { clearAllForSession(sessionId: number): void },
  stepPointHints: { refresh(): void },
): vscode.Disposable {
  return sessions.onDidRemoveSession((id) => {
    // Before the panels close: the export set went with the session, so a
    // panel releasing its pins would only fail against the logged-out handle.
    forgetSessionPins(id);
    EnhancedInspector.disposeForSession(id);
    BasicInspector.disposeForSession(id);
    DebuggerPanel.disposeForSession(id);
    breakpoints.clearAllForSession(id);
    stepPointHints.refresh();
  });
}
