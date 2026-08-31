import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { buildMethodUri } from './gemstoneFileSystemProvider';
import * as queries from './browserQueries';
import { GemStoneBreakpoint } from './browserQueries';
import { BreakpointManager } from './breakpointManager';

/** A class (or metaclass) heading, or one breakpoint under it. */
export type BreakpointNode =
  | { kind: 'class'; className: string; isMeta: boolean; breakpoints: GemStoneBreakpoint[] }
  | { kind: 'breakpoint'; bp: GemStoneBreakpoint }
  | { kind: 'notice'; text: string; icon?: string };

/** Label for a class heading — `Foo class` for the metaclass, as Smalltalk writes it. */
export function classLabel(className: string, isMeta: boolean): string {
  if (className === '') return '(executed code)';
  return isMeta ? `${className} class` : className;
}

/**
 * Group the gem's flat breakpoint list into class headings, sorted the way a
 * developer scans for one: classes alphabetically, and within a class by
 * selector then step point. Instance side sorts before class side for the same
 * name, so the two halves of a class stay adjacent rather than interleaving.
 *
 * Breakpoints in executed code (a doit) carry no class, and collect under a
 * single heading at the end — they can't be navigated to, but they still have to
 * be visible and clearable, since a stray one silently stops every evaluation.
 */
export function groupBreakpoints(breakpoints: GemStoneBreakpoint[]): BreakpointNode[] {
  // Keyed by class *and* side, with the parts carried in the value rather than
  // encoded into the key and split back out — a class name and a boolean have no
  // separator that is obviously safe, and there is no need to invent one.
  const groups = new Map<
    string,
    { className: string; isMeta: boolean; list: GemStoneBreakpoint[] }
  >();
  for (const bp of breakpoints) {
    const key = `${bp.isMeta ? 'meta' : 'inst'}:${bp.className}`;
    const group = groups.get(key);
    if (group) group.list.push(bp);
    else groups.set(key, { className: bp.className, isMeta: bp.isMeta, list: [bp] });
  }

  const nodes: BreakpointNode[] = [];
  for (const { className, isMeta, list } of groups.values()) {
    nodes.push({
      kind: 'class',
      className,
      isMeta,
      breakpoints: [...list].sort(
        (a, b) => a.selector.localeCompare(b.selector) || a.stepPoint - b.stepPoint,
      ),
    });
  }

  nodes.sort((a, b) => {
    if (a.kind !== 'class' || b.kind !== 'class') return 0;
    // Doits last — they're the odd ones out and nothing navigates to them.
    if (a.className === '') return b.className === '' ? 0 : 1;
    if (b.className === '') return -1;
    return a.className.localeCompare(b.className) || Number(a.isMeta) - Number(b.isMeta);
  });
  return nodes;
}

/**
 * The breakpoint manager: every breakpoint in the current session's gem, with
 * the operations that act on all of them at once.
 *
 * Deliberately shows the **gem's** breakpoints rather than mirroring VS Code's
 * Breakpoints view. The two answer different questions. VS Code's view is
 * Jasper's durable model — what you asked for, per file, surviving restarts. This
 * one is ground truth for the session you are actually debugging: it resolves
 * each breakpoint to the step point it really landed on, shows which are
 * disabled, and surfaces breakpoints Jasper never set — from topaz, another
 * tool, or a `halt` left in the code — which the VS Code view cannot know about
 * and which are otherwise invisible right up until execution stops on one.
 *
 * Enable/disable is a checkbox per row, matching how VS Code's own Breakpoints
 * view works; the manager routes each flip to VS Code's model or straight to the
 * gem depending on whether Jasper owns that breakpoint.
 */
