import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from './sessionManager';

/** Asks the language server for the selector at a position in a document. */
export interface SelectorResolver {
  getSelector(uri: string, position: vscode.Position): Promise<string | null>;
}

/**
 * A method opened from the stone answers from the session it was opened in, which need not be
 * the selected one; the language server leaves its implementors and senders to the stone.
 */
export function sessionForDocument(
  sessionManager: SessionManager,
  document: vscode.TextDocument,
): ActiveSession | undefined {
  if (document.uri.scheme !== 'gemstone') return sessionManager.getSelectedSession();
  const id = Number(document.uri.authority);
  return sessionManager.getSessions().find((s) => s.id === id);
}
