import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn(),
    showWarningMessage: vi.fn(),
  },
  ViewColumn: { Beside: 2 },
}));

vi.mock('../../debugQueries', () => ({
  fetchPrintString: vi.fn(),
  getObjectClassName: vi.fn(),
  fetchFullPrintString: vi.fn(),
}));

vi.mock('../../browserQueries', () => ({
  executeFetchString: vi.fn(() => ''),
}));

vi.mock('../queries/getEnhancedInspectorViewSpecs', () => ({
  getEnhancedInspectorViewSpecs: vi.fn(),
  fetchObjectMeta: vi.fn(),
  fetchEnhancedInspectorPrintTabData: vi.fn(),
  fetchEnhancedInspectorTextData: vi.fn(),
  fetchEnhancedInspectorListData: vi.fn(),
  fetchEnhancedInspectorForwardListData: vi.fn(),
  fetchEnhancedInspectorForwardListTotal: vi.fn(),
  fetchEnhancedInspectorListTotal: vi.fn(),
  fetchEnhancedInspectorRowOop: vi.fn(),
  fetchEnhancedInspectorForwardRowOop: vi.fn(),
  fetchEnhancedInspectorTreeChildren: vi.fn(),
  fetchMethodSource: vi.fn(),
  fetchMethodBrowseLocation: vi.fn(),
}));

vi.mock('../../systemBrowser', () => ({
  SystemBrowser: { navigateBeside: vi.fn() },
}));

import * as vscode from 'vscode';
import * as debug from '../../debugQueries';
import * as queries from '../queries/getEnhancedInspectorViewSpecs';
import { SystemBrowser } from '../../systemBrowser';
import { EnhancedInspector } from '../enhancedInspector';
import { ActiveSession } from '../../sessionManager';
import { GemStoneLogin } from '../../loginTypes';

// ── Mock panel factory ─────────────────────────────────────────────────────
// Each panel is self-contained: its own postMessage, title, and sendMessage.

function makeMockPanel() {
  const postMessage = vi.fn();
  let title = '';
  let messageHandler: ((msg: unknown) => Promise<void>) | undefined;

  const panel = {
    webview: {
      set html(_: string) {},
      postMessage,
      onDidReceiveMessage(cb: (msg: unknown) => Promise<void>) {
        messageHandler = cb;
        return { dispose: vi.fn() };
      },
    },
    get title() {
      return title;
    },
    set title(v: string) {
      title = v;
    },
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  };

  return {
    panel,
    get postMessage() {
      return postMessage;
    },
    get title() {
      return title;
    },
    async sendMessage(msg: unknown) {
      await messageHandler!(msg);
    },
  };
}

function createMockSession(): ActiveSession {
  return {
    id: 1,
    gci: {} as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.5',
  };
}

// ── Shared state ───────────────────────────────────────────────────────────

let session: ActiveSession;
let mock: ReturnType<typeof makeMockPanel>;

function setup(oop = 1000n, label = 'test') {
  EnhancedInspector.create(session, oop, label);
  return mock;
}

beforeEach(() => {
  vi.clearAllMocks();
  session = createMockSession();
  mock = makeMockPanel();
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
    mock.panel as unknown as vscode.WebviewPanel,
  );
  vi.mocked(debug.fetchPrintString).mockReturnValue({ value: 'an Object', truncated: false });
  vi.mocked(debug.getObjectClassName).mockReturnValue('Object');
  vi.mocked(queries.getEnhancedInspectorViewSpecs).mockResolvedValue([]);
  vi.mocked(queries.fetchObjectMeta).mockResolvedValue('{}');
});

