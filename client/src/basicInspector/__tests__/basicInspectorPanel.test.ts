import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn(),
    showWarningMessage: vi.fn(),
    setStatusBarMessage: vi.fn(),
  },
  env: { clipboard: { writeText: vi.fn(() => Promise.resolve()) } },
  ViewColumn: { Beside: 2 },
}));

vi.mock('../../browserQueries', () => ({ executeFetchString: vi.fn(() => '') }));
vi.mock('../../gciLog', () => ({ logError: vi.fn() }));
vi.mock('../../systemBrowser', () => ({ SystemBrowser: { navigateBeside: vi.fn() } }));

vi.mock('../queries/basicInspectorQueries', () => ({
  PAGE_SIZE: 100,
  fetchObjectHeader: vi.fn(),
  fetchSlots: vi.fn(() => []),
  fetchItems: vi.fn(() => []),
  fetchEntries: vi.fn(() => []),
  fetchBytes: vi.fn(() => []),
  fetchObjectMeta: vi.fn(() => null),
  fetchMethodSource: vi.fn(() => null),
  fetchBrowseLocation: vi.fn(() => null),
}));

vi.mock('../../debugQueries', () => ({
  fetchFullPrintString: vi.fn(() => 'an Account'),
  getObjectPrintString: vi.fn(() => '84'),
  evaluateWithReceiverToOop: vi.fn(() => 777n),
  isSpecialOop: vi.fn(() => false),
  getInstVarOop: vi.fn(() => 500n),
  getIndexedVarOop: vi.fn(() => 501n),
  getDictionaryValueOop: vi.fn(() => 502n),
  setInstVar: vi.fn(),
  setIndexedVar: vi.fn(),
  setDictionaryValue: vi.fn(),
  saveObjs: vi.fn(),
  releaseObjs: vi.fn(),
}));

import * as vscode from 'vscode';
import { BasicInspector } from '../basicInspector';
import * as queries from '../queries/basicInspectorQueries';
import * as debug from '../../debugQueries';
import { SystemBrowser } from '../../systemBrowser';
import type { ActiveSession } from '../../sessionManager';

/**
 * The panel host: what it asks the stone for, what it posts back, and the
 * bookkeeping behind editing a slot. Every query and kernel send is mocked —
 * this is about the panel's decisions, not the doits, which have their own
 * tests and are exercised against a live stone in the routing integration test.
 */

interface MockPanel {
  webview: {
    html: string;
    postMessage: Mock<(msg: unknown) => void>;
    onDidReceiveMessage: Mock<(handler: (msg: unknown) => void) => void>;
  };
  title: string;
  onDidDispose: Mock<(handler: () => void) => void>;
  dispose: Mock<() => void>;
  reveal: Mock<() => void>;
}

let panel: MockPanel;
let callInProgress: number;

function makeMockPanel(): MockPanel {
  const p: MockPanel = {
    webview: { html: '', postMessage: vi.fn(), onDidReceiveMessage: vi.fn() },
    title: 'Inspector',
    onDidDispose: vi.fn(),
    dispose: vi.fn(() => {
      p.onDidDispose.mock.calls[0]?.[0]?.();
    }),
    reveal: vi.fn(),
  };
  return p;
}

function makeSession(): ActiveSession {
  return {
    id: 1,
    handle: {},
    gci: { GciTsCallInProgress: () => ({ result: callInProgress }) },
  } as unknown as ActiveSession;
}

let session: ActiveSession;

function open(oop = 100n, label = 'anAccount'): BasicInspector {
  return BasicInspector.create(session, oop, label);
}

/** Deliver a webview message to the panel, as the webview bridge would. */
function send(msg: Record<string, unknown>): void {
  panel.webview.onDidReceiveMessage.mock.calls[0][0](msg);
}

const postsOf = (command: string) =>
  panel.webview.postMessage.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((m) => m.command === command);

