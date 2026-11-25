import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { AssistantResultsView, askAboutContext } from '../assistantResultsView';
import { OMNI_DEFAULTS } from '../omniConfig';
import type { OmniPanelDeps } from '../omniSearchPanel';
import type { OmniResult } from '../omniTypes';

function method(selector: string): OmniResult {
  return {
    categoryId: 'methods',
    label: `Library>>${selector}`,
    score: 0,
    ranges: [],
    action: {
      kind: 'openMethod',
      sessionId: 1,
      dictName: 'UserGlobals',
      className: 'Library',
      isMeta: false,
      category: 'x',
      selector,
      environmentId: 0,
      dictIndex: 0,
    },
  };
}

function deps(): OmniPanelDeps {
  return {
    sessionId: 1,
    config: OMNI_DEFAULTS,
    providers: [],
    activate: vi.fn(),
    previewSource: vi.fn(() => 'source'),
    onError: vi.fn(),
  };
}

type Msg = Record<string, unknown>;

/** The view, resolved into a fake webview, with what it posted and a way to play the page. */
function mount() {
  const results = new AssistantResultsView();
  let handler: (m: unknown) => Promise<void> = async () => {};
  const webview = {
    options: {},
    html: '',
    onDidReceiveMessage: (cb: (m: unknown) => Promise<void>) => {
      handler = cb;
      return { dispose() {} };
    },
    postMessage: vi.fn(),
  };
  const view = { webview, show: vi.fn(), onDidDispose: () => ({ dispose() {} }) };
  results.resolveWebviewView(view as never);
  // Tall enough that showing a list never waits to grow the panel.
  void handler({ command: 'viewHeight', px: 1000 });
  const posted = (): Msg[] => webview.postMessage.mock.calls.map((c) => c[0] as Msg);
  const last = (command: string) =>
    posted()
      .filter((m) => m.command === command)
      .pop()!;
  const rows = () => (last('results').rows as { label: string }[]).map((r) => r.label);
  const tabs = () =>
    last('resultTabs') as {
      tabs: { id: number; label: string; title: string; question?: string }[];
      active: number;
    };
  return { results, view, html: webview.html, send: (m: Msg) => handler(m), posted, rows, tabs };
}

const library = { title: 'Methods in Library', results: [method('addBook:'), method('lend:to:')] };
const trail = { title: 'How lending works', results: [method('lend:to:')] };

