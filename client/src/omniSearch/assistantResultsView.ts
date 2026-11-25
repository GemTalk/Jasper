import * as vscode from 'vscode';
import { codePointMatchesToUtf16 } from '../matchOffsets';
import { OmniResult } from './omniTypes';
import { createOmniEngine, OmniEngine, OmniViewData, ReferenceView } from './omniEngine';
import { OmniPanelDeps } from './omniSearchPanel';
import { configMessage, renderOmniHtml, resultsMessage } from './omniSearchShared';
import { ASSISTANT_RESULTS_MIN_HEIGHT, ViewGrower } from './viewGrower';

export const ASSISTANT_RESULTS_VIEW_ID = 'jasperAssistantResultsView';

/** The view is hidden until this is set: by opening the Jasper Assistant, or by the first list. */
export const ASSISTANT_STARTED_CONTEXT = 'jasper.assistantStarted';

/** Show the Assistant Results panel tab from now until the window reloads. */
export async function showAssistantResultsTab(): Promise<void> {
  await vscode.commands.executeCommand('setContext', ASSISTANT_STARTED_CONTEXT, true);
}

type Inbound = {
  command: string;
  value?: string;
  id?: number;
  refId?: number;
  tab?: number;
  px?: number;
};

const FILTER_PLACEHOLDER = 'Filter these results';

/** One list the assistant showed. Its engine serves only the list (filter, preview, references),
 *  so it is never primed: no search corpus is loaded for a result. */
interface ResultTab {
  id: number;
  /** "Results 3": the tab's name is short; the list's own title shows above it. */
  label: string;
  title: string;
  deps: OmniPanelDeps;
  engine: OmniEngine;
  /** What the box filters the list by: the engine's own term is the search behind a list, not this. */
  filter: string;
  /** The question the list answers, when it came from the Jasper Assistant's chat. */
  question?: string;
  /** The whole list, for Ask about this, whatever the filter shows. */
  results: readonly OmniResult[];
}

/**
 * The Assistant Results view in the bottom panel, beside GemStone Search: each list the Jasper
 * Assistant shows gets a tab of its own here, so it neither replaces nor is replaced by the user's
 * own search. The user closes the tabs. VS Code cannot add a panel tab per result, so these tabs are
 * drawn by the page (`resultTabs`), above the Search page with its search controls hidden.
 */
export class AssistantResultsView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private tabs: ResultTab[] = [];
  private activeId: number | undefined;
  private nextId = 1;
  /** Counts again from 1 once no tab is left, so the names say how far back a list is. */
  private nextNumber = 1;
  private questionSource: () => string | undefined = () => undefined;
  private readonly grower = new ViewGrower();

  /** Where to learn the question being answered when a list arrives. */
  setQuestionSource(source: () => string | undefined): void {
    this.questionSource = source;
  }

  /** Close every tab (the view's Clear button). */
  async clear(): Promise<void> {
    this.tabs = [];
    this.activeId = undefined;
    await this.showActive();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = renderOmniHtml({ showPin: false, resultsOnly: true });
    view.webview.onDidReceiveMessage((m: Inbound) => void this.onMessage(m));
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  /** Add `list` as a new tab and show it, bringing the view up without taking the focus (except the
   *  first time, when only focusing it makes VS Code create it). The first list in an empty view
   *  also makes the panel tall enough to see, so the change is noticed; after that, a height the
   *  user chose is left alone. */
  async open(deps: OmniPanelDeps, list: ReferenceView): Promise<void> {
    const engine = createOmniEngine(deps);
    engine.showList(list);
    const tab: ResultTab = {
      id: this.nextId++,
      label: `Results ${this.nextNumber++}`,
      title: list.title,
      deps,
      engine,
      filter: '',
      question: this.questionSource(),
      results: list.results,
    };
    this.tabs.push(tab);
    this.activeId = tab.id;
    // Another Claude Code can show a list through Jasper's MCP server without the chat ever opening.
    await showAssistantResultsTab();
    if (this.view) {
      this.view.show(true);
      await this.showActive();
    } else {
      // Resolving the view sends `ready`, which shows the active tab.
      await vscode.commands.executeCommand(`${ASSISTANT_RESULTS_VIEW_ID}.focus`);
    }
    // A view still loading reports its height late, so wait longer for it.
    if (this.tabs.length === 1) await this.grower.growTo(ASSISTANT_RESULTS_MIN_HEIGHT, 3000);
  }

  private active(): ResultTab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  private post(msg: Record<string, unknown>): void {
    void this.view?.webview.postMessage(msg);
  }

  private async showActive(): Promise<void> {
    if (this.tabs.length === 0) this.nextNumber = 1;
    const tab = this.active();
    this.post({
      command: 'resultTabs',
      tabs: this.tabs.map((t) => ({
        id: t.id,
        label: t.label,
        title: t.title,
        question: t.question,
      })),
      active: this.activeId,
    });
    if (!tab) {
      this.post({ command: 'reset' });
      return;
    }
    this.post({
      ...configMessage(tab.deps.config, false, tab.engine.state()),
      placeholder: FILTER_PLACEHOLDER,
    });
    this.post({ command: 'setInput', value: tab.filter });
    const view = await tab.engine.search(tab.filter);
    if (view) this.postView(tab, view);
  }

  private postView(tab: ResultTab, view: OmniViewData): void {
    const st = tab.engine.state();
    this.post({
      ...resultsMessage(view, {
        config: tab.deps.config,
        scopeId: null,
        caseSensitive: st.caseSensitive,
        pinned: false,
        excludedFromAll: st.excludedFromAll,
        matchMode: st.matchMode,
        regex: false,
        regexAvailable: false,
        term: tab.filter,
      }),
      // Search's "Esc to go back" has nothing to go back to here.
      pivotHint: '',
      placeholder: FILTER_PLACEHOLDER,
    });
  }

  private async onMessage(m: Inbound): Promise<void> {
    if (m.command === 'ready') return await this.showActive();
    if (m.command === 'viewHeight') return this.grower.report(m.px ?? 0);
    if (m.command === 'selectTab') {
      if (this.tabs.some((t) => t.id === m.tab)) this.activeId = m.tab;
      return await this.showActive();
    }
    if (m.command === 'closeTab') {
      const at = this.tabs.findIndex((t) => t.id === m.tab);
      if (at < 0) return;
      this.tabs.splice(at, 1);
      if (this.activeId === m.tab) {
        this.activeId = (this.tabs[at] ?? this.tabs[at - 1])?.id;
      }
      return await this.showActive();
    }
    const tab = this.active();
    if (!tab) return;
    try {
      await this.onListMessage(tab, m);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      tab.deps.onError?.(message);
      this.post({ command: 'error', message, failed: m.command });
    }
  }

  private async onListMessage(tab: ResultTab, m: Inbound): Promise<void> {
    const { engine, deps } = tab;
    switch (m.command) {
      case 'query':
      case 'submit': {
        tab.filter = m.value ?? '';
        const view = await engine.search(tab.filter);
        if (view) this.postView(tab, view);
        return;
      }
      case 'back': {
        tab.filter = '';
        this.post({ command: 'setInput', value: '' });
        const view = await engine.search('');
        if (view) this.postView(tab, view);
        return;
      }
      case 'activate': {
        const result = engine.resultFor(m.id ?? -1);
        if (result) await deps.activate(result, { beside: false, preserveFocus: false });
        return;
      }
      case 'preview': {
        const result = engine.resultFor(m.id ?? -1);
        if (result) this.post(previewMessage(m.id, result, deps));
        return;
      }
      case 'referencesInline': {
        const preview = await engine.referencesFor(m.id ?? -1);
        if (preview) {
          this.post({
            command: 'refPreview',
            forId: m.id,
            title: preview.title,
            highlightTerm: preview.highlightTerm,
            rows: preview.rows,
          });
        }
        return;
      }
      case 'previewReference': {
        const result = engine.referenceResultFor(m.refId ?? -1);
        const source = result ? previewSource(deps, result) : '';
        this.post({ command: 'referenceSource', refId: m.refId, source });
        return;
      }
      case 'askAbout': {
        const result = engine.resultFor(m.id ?? -1);
        if (!result) return;
        await vscode.commands.executeCommand(ASK_ABOUT_COMMAND, askAboutContext(tab, result));
        return;
      }
      case 'openReference': {
        const result = engine.referenceResultFor(m.refId ?? -1);
        if (result) await deps.activate(result, { beside: false, preserveFocus: true });
        return;
      }
    }
  }
}