export class BreakpointTreeProvider implements vscode.TreeDataProvider<BreakpointNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Last fetch, so a checkbox flip doesn't have to re-query to find its row. */
  private lastFetch: GemStoneBreakpoint[] = [];

  /** Pending coalesced refresh — see `refresh`. */
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private sessionManager: SessionManager,
    private breakpoints: BreakpointManager,
  ) {}

  register(context: vscode.ExtensionContext): void {
    const view = vscode.window.createTreeView('gemstoneBreakpoints', {
      treeDataProvider: this,
      showCollapseAll: true,
    });
    context.subscriptions.push(
      view,
      this._onDidChangeTreeData,
      // A pending refresh must not outlive the view it would redraw.
      {
        dispose: () => {
          if (this.refreshTimer) clearTimeout(this.refreshTimer);
        },
      },
      view.onDidChangeCheckboxState((e) => {
        for (const [node, state] of e.items) {
          if (node.kind !== 'breakpoint') continue;
          this.breakpoints.setEnabledForStoneBreakpoint(
            node.bp,
            state === vscode.TreeItemCheckboxState.Checked,
          );
        }
        this.refresh();
      }),
      // Re-read the gem whenever breakpoints are pushed to it, so the view is
      // never stale after a gutter click or a global enable/disable.
      this.breakpoints.onDidApply(() => this.refresh()),
      this.sessionManager.onDidChangeSelection(() => this.refresh()),
    );
  }

  /**
   * Redraw the view, coalescing bursts.
   *
   * Every redraw costs a GCI round trip, and the events that trigger one arrive
   * in batches — the manager applies breakpoints one method at a time, so
   * changing five methods (or re-applying them all after a login) would
   * otherwise mean five queries for the same answer. One tick's delay collapses
   * a batch into a single fetch and is imperceptible in a tree view.
   */
  refresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this._onDidChangeTreeData.fire();
    }, 50);
  }

  /** Redraw now, for a test that must not wait on the coalescing timer. */
  refreshNow(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: BreakpointNode): vscode.TreeItem {
    if (element.kind === 'notice') {
      const item = new vscode.TreeItem(element.text);
      item.iconPath = new vscode.ThemeIcon(element.icon ?? 'info');
      item.contextValue = 'gemstoneBreakpointNotice';
      return item;
    }

    if (element.kind === 'class') {
      const item = new vscode.TreeItem(
        classLabel(element.className, element.isMeta),
        vscode.TreeItemCollapsibleState.Expanded,
      );
      const n = element.breakpoints.length;
      const disabled = element.breakpoints.filter((b) => b.disabled).length;
      item.description = disabled > 0 ? `${n} · ${disabled} disabled` : `${n}`;
      item.iconPath = new vscode.ThemeIcon(element.className === '' ? 'terminal' : 'symbol-class');
      item.contextValue = 'gemstoneBreakpointClass';
      return item;
    }

    const bp = element.bp;
    const item = new vscode.TreeItem(bp.selector === '' ? '(executed code)' : bp.selector);
    item.description = `@ ${bp.stepPoint}`;
    item.checkboxState = bp.disabled
      ? vscode.TreeItemCheckboxState.Unchecked
      : vscode.TreeItemCheckboxState.Checked;
    item.tooltip = breakpointTooltip(bp);
    // Only a real method can be opened; a doit's source is long gone.
    item.contextValue = bp.selector === '' ? 'gemstoneBreakpointDoit' : 'gemstoneBreakpoint';
    if (bp.selector !== '') {
      item.command = {
        title: 'Reveal in source',
        command: 'gemstone.breakpoints.reveal',
        arguments: [element],
      };
    }
    return item;
  }

  getChildren(element?: BreakpointNode): BreakpointNode[] {
    if (element?.kind === 'class') {
      return element.breakpoints.map((bp) => ({ kind: 'breakpoint' as const, bp }));
    }
    if (element) return [];

    const session = this.sessionManager.getSelectedSession();
    if (!session) {
      this.lastFetch = [];
      return [{ kind: 'notice', text: 'Log in to a GemStone session to see breakpoints.' }];
    }

    try {
      this.lastFetch = queries.getAllBreakpoints(session);
    } catch (e) {
      this.lastFetch = [];
      return [
        {
          kind: 'notice',
          text: `Could not read breakpoints: ${e instanceof Error ? e.message : String(e)}`,
          icon: 'warning',
        },
      ];
    }

    if (this.lastFetch.length === 0) {
      return [
        {
          kind: 'notice',
          text: 'No breakpoints set in this session.',
        },
      ];
    }
    return groupBreakpoints(this.lastFetch);
  }

  /** Every breakpoint the last fetch saw — for commands that act on all of them. */
  all(): GemStoneBreakpoint[] {
    return this.lastFetch;
  }
}

function breakpointTooltip(bp: GemStoneBreakpoint): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  const where =
    bp.className === ''
      ? 'executed code'
      : `${classLabel(bp.className, bp.isMeta)} >> ${bp.selector}`;
  md.appendMarkdown(`**${where}**\n\nStep point ${bp.stepPoint}`);
  if (bp.disabled) md.appendMarkdown(' — disabled');
  if (bp.dictName) md.appendMarkdown(`\n\nDictionary: ${bp.dictName}`);
  if (bp.environmentId > 0) md.appendMarkdown(`\n\nEnvironment: ${bp.environmentId}`);
  return md;
}

/**
 * Open the method a breakpoint is in and put the caret on the step point.
 *
 * The step point is resolved from the *stone's* offsets for the method just
 * opened, rather than trusting the line the gem reported, so the selection lands
 * on the token that will actually break.
 */
export async function revealBreakpoint(
  sessionManager: SessionManager,
  node?: BreakpointNode,
): Promise<void> {
  if (node?.kind !== 'breakpoint') return;
  const bp = node.bp;
  if (bp.selector === '' || bp.className === '') return;

  const session = sessionManager.getSelectedSession();
  if (!session) return;

  const uri = buildMethodUri({
    kind: 'method',
    sessionId: session.id,
    dictName: bp.dictName || 'Globals',
    className: bp.className,
    isMeta: bp.isMeta,
    // The category only labels the URI path; the file system provider resolves
    // the method by class and selector. 'other' keeps the path well-formed when
    // the gem couldn't name a category (an inherited or removed method).
    category: bp.category || 'other',
    selector: bp.selector,
    environmentId: bp.environmentId,
  });

  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preview: false });

  let offsets: number[];
  try {
    offsets = queries.getSourceOffsets(
      session,
      bp.className,
      bp.isMeta,
      bp.selector,
      bp.environmentId,
    );
  } catch {
    return;
  }
  const at = offsets[bp.stepPoint - 1];
  if (at === undefined) return;

  const position = document.positionAt(at - 1); // _sourceOffsets is 1-based
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
}
