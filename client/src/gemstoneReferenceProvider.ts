import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { buildMethodUri } from './gemstoneFileSystemProvider';
import { dedupeMethodResults } from './queries/methodSearch';
import { sweepEnvironments } from './methodEnvironments';
import { SelectorResolver, sessionForDocument } from './gemstoneDefinitionProvider';
import * as queries from './browserQueries';

/** Find All References on a selector: the stone's senders of it, one location per method. */
export class GemStoneReferenceProvider implements vscode.ReferenceProvider {
  constructor(
    private sessionManager: SessionManager,
    private selectorResolver: SelectorResolver,
  ) {}

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[]> {
    const session = sessionForDocument(this.sessionManager, document);
    if (!session) return [];

    let selector: string | null;
    try {
      selector = await this.selectorResolver.getSelector(document.uri.toString(), position);
    } catch {
      return []; // LSP not ready
    }
    if (!selector) return [];

    const sel = selector;
    const all = sweepEnvironments((env) => queries.sendersOf(session, sel, env));
    return dedupeMethodResults(all).map(
      (r) =>
        new vscode.Location(
          buildMethodUri({ kind: 'method', sessionId: session.id, ...r }),
          new vscode.Position(0, 0),
        ),
    );
  }
}