describe('the Assistant Results view', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gives each list a tab of its own and shows the newest, without taking the focus', async () => {
    const { results, view, rows, tabs } = mount();

    await results.open(deps(), library);
    await results.open(deps(), trail);

    expect(tabs().tabs.map((t) => [t.label, t.title])).toEqual([
      ['Results 1', 'Methods in Library'],
      ['Results 2', 'How lending works'],
    ]);
    expect(tabs().active).toBe(tabs().tabs[1].id);
    expect(rows()).toEqual(['Library>>lend:to:']);
    expect(view.show).toHaveBeenCalledWith(true);
  });

  it('shows an earlier list again when its tab is clicked', async () => {
    const { results, send, rows, tabs } = mount();
    await results.open(deps(), library);
    await results.open(deps(), trail);

    await send({ command: 'selectTab', tab: tabs().tabs[0].id });

    expect(rows()).toEqual(['Library>>addBook:', 'Library>>lend:to:']);
  });

  it('closes a tab and shows its neighbour, and says what goes here once none is left', async () => {
    const { results, send, rows, tabs, posted } = mount();
    await results.open(deps(), library);
    await results.open(deps(), trail);

    await send({ command: 'closeTab', tab: tabs().tabs[1].id });
    const afterOne = [tabs().tabs.map((t) => t.title), rows()];
    await send({ command: 'closeTab', tab: tabs().tabs[0].id });

    expect(afterOne).toEqual([['Methods in Library'], ['Library>>addBook:', 'Library>>lend:to:']]);
    expect(tabs().tabs).toEqual([]);
    expect(posted().pop()).toEqual({ command: 'reset' });
  });

  it("keeps each tab's filter when switching between them", async () => {
    const { results, send, rows, tabs, posted } = mount();
    await results.open(deps(), library);
    await send({ command: 'query', value: 'add' });
    await results.open(deps(), trail);

    await send({ command: 'selectTab', tab: tabs().tabs[0].id });

    expect(rows()).toEqual(['Library>>addBook:']);
    expect(posted()).toContainEqual({ command: 'setInput', value: 'add' });
  });

  it('clears the filter on Esc', async () => {
    const { results, send, rows } = mount();
    await results.open(deps(), library);
    await send({ command: 'query', value: 'add' });

    await send({ command: 'back' });

    expect(rows()).toHaveLength(2);
  });

  it('opens and previews a row of the tab that is showing', async () => {
    const first = deps();
    const second = deps();
    const { results, send, posted } = mount();
    await results.open(first, library);
    await results.open(second, trail);

    await send({ command: 'activate', id: 0 });
    await send({ command: 'preview', id: 0 });

    expect(first.activate).not.toHaveBeenCalled();
    expect(second.activate).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Library>>lend:to:' }),
      { beside: false, preserveFocus: false },
    );
    expect(posted()).toContainEqual(expect.objectContaining({ command: 'preview', id: 0 }));
  });

  it('hides the search controls and has a row of tabs', () => {
    const { html } = mount();

    expect(html).toContain('class="results-only"');
    expect(html).toContain('id="resulttabs"');
  });

  it('closes every tab on Clear', async () => {
    const { results, tabs, posted } = mount();
    await results.open(deps(), library);
    await results.open(deps(), trail);

    await results.clear();

    expect(tabs().tabs).toEqual([]);
    expect(posted().pop()).toEqual({ command: 'reset' });
  });

  it('remembers the question each list answers', async () => {
    const { results, tabs } = mount();
    let asking: string | undefined = 'What does Library do?';
    results.setQuestionSource(() => asking);
    await results.open(deps(), library);
    asking = undefined;

    await results.open(deps(), trail);

    expect(tabs().tabs.map((t) => t.question)).toEqual(['What does Library do?', undefined]);
  });

  it('makes its panel tab appear, hidden until the assistant first shows something', async () => {
    const { results } = mount();

    await results.open(deps(), library);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'jasper.assistantStarted',
      true,
    );
  });

  it('names tabs by number, counting from 1 again once none is left', async () => {
    const { results, send, tabs } = mount();
    await results.open(deps(), library);
    await results.open(deps(), trail);
    await send({ command: 'closeTab', tab: tabs().tabs[0].id });
    await results.open(deps(), library);
    const whileOpen = tabs().tabs.map((t) => t.label);
    await results.clear();

    await results.open(deps(), trail);

    expect(whileOpen).toEqual(['Results 2', 'Results 3']);
    expect(tabs().tabs.map((t) => t.label)).toEqual(['Results 1']);
  });

  it('opens the chat to ask about the selected row', async () => {
    const { results, send } = mount();
    await results.open(deps(), trail);

    await send({ command: 'askAbout', ids: [0] });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'jasper.askAbout',
      expect.objectContaining({ label: 'Results 1: Library>>lend:to:' }),
    );
  });
});

