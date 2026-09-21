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
      // `gemstone.maxEnvironment` is a CEILING, not a selection — sweep 0..max and fold, the
      // same shape as the gemstone.implementorsOfSelector command and the senders/implementors
      // CodeLens. Passing it straight through as the environment id asked about that one
      // environment instead, and almost nothing is compiled above 0, so with the setting raised
      // this answered no implementors for EVERY selector and Go to Definition did nothing.
      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
      const all: queries.MethodSearchResult[] = [];
      for (let env = 0; env <= maxEnv; env++) {
        all.push(...queries.implementorsOf(session, selector, env));
      }
      // Each row carries the environment it was found in, so spread it into the URI rather than
      // rebuilding one by hand: an implementor above environment 0 otherwise opens the
      // environment-0 method of the same name, or nothing.
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
