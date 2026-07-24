import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('../gciLog', () => ({
  logError: vi.fn(),
}));

import { notebooks } from '../__mocks__/vscode';
import {
  SmalltalkNotebookController,
  SMALLTALK_CONTROLLER_ID,
  SMALLTALK_CONTROLLER_LABEL,
} from '../smalltalkNotebookController';
import { GEMSTONE_NOTEBOOK_TYPE } from '../gemstoneNotebookKernel';
import { SessionManager } from '../sessionManager';

// Cells run on the non-blocking execute path (live transcript). The mock gci
// covers that path: NbExecute starts the doit, NbPoll reports ready, NbResult
// yields the result oop, FetchUtf8 reads its string. The transcript sink's
// live-toggle/drain calls go through executeAndFetchString.
function makeGci(overrides: Record<string, unknown> = {}) {
  return {
    GciTsCallInProgress: vi.fn(() => ({ result: 0, err: { number: 0 } })),
    GciTsResolveSymbol: vi.fn(() => ({ result: 100n, err: { number: 0 } })),
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
  } as unknown as SessionManager;
}

function makeCell(source: string, notebookUri = 'file:///tmp/demo.ipynb') {
  return {
    document: { getText: () => source, languageId: 'gemstone-smalltalk' },
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
    expect(mock.supportedLanguages).toEqual(['gemstone-smalltalk']);
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

  it('runs the cell with the transcript sink toggled live, restoring buffered mode after', async () => {
    const gci = makeGci();
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeSession(gci)));

    await runCells([makeCell('3 + 4')]);

    const sinkCalls = gci.executeAndFetchString.mock.calls
      .map((c) => c[1] as string)
      .filter((code) => code.includes('jasperLive:'));
    expect(sinkCalls.some((code) => code.includes('jasperLive: true'))).toBe(true);
    expect(sinkCalls.some((code) => code.includes('jasperLive: false'))).toBe(true);
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
});