describe('what Ask about this tells the assistant', () => {
  const steps = [
    { ...method('lend:to:'), label: '1. Library>>lend:to:', coach: 'checks the book is in' },
    { ...method('isOnLoan'), label: '2. Library>>isOnLoan', coach: 'asks the borrower' },
  ];

  it('sends the whole list with its notes, its question, and the row the user is on', () => {
    const { label, context } = askAboutContext(
      {
        label: 'Results 2',
        title: 'How lending works',
        question: 'How does lending work?',
        results: steps,
      },
      [steps[1]],
    );

    expect(label).toBe('Results 2: Library>>isOnLoan');
    expect(context).toContain('titled "How lending works"');
    expect(context).toContain('their question: "How does lending work?"');
    expect(context).toContain('- Library>>lend:to: — checks the book is in');
    expect(context).toContain('They have "Library>>isOnLoan" selected.');
  });

  it('asks for a trail into a method only when the question is about the whole method', () => {
    const { context } = askAboutContext(
      { label: 'Results 1', title: 'How lending works', results: steps },
      [steps[0]],
    );

    expect(context).toContain('show a trail into it with show_trail_in_search');
    expect(context).toContain('Only if their question is about how that method works as a whole');
    expect(context).toContain('A question about one detail of it');
    expect(context).toContain('"Inside Library>>lend:to:"');
  });

  it('asks for no trail into a class', () => {
    const cls = {
      categoryId: 'classes' as const,
      label: 'Library',
      score: 0,
      ranges: [],
      action: {
        kind: 'openClass' as const,
        sessionId: 1,
        dictName: 'UserGlobals',
        className: 'Library',
        dictIndex: 1,
      },
    };

    const { context } = askAboutContext(
      { label: 'Results 1', title: 'Classes created', results: [cls] },
      [cls],
    );

    expect(context).not.toContain('show_trail_in_search');
  });

  it('names a method listed under its class with that class', () => {
    const nested = { ...method('addBook:'), label: 'addBook:', nested: true };

    const { context } = askAboutContext(
      { label: 'Results 1', title: 'Classes created', results: [nested] },
      [nested],
    );

    expect(context).toContain('  - Library>>addBook:');
    expect(context).not.toContain('It answered');
  });

  it('sends at most a hundred rows, and says how many more there are', () => {
    const many = Array.from({ length: 130 }, (_, i) => method(`m${i}`));

    const { context } = askAboutContext({ label: 'Results 1', title: 'Many', results: many }, [
      many[0],
    ]);

    expect(context).toContain('(and 30 more)');
    expect(context).not.toContain('Library>>m100');
  });

  it('asks about several rows together, and names them all', () => {
    const { label, context } = askAboutContext(
      { label: 'Results 1', title: 'How lending works', results: steps },
      steps,
    );

    expect(label).toBe('Results 1: 2 rows (Library>>lend:to:, Library>>isOnLoan)');
    expect(context).toContain(
      'They have these selected:\n- Library>>lend:to:\n- Library>>isOnLoan',
    );
    expect(context).not.toContain('show_trail_in_search');
  });
});

describe('a trail step that points at its code', () => {
  beforeEach(() => vi.clearAllMocks());

  const source = 'run\n  | m |\n  m := self matcher.\n  ^m size';
  const step = {
    ...method('run'),
    label: '1. Library>>run',
    coach: 'makes the matcher',
    focus: 'm := self matcher.',
  };

  it('tells the preview where the code is', async () => {
    const d = { ...deps(), previewSource: vi.fn(() => source) };
    const { results, send, posted } = mount();
    await results.open(d, { title: 'T', results: [step] });

    await send({ command: 'preview', id: 0 });

    expect(posted()).toContainEqual(
      expect.objectContaining({ command: 'preview', focus: { start: 14, end: 32 } }),
    );
  });

  it('opens the method with the cursor on that code', async () => {
    const d = { ...deps(), previewSource: vi.fn(() => source) };
    const { results, send } = mount();
    await results.open(d, { title: 'T', results: [step] });

    await send({ command: 'activate', id: 0 });

    expect(d.activate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ matches: [{ start: 14, end: 32 }] }),
      }),
      expect.anything(),
    );
  });

  it('opens the method as usual when the code is not in it', async () => {
    const d = { ...deps(), previewSource: vi.fn(() => 'run\n  ^1') };
    const { results, send } = mount();
    await results.open(d, { title: 'T', results: [step] });

    await send({ command: 'activate', id: 0 });

    expect(vi.mocked(d.activate).mock.calls[0][0].action).not.toHaveProperty('matches');
  });
});
