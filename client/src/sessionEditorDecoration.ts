import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import {
  describeSession,
  multipleSessionMode,
  onDidChangeSessionMode,
} from './activeSessionDisplay';
import { isExplorerRowUri } from './activeEditorDecoration';

// Puts the session a gemstone:// editor is open on onto its tab, in multiple-
// session mode: the session number as the tab's badge, the full session in its
// hover. A tab's label is the URI's last path segment and the session is only in
// the authority, so otherwise the same method open in two sessions is two
// identical tabs. The session comes from the URI, not the selection: an editor
// stays on the session it was opened in when the active one changes.
export class SessionEditorDecorationProvider
  implements vscode.FileDecorationProvider, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this.changed.event;
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly sessionManager: SessionManager,
    openUris: () => vscode.Uri[] = openGemstoneTabUris,
  ) {
    // Only the mode changes an open tab's answer: a session's number and login are
    // fixed for its life, and its tabs are closed when it logs out. Firing the open
    // tabs rather than `undefined`, which would refresh every decoration in the
    // workbench (git badges included).
    this.subscription = onDidChangeSessionMode(() => this.changed.fire(openUris()));
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'gemstone' || isExplorerRowUri(uri) || !multipleSessionMode()) {
      return undefined;
    }
    const session = this.sessionManager.getSession(Number(uri.authority));
    if (!session) return undefined;
    return {
      // VS Code rejects a badge longer than two characters, and with it the whole
      // decoration, so a session numbered 100 or above keeps only the hover.
      badge: session.id < 100 ? String(session.id) : undefined,
      tooltip: describeSession(session),
      propagate: false,
    };
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }
}

function openGemstoneTabUris(): vscode.Uri[] {
  const uris: vscode.Uri[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'gemstone') {
        uris.push(tab.input.uri);
      }
    }
  }
  return uris;
}
