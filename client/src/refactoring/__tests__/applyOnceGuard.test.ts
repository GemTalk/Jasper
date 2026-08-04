/**
 * Every paginated refactoring preview host must apply its change set AT MOST ONCE.
 *
 * `handlers.apply` performs the change set server-side (versioning classes, recompiling
 * methods, sometimes committing), so a second `apply` message — a double-click on the
 * Apply button, or a webview that replays its queue — would run the whole thing again.
 * The hosts guard this with an `applying` latch, and this suite pins that latch for the
 * whole family in one place rather than once per panel.
 *
 * The `start` / `outOfScope` fixtures below are supersets: each panel's renderer reads a
 * subset of these fields, so one fixture drives all of them (cast per call, since the
 * Start* types differ). The real HTML renderers run — a panel whose renderer can't take
 * the fixture fails loudly here rather than silently skipping its guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  ViewColumn: { Active: 1 },
  window: {
    createWebviewPanel: vi.fn(() => {
      const messageCbs: Array<(m: unknown) => void> = [];
      const disposeCbs: Array<() => void> = [];
      return {
        webview: {
          html: '',
          postMessage: vi.fn(),
          onDidReceiveMessage: (cb: (m: unknown) => void) => {
            messageCbs.push(cb);
            return { dispose() {} };
          },
        },
        onDidDispose: (cb: () => void) => {
          disposeCbs.push(cb);
          return { dispose() {} };
        },
        dispose: () => disposeCbs.forEach((c) => c()),
        __emit: (m: unknown) => messageCbs.forEach((c) => c(m)),
      };
    }),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
}));

import * as vscode from 'vscode';
import { showChangeSignaturePanel } from '../changeSignaturePanel';
import { showExtractMethodPanel } from '../extractMethodPanel';
import { showExtractTemporaryPanel } from '../extractTemporaryPanel';
import { showInlineMethodPanel } from '../inlineMethodPanel';
import { showInlineTemporaryPanel } from '../inlineTemporaryPanel';
import { showInstVarStructurePanel } from '../instVarStructurePanel';
import { showMoveMethodPanel } from '../moveMethodPanel';
import { showPushMethodPanel } from '../pushMethodPanel';
import { showRenameClassPanel } from '../renameClassPanel';
import { showRenameClassVarPanel } from '../renameClassVarPanel';
import { showRenameMethodPanel } from '../renameMethodPanel';
import { showRenameTemporaryPanel } from '../renameTemporaryPanel';

interface MockPanel {
  __emit: (m: unknown) => void;
  dispose: () => void;
  webview: { postMessage: ReturnType<typeof vi.fn> };
}
function lastPanel(): MockPanel {
  const mock = vscode.window.createWebviewPanel as unknown as {
    mock: { results: Array<{ value: MockPanel }> };
  };
  return mock.mock.results[mock.mock.results.length - 1].value;
}

const change = {
  id: '1',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Foo',
  isMeta: false,
  selector: 'bar',
  newSelector: 'barX',
  category: 'accessing',
  label: 'Foo>>bar',
  oldSource: 'bar\n\t^1',
  newSource: 'bar\n\t^2',
};

const outOfScope = {
  decline: null,
  note: null,
  collision: null,
  references: 0,
  descendants: 0,
  skipped: 0,
  implementors: 0,
  senders: 0,
  willNotRecompile: [],
  actedOnClass: 'Foo',
};

const start = {
  token: 'tok',
  total: 1,
  sourceClass: 'Foo',
  occurrenceCount: 1,
  lastSender: null,
  skippedMethods: [],
  outOfScope,
  page: { changes: [change], nextOffset: 2, done: true },
};

const applyResult = { applied: 1, failed: [], dropped: [], committed: false };

/** A handlers object whose `apply` blocks until `release()`, so a second apply message
 *  arrives while the first is still in flight — the double-click window. */
