import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { SelectorResolver, sessionForDocument } from './selectorProviders';
import { buildMethodUri } from './gemstoneFileSystemProvider';
import { dedupeMethodResults } from './queries/methodSearch';
import { sweepEnvironments } from './methodEnvironments';
import * as queries from './browserQueries';

export class GemStoneDefinitionProvider implements vscode.DefinitionProvider {
  constructor(
    private sessionManager: SessionManager,
    private selectorResolver?: SelectorResolver,
  ) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[]> {
    const session = sessionForDocument(this.sessionManager, document);
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
      // Captured as a const: TypeScript drops the null-narrowing inside the sweep callback.
      const sel = selector;
      // `gemstone.maxEnvironment` is a ceiling — see sweepEnvironments, which carries the rule.
      // Quiet, and empty on a throw: a Find All References search can hold the session in the
      // background, and a refusal then must not raise a notice or lose the other environments.
      const all = sweepEnvironments((env) => {
        try {
          return queries.quietly(() => queries.implementorsOf(session, sel, env));
        } catch {
          return [];
        }
      });
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

    let classNames: ReturnType<typeof queries.getAllClassNames>;
    try {
      classNames = queries.quietly(() => queries.getAllClassNames(session));
    } catch {
      return [];
    }
    const classEntries = classNames.filter((e) => e.className === word);
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
