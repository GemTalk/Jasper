import * as vscode from 'vscode';
import { codePointMatchesToUtf16 } from '../matchOffsets';
import { OmniResult } from './omniTypes';
import { createOmniEngine, OmniEngine, OmniViewData, ReferenceView } from './omniEngine';
import { OmniPanelDeps } from './omniSearchPanel';
import { configMessage, renderOmniHtml, resultsMessage } from './omniSearchShared';

export const ASSISTANT_RESULTS_VIEW_ID = 'jasperAssistantResultsView';

type Inbound = { command: string; value?: string; id?: number; refId?: number; tab?: number };

const FILTER_PLACEHOLDER = 'Filter these results';

/** One list the assistant showed. Its engine serves only the list (filter, preview, references),
 *  so it is never primed: no search corpus is loaded for a result. */
interface ResultTab {
  id: number;
  title: string;
  deps: OmniPanelDeps;
  engine: OmniEngine;
  /** What the box filters the list by: the engine's own term is the search behind a list, not this. */
  filter: string;
  /** The question the list answers, when it came from the Jasper Assistant's chat. */
  question?: string;
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
  private questionSource: () => string | undefined = () => undefined;

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

  /** Add `list` as a new tab, show it, and bring the view up without taking the focus. */
  async open(deps: OmniPanelDeps, list: ReferenceView): Promise<void> {
    const engine = createOmniEngine(deps);
    engine.showList(list);
    const tab: ResultTab = {
      id: this.nextId++,
      title: list.title,
      deps,
      engine,
      filter: '',
      question: this.questionSource(),
    };
    this.tabs.push(tab);
    this.activeId = tab.id;
    if (this.view) {
      this.view.show(true);
      await this.showActive();
    } else {
      // Resolving the view sends `ready`, which shows the active tab.
      await vscode.commands.executeCommand(`${ASSISTANT_RESULTS_VIEW_ID}.focus`);
    }
  }

  private active(): ResultTab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  private post(msg: Record<string, unknown>): void {
    void this.view?.webview.postMessage(msg);
  }

  private async showActive(): Promise<void> {
    const tab = this.active();
    this.post({
      command: 'resultTabs',
      tabs: this.tabs.map((t) => ({ id: t.id, title: t.title, question: t.question })),
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
      pivotHint: 'Type to filter; Esc clears the filter',
      placeholder: FILTER_PLACEHOLDER,
    });
  }

  private async onMessage(m: Inbound): Promise<void> {
    if (m.command === 'ready') return await this.showActive();
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
      case 'openReference': {
        const result = engine.referenceResultFor(m.refId ?? -1);
        if (result) await deps.activate(result, { beside: false, preserveFocus: true });
        return;
      }
    }
  }
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
