import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import * as queries from './browserQueries';
import { ClassNameEntry } from './browserQueries';

export class GemStoneWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
  private cache: ClassNameEntry[] | null = null;
  private cachedSessionId: number | null = null;

  constructor(private sessionManager: SessionManager) {
    sessionManager.onDidChangeSelection(() => this.invalidateCache());
  }

  invalidateCache(): void {
    this.cache = null;
    this.cachedSessionId = null;
  }

  async provideWorkspaceSymbols(query: string): Promise<vscode.SymbolInformation[]> {
    if (!query) return [];

    const session = this.sessionManager.getSelectedSession();
    if (!session) return [];

    try {
      if (this.cachedSessionId !== session.id || !this.cache) {
        this.cache = await queries.getAllClassNames(session);
        this.cachedSessionId = session.id;
      }
    } catch {
      return [];
    }

    const lower = query.toLowerCase();
    return this.cache
      .filter((e) => e.className.toLowerCase().includes(lower))
      .map((e) => {
        const uri = vscode.Uri.parse(
          `gemstone://${session.id}` +
            `/${encodeURIComponent(e.dictName)}` +
            `/${encodeURIComponent(e.className)}` +
            `/definition`,
        );
        return new vscode.SymbolInformation(
          e.className,
          vscode.SymbolKind.Class,
          e.dictName,
          new vscode.Location(uri, new vscode.Position(0, 0)),
        );
      });
  }
}
