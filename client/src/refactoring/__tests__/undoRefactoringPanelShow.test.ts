import { describe, it, expect, vi, beforeEach } from 'vitest';

// A controllable webview panel, so the undo panel's message wiring
// (loadMore / loadAll / apply / cancel / dispose) can be driven directly.
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
  },
}));

import * as vscode from 'vscode';
import { showUndoRefactoringPanel } from '../undoRefactoringPanel';
import { UndoChange, UndoPreviewPage, UndoStartPreview } from '../undoRefactoringPreview';

/**
 * The undo preview panel's message wiring (#434).
 *
 * The panel itself is HTML (covered by `undoRefactoringPanelHtml`); what lives here is the
 * conversation with it, and two of its rules exist because undoing is not a preview
 * operation but a real one:
 *
 *  - APPLY IS ONE-SHOT. `handlers.apply` performs the inverse change set server-side, so a
 *    double-click or a replayed webview message must not run it twice.
 *  - CLEANUP HAPPENS EXACTLY ONCE, on every way out — apply, cancel, or the user closing
 *    the tab — because it drops a preview session the stone is holding open.
 */

interface MockPanel {
  __emit: (m: unknown) => void;
  dispose: () => void;
  webview: { postMessage: ReturnType<typeof vi.fn>; html: string };
}

function lastPanel(): MockPanel {
  const mock = vscode.window.createWebviewPanel as unknown as {
    mock: { results: Array<{ value: MockPanel }> };
  };
  return mock.mock.results[mock.mock.results.length - 1].value;
}

const change = (id: string): UndoChange => ({
  id,
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: `sel${id}`,
  newName: null,
  category: 'accessing',
  oldSource: `sel${id} ^1`,
  newSource: `sel${id} ^2`,
  warning: null,
});

const page = (over: Partial<UndoPreviewPage> = {}): UndoPreviewPage => ({
  changes: [change('1')],
  nextOffset: 2,
  done: false,
  ...over,
});

const start = (over: Partial<UndoStartPreview> = {}): UndoStartPreview => ({
  token: 'tok',
  label: 'Rename #total to #sum',
  engine: 'GsRenameMethodRefactoring',
  mechanism: 'changeSet',
  reverseKind: null,
  deselection: 'perChange',
  dropCount: 0,
  sequence: 1,
  drifted: 0,
  total: 3,
  page: page(),
  ...over,
});