const HEADER = {
  className: 'Account',
  superclassName: 'Object',
  namedSize: 2,
  itemCount: 0,
  entryCount: 0,
  isBytes: false,
  isDictionary: false,
  printString: 'an Account',
  sizeUnit: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  callInProgress = 0;
  session = makeSession();
  panel = makeMockPanel();
  vi.mocked(vscode.window.createWebviewPanel).mockImplementation(
    () => panel as unknown as vscode.WebviewPanel,
  );
  // Tests run in random order and `clearAllMocks` clears calls but not queued
  // return values, so every default a test may override is re-stated here.
  vi.mocked(queries.fetchObjectHeader).mockReturnValue(HEADER);
  vi.mocked(queries.fetchSlots).mockReturnValue([]);
  vi.mocked(queries.fetchItems).mockReturnValue([]);
  vi.mocked(queries.fetchEntries).mockReturnValue([]);
  vi.mocked(queries.fetchBytes).mockReturnValue([]);
  vi.mocked(queries.fetchBrowseLocation).mockReturnValue(null);
  vi.mocked(debug.evaluateWithReceiverToOop).mockReturnValue(777n);
  vi.mocked(debug.getInstVarOop).mockReturnValue(500n);
  vi.mocked(debug.isSpecialOop).mockReturnValue(false);
  vi.mocked(debug.saveObjs).mockImplementation(() => {});
  // Panels stay in the static per-session registry until disposed; a leftover
  // from an earlier test would be closed by the next disposeForSession.
  (BasicInspector as unknown as { panels: Map<number, unknown> }).panels = new Map();
});

describe('opening the panel', () => {
  it('opens beside the editor without stealing focus from it', () => {
    open();

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'gemstoneBasicInspector',
      'Inspector',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      expect.objectContaining({ enableScripts: true, retainContextWhenHidden: true }),
    );
  });

  it('serves a page whose scripts are locked to a single nonce', () => {
    open();

    // Three script tags: the shared column model, this panel's view, and the
    // one-line bootstrap that wires them together. Counting them (rather than
    // scanning for `<script`) keeps the assertion off the `<script>` mentions
    // inside the injected files' own comments.
    const nonce = /script-src 'nonce-([0-9a-f]{32})'/.exec(panel.webview.html)?.[1];
    expect(nonce).toBeDefined();
    expect(panel.webview.html).not.toContain('<script src');
    expect(panel.webview.html.split(`<script nonce="${nonce}">`)).toHaveLength(4);
  });

  it('loads no script the content-security-policy would block', () => {
    open();

    // A `</script>` inside an injected file would close the block early and
    // strand the rest of it as page text, whatever the nonce says.
    expect(panel.webview.html.match(/<\/script>/g)).toHaveLength(3);
  });

  it('sends the inspected object once the webview says it is ready', () => {
    open(100n, 'anAccount');

    send({ command: 'ready' });

    expect(postsOf('addRoot')[0]).toMatchObject({
      columnId: 0,
      oop: '100',
      label: 'anAccount',
      header: HEADER,
    });
  });

  it('still opens a column for an object the stone will not describe', () => {
    vi.mocked(queries.fetchObjectHeader).mockReturnValue(null);
    open();

    send({ command: 'ready' });

    expect(postsOf('addRoot')[0].header).toMatchObject({ className: '<unreadable>' });
  });
});

