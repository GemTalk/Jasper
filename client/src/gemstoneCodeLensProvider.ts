import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { parseTopazDocument } from './topazFileIn';
import { extractSelector } from './systemBrowser';
import * as queries from './browserQueries';

interface CodeLensData {
  selector: string;
  className?: string;
  isMeta: boolean;
  // Each method contributes two lenses on the same line: one for senders,
  // one for implementors. Keeping them as separate CodeLens objects (rather
  // than one lens with a combined "N senders | M implementors" title that
  // dispatches to senders only) gives the user two clickable links — one
  // per concept — and lets each link compute only its own count.
  kind: 'senders' | 'implementors';
}

/** Files `gemstone.fileInFile` can act on — the same pair of terms its editor menus
 *  are gated on, so the lens and the title-bar button appear on exactly the files. A
 *  `gemstone://` method is not a file on disk; a `.gst`/`.st` is not Topaz. */
function isFileInTarget(document: vscode.TextDocument): boolean {
  return document.uri.scheme === 'file' && document.languageId === 'gemstone-topaz';
}

/** The "file this in" link, at the very top of the document. Names its own document
 *  rather than letting the command fall back to the active editor, so the lens files
 *  in the file it is sitting on however focus happens to be arranged. */
function fileInLens(document: vscode.TextDocument): vscode.CodeLens {
  const top = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
  return new vscode.CodeLens(top, {
    title: '$(desktop-download) File In to GemStone',
    command: 'gemstone.fileInFile',
    arguments: [document.uri],
  });
}