/** Opens the Jasper Assistant ready for a question about a row (registered in extension.ts). */
export const ASK_ABOUT_COMMAND = 'jasper.askAbout';

/** A row as the assistant should read it: a method as Class>>selector, whatever its row shows (a
 *  step number, or only the selector under its class). */
function rowName(r: OmniResult): string {
  if (r.action.kind === 'openMethod') {
    return `${r.action.className}${r.action.isMeta ? ' class' : ''}>>${r.action.selector}`;
  }
  return r.label;
}

/** The most rows of a list sent with a question about it; the assistant can look up the rest. */
const MAX_ROWS_ASKED_ABOUT = 100;

/** What Ask about this tells the assistant: the list, its question, and the row the user is on. */
export function askAboutContext(
  tab: Pick<ResultTab, 'label' | 'title' | 'question' | 'results'>,
  selected: OmniResult,
): { label: string; context: string } {
  const rows = tab.results.slice(0, MAX_ROWS_ASKED_ABOUT).map((r) => {
    const note = r.coach ? ` — ${r.coach}` : '';
    return `${'  '.repeat(r.depth ?? (r.nested ? 1 : 0))}- ${rowName(r)}${note}`;
  });
  const more = tab.results.length - rows.length;
  const lines = [
    `The user is asking about a list you showed in Jasper's Assistant Results panel, titled "${tab.title}".`,
    ...(tab.question ? [`It answered their question: "${tab.question}".`] : []),
    'Its rows:',
    ...rows,
    ...(more > 0 ? [`(and ${more} more)`] : []),
    `They have "${rowName(selected)}" selected. Answer about that, reading its source with your tools as needed.`,
    ...(selected.action.kind === 'openMethod'
      ? [
          `Then show a trail into it with show_trail_in_search, titled for example "Inside ${rowName(selected)}": ` +
            'start at that method and follow the methods it sends, into other classes too, so the user can go a ' +
            'level deeper. If it sends nothing worth following (only primitives or basic messages), say so instead.',
        ]
      : []),
  ];
  return { label: `${tab.label}: ${rowName(selected)}`, context: lines.join('\n') };
}

/** The source to preview, or none when it cannot be read: a preview is not worth an error. */
function previewSource(deps: OmniPanelDeps, result: OmniResult): string {
  try {
    return deps.previewSource(result);
  } catch {
    return '';
  }
}

function previewMessage(
  id: number | undefined,
  result: OmniResult,
  deps: OmniPanelDeps,
): Record<string, unknown> {
  const source = previewSource(deps, result);
  return {
    command: 'preview',
    id,
    source,
    title: result.label,
    matches:
      result.action.kind === 'openMethod' && result.action.matches
        ? codePointMatchesToUtf16(source, result.action.matches)
        : undefined,
  };
}
