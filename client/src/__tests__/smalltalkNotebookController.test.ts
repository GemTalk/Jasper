import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../gciLog', () => ({
  logError: vi.fn(),
}));
// Call-through spy, so a test can read the options a cell hands the runner.
vi.mock('../nbRunner', async (orig) => {
  const actual = await orig<typeof import('../nbRunner')>();
  return { ...actual, runNbCall: vi.fn(actual.runNbCall) };
});

import {
  notebooks,
  workspace,
  NotebookControllerAffinity,
  EventEmitter,
} from '../__mocks__/vscode';
import {
  SmalltalkNotebookController,
  SMALLTALK_CONTROLLER_ID,
  SMALLTALK_CONTROLLER_LABEL,
} from '../smalltalkNotebookController';
import { GEMSTONE_NOTEBOOK_TYPE } from '../gemstoneNotebookKernel';
import { runNbCall, type NbRunOptions } from '../nbRunner';
import { SessionManager } from '../sessionManager';
import { SMALLTALK_LANGUAGE } from '../languageIds';

// Cells run on the non-blocking execute path in clientForwarder mode. The mock
// gci covers that path: NbExecute starts the doit, NbPoll reports ready,
// NbResult yields the result oop, FetchUtf8 reads its string. The transcript
// sink's start/end/drain calls go through executeAndFetchString.
function makeGci(overrides: Record<string, unknown> = {}) {
  return {
    GciTsCallInProgress: vi.fn(() => ({ result: 0, err: { number: 0 } })),
    GciTsNbExecute: vi.fn((..._args: unknown[]) => ({
      success: true,
      err: { number: 0, message: '' },
    })),
    isAvailable: vi.fn(() => true),
    GciTsNbPoll: vi.fn(() => ({ result: 1, err: { number: 0 } })),
    GciTsNbResult: vi.fn(() => ({ result: 200n, err: { number: 0, message: '', context: 0x14n } })),
    GciTsFetchUtf8: vi.fn(() => ({ data: '7', err: { number: 0 } })),
    executeAndFetchString: vi.fn((..._args: unknown[]) => ''),
    ...overrides,
  };
}

function makeSession(gci = makeGci()) {
  return {
    id: 1,
    gci,
    handle: {},
    login: { label: 'Test' },
    stoneVersion: '3.7.2',
  };
}