describe('serving a tab', () => {
  beforeEach(() => {
    open();
    send({ command: 'ready' });
  });

  it('reads named slots for the slots tab', () => {
    send({ command: 'fetchTab', columnId: 0, oop: '100', tab: 'slots', from: 1 });

    expect(queries.fetchSlots).toHaveBeenCalledWith(expect.any(Function), 100n);
  });

  it('asks for one page of items at a time', () => {
    send({ command: 'fetchTab', columnId: 0, oop: '100', tab: 'items', from: 101 });

    expect(queries.fetchItems).toHaveBeenCalledWith(expect.any(Function), 100n, 101, 100);
  });

  it('prints an object in full, past the printString cap', () => {
    send({ command: 'fetchTab', columnId: 0, oop: '100', tab: 'print', from: 1 });

    expect(debug.fetchFullPrintString).toHaveBeenCalledWith(session, 100n);
    expect(postsOf('tabData').at(-1)).toMatchObject({ tab: 'print', text: 'an Account' });
  });

  /** A reader that answers full pages until `total` rows are gone. */
  function pagesOf(total: number) {
    return (_exec: unknown, _oop: bigint, from: number, count: number) =>
      Array.from({ length: Math.max(0, Math.min(count, total - from + 1)) }, (_, i) => ({
        label: `[${from + i}]`,
        value: '1',
        oop: '900',
        className: 'SmallInteger',
        index: from + i,
      }));
  }

  it('takes one page when the tab asks for one page', () => {
    vi.mocked(queries.fetchItems).mockImplementation(pagesOf(450));

    send({ command: 'fetchTab', columnId: 0, oop: '100', tab: 'items', from: 1 });

    expect(queries.fetchItems).toHaveBeenCalledTimes(1);
    expect((postsOf('tabData').at(-1)!.rows as unknown[]).length).toBe(100);
  });

  it('reads on to the end of the object for a Load all', () => {
    vi.mocked(queries.fetchItems).mockImplementation(pagesOf(450));

    send({ command: 'fetchTab', columnId: 0, oop: '100', tab: 'items', from: 1, all: true });

    expect((postsOf('tabData').at(-1)!.rows as unknown[]).length).toBe(450);
  });

  it('carries a Load all on from the rows already loaded', () => {
    vi.mocked(queries.fetchItems).mockImplementation(pagesOf(450));

    send({ command: 'fetchTab', columnId: 0, oop: '100', tab: 'items', from: 101, all: true });

    expect(queries.fetchItems).toHaveBeenNthCalledWith(1, expect.any(Function), 100n, 101, 100);
    expect((postsOf('tabData').at(-1)!.rows as unknown[]).length).toBe(350);
  });

  it('stops a Load all at a ceiling rather than holding the session', () => {
    vi.mocked(queries.fetchItems).mockImplementation(pagesOf(1_000_000));

    send({ command: 'fetchTab', columnId: 0, oop: '100', tab: 'items', from: 1, all: true });

    // 50 pages of 100. The tab still shows a remainder, and another click
    // carries on from there.
    expect((postsOf('tabData').at(-1)!.rows as unknown[]).length).toBe(5000);
  });

  it('reads every remaining byte for a Load all on the bytes tab', () => {
    vi.mocked(queries.fetchBytes).mockImplementation(
      (_exec: unknown, _oop: bigint, from: number, count: number) =>
        Array.from({ length: Math.max(0, Math.min(count, 1000 - from + 1)) }, () => 98),
    );

    send({ command: 'fetchTab', columnId: 0, oop: '100', tab: 'bytes', from: 1, all: true });

    expect((postsOf('tabData').at(-1)!.bytes as unknown[]).length).toBe(1000);
  });

  it('answers the column that asked, so a stale reply cannot land elsewhere', () => {
    send({ command: 'fetchTab', columnId: 7, oop: '100', tab: 'slots', from: 1 });

    expect(postsOf('tabData').at(-1)).toMatchObject({ columnId: 7, tab: 'slots' });
  });
});

describe('drilling and diving', () => {
  beforeEach(() => {
    open();
    send({ command: 'ready' });
  });

  it('gives a drilled column its own id, to the right of its source', () => {
    send({ command: 'inspectRow', sourceColumnId: 0, oop: '900', label: 'balance' });

    expect(postsOf('addChild')[0]).toMatchObject({
      columnId: 1,
      sourceColumnId: 0,
      oop: '900',
      label: 'balance',
    });
  });

  it('never reuses a column id across drills', () => {
    send({ command: 'inspectRow', sourceColumnId: 0, oop: '900', label: 'a' });
    send({ command: 'inspectRow', sourceColumnId: 0, oop: '901', label: 'b' });

    expect(postsOf('addChild').map((m) => m.columnId)).toEqual([1, 2]);
  });

  it('replaces a column in place on a dive, keeping its id', () => {
    send({ command: 'diveHere', columnId: 0, oop: '900', label: 'balance', remember: true });

    expect(postsOf('replaceColumn')[0]).toMatchObject({ columnId: 0, oop: '900' });
  });

  it('echoes back whether a dive should be remembered, since the webview owns the history', () => {
    send({ command: 'diveHere', columnId: 0, oop: '900', label: 'b', remember: false });

    expect(postsOf('replaceColumn')[0]).toMatchObject({ remember: false });
  });
});

