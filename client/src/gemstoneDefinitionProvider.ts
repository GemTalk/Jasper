import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { buildMethodUri } from './gemstoneFileSystemProvider';
import { dedupeMethodResults } from './queries/methodSearch';
import * as queries from './browserQueries';

export interface SelectorResolver {
  getSelector(uri: string, position: vscode.Position): Promise<string | null>;
}

export class GemStoneDefinitionProvider implements vscode.DefinitionProvider {
  constructor(
    private sessionManager: SessionManager,
    private selectorResolver?: SelectorResolver,
  ) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[]> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return [];

    // 1. Try selector via LSP
    let selector: string | null = null;
    if (this.selectorResolver) {
      try {
        selector = await this.selectorResolver.getSelector(document.uri.toString(), position);
      } catch {
        /* LSP not ready */
      }
    }

    if (selector) {
      // `gemstone.maxEnvironment` is a CEILING, not a selection: sweep and fold. Same rule and
      // same failure as GemStoneHoverProvider — see the comment there.
      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
      const all: queries.MethodSearchResult[] = [];
      for (let env = 0; env <= maxEnv; env++) {
        all.push(...queries.implementorsOf(session, selector, env));
      }
      // Spread the row in: it carries the environment it was found in, and without that an
      // implementor above environment 0 opens the environment-0 method of the same name.
      return dedupeMethodResults(all).map(
        (r) =>
          new vscode.Location(
            buildMethodUri({ kind: 'method', sessionId: session.id, ...r }),
            new vscode.Position(0, 0),
          ),
      );
    }

    // 2. Try class name (uppercase identifier)
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return [];
    const word = document.getText(wordRange);
    if (!word || word[0] !== word[0].toUpperCase() || word[0] === word[0].toLowerCase()) {
      return [];
    }

    const classEntries = queries.getAllClassNames(session).filter((e) => e.className === word);
    return classEntries.map((e) => {
      const uri = vscode.Uri.parse(
        `gemstone://${session.id}` +
          `/${encodeURIComponent(e.dictName)}` +
          `/${encodeURIComponent(e.className)}` +
          `/definition`,
      );
      return new vscode.Location(uri, new vscode.Position(0, 0));
    });
  }
}
