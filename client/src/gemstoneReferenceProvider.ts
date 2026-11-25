import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { buildMethodUri } from './gemstoneFileSystemProvider';
import { dedupeMethodResults } from './queries/methodSearch';
import { sweepEnvironmentsAsync } from './methodEnvironments';
import { SelectorResolver, sessionForDocument } from './selectorProviders';
import * as queries from './browserQueries';
import { BrowserQueryError } from './browserQueries';
import { NbCancelledError } from './nbRunner';
import { logError } from './gciLog';

/**
 * VS Code's Find All References on a selector: the stone's senders of it, one location per method.
 * GemStone Search's references are separate (`resolveReferencesUsing`) and still block.
 */
export class GemStoneReferenceProvider implements vscode.ReferenceProvider {
  constructor(
    private sessionManager: SessionManager,
    private selectorResolver: SelectorResolver,
  ) {}

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context?: vscode.ReferenceContext,
    token?: vscode.CancellationToken,
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
    // After a failure the rest are skipped, not asked: a busy session would refuse each of them
    // with its own notice.
    let failed = false;
    const all = await sweepEnvironmentsAsync(async (env) => {
      if (failed) return [];
      try {
        return await queries.sendersOfAsync(session, sel, env, token);
      } catch (e) {
        failed = true;
        // A query failure is logged where it is raised, and a cancel needs no word.
        if (!(e instanceof BrowserQueryError) && !(e instanceof NbCancelledError)) {
          logError(
            session.id,
            `Find All References: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        return [];
      }
    }, token);
    if (token?.isCancellationRequested) return [];
    return dedupeMethodResults(all).map(
      (r) =>
        new vscode.Location(
          buildMethodUri({ kind: 'method', sessionId: session.id, ...r }),
          new vscode.Position(0, 0),
        ),
    );
  }
}