describe('editing a slot', () => {
  const EDIT = {
    command: 'setSlot',
    columnId: 0,
    oop: '100',
    kind: 'instvar',
    index: 2,
    expression: 'self balance * 2',
  };

  beforeEach(() => {
    open();
    send({ command: 'ready' });
  });

  it('evaluates the expression with the inspected object bound to self', () => {
    send(EDIT);

    expect(debug.evaluateWithReceiverToOop).toHaveBeenCalledWith(session, 100n, 'self balance * 2');
  });

  it('stores the evaluated result into the named slot', () => {
    send(EDIT);

    expect(debug.setInstVar).toHaveBeenCalledWith(session, 100n, 2, 777n);
    expect(postsOf('setSlotResult').at(-1)).toMatchObject({ ok: true });
  });

  it('writes an indexed element with at:put:', () => {
    send({ ...EDIT, kind: 'indexed', index: 3 });

    expect(debug.setIndexedVar).toHaveBeenCalledWith(session, 100n, 3, 777n);
  });

  it('writes a dictionary entry at its key, not at a slot number', () => {
    send({ ...EDIT, kind: 'entry', index: 0, keyOop: '800' });

    expect(debug.setDictionaryValue).toHaveBeenCalledWith(session, 100n, 800n, 777n);
  });

  it('leaves the slot untouched when the expression will not evaluate', () => {
    vi.mocked(debug.evaluateWithReceiverToOop).mockImplementationOnce(() => {
      throw new Error('doesNotUnderstand');
    });

    send(EDIT);

    expect(debug.setInstVar).not.toHaveBeenCalled();
    expect(postsOf('setSlotResult').at(-1)).toMatchObject({
      ok: false,
      error: 'doesNotUnderstand',
    });
  });

  it('refuses to write while the session is mid-call', () => {
    callInProgress = 1;

    send(EDIT);

    expect(debug.setInstVar).not.toHaveBeenCalled();
    expect(String(postsOf('setSlotResult').at(-1)!.error)).toContain('busy');
  });

  it('pins the value a slot held so a revert cannot restore a recycled oop', () => {
    send(EDIT);

    expect(debug.saveObjs).toHaveBeenCalledWith(session, [500n]);
  });

  it('does not pin an immediate, which cannot be collected', () => {
    vi.mocked(debug.isSpecialOop).mockReturnValue(true);

    send(EDIT);

    expect(debug.saveObjs).not.toHaveBeenCalled();
  });

  it('keeps the value from before the first edit, not from the previous one', () => {
    send(EDIT);
    vi.mocked(debug.getInstVarOop).mockReturnValue(999n);

    send({ ...EDIT, expression: 'self balance * 3' });
    send({ command: 'revertSlot', columnId: 0, oop: '100', kind: 'instvar', index: 2 });

    expect(vi.mocked(debug.setInstVar).mock.calls.at(-1)).toEqual([session, 100n, 2, 500n]);
  });

  it('restores the original without re-evaluating anything', () => {
    send(EDIT);
    const evaluations = vi.mocked(debug.evaluateWithReceiverToOop).mock.calls.length;

    send({ command: 'revertSlot', columnId: 0, oop: '100', kind: 'instvar', index: 2 });

    expect(vi.mocked(debug.evaluateWithReceiverToOop).mock.calls).toHaveLength(evaluations);
    expect(postsOf('setSlotResult').at(-1)).toMatchObject({ ok: true });
  });

  it('says so rather than guessing when a slot has no recorded original', () => {
    send({ command: 'revertSlot', columnId: 0, oop: '100', kind: 'instvar', index: 2 });

    expect(postsOf('setSlotResult').at(-1)).toMatchObject({ ok: false });
    expect(debug.setInstVar).not.toHaveBeenCalled();
  });

  it('offers no revert on a slot whose original could not be pinned', () => {
    vi.mocked(debug.saveObjs).mockImplementationOnce(() => {
      throw new Error('export set full');
    });

    send(EDIT);
    send({ command: 'revertSlot', columnId: 0, oop: '100', kind: 'instvar', index: 2 });

    expect(postsOf('setSlotResult').at(-1)).toMatchObject({ ok: false });
  });

  it('marks an edited slot so its rows come back offering a revert', () => {
    vi.mocked(queries.fetchSlots).mockReturnValue([
      { label: 'owner', value: "'Fred'", oop: '901', className: 'String', index: 1 },
      { label: 'balance', value: '84', oop: '902', className: 'SmallInteger', index: 2 },
    ]);
    send(EDIT);

    send({ command: 'fetchTab', columnId: 0, oop: '100', tab: 'slots', from: 1 });

    const rows = postsOf('tabData').at(-1)!.rows as { label: string; revertible?: boolean }[];
    expect(rows.map((r) => r.revertible)).toEqual([undefined, true]);
  });

  it('stops marking a slot once its original has been put back', () => {
    vi.mocked(queries.fetchSlots).mockReturnValue([
      { label: 'balance', value: '42', oop: '902', className: 'SmallInteger', index: 2 },
    ]);
    send(EDIT);

    send({ command: 'revertSlot', columnId: 0, oop: '100', kind: 'instvar', index: 2 });
    send({ command: 'fetchTab', columnId: 0, oop: '100', tab: 'slots', from: 1 });

    const rows = postsOf('tabData').at(-1)!.rows as { revertible?: boolean }[];
    expect(rows[0].revertible).toBeUndefined();
  });

  it('releases every pinned value when the panel closes', () => {
    send(EDIT);

    panel.dispose();

    expect(debug.releaseObjs).toHaveBeenCalledWith(session, [500n]);
  });
});

