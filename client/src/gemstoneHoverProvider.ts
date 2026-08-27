import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { SelectorResolver } from './gemstoneDefinitionProvider';
import * as queries from './browserQueries';

export class GemStoneHoverProvider implements vscode.HoverProvider {
  constructor(
    private sessionManager: SessionManager,
    private selectorResolver?: SelectorResolver,
  ) {}

  /**
   * Senders counts, keyed by `selector|sessionId|maxEnv`. `sendersOf` blocks the
   * host and can be costly for a popular selector, and a hover fires on every mouse
   * rest — so once counted, a re-hover of the same selector is instant. (The
   * implementors count is free: the hover already runs `implementorsOf` to list
   * the classes.)
   */
  private sendersCountCache = new Map<string, number>();

  /**
   * A trusted markdown line of clickable senders/implementors links (#432). This
   * is where those counts live now — the source-editor CodeLens jiggled the code on
   * open, so the counts moved into this hover, out of the document flow. Each link
   * fires the same command the old lens did, opening the results panel.
   */
  private navLinks(selector: string, sessionId: number, sendersCount: number, implCount: number) {
    const arg = encodeURIComponent(JSON.stringify([{ selector, sessionId }]));
    // The quoted title after the URL is the link's tooltip; without it VS Code
    // shows the raw `command:…?%5B…` URI on hover (#432).
    const senders =
      `[$(references) ${sendersCount} sender${sendersCount === 1 ? '' : 's'}]` +
      `(command:gemstone.sendersOfSelector?${arg} "Browse senders of #${selector}")`;
    const impl =
      `[$(symbol-method) ${implCount} implementor${implCount === 1 ? '' : 's'}]` +
      `(command:gemstone.implementorsOfSelector?${arg} "Browse implementors of #${selector}")`;
    return `${senders}  ·  ${impl}`;
  }

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | null> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return null;

    // 1. Try selector → show implementors with categories
    let selector: string | null = null;
    if (this.selectorResolver) {
      try {
        selector = await this.selectorResolver.getSelector(document.uri.toString(), position);
      } catch {
        /* LSP not ready */
      }
    }

    if (selector) {
      const env = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
      // A thrown query (busy session, browser/RB plugin absent) must not reject
      // the whole hover — that silently shows nothing. Degrade to no implementors,
      // mirroring the sendersOf guard below.
      let results: ReturnType<typeof queries.implementorsOf>;
      try {
        results = queries.implementorsOf(session, selector, env);
      } catch {
        results = [];
      }

      // Senders count (cached — sendersOf is costly and a hover fires easily).
      const sKey = `${selector}|${session.id}|${env}`;
      let sendersCount = this.sendersCountCache.get(sKey);
      if (sendersCount === undefined) {
        try {
          sendersCount = queries.sendersOf(session, selector, env).length;
        } catch {
          sendersCount = 0;
        }
        this.sendersCountCache.set(sKey, sendersCount);
      }

      // Nothing to say if the selector is neither sent nor implemented anywhere.
      if (results.length === 0 && sendersCount === 0) return null;

      const md = new vscode.MarkdownString();
      md.supportThemeIcons = true;
      md.isTrusted = true; // required for the command: links below to be clickable
      md.appendMarkdown(`**#${selector}**\n\n`);
      md.appendMarkdown(this.navLinks(selector, session.id, sendersCount, results.length) + '\n\n');

      const show = results.slice(0, 10);
      for (const r of show) {
        const side = r.isMeta ? ' class' : '';
        md.appendMarkdown(`- \`${r.className}${side}\` (${r.category})\n`);
      }
      if (results.length > 10) {
        md.appendMarkdown(`\n...and ${results.length - 10} more`);
      }
      return new vscode.Hover(md);
    }

    // 2. Try class name → show comment
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    if (!word || word[0] !== word[0].toUpperCase() || word[0] === word[0].toLowerCase()) {
      return null;
    }

    const classEntries = queries.getAllClassNames(session).filter((e) => e.className === word);
    if (classEntries.length === 0) return null;

    const entry = classEntries[0];
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${word}** *${entry.dictName}*\n\n`);
    try {
      const comment = queries.getClassComment(session, word);
      if (comment) {
        const preview = comment.length > 500 ? comment.substring(0, 500) + '...' : comment;
        md.appendMarkdown(preview);
      }
    } catch {
      /* class not found */
    }
    return new vscode.Hover(md);
  }
}