afterEach(() => {
  EnhancedInspector.disposeForSession(session.id);
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('EnhancedInspector', () => {
  describe('A — panel lifecycle', () => {
    it('create() opens the panel beside the editor without stealing focus', () => {
      expect.assertions(1);
      EnhancedInspector.create(session, 1000n, 'test');
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneEnhancedInspector',
        'Inspector',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        expect.any(Object),
      );
    });

    it('disposeForSession() disposes all panels registered to a session', () => {
      expect.assertions(2);
      const mock2 = makeMockPanel();
      vi.mocked(vscode.window.createWebviewPanel)
        .mockReturnValueOnce(mock.panel as unknown as vscode.WebviewPanel)
        .mockReturnValueOnce(mock2.panel as unknown as vscode.WebviewPanel);
      EnhancedInspector.create(session, 1000n, 'first');
      EnhancedInspector.create(session, 2000n, 'second');
      EnhancedInspector.disposeForSession(session.id);
      expect(mock.panel.dispose).toHaveBeenCalled();
      expect(mock2.panel.dispose).toHaveBeenCalled();
    });

    it('disposeForSession() is a no-op for an unknown session id', () => {
      expect.assertions(1);
      expect(() => EnhancedInspector.disposeForSession(9999)).not.toThrow();
    });
  });

  describe('B — ready: panel title', () => {
    it('sets title from fetchPrintString when not truncated', async () => {
      expect.assertions(1);
      vi.mocked(debug.fetchPrintString).mockReturnValue({ value: 'an Array(3)', truncated: false });
      setup();
      await mock.sendMessage({ command: 'ready' });
      expect(mock.title).toBe('an Array(3)');
    });

    it('appends ellipsis to title when print string is truncated', async () => {
      expect.assertions(1);
      vi.mocked(debug.fetchPrintString).mockReturnValue({
        value: 'a very long string',
        truncated: true,
      });
      setup();
      await mock.sendMessage({ command: 'ready' });
      expect(mock.title).toBe('a very long string…');
    });

    it('calls fetchPrintString with the inspector oop and a limit of 40', async () => {
      expect.assertions(2);
      setup(5555n);
      await mock.sendMessage({ command: 'ready' });
      const [, oop, limit] = vi.mocked(debug.fetchPrintString).mock.calls[0];
      expect(oop).toBe(5555n);
      expect(limit).toBe(40);
    });
  });

  describe('C — ready: enhancedInspectorViewSpecs message', () => {
    it('always includes meta in the enhancedInspectorViewSpecs message', async () => {
      expect.assertions(1);
      vi.mocked(queries.fetchObjectMeta).mockResolvedValue('{"className":"Array"}');
      setup();
      await mock.sendMessage({ command: 'ready' });
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'enhancedInspectorViewSpecs',
          meta: '{"className":"Array"}',
        }),
      );
    });

    it('passes specs through in the enhancedInspectorViewSpecs message even when null', async () => {
      expect.assertions(1);
      vi.mocked(queries.getEnhancedInspectorViewSpecs).mockResolvedValue(null);
      setup();
      await mock.sendMessage({ command: 'ready' });
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'enhancedInspectorViewSpecs', specs: null }),
      );
    });

    it('includes className from getObjectClassName in the enhancedInspectorViewSpecs message', async () => {
      expect.assertions(1);
      vi.mocked(debug.getObjectClassName).mockReturnValue('OrderedCollection');
      setup();
      await mock.sendMessage({ command: 'ready' });
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'enhancedInspectorViewSpecs',
          className: 'OrderedCollection',
        }),
      );
    });
  });

  describe('D — fetchEnhancedInspectorViewData routing', () => {
    it('routes gtPrintFor: + text editor view to fetchEnhancedInspectorPrintTabData', async () => {
      expect.assertions(1);
      vi.mocked(queries.fetchEnhancedInspectorPrintTabData).mockResolvedValue({
        data: '{}',
        truncated: false,
      });
      setup();
      await mock.sendMessage({
        command: 'fetchEnhancedInspectorViewData',
        oop: '1000',
        methodSelector: 'gtPrintFor:',
        viewName: 'GtPhlowTextEditorViewSpecification',
      });
      expect(queries.fetchEnhancedInspectorPrintTabData).toHaveBeenCalled();
    });

    it('routes text view to fetchEnhancedInspectorTextData', async () => {
      expect.assertions(1);
      vi.mocked(queries.fetchEnhancedInspectorTextData).mockResolvedValue('{}');
      setup();
      await mock.sendMessage({
        command: 'fetchEnhancedInspectorViewData',
        oop: '1000',
        methodSelector: 'gtTextFor:',
        viewName: 'GtPhlowTextViewSpecification',
      });
      expect(queries.fetchEnhancedInspectorTextData).toHaveBeenCalled();
    });

    it('routes list view to fetchEnhancedInspectorListData', async () => {
      expect.assertions(1);
      vi.mocked(queries.fetchEnhancedInspectorListData).mockResolvedValue('[]');
      setup();
      await mock.sendMessage({
        command: 'fetchEnhancedInspectorViewData',
        oop: '1000',
        methodSelector: 'gtItemsFor:',
        viewName: 'GtPhlowListViewSpecification',
      });
      expect(queries.fetchEnhancedInspectorListData).toHaveBeenCalled();
    });
  });

  describe('E — fetchEnhancedInspectorViewTotal routing', () => {
    it('routes forward view to fetchEnhancedInspectorForwardListTotal', async () => {
      expect.assertions(2);
      vi.mocked(queries.fetchEnhancedInspectorForwardListTotal).mockResolvedValue(42);
      setup();
      await mock.sendMessage({
        command: 'fetchEnhancedInspectorViewTotal',
        oop: '1000',
        methodSelector: 'gtForwardFor:',
        viewName: 'GtPhlowForwardViewSpecification',
      });
      expect(queries.fetchEnhancedInspectorForwardListTotal).toHaveBeenCalled();
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'enhancedInspectorViewTotal', total: 42 }),
      );
    });

    it('routes non-forward view to fetchEnhancedInspectorListTotal', async () => {
      expect.assertions(2);
      vi.mocked(queries.fetchEnhancedInspectorListTotal).mockResolvedValue(10);
      setup();
      await mock.sendMessage({
        command: 'fetchEnhancedInspectorViewTotal',
        oop: '1000',
        methodSelector: 'gtItemsFor:',
        viewName: 'GtPhlowListViewSpecification',
      });
      expect(queries.fetchEnhancedInspectorListTotal).toHaveBeenCalled();
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'enhancedInspectorViewTotal', total: 10 }),
      );
    });
  });

  describe('F — enhancedInspectRow: double-click drills into a new miller column', () => {
    it('appends a column in the same webview rather than opening a new panel', async () => {
      expect.assertions(2);
      vi.mocked(queries.fetchEnhancedInspectorRowOop).mockResolvedValue(9999n);
      setup();
      const callsBefore = vi.mocked(vscode.window.createWebviewPanel).mock.calls.length;
      await mock.sendMessage({
        command: 'enhancedInspectRow',
        columnId: 0,
        itemOop: '1000',
        methodSelector: 'gtItemsFor:',
        nodeId: 3,
        viewName: 'GtPhlowListViewSpecification',
      });
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'addColumn', sourceColumnId: 0, oop: '9999' }),
      );
      expect(vi.mocked(vscode.window.createWebviewPanel).mock.calls.length).toBe(callsBefore);
    });

    it('carries a fresh column id that differs from the source column', async () => {
      expect.assertions(1);
      vi.mocked(queries.fetchEnhancedInspectorRowOop).mockResolvedValue(9999n);
      setup();
      await mock.sendMessage({
        command: 'enhancedInspectRow',
        columnId: 0,
        itemOop: '1000',
        methodSelector: 'gtItemsFor:',
        nodeId: 3,
        viewName: 'GtPhlowListViewSpecification',
      });
      const addColumn = mock.postMessage.mock.calls
        .map((c) => c[0])
        .find((m) => m.command === 'addColumn');
      expect(addColumn.columnId).not.toBe(addColumn.sourceColumnId);
    });

    it('uses fetchEnhancedInspectorForwardRowOop for double-click on a forward view row', async () => {
      expect.assertions(1);
      vi.mocked(queries.fetchEnhancedInspectorForwardRowOop).mockResolvedValue(8888n);
      setup();
      await mock.sendMessage({
        command: 'enhancedInspectRow',
        columnId: 0,
        itemOop: '1000',
        methodSelector: 'gtForwardFor:',
        nodeId: 2,
        viewName: 'GtPhlowForwardViewSpecification',
      });
      expect(queries.fetchEnhancedInspectorForwardRowOop).toHaveBeenCalled();
    });

    it('does not append a column when row OOP is null', async () => {
      expect.assertions(1);
      vi.mocked(queries.fetchEnhancedInspectorRowOop).mockResolvedValue(null);
      setup();
      await mock.sendMessage({
        command: 'enhancedInspectRow',
        columnId: 0,
        itemOop: '1000',
        methodSelector: 'gtItemsFor:',
        nodeId: 3,
        viewName: 'GtPhlowListViewSpecification',
      });
      expect(mock.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: 'addColumn' }),
      );
    });
  });

  describe('M — column-aware message protocol', () => {
    it('tags the root view specs message with the root column id', async () => {
      expect.assertions(1);
      setup();
      await mock.sendMessage({ command: 'ready' });
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'enhancedInspectorViewSpecs', columnId: 0 }),
      );
    });

    it('echoes the requesting column id back on a view-data response', async () => {
      expect.assertions(1);
      vi.mocked(queries.fetchEnhancedInspectorListData).mockResolvedValue('[]');
      setup();
      await mock.sendMessage({
        command: 'fetchEnhancedInspectorViewData',
        columnId: 7,
        oop: '1000',
        methodSelector: 'gtItemsFor:',
        viewName: 'GtPhlowListViewSpecification',
      });
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'enhancedInspectorViewData', columnId: 7 }),
      );
    });

    it('updates the panel title when the focused column changes', async () => {
      expect.assertions(1);
      setup();
      await mock.sendMessage({ command: 'setTitle', title: 'a Character' });
      expect(mock.title).toBe('a Character');
    });

    it('disposes the whole panel when the root column is closed', async () => {
      expect.assertions(1);
      setup();
      await mock.sendMessage({ command: 'closePanel' });
      expect(mock.panel.dispose).toHaveBeenCalled();
    });
  });

  describe('H — fetchMoreRows', () => {
    it('posts enhancedInspectorMoreRows (not enhancedInspectorViewData) with list data', async () => {
      expect.assertions(1);
      vi.mocked(queries.fetchEnhancedInspectorListData).mockResolvedValue('[1,2,3]');
      setup();
      await mock.sendMessage({
        command: 'fetchMoreRows',
        oop: '1000',
        methodSelector: 'gtItemsFor:',
        viewName: 'GtPhlowListViewSpecification',
        fromIndex: 11,
      });
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'enhancedInspectorMoreRows',
          methodSelector: 'gtItemsFor:',
          data: '[1,2,3]',
        }),
      );
    });

    it('passes fromIndex through to the query function', async () => {
      expect.assertions(1);
      vi.mocked(queries.fetchEnhancedInspectorListData).mockResolvedValue('[]');
      setup();
      await mock.sendMessage({
        command: 'fetchMoreRows',
        oop: '1000',
        methodSelector: 'gtItemsFor:',
        viewName: 'GtPhlowListViewSpecification',
        fromIndex: 21,
      });
      expect(queries.fetchEnhancedInspectorListData).toHaveBeenCalledWith(
        expect.any(Function),
        1000n,
        'gtItemsFor:',
        21,
        expect.any(Number),
      );
    });
  });

  describe('I — fetchEnhancedInspectorRangeData', () => {
    it('routes non-forward view to fetchEnhancedInspectorListData and posts enhancedInspectorRangeData with rangeStart', async () => {
      expect.assertions(2);
      vi.mocked(queries.fetchEnhancedInspectorListData).mockResolvedValue('[4,5,6]');
      setup();
      await mock.sendMessage({
        command: 'fetchEnhancedInspectorRangeData',
        oop: '1000',
        methodSelector: 'gtItemsFor:',
        viewName: 'GtPhlowListViewSpecification',
        fromIndex: 5,
        rangeStart: 5,
      });
      expect(queries.fetchEnhancedInspectorListData).toHaveBeenCalled();
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'enhancedInspectorRangeData',
          methodSelector: 'gtItemsFor:',
          rangeStart: 5,
          data: '[4,5,6]',
        }),
      );
    });

    it('routes forward view to fetchEnhancedInspectorForwardListData', async () => {
      expect.assertions(1);
      vi.mocked(queries.fetchEnhancedInspectorForwardListData).mockResolvedValue('[7,8,9]');
      setup();
      await mock.sendMessage({
        command: 'fetchEnhancedInspectorRangeData',
        oop: '1000',
        methodSelector: 'gtForwardFor:',
        viewName: 'GtPhlowForwardViewSpecification',
        fromIndex: 1,
        rangeStart: 1,
      });
      expect(queries.fetchEnhancedInspectorForwardListData).toHaveBeenCalled();
    });
  });

  describe('J — fetchEnhancedInspectorTreeChildren', () => {
    it('calls fetchEnhancedInspectorTreeChildren and posts enhancedInspectorTreeChildren with path and data', async () => {
      expect.assertions(2);
      vi.mocked(queries.fetchEnhancedInspectorTreeChildren).mockResolvedValue(
        '[{"label":"child"}]',
      );
      setup();
      await mock.sendMessage({
        command: 'fetchEnhancedInspectorTreeChildren',
        itemOop: '2000',
        methodSelector: 'gtTreeFor:',
        path: [1, 2],
      });
      expect(queries.fetchEnhancedInspectorTreeChildren).toHaveBeenCalledWith(
        expect.any(Function),
        2000n,
        'gtTreeFor:',
        [1, 2],
      );
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'enhancedInspectorTreeChildren',
          methodSelector: 'gtTreeFor:',
          path: [1, 2],
          data: '[{"label":"child"}]',
        }),
      );
    });
  });

  describe('K — fetchFullPrintString', () => {
    it('wraps fetchFullPrintString result in JSON with stylerSpecification null and posts fullPrintString', async () => {
      expect.assertions(2);
      vi.mocked(debug.fetchFullPrintString).mockResolvedValue('this is the full text');
      setup();
      await mock.sendMessage({
        command: 'fetchFullPrintString',
        oop: '1000',
        methodSelector: 'gtPrintFor:',
      });
      expect(debug.fetchFullPrintString).toHaveBeenCalled();
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'fullPrintString',
          methodSelector: 'gtPrintFor:',
          data: JSON.stringify({ string: 'this is the full text', stylerSpecification: null }),
        }),
      );
    });
  });

  describe('L — fetchMethodSource', () => {
    it('posts methodSource with source, methodSelector, and isClassSide', async () => {
      expect.assertions(1);
      vi.mocked(queries.fetchMethodSource).mockResolvedValue('size\n  ^ self basicSize');
      setup();
      await mock.sendMessage({
        command: 'fetchMethodSource',
        oop: '1000',
        methodSelector: 'size',
        isClassSide: false,
      });
      expect(mock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'methodSource',
          methodSelector: 'size',
          isClassSide: false,
          source: 'size\n  ^ self basicSize',
        }),
      );
    });
  });

  describe('G — browseMethod', () => {
    it('calls SystemBrowser.navigateBeside when location is found', async () => {
      expect.assertions(1);
      vi.mocked(queries.fetchMethodBrowseLocation).mockResolvedValue({
        dictName: 'Globals',
        className: 'Array',
        category: 'accessing',
      });
      setup();
      await mock.sendMessage({
        command: 'browseMethod',
        oop: '1000',
        methodSelector: 'size',
        isClassSide: false,
      });
      expect(SystemBrowser.navigateBeside).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ className: 'Array', selector: 'size' }),
      );
    });

    it('shows a warning and does not navigate when location is null', async () => {
      expect.assertions(2);
      vi.mocked(queries.fetchMethodBrowseLocation).mockResolvedValue(null);
      setup();
      await mock.sendMessage({
        command: 'browseMethod',
        oop: '1000',
        methodSelector: 'size',
        isClassSide: false,
      });
      expect(vscode.window.showWarningMessage).toHaveBeenCalled();
      expect(SystemBrowser.navigateBeside).not.toHaveBeenCalled();
    });
  });
});