const handlers = (over: Partial<Parameters<typeof showUndoRefactoringPanel>[1]> = {}) => ({
  loadPage: vi.fn(async () => page({ changes: [change('2')], nextOffset: 3, done: true })),
  apply: vi.fn(async () => ({ applied: 3, failed: [] })),
  cleanup: vi.fn(),
  ...over,
});

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('showUndoRefactoringPanel', () => {
  it('titles the panel for the refactoring it would reverse', () => {
    void showUndoRefactoringPanel(start(), handlers());

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'gemstoneUndoRefactoring',
      'Undo Rename #total to #sum',
      1,
      expect.objectContaining({ enableScripts: true }),
    );
  });

  it('resolves with the apply result and drops the preview session', async () => {
    const h = handlers();
    const done = showUndoRefactoringPanel(start(), h);

    lastPanel().__emit({ command: 'apply', deselected: ['1'] });

    await expect(done).resolves.toEqual({ applied: 3, failed: [] });
    expect(h.apply).toHaveBeenCalledWith(['1']);
    expect(h.cleanup).toHaveBeenCalledTimes(1);
  });

  it('reports only the DESELECTED ids, so an unloaded change is undone by default', async () => {
    // The same contract a forward apply follows: the server holds the change set, and the
    // client can only say what to skip. A page the user never scrolled to is not a choice.
    const h = handlers();
    const done = showUndoRefactoringPanel(start(), h);

    lastPanel().__emit({ command: 'apply' });
    await done;

    expect(h.apply).toHaveBeenCalledWith([]);
  });

  it('applies once however many times the message arrives', async () => {
    // Undo is not idempotent: a second dispatch would reverse the reversal.
    const h = handlers();
    const done = showUndoRefactoringPanel(start(), h);
    const panel = lastPanel();

    panel.__emit({ command: 'apply', deselected: [] });
    panel.__emit({ command: 'apply', deselected: [] });
    await done;

    expect(h.apply).toHaveBeenCalledTimes(1);
    expect(h.cleanup).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined on cancel, and on the user closing the tab', async () => {
    const cancelled = handlers();
    const cancelledPromise = showUndoRefactoringPanel(start(), cancelled);
    lastPanel().__emit({ command: 'cancel' });
    await expect(cancelledPromise).resolves.toBeUndefined();
    expect(cancelled.cleanup).toHaveBeenCalledTimes(1);

    const closed = handlers();
    const closedPromise = showUndoRefactoringPanel(start(), closed);
    lastPanel().dispose();
    await expect(closedPromise).resolves.toBeUndefined();
    expect(closed.cleanup).toHaveBeenCalledTimes(1);
  });

  it('appends one page on More, and says when the list is complete', async () => {
    const h = handlers();
    void showUndoRefactoringPanel(start(), h);
    const panel = lastPanel();

    panel.__emit({ command: 'loadMore' });
    await settle();

    expect(h.loadPage).toHaveBeenCalledWith(2);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'appendChanges', done: true }),
    );
  });

  it('keeps fetching on Load all until the server says it is done', async () => {
    const h = handlers({
      loadPage: vi
        .fn()
        .mockResolvedValueOnce(page({ changes: [change('2')], nextOffset: 3, done: false }))
        .mockResolvedValueOnce(page({ changes: [change('3')], nextOffset: 4, done: true })),
    });
    void showUndoRefactoringPanel(start(), h);

    lastPanel().__emit({ command: 'loadAll' });
    await settle();

    expect(h.loadPage).toHaveBeenCalledTimes(2);
    expect(h.loadPage).toHaveBeenNthCalledWith(2, 3);
  });

  it('answers a fetch for a list that is already complete without asking the stone', async () => {
    const h = handlers();
    void showUndoRefactoringPanel(start({ page: page({ done: true }) }), h);
    const panel = lastPanel();

    panel.__emit({ command: 'loadMore' });
    await settle();

    expect(h.loadPage).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ command: 'busyDone' });
  });

  it('reports a failed fetch and leaves the panel usable', async () => {
    // The session is still alive and the preview token still valid, so the right outcome is
    // a message and a released spinner — not a closed panel and a lost undo.
    const h = handlers({
      loadPage: vi.fn().mockRejectedValue(new Error('session busy')),
    });
    const done = showUndoRefactoringPanel(start(), h);
    const panel = lastPanel();

    panel.__emit({ command: 'loadMore' });
    await settle();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Undo preview: session busy');
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ command: 'busyDone' });
    expect(h.cleanup).not.toHaveBeenCalled();

    // Still open, and a retry still reaches the handler.
    panel.__emit({ command: 'cancel' });
    await expect(done).resolves.toBeUndefined();
  });

  it('lets the user retry after a failed apply', async () => {
    const h = handlers({
      apply: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ applied: 3, failed: [] }),
    });
    const done = showUndoRefactoringPanel(start(), h);
    const panel = lastPanel();

    panel.__emit({ command: 'apply', deselected: [] });
    await settle();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Undo preview: boom');

    panel.__emit({ command: 'apply', deselected: [] });

    await expect(done).resolves.toEqual({ applied: 3, failed: [] });
    expect(h.apply).toHaveBeenCalledTimes(2);
  });

  it('ignores a message it does not recognise', () => {
    const h = handlers();
    void showUndoRefactoringPanel(start(), h);

    expect(() => lastPanel().__emit({ command: 'somethingElse' })).not.toThrow();
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.cleanup).not.toHaveBeenCalled();
  });
});