describe('the evaluation pane', () => {
  beforeEach(() => {
    open();
    send({ command: 'ready' });
  });

  const EVAL = { command: 'evaluate', columnId: 0, oop: '100', expression: 'self size' };

  it('shows the printString of the result when asked to display it', () => {
    send({ ...EVAL, mode: 'display' });

    expect(postsOf('evalResult').at(-1)).toMatchObject({ ok: true, text: '84' });
  });

  it('opens the result in a new column when asked to inspect it', () => {
    send({ ...EVAL, mode: 'inspect' });

    expect(postsOf('addChild').at(-1)).toMatchObject({ sourceColumnId: 0, oop: '777' });
  });

  it('says nothing about the result when asked to execute it', () => {
    send({ ...EVAL, mode: 'execute' });

    expect(debug.evaluateWithReceiverToOop).toHaveBeenCalled();
    expect(postsOf('evalResult').at(-1)).toMatchObject({ ok: true, text: '' });
    expect(postsOf('addChild')).toHaveLength(0);
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalled();
  });

  it('reports why an expression failed instead of opening an empty column', () => {
    vi.mocked(debug.evaluateWithReceiverToOop).mockImplementationOnce(() => {
      throw new Error('doesNotUnderstand: #nope');
    });

    send({ ...EVAL, mode: 'inspect' });

    expect(postsOf('evalResult').at(-1)).toMatchObject({ ok: false });
    expect(postsOf('addChild')).toHaveLength(0);
  });

  it('refuses to evaluate while the session is mid-call', () => {
    callInProgress = 1;

    send({ ...EVAL, mode: 'display' });

    expect(debug.evaluateWithReceiverToOop).not.toHaveBeenCalled();
    expect(postsOf('evalResult').at(-1)).toMatchObject({ ok: false });
  });
});

describe('acting on a row', () => {
  beforeEach(() => {
    open();
    send({ command: 'ready' });
  });

  it('browses the class of the value the row points at', () => {
    vi.mocked(queries.fetchBrowseLocation).mockReturnValue({
      dictName: 'UserGlobals',
      className: 'Account',
    });

    send({ command: 'browseClass', oop: '900' });

    expect(SystemBrowser.navigateBeside).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ dictName: 'UserGlobals', className: 'Account' }),
    );
  });

  it('says so rather than opening a browser on nothing', () => {
    vi.mocked(queries.fetchBrowseLocation).mockReturnValue(null);

    send({ command: 'browseClass', oop: '900' });

    expect(SystemBrowser.navigateBeside).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('copies text to the clipboard', () => {
    send({ command: 'copyText', text: '900', what: 'OOP' });

    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('900');
  });
});

describe('the panel title and lifetime', () => {
  it('names the panel after the focused column', () => {
    open();
    send({ command: 'ready' });

    send({ command: 'setTitle', title: 'Account › balance' });

    expect(panel.title).toBe('Inspector: Account › balance');
  });

  it('falls back to a plain name when there is nothing to name it after', () => {
    open();

    send({ command: 'setTitle', title: '' });

    expect(panel.title).toBe('Inspector');
  });

  it('closes the panel when its last column goes', () => {
    open();

    send({ command: 'closePanel' });

    expect(panel.dispose).toHaveBeenCalled();
  });

  it('closes every panel a session had open when it logs out', () => {
    const first = makeMockPanel();
    const second = makeMockPanel();
    vi.mocked(vscode.window.createWebviewPanel)
      .mockImplementationOnce(() => first as unknown as vscode.WebviewPanel)
      .mockImplementationOnce(() => second as unknown as vscode.WebviewPanel);
    open();
    open(200n, 'other');

    BasicInspector.disposeForSession(1);

    expect(first.dispose).toHaveBeenCalled();
    expect(second.dispose).toHaveBeenCalled();
  });

  it('leaves the panels of another session alone', () => {
    const other = makeMockPanel();
    vi.mocked(vscode.window.createWebviewPanel).mockImplementationOnce(
      () => other as unknown as vscode.WebviewPanel,
    );
    BasicInspector.create({ ...session, id: 2 }, 100n, 'x');

    BasicInspector.disposeForSession(1);

    expect(other.dispose).not.toHaveBeenCalled();
  });

  it('closes on request, so an owner can tear down what it opened', () => {
    const inspector = open();

    inspector.close();

    expect(panel.dispose).toHaveBeenCalled();
  });
});