export class GemStoneCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  /** Pending {@link scheduleCount} timers, so disposal can cancel deferred lookups
   *  (which would otherwise run blocking GCI against a torn-down session). */
  private countTimers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  private codeLensData = new Map<vscode.CodeLens, CodeLensData>();

  /**
   * Cache of resolved senders/implementors counts. Each `resolveCodeLens` runs
   * server `sendersOf`/`implementorsOf` lookups, which are costly for a popular
   * selector (hundreds of hits). VS Code re-resolves a document's lenses whenever
   * ANY CodeLens provider on that document fires a change — e.g. the debugger's
   * inline-values toggle — so without this cache every such toggle re-counted
   * senders/implementors (seconds for a method like `initialize`). Keyed by
   * kind|selector|class|meta|session|maxEnv; cleared on `refresh()`. Counts are
   * already effectively static between refreshes (this provider doesn't re-fire on
   * recompile today), so caching introduces no new staleness.
   */
  private countCache = new Map<string, number>();

  /**
   * Counts currently being computed (keyed like {@link countCache}). The
   * sendersOf/implementorsOf lookups BLOCK the extension host — for a popular
   * selector (`initialize`: hundreds of hits) that freeze lasts seconds. So a
   * lens shows a spinner placeholder and the count is computed on a later tick
   * ({@link scheduleCount}); the spinner paints first and keeps animating (it
   * lives in the editor's process, not the frozen host) until the count lands.
   * This set dedupes concurrent re-resolves so the lookup runs once per key.
   */
  private pending = new Set<string>();

  constructor(private sessionManager: SessionManager) {}

  refresh(): void {
    this.countCache.clear();
    this.pending.clear();
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    this.codeLensData.clear();

    if (document.uri.scheme === 'gemstone') {
      return this.provideGemstoneCodeLenses(document);
    }

    // Topaz file — parse regions
    const text = document.getText();

    // A `.gs`/`.tpz` on disk is the one thing File In reads, and a user looking at one
    // has nowhere obvious to go: the command is an icon in the title bar, an entry in
    // a right-click menu, or palette wording they have to already know (#539). One
    // lens at the top says it in words, in the document itself.
    //
    // Built with its command already set rather than filled in by resolveCodeLens: a
    // lens that arrives late shoves the source down after first paint, which is the
    // jiggle #432 took the senders/implementors lenses off `gemstone://` methods for.
    if (isFileInTarget(document) && text.trim().length > 0) {
      lenses.push(fileInLens(document));
    }

    const regions = parseTopazDocument(text);

    for (const region of regions) {
      if (region.kind !== 'smalltalk-method') continue;

      const firstLine = region.text.split('\n')[0];
      const selector = extractSelector(firstLine);
      if (!selector) continue;

      const range = new vscode.Range(
        new vscode.Position(region.startLine, 0),
        new vscode.Position(region.startLine, 0),
      );
      const isMeta = region.command === 'classmethod';
      lenses.push(...this.makeMethodLenses(range, selector, region.className, isMeta));
    }

    return lenses;
  }

  private provideGemstoneCodeLenses(_document: vscode.TextDocument): vscode.CodeLens[] {
    // #432: the editable gemstone:// method editor no longer carries a
    // senders/implementors CodeLens (it appeared after first paint and shoved the
    // source down — the "jiggle"). Those counts now live in the selector hover
    // (GemStoneHoverProvider) as clickable links, which is out of the document flow
    // and can't move the source. The topaz/file paths above keep their lenses.
    return [];
  }

  // Emit the senders + implementors pair on the same range, in that order.
  // VS Code preserves insertion order on a given range, so the user always
  // sees senders to the left of implementors.
  private makeMethodLenses(
    range: vscode.Range,
    selector: string,
    className: string | undefined,
    isMeta: boolean,
  ): vscode.CodeLens[] {
    const out: vscode.CodeLens[] = [];
    for (const kind of ['senders', 'implementors'] as const) {
      const lens = new vscode.CodeLens(range);
      this.codeLensData.set(lens, { selector, className, isMeta, kind });
      out.push(lens);
    }
    return out;
  }

  resolveCodeLens(codeLens: vscode.CodeLens): vscode.CodeLens {
    const data = this.codeLensData.get(codeLens);
    if (!data) return codeLens;

    const session = this.sessionManager.getSelectedSession();
    if (!session) {
      codeLens.command = {
        title: 'No session',
        command: '',
      };
      return codeLens;
    }

    const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
    // Each lens computes only its own count. Cached so a forced re-resolve
    // (another provider on this doc changing) doesn't repeat the server work.
    const cacheKey = `${data.kind}|${data.selector}|${data.className ?? ''}|${data.isMeta}|${session.id}|${maxEnv}`;

    const count = this.countCache.get(cacheKey);
    if (count !== undefined) {
      codeLens.command = this.countCommand(count, data, session.id);
      return codeLens;
    }

    // Not counted yet: show a spinner and compute on a later tick (see
    // `pending`). When the count lands, scheduleCount fires a change so VS Code
    // re-resolves this lens — now a cache hit — and the number replaces the spin.
    this.scheduleCount(data, session, maxEnv, cacheKey);
    const noun = data.kind === 'senders' ? 'senders' : 'implementors';
    codeLens.command = { title: `$(loading~spin) ${noun}…`, command: '' };
    return codeLens;
  }

  /** The resolved link for a known count (singular/plural + click command). */
  private countCommand(count: number, data: CodeLensData, sessionId: number): vscode.Command {
    const noun = data.kind === 'senders' ? 'sender' : 'implementor';
    const title = count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
    const command =
      data.kind === 'senders' ? 'gemstone.sendersOfSelector' : 'gemstone.implementorsOfSelector';
    return { title, command, arguments: [{ selector: data.selector, sessionId }] };
  }

  /**
   * Compute a senders/implementors count off the resolve path so the spinner
   * placeholder renders first, then cache it and fire a change to re-resolve.
   * Deferred (not awaited) because the lookups block the host; running them here
   * — after the placeholder is already on screen — keeps the spin visible.
   */
  private scheduleCount(
    data: CodeLensData,
    session: ActiveSession,
    maxEnv: number,
    cacheKey: string,
  ): void {
    if (this.pending.has(cacheKey)) return;
    this.pending.add(cacheKey);
    const timer = setTimeout(() => {
      this.countTimers.delete(timer);
      if (this.disposed) return; // editor/extension torn down before the timer fired
      let count = 0;
      for (let env = 0; env <= maxEnv; env++) {
        try {
          count +=
            data.kind === 'senders'
              ? queries.sendersOf(session, data.selector, env).length
              : queries.implementorsOf(session, data.selector, env).length;
        } catch {
          // Session may be busy or selector not found in this env
        }
      }
      this.countCache.set(cacheKey, count);
      this.pending.delete(cacheKey);
      this._onDidChangeCodeLenses.fire();
    }, 0);
    this.countTimers.add(timer);
  }

  /** Cancel pending count lookups and release the change emitter on teardown. */
  dispose(): void {
    this.disposed = true;
    for (const timer of this.countTimers) clearTimeout(timer);
    this.countTimers.clear();
    this.pending.clear();
    this._onDidChangeCodeLenses.dispose();
  }
}
