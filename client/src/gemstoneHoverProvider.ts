import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { SelectorResolver, sessionForDocument } from './selectorProviders';
import { dedupeMethodResults } from './queries/methodSearch';
import { compareMethods } from './methodOrder';
import { maxEnvironment, sweepEnvironments } from './methodEnvironments';
import * as queries from './browserQueries';
import { onDidChangeMethods } from './methodsChanged';

/** A senders or implementors count, or why it couldn't be had: a lookup that threw
 *  in any environment leaves only part of the total, so none is shown. */
interface Count {
  value: number;
  failure?: string;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `text` as a markdown link title in double quotes: one line, with `\` and `"` escaped,
 *  since a blank line or an unescaped one ends the title and breaks the link. */
function linkTitle(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\\"]/g, '\\$&');
}

export class GemStoneHoverProvider implements vscode.HoverProvider, vscode.Disposable {
  /** @param methodsChanged fires when methods may have changed on the stone, so every count is stale. */
  constructor(
    private sessionManager: SessionManager,
    private selectorResolver?: SelectorResolver,
    methodsChanged: vscode.Event<unknown> = onDidChangeMethods,
  ) {
    this.methodsChangedSubscription = methodsChanged(() => this.sendersCountCache.clear());
  }

  private methodsChangedSubscription: vscode.Disposable;

  dispose(): void {
    this.methodsChangedSubscription.dispose();
  }

  /**
   * Senders counts, keyed by `selector|sessionId|maxEnv`. `sendersOf` blocks the
   * host and can be costly for a popular selector, and a hover fires on every mouse
   * rest — so once counted, a re-hover of the same selector is instant. (The
   * implementors count is free: the hover already runs `implementorsOf` to list
   * the classes.) A failed count is kept too, so a lost connection isn't asked again on
   * every hover; a busy refusal is not. Cleared when methods change on the stone.
   */
  private sendersCountCache = new Map<string, Count>();

  /**
   * A trusted markdown line of clickable senders/implementors links (#432). This
   * is where those counts live now — the source-editor CodeLens jiggled the code on
   * open, so the counts moved into this hover, out of the document flow. Each link
   * fires the same command the old lens did, opening the results panel.
   */
  private navLinks(selector: string, sessionId: number, senders: Count, implementors: Count) {
    const arg = encodeURIComponent(JSON.stringify([{ selector, sessionId }]));
    // The quoted title after the URL is the link's tooltip; without it VS Code
    // shows the raw `command:…?%5B…` URI on hover (#432).
    const link = (icon: string, noun: string, command: string, count: Count) => {
      const label =
        count.failure !== undefined
          ? `${noun}s`
          : `${count.value} ${noun}${count.value === 1 ? '' : 's'}`;
      const tooltip =
        count.failure !== undefined
          ? `Count unavailable: ${count.failure}`
          : `Browse ${noun}s of #${selector}`;
      return `[$(${icon}) ${label}](command:${command}?${arg} "${linkTitle(tooltip)}")`;
    };
    return (
      link('references', 'sender', 'gemstone.sendersOfSelector', senders) +
      '  ·  ' +
      link('symbol-method', 'implementor', 'gemstone.implementorsOfSelector', implementors)
    );
  }

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | null> {
    const session = sessionForDocument(this.sessionManager, document);
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
      // Captured as a const: TypeScript drops the null-narrowing inside the sweep callbacks.
      const sel = selector;
      // `gemstone.maxEnvironment` is a ceiling — see sweepEnvironments, which carries the rule.
      // A thrown query (browser/RB plugin absent, lost connection) must not reject the whole
      // hover; that silently shows nothing. Guarding INSIDE the callback rather than around the
      // sweep keeps what the other environments found for the list; the count, like the
      // CodeLens's, is left off, since it would be only part of the total. A busy session's
      // refusal is different: it says nothing about the answer, so the hover shows nothing.
      let refused = false;
      const failureOf = (e: unknown): string => {
        if (queries.isBusyRefusal(e)) refused = true;
        return messageOf(e);
      };
      let implementorsFailure: string | undefined;
      const results = dedupeMethodResults(
        sweepEnvironments((env) => {
          try {
            return queries.quietly(() => queries.implementorsOf(session, sel, env));
          } catch (e) {
            implementorsFailure ??= failureOf(e);
            return [];
          }
        }),
      ).sort(compareMethods);

      // Senders count (cached — sendersOf is costly and a hover fires easily).
      const sKey = `${sel}|${session.id}|${maxEnvironment()}`;
      let senders = this.sendersCountCache.get(sKey);
      if (senders === undefined) {
        // Summed, not folded: a sweep stamps each row with the environment it was found
        // in, so no row from one environment can duplicate a row from another, and this
        // has to agree with the senders/implementors CodeLens, which sums the same way.
        let failure: string | undefined;
        const value = sweepEnvironments((env) => {
          try {
            return queries.quietly(() => queries.sendersOf(session, sel, env));
          } catch (e) {
            failure ??= failureOf(e);
            return [];
          }
        }).length;
        senders = { value, failure };
        if (!refused) this.sendersCountCache.set(sKey, senders);
      }
      if (refused) return null;

      // Nothing to say if the selector is known to be neither sent nor implemented anywhere.
      if (
        results.length === 0 &&
        senders.value === 0 &&
        implementorsFailure === undefined &&
        senders.failure === undefined
      ) {
        return null;
      }

      const md = new vscode.MarkdownString();
      md.supportThemeIcons = true;
      md.isTrusted = true; // required for the command: links below to be clickable
      md.appendMarkdown(`**#${selector}**\n\n`);
      md.appendMarkdown(
        this.navLinks(selector, session.id, senders, {
          value: results.length,
          failure: implementorsFailure,
        }) + '\n\n',
      );

      const show = results.slice(0, 10);
      for (const r of show) {
        const side = r.isMeta ? ' class' : '';
        // The same selector on the same class in two environments is two different methods and
        // both are kept, so name the environment or the list reads as a repeated row.
        const env = r.environmentId > 0 ? ` · env ${r.environmentId}` : '';
        md.appendMarkdown(`- \`${r.className}${side}\` (${r.category})${env}\n`);
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

    const classEntries = queries
      .quietly(() => queries.getAllClassNames(session))
      .filter((e) => e.className === word);
    if (classEntries.length === 0) return null;

    const entry = classEntries[0];
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${word}** *${entry.dictName}*\n\n`);
    try {
      // The synthesised comment is wanted here: a class with none still hovers with
      // its hierarchy, which is the useful thing to see. Only the editable
      // gemstone:// comment document opens on the stored text — see
      // getStoredClassComment.
      const comment = queries.quietly(() => queries.getClassComment(session, word));
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
