import { describe, it, expect, vi, beforeEach } from 'vitest';

// A controllable webview panel so the paginated instVar panel's message wiring
// (loadMore / apply / cancel / commit-confirm / dispose) can be driven.
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
import { showInstVarRefactorPanel } from '../instVarRefactorPanel';
import { StartInstVarPreview, ApplyResult } from '../instVarRefactorPreview';

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

const start: StartInstVarPreview = {
  token: 'tok',
  total: 2,
  sourceClass: 'Foo',
  outOfScope: {
    decline: null,
    willNotRecompile: [],
    actedOnClass: 'Foo',
    note: null,
    sessionHasUncommittedChanges: false,
  },
  page: {
    changes: [
      {
        id: '1',
        kind: 'classDefinitionEdit',
        dictName: 'UserGlobals',
        className: 'Foo',
        oldSource: 'a',
        newSource: 'b',
      },
    ],
    nextOffset: 2,
    done: false,
  },
};

function handlers() {
  return {
    loadPage: vi.fn(async () => ({
      changes: [
        {
          id: '2',
          kind: 'classReparent' as const,
          dictName: 'UserGlobals',
          className: 'Sub',
          oldSource: 'x',
          newSource: 'x',
        },
      ],
      nextOffset: 3,
      done: true,
    })),
    apply: vi.fn(async (): Promise<ApplyResult> => ({
      applied: 2,
      failed: [],
      dropped: [],
      committed: false,
    })),
    abort: vi.fn(),
    cleanup: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('showInstVarRefactorPanel', () => {
  it('loadMore fetches a page and posts appendChanges', async () => {
    const h = handlers();
    void showInstVarRefactorPanel('Add tally to Foo', start, h);
    const panel = lastPanel();
    panel.__emit({ command: 'loadMore' });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.loadPage).toHaveBeenCalledWith(2);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'appendChanges' }),
    );
  });

  it('apply (no commit) passes options through and resolves with the result', async () => {
    const h = handlers();
    const p = showInstVarRefactorPanel('Add tally to Foo', start, h);
    lastPanel().__emit({
      command: 'apply',
      deselected: [],
      options: ['logCreation'],
      migrate: false,
      deleteHistory: false,
    });
    const result = await p;
    expect(h.apply).toHaveBeenCalledWith(['logCreation'], false, false);
    expect(result?.applied).toBe(2);
    expect(h.cleanup).toHaveBeenCalledOnce();
  });

  it('a committing apply asks for confirmation and aborts when declined', async () => {
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const h = handlers();
    void showInstVarRefactorPanel('Add tally to Foo', start, h);
    lastPanel().__emit({
      command: 'apply',
      deselected: [],
      options: [],
      migrate: true,
      deleteHistory: false,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMMIT'),
      expect.objectContaining({ modal: true }),
      'Apply & Commit',
    );
    expect(h.apply).not.toHaveBeenCalled();
  });

  // `System commitTransaction` commits the WHOLE session transaction, so the user's other
  // uncommitted work rides along with a migrate / delete-history apply. The engine reports
  // `System needsCommit` in the preview; the confirmation must say so.
  it('warns that other uncommitted work will be committed too when the session has some', async () => {
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const dirty: StartInstVarPreview = {
      ...start,
      outOfScope: { ...start.outOfScope, sessionHasUncommittedChanges: true },
    };

    void showInstVarRefactorPanel('Add tally to Foo', dirty, handlers());
    lastPanel().__emit({
      command: 'apply',
      deselected: [],
      options: [],
      migrate: true,
      deleteHistory: false,
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('OTHER uncommitted changes'),
      expect.objectContaining({ modal: true }),
      'Apply & Commit',
    );
  });

  it('does not mention other uncommitted work when the session is clean', async () => {
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    void showInstVarRefactorPanel('Add tally to Foo', start, handlers());
    lastPanel().__emit({
      command: 'apply',
      deselected: [],
      options: [],
      migrate: true,
      deleteHistory: false,
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.not.stringContaining('OTHER uncommitted changes'),
      expect.objectContaining({ modal: true }),
      'Apply & Commit',
    );
  });

  it('a confirmed committing apply calls apply with the commit flags', async () => {
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'Apply & Commit',
    );
    const h = handlers();
    h.apply = vi.fn(async (): Promise<ApplyResult> => ({
      applied: 1,
      failed: [],
      dropped: [],
      committed: true,
    }));
    const p = showInstVarRefactorPanel('Add tally to Foo', start, h);
    lastPanel().__emit({
      command: 'apply',
      deselected: [],
      options: [],
      migrate: true,
      deleteHistory: true,
    });
    const result = await p;
    expect(h.apply).toHaveBeenCalledWith([], true, true);
    expect(result?.committed).toBe(true);
  });

  it('a second apply while the first is still in flight is ignored', async () => {
    const h = handlers();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    h.apply = vi.fn(async () => {
      await gate;
      return { applied: 2, failed: [], dropped: [], committed: false };
    });
    const applyMsg = {
      command: 'apply',
      deselected: [],
      options: [],
      migrate: false,
      deleteHistory: false,
    };

    const p = showInstVarRefactorPanel('Add tally to Foo', start, h);
    const panel = lastPanel();
    panel.__emit(applyMsg);
    panel.__emit(applyMsg); // the double-click
    await new Promise((r) => setTimeout(r, 0));

    expect(h.apply).toHaveBeenCalledTimes(1);

    release();
    expect((await p)?.applied).toBe(2);
    expect(h.apply).toHaveBeenCalledTimes(1);
    expect(h.cleanup).toHaveBeenCalledOnce();
  });

  it('a second apply while the commit confirmation is open is ignored', async () => {
    let confirm!: (choice: string | undefined) => void;
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((r) => {
        confirm = r;
      }),
    );
    const h = handlers();
    const applyMsg = {
      command: 'apply',
      deselected: [],
      options: [],
      migrate: true,
      deleteHistory: false,
    };

    const p = showInstVarRefactorPanel('Add tally to Foo', start, h);
    const panel = lastPanel();
    panel.__emit(applyMsg);
    panel.__emit(applyMsg); // arrives while the modal is up
    await new Promise((r) => setTimeout(r, 0));

    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(h.apply).not.toHaveBeenCalled();

    confirm('Apply & Commit');
    await p;
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it('a declined committing apply can be retried', async () => {
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('Apply & Commit');
    const h = handlers();
    const applyMsg = {
      command: 'apply',
      deselected: [],
      options: [],
      migrate: true,
      deleteHistory: false,
    };

    const p = showInstVarRefactorPanel('Add tally to Foo', start, h);
    const panel = lastPanel();

    panel.__emit(applyMsg); // declined
    await new Promise((r) => setTimeout(r, 0));
    expect(h.apply).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'busyDone' }),
    );

    panel.__emit(applyMsg); // retry, confirmed this time
    await p;

    expect(h.apply).toHaveBeenCalledTimes(1);
    expect(h.apply).toHaveBeenCalledWith([], true, false);
  });

  it('an apply that fails can be retried, and the retry runs', async () => {
    const h = handlers();
    h.apply = vi
      .fn()
      .mockRejectedValueOnce(new Error('apply boom'))
      .mockResolvedValueOnce({ applied: 2, failed: [], dropped: [], committed: false });
    const applyMsg = {
      command: 'apply',
      deselected: [],
      options: [],
      migrate: false,
      deleteHistory: false,
    };

    const p = showInstVarRefactorPanel('Add tally to Foo', start, h);
    const panel = lastPanel();

    panel.__emit(applyMsg);
    await new Promise((r) => setTimeout(r, 0));
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('apply boom'),
    );

    panel.__emit(applyMsg);
    expect((await p)?.applied).toBe(2);
    expect(h.apply).toHaveBeenCalledTimes(2);
  });

  const applyMsg = {
    command: 'apply',
    deselected: [],
    options: [],
    migrate: false,
    deleteHistory: false,
  };

  it('leaves the preview open with a failure notice, rather than resolving, when the apply fails', async () => {
    const h = handlers();
    h.apply = vi.fn(async (): Promise<ApplyResult> => ({
      applied: 1,
      failed: [{ id: 'c2', label: 'Sub (recompiled)', error: 'boom' }],
      dropped: [],
      committed: false,
      partiallyApplied: true,
    }));

    void showInstVarRefactorPanel('Add tally to Foo', start, h);
    const panel = lastPanel();
    panel.__emit(applyMsg);
    await new Promise((r) => setTimeout(r, 0));

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'applyFailed',
        canAbort: true,
        message: expect.stringContaining('already versioned'),
      }),
    );
    expect(h.cleanup).not.toHaveBeenCalled();
  });

  it('a whole-apply error shows a failure notice with no abort offered', async () => {
    const h = handlers();
    h.apply = vi.fn(async (): Promise<ApplyResult> => ({
      applied: 0,
      failed: [],
      dropped: [],
      committed: false,
      error: 'preview session expired',
    }));

    void showInstVarRefactorPanel('Add tally to Foo', start, h);
    const panel = lastPanel();
    panel.__emit(applyMsg);
    await new Promise((r) => setTimeout(r, 0));

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'applyFailed',
        canAbort: false,
        message: expect.stringContaining('preview session expired'),
      }),
    );
  });

  it('the in-panel abort aborts the transaction and confirms in place', async () => {
    const h = handlers();
    h.apply = vi.fn(async (): Promise<ApplyResult> => ({
      applied: 1,
      failed: [{ id: 'c2', label: 'Sub (recompiled)', error: 'boom' }],
      dropped: [],
      committed: false,
      partiallyApplied: true,
    }));

    void showInstVarRefactorPanel('Add tally to Foo', start, h);
    const panel = lastPanel();
    panel.__emit(applyMsg);
    await new Promise((r) => setTimeout(r, 0));
    panel.__emit({ command: 'abort' });

    expect(h.abort).toHaveBeenCalledOnce();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'aborted' }),
    );
  });

  it('reports an abort that throws in the panel instead of closing it', async () => {
    const h = handlers();
    h.apply = vi.fn(async (): Promise<ApplyResult> => ({
      applied: 1,
      failed: [{ id: 'c2', label: 'Sub (recompiled)', error: 'boom' }],
      dropped: [],
      committed: false,
      partiallyApplied: true,
    }));
    h.abort = vi.fn(() => {
      throw new Error('gci down');
    });

    void showInstVarRefactorPanel('Add tally to Foo', start, h);
    const panel = lastPanel();
    panel.__emit(applyMsg);
    await new Promise((r) => setTimeout(r, 0));
    panel.__emit({ command: 'abort' });

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'abortFailed',
        message: expect.stringContaining('gci down'),
      }),
    );
    expect(h.cleanup).not.toHaveBeenCalled();
  });

  it('cancel resolves undefined and cleans up', async () => {
    const h = handlers();
    const p = showInstVarRefactorPanel('Add tally to Foo', start, h);
    lastPanel().__emit({ command: 'cancel' });
    expect(await p).toBeUndefined();
    expect(h.cleanup).toHaveBeenCalledOnce();
  });

  it('loadAll fetches successive pages until the preview is exhausted', async () => {
    const page = (id: string, off: number, done: boolean) => ({
      changes: [
        {
          id,
          kind: 'classReparent' as const,
          dictName: 'UserGlobals',
          className: 'Sub',
          oldSource: 'x',
          newSource: 'x',
        },
      ],
      nextOffset: off,
      done,
    });
    const h = handlers();
    h.loadPage = vi
      .fn()
      .mockResolvedValueOnce(page('2', 3, false))
      .mockResolvedValueOnce(page('3', 4, true));

    void showInstVarRefactorPanel('Add tally to Foo', start, h);
    const panel = lastPanel();
    panel.__emit({ command: 'loadAll' });
    await new Promise((r) => setTimeout(r, 0));

    expect(h.loadPage).toHaveBeenNthCalledWith(1, 2);
    expect(h.loadPage).toHaveBeenNthCalledWith(2, 3);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'appendChanges', done: true }),
    );
  });

  it('a load request after the preview is exhausted just re-enables the panel', async () => {
    const h = handlers(); // its loadPage returns a single done:true page
    void showInstVarRefactorPanel('Add tally to Foo', start, h);
    const panel = lastPanel();

    panel.__emit({ command: 'loadMore' }); // consumes the last page → done
    await new Promise((r) => setTimeout(r, 0));
    panel.webview.postMessage.mockClear();

    panel.__emit({ command: 'loadMore' }); // nothing left to fetch
    await new Promise((r) => setTimeout(r, 0));

    expect(h.loadPage).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'busyDone' }),
    );
  });

  it('surfaces a page-load failure and re-enables the panel', async () => {
    const h = handlers();
    h.loadPage = vi.fn().mockRejectedValue(new Error('page boom'));

    void showInstVarRefactorPanel('Add tally to Foo', start, h);
    const panel = lastPanel();
    panel.__emit({ command: 'loadMore' });
    await new Promise((r) => setTimeout(r, 0));

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('page boom'),
    );
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'busyDone' }),
    );
  });
});