function makeSessionManager(session: ReturnType<typeof makeSession> | undefined) {
  return {
    resolveSession: vi.fn(async () => session),
    getSelectedSession: vi.fn(() => undefined),
    getSessions: vi.fn(() => []),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
    onDidAddSession: vi.fn(() => ({ dispose: () => {} })),
    onDidRemoveSession: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;
}

function makeCell(source: string, notebookUri = 'file:///tmp/demo.ipynb') {
  return {
    document: { getText: () => source, languageId: SMALLTALK_LANGUAGE },
    notebook: { uri: { toString: () => notebookUri } },
  };
}

function lastController() {
  const results = notebooks.createNotebookController.mock.results;
  return results[results.length - 1].value;
}

function executionAt(index: number) {
  return lastController().createNotebookCellExecution.mock.results[index].value;
}

async function runCells(cells: unknown[]) {
  await lastController().executeHandler(cells);
}

describe('SmalltalkNotebookController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a controller for the jupyter-notebook type with smalltalk cells', () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession()));
    expect(notebooks.createNotebookController).toHaveBeenCalledWith(
      SMALLTALK_CONTROLLER_ID,
      GEMSTONE_NOTEBOOK_TYPE,
      SMALLTALK_CONTROLLER_LABEL,
    );
    const mock = lastController();
    expect(mock.supportedLanguages).toEqual([SMALLTALK_LANGUAGE]);
    expect(mock.supportsExecutionOrder).toBe(true);
    ctrl.dispose();
  });

  // Each cell is an independent doit through wrapExecuteCode — the same
  // contract as the MCP execute_code tool: block-wrapped, stack-guarded,
  // printString of the last statement's value.
  it('executes a cell as a guarded doit and shows the printString result', async () => {
    const gci = makeGci();
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession(gci)));

    await runCells([makeCell('3 + 4')]);

    expect(gci.GciTsNbExecute).toHaveBeenCalledTimes(1);
    const code = gci.GciTsNbExecute.mock.calls[0][1] as string;
    expect(code).toContain('[[[3 + 4] value printString]');
    expect(code).toContain('on: AlmostOutOfStack');
    expect(code).toContain('on: AbstractException');

    const execution = executionAt(0);
    expect(execution.end).toHaveBeenCalledWith(true, expect.any(Number));
    const item = execution.replaceOutput.mock.calls[0][0][0].items[0];
    expect(item.mime).toBe('text/plain');
    expect(new TextDecoder().decode(item.data)).toBe('7');
    ctrl.dispose();
  });

  it('starts clientForwarder mode for the wrapped cell it runs, and ends it after', async () => {
    const gci = makeGci();
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession(gci)));

    await runCells([makeCell("Transcript show: 'hi'. 3 + 4")]);

    const sent = gci.GciTsNbExecute.mock.calls[0][1] as string;
    const sinkCalls = gci.executeAndFetchString.mock.calls
      .map((c) => c[1] as string)
      .filter((code) => code.includes('ClientForwarderMode'));
    expect(sinkCalls).toHaveLength(2);
    expect(sinkCalls[0]).toContain(
      `jasperStartClientForwarderModeFor: '${sent.replace(/'/g, "''")}'`,
    );
    expect(sinkCalls[1]).toContain('jasperEndClientForwarderMode');
    ctrl.dispose();
  });

  // After a hard break the `finally`'s end is refused while the cell is still
  // being collected; the runner calls this hook once it has been (when is
  // nbRunner.test.ts's to pin).
  it('ends clientForwarder mode once a hard-broken cell is collected', async () => {
    const gci = makeGci();
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession(gci)));
    await runCells([makeCell('3 + 4')]);
    const opts = vi.mocked(runNbCall).mock.lastCall![3] as NbRunOptions;
    gci.executeAndFetchString.mockClear();

    opts.onAbandonedCollected!();

    const sent = gci.executeAndFetchString.mock.calls.map((c) => c[1] as string);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('jasperEndClientForwarderMode');
    ctrl.dispose();
  });

  it('ends with an error output when the doit reports an inline error', async () => {
    const gci = makeGci({
      GciTsFetchUtf8: vi.fn(() => ({
        data: 'Error: ZeroDivide — attempt to divide 1 by zero',
        err: { number: 0 },
      })),
    });
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession(gci)));

    await runCells([makeCell('1 / 0')]);

    const execution = executionAt(0);
    expect(execution.end).toHaveBeenCalledWith(false, expect.any(Number));
    const item = execution.replaceOutput.mock.calls[0][0][0].items[0];
    expect(item.mime).toBe('application/vnd.code.notebook.error');
    expect(new TextDecoder().decode(item.data)).toContain('ZeroDivide');
    ctrl.dispose();
  });

  it('clears the stopped process when an error escapes the cell wrapper', async () => {
    // wrapExecuteCode reports ordinary errors inline, so a non-zero err here
    // escaped it -- possibly raised inside a Transcript write, where the
    // process holds the session's Transcript semaphore. Left suspended it leaks
    // and keeps that semaphore; there is no notebook debugger to hand it to.
    const clearStack = vi.fn((_handle: unknown, _gsProcess: bigint) => ({
      success: true,
      err: { number: 0 },
    }));
    const gci = makeGci({
      GciTsNbResult: vi.fn(() => ({
        result: 0n,
        err: { number: 2010, message: 'a Halt occurred', context: 0x99n },
      })),
      GciTsClearStack: clearStack,
    });
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession(gci)));

    await runCells([makeCell('Transcript nextPutAll: brokenPrintString')]);

    expect(clearStack).toHaveBeenCalledTimes(1);
    expect(clearStack.mock.calls[0][1]).toBe(0x99n);
    expect(executionAt(0).end).toHaveBeenCalledWith(false, expect.any(Number));
    ctrl.dispose();
  });

  it('does not clear a stack it has no context for', async () => {
    const clearStack = vi.fn((_handle: unknown, _gsProcess: bigint) => ({
      success: true,
      err: { number: 0 },
    }));
    const gci = makeGci({
      GciTsNbResult: vi.fn(() => ({
        result: 0n,
        err: { number: 2010, message: 'a Halt occurred', context: 0n },
      })),
      GciTsClearStack: clearStack,
    });
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession(gci)));

    await runCells([makeCell('nil foo')]);

    expect(clearStack).not.toHaveBeenCalled();
    ctrl.dispose();
  });

  it('reports a busy session as a cell error without starting the execute', async () => {
    const gci = makeGci({
      GciTsCallInProgress: vi.fn(() => ({ result: 1, err: { number: 0 } })),
    });
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession(gci)));

    await runCells([makeCell('3 + 4')]);

    expect(gci.GciTsNbExecute).not.toHaveBeenCalled();
    expect(executionAt(0).end).toHaveBeenCalledWith(false, expect.any(Number));
    ctrl.dispose();
  });

  it('fails the cell without executing when no session is active', async () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(undefined));
    await runCells([makeCell('3 + 4')]);

    const execution = executionAt(0);
    expect(execution.end).toHaveBeenCalledWith(false, expect.any(Number));
    const item = execution.replaceOutput.mock.calls[0][0][0].items[0];
    expect(new TextDecoder().decode(item.data)).toContain('No GemStone session');
    ctrl.dispose();
  });

  it('increments executionOrder independently of other kernels', async () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession()));
    await runCells([makeCell('1'), makeCell('2')]);
    expect(executionAt(0).executionOrder).toBe(1);
    expect(executionAt(1).executionOrder).toBe(2);
    ctrl.dispose();
  });

  it('dispose releases the controller', () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession()));
    const mock = lastController();
    ctrl.dispose();
    expect(mock.dispose).toHaveBeenCalled();
  });

  describe('default kernel for Smalltalk notebooks', () => {
    function makeNotebook(languages: string[], notebookType = GEMSTONE_NOTEBOOK_TYPE) {
      return {
        notebookType,
        getCells: () => [
          { kind: 1, document: { languageId: 'markdown' } },
          ...languages.map((languageId) => ({ kind: 2, document: { languageId } })),
        ],
      };
    }

    function openNotebook(doc: ReturnType<typeof makeNotebook>) {
      const listener = vi.mocked(workspace.onDidOpenNotebookDocument).mock.calls.at(-1)![0] as (
        d: unknown,
      ) => void;
      listener(doc);
    }

    it('prefers itself for a notebook whose code cells are all Smalltalk', () => {
      const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession()));
      const doc = makeNotebook([SMALLTALK_LANGUAGE, SMALLTALK_LANGUAGE]);
      openNotebook(doc);
      expect(lastController().updateNotebookAffinity).toHaveBeenCalledWith(
        doc,
        NotebookControllerAffinity.Preferred,
      );
      ctrl.dispose();
    });

    it('leaves a mixed-language or non-Jupyter notebook alone', () => {
      const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession()));
      openNotebook(makeNotebook([SMALLTALK_LANGUAGE, 'python']));
      openNotebook(makeNotebook([]));
      openNotebook(makeNotebook([SMALLTALK_LANGUAGE], 'interactive'));
      expect(lastController().updateNotebookAffinity).not.toHaveBeenCalled();
      ctrl.dispose();
    });

    it('prefers itself for a Smalltalk notebook already open at activation', () => {
      const doc = makeNotebook([SMALLTALK_LANGUAGE]);
      workspace.notebookDocuments.push(doc);
      try {
        const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession()));
        expect(lastController().updateNotebookAffinity).toHaveBeenCalledWith(
          doc,
          NotebookControllerAffinity.Preferred,
        );
        ctrl.dispose();
      } finally {
        workspace.notebookDocuments.length = 0;
      }
    });
  });

  describe('kernel label names the active session', () => {
    const LOGIN = { gs_user: 'DataCurator', stone: 'gs64stone', gem_host: 'localhost' };

    function makeSwitchableSessionManager() {
      const selection = new EventEmitter<number | null>();
      let active: { id: number; login: typeof LOGIN } | undefined;
      const manager = {
        resolveSession: vi.fn(async () => active),
        getSelectedSession: () => active,
        getSessions: () => (active ? [active] : []),
        onDidChangeSelection: selection.event,
        onDidAddSession: vi.fn(() => ({ dispose: () => {} })),
        onDidRemoveSession: vi.fn(() => ({ dispose: () => {} })),
      } as unknown as SessionManager;
      const select = (id: number | undefined) => {
        active = id === undefined ? undefined : { id, login: LOGIN };
        selection.fire(id ?? null);
      };
      return { manager, select };
    }

    it('shows the active session, and follows it when it changes', () => {
      const { manager, select } = makeSwitchableSessionManager();
      const ctrl = new SmalltalkNotebookController(manager);
      const mock = lastController();
      expect(mock.label).toBe(SMALLTALK_CONTROLLER_LABEL);

      select(3);
      expect(mock.label).toBe(
        `${SMALLTALK_CONTROLLER_LABEL} · Session 3 · DataCurator on gs64stone (localhost)`,
      );
      select(undefined);
      expect(mock.label).toBe(SMALLTALK_CONTROLLER_LABEL);
      ctrl.dispose();
    });

    // VS Code's extension host sends a controller's label on a microtask but an
    // affinity change at once (extHostNotebookKernels). The toolbar redraws on
    // the affinity change and reads whatever label it has by then, so the label
    // must reach VS Code first or the notebook keeps showing the old session.
    it('sends the new label to VS Code before the affinity change that redraws it', async () => {
      const sent: string[] = [];
      let label = '';
      const controller = {
        ...notebooks.createNotebookController('probe', GEMSTONE_NOTEBOOK_TYPE, 'probe'),
        get label() {
          return label;
        },
        set label(value: string) {
          label = value;
          void Promise.resolve().then(() => sent.push(`label: ${value}`));
        },
        updateNotebookAffinity: vi.fn(() => sent.push(`affinity (label is: ${label})`)),
      };
      notebooks.createNotebookController.mockReturnValueOnce(controller);
      const { manager, select } = makeSwitchableSessionManager();
      const ctrl = new SmalltalkNotebookController(manager);
      const onSelected = vi.mocked(controller.onDidChangeSelectedNotebooks).mock
        .calls[0][0] as (e: { notebook: unknown; selected: boolean }) => void;
      onSelected({ notebook: { notebookType: 'other', getCells: () => [] }, selected: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
      sent.length = 0;

      select(3);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const newLabel = `${SMALLTALK_CONTROLLER_LABEL} · Session 3 · DataCurator on gs64stone (localhost)`;
      expect(sent).toEqual([`label: ${newLabel}`, `affinity (label is: ${newLabel})`]);
      ctrl.dispose();
    });

    it('re-applies affinity on the notebooks it serves so their toolbar redraws', () => {
      vi.useFakeTimers();
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const { manager, select } = makeSwitchableSessionManager();
      const ctrl = new SmalltalkNotebookController(manager);
      const mock = lastController();
      const onSelected = vi.mocked(mock.onDidChangeSelectedNotebooks).mock.calls[0][0] as (e: {
        notebook: unknown;
        selected: boolean;
      }) => void;
      const doc = { notebookType: 'other', getCells: () => [] };
      onSelected({ notebook: doc, selected: true });
      vi.runAllTimers();
      mock.updateNotebookAffinity.mockClear();

      select(3);
      // Not yet: the label has to reach VS Code first, or the redraw shows the old one.
      expect(mock.updateNotebookAffinity).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(mock.updateNotebookAffinity).toHaveBeenCalledWith(
        doc,
        NotebookControllerAffinity.Preferred,
      );

      onSelected({ notebook: doc, selected: false });
      mock.updateNotebookAffinity.mockClear();
      select(4);
      vi.runAllTimers();
      expect(mock.updateNotebookAffinity).not.toHaveBeenCalled();
      ctrl.dispose();
    });
  });

  describe('kernel lifecycle', () => {
    const LOGIN = { gs_user: 'DataCurator', stone: 'gs64stone', gem_host: 'localhost' };

    function managerWith(active: { id: number; login: typeof LOGIN } | undefined) {
      const selection = new EventEmitter<number | null>();
      const manager = {
        resolveSession: vi.fn(async () => active),
        getSelectedSession: () => active,
        getSessions: () => (active ? [active] : []),
        onDidChangeSelection: selection.event,
        onDidAddSession: vi.fn(() => ({ dispose: () => {} })),
        onDidRemoveSession: vi.fn(() => ({ dispose: () => {} })),
      } as unknown as SessionManager;
      return { manager, fire: () => selection.fire(active?.id ?? null) };
    }

    function selectedListener(mock: ReturnType<typeof lastController>) {
      return vi.mocked(mock.onDidChangeSelectedNotebooks).mock.calls[0][0] as (e: {
        notebook: unknown;
        selected: boolean;
      }) => void;
    }

    it('names the session at once when built while one is already active', () => {
      const ctrl = new SmalltalkNotebookController(managerWith({ id: 7, login: LOGIN }).manager);
      expect(lastController().label).toBe(
        `${SMALLTALK_CONTROLLER_LABEL} · Session 7 · DataCurator on gs64stone (localhost)`,
      );
      ctrl.dispose();
    });

    it('forgets a closed notebook, so a later session change leaves it alone', () => {
      vi.useFakeTimers();
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const { manager, fire } = managerWith({ id: 7, login: LOGIN });
      const ctrl = new SmalltalkNotebookController(manager);
      const mock = lastController();
      const doc = { notebookType: 'other', getCells: () => [] };
      selectedListener(mock)({ notebook: doc, selected: true });
      const onClose = vi.mocked(workspace.onDidCloseNotebookDocument).mock.calls.at(-1)![0] as (
        d: unknown,
      ) => void;
      onClose(doc);
      mock.updateNotebookAffinity.mockClear();

      fire();
      vi.runAllTimers();

      expect(mock.updateNotebookAffinity).not.toHaveBeenCalled();
      ctrl.dispose();
    });

    it('sends nothing to a controller disposed before its redraw nudge ran', () => {
      vi.useFakeTimers();
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const { manager, fire } = managerWith({ id: 7, login: LOGIN });
      const ctrl = new SmalltalkNotebookController(manager);
      const mock = lastController();
      selectedListener(mock)({
        notebook: { notebookType: 'other', getCells: () => [] },
        selected: true,
      });
      vi.runAllTimers();
      mock.updateNotebookAffinity.mockClear();

      fire();
      ctrl.dispose();
      vi.runAllTimers();

      expect(mock.updateNotebookAffinity).not.toHaveBeenCalled();
    });

    it('releases every listener it registered when disposed', () => {
      const unsubscribe = vi.fn();
      const subscribe = vi.fn(() => ({ dispose: unsubscribe }));
      const manager = {
        getSelectedSession: () => undefined,
        onDidChangeSelection: subscribe,
        onDidAddSession: subscribe,
        onDidRemoveSession: subscribe,
      } as unknown as SessionManager;
      vi.mocked(workspace.onDidOpenNotebookDocument).mockReturnValueOnce({ dispose: unsubscribe });
      vi.mocked(workspace.onDidCloseNotebookDocument).mockReturnValueOnce({ dispose: unsubscribe });

      const ctrl = new SmalltalkNotebookController(manager);
      const mock = lastController();
      vi.mocked(mock.onDidChangeSelectedNotebooks).mock.results[0].value.dispose = unsubscribe;
      ctrl.dispose();

      // three session events + selected-notebooks + close + open
      expect(unsubscribe).toHaveBeenCalledTimes(6);
      expect(mock.dispose).toHaveBeenCalled();
    });
  });
});