function gatedHandlers() {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const apply = vi.fn(async () => {
    await gate;
    return applyResult;
  });
  return {
    handlers: {
      loadPage: vi.fn(async () => ({ changes: [change], nextOffset: 3, done: true })),
      apply,
      cleanup: vi.fn(),
    },
    apply,
    release: () => release(),
  };
}

/** Each panel's `Start*` / `*Handlers` types differ, but they all read the same subset of
 *  the superset fixtures above, so every call site erases its argument types. */
function asPanelArg<T>(value: T): never {
  return value as unknown as never;
}

type Show = (start: never, handlers: never) => Promise<unknown>;

const PANELS: Array<{ name: string; show: Show }> = [
  { name: 'changeSignature', show: (s, h) => showChangeSignaturePanel('a', 'b', s, h) },
  { name: 'extractMethod', show: (s, h) => showExtractMethodPanel('newSel', s, h) },
  { name: 'extractTemporary', show: (s, h) => showExtractTemporaryPanel('t', s, true, h) },
  { name: 'inlineMethod', show: (s, h) => showInlineMethodPanel('bar', s, h) },
  { name: 'inlineTemporary', show: (s, h) => showInlineTemporaryPanel('t', s, h) },
  { name: 'instVarStructure', show: (s, h) => showInstVarStructurePanel('Push up count', s, h) },
  { name: 'moveMethod', show: (s, h) => showMoveMethodPanel('Bar', s, h) },
  { name: 'pushMethod', show: (s, h) => showPushMethodPanel('Push down bar', s, h) },
  {
    name: 'renameClass',
    show: (s, h) =>
      showRenameClassPanel(
        'Foo',
        'Baz',
        s,
        { recompileSubclasses: false, migrateInstances: false },
        h,
      ),
  },
  { name: 'renameClassVar', show: (s, h) => showRenameClassVarPanel('C', 'D', s, h) },
  { name: 'renameMethod', show: (s, h) => showRenameMethodPanel('a', 'b', s, h) },
  { name: 'renameTemporary', show: (s, h) => showRenameTemporaryPanel('t', 'u', s, h) },
];

const applyMsg = { command: 'apply', deselected: [], ids: ['1'], options: {} };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('apply-once guard across every paginated preview host', () => {
  it.each(PANELS)('$name applies once for a double-click', async ({ show }) => {
    const g = gatedHandlers();
    const p = show(asPanelArg(start), asPanelArg(g.handlers));
    const panel = lastPanel();

    panel.__emit(applyMsg);
    panel.__emit(applyMsg);
    await new Promise((r) => setTimeout(r, 0));

    expect(g.apply).toHaveBeenCalledTimes(1);

    g.release();
    await p;
    expect(g.apply).toHaveBeenCalledTimes(1);
  });

  it.each(PANELS)('$name applies once even for five rapid clicks', async ({ show }) => {
    const g = gatedHandlers();
    const p = show(asPanelArg(start), asPanelArg(g.handlers));
    const panel = lastPanel();

    for (let i = 0; i < 5; i++) panel.__emit(applyMsg);
    await new Promise((r) => setTimeout(r, 0));

    expect(g.apply).toHaveBeenCalledTimes(1);

    g.release();
    await p;
  });

  it.each(PANELS)('$name lets a failed apply be retried', async ({ show }) => {
    const handlers = {
      loadPage: vi.fn(async () => ({ changes: [change], nextOffset: 3, done: true })),
      apply: vi
        .fn()
        .mockRejectedValueOnce(new Error('apply boom'))
        .mockResolvedValueOnce(applyResult),
      cleanup: vi.fn(),
    };

    const p = show(asPanelArg(start), asPanelArg(handlers));
    const panel = lastPanel();

    panel.__emit(applyMsg); // fails → the latch must clear
    await new Promise((r) => setTimeout(r, 0));
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'busyDone' }),
    );

    panel.__emit(applyMsg); // retry
    await p;

    expect(handlers.apply).toHaveBeenCalledTimes(2);
  });
});
