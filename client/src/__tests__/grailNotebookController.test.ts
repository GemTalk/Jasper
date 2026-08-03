import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../pythonQueries', () => ({
  evalPythonInScope: vi.fn(() => '3'),
  resetPythonScope: vi.fn(() => 'scope reset'),
}));

vi.mock('../gciLog', () => ({
  logError: vi.fn(),
}));

import { notebooks, window, commands } from '../__mocks__/vscode';
import {
  GrailNotebookController,
  GRAIL_CONTROLLER_ID,
  GRAIL_CONTROLLER_LABEL,
  GRAIL_RESET_SCOPE_COMMAND,
} from '../grailNotebookController';
import { classifyCellResult, GEMSTONE_NOTEBOOK_TYPE } from '../gemstoneNotebookKernel';
import { SessionManager } from '../sessionManager';
import * as python from '../pythonQueries';

const SESSION = {
  id: 1,
  gci: {},
  handle: {},
  login: { label: 'Test' },
  stoneVersion: '3.7.2',
};

function makeSessionManager(hasSession: boolean) {
  return {
    resolveSession: vi.fn(async () => (hasSession ? SESSION : undefined)),
  } as unknown as SessionManager;
}

function makeCell(source: string, notebookUri = 'file:///tmp/demo.ipynb') {
  return {
    document: { getText: () => source, languageId: 'python' },
    notebook: { uri: { toString: () => notebookUri } },
  };
}

/** The mock NotebookController created by the most recent constructor call. */
function lastController() {
  const results = notebooks.createNotebookController.mock.results;
  return results[results.length - 1].value;
}

/** The mock cell execution created for the nth executed cell. */
function executionAt(index: number) {
  return lastController().createNotebookCellExecution.mock.results[index].value;
}

// Drive execution the way VS Code does: through the executeHandler the
// controller installed on the (mock) NotebookController.
async function runCells(cells: unknown[]) {
  await lastController().executeHandler(cells);
}

describe('classifyCellResult', () => {
  it('treats ordinary results as success', () => {
    expect(classifyCellResult('3')).toEqual({ success: true, message: '3' });
  });

  it('treats inline Grail errors as failure', () => {
    const msg = 'Error: ZeroDivide — division by zero';
    expect(classifyCellResult(msg)).toEqual({ success: false, message: msg });
  });

  it('treats the Grail-not-detected hint as failure', () => {
    const msg = 'Grail (GemStone-Python) not detected: class ModuleAst not found in symbolList.';
    expect(classifyCellResult(msg).success).toBe(false);
  });

  // printString wraps Python string results in quotes, so a user string that
  // *contains* "Error: " arrives as 'Error: ...' (leading quote) — success.
  it('does not misclassify a quoted Python string starting with Error:', () => {
    expect(classifyCellResult("'Error: my own text'").success).toBe(true);
  });
});

describe('GrailNotebookController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as { activeNotebookEditor: unknown }).activeNotebookEditor = undefined;
  });

  it('registers a controller for the jupyter-notebook type with python cells', () => {
    const ctrl = new GrailNotebookController(makeSessionManager(true));
    expect(notebooks.createNotebookController).toHaveBeenCalledWith(
      GRAIL_CONTROLLER_ID,
      GEMSTONE_NOTEBOOK_TYPE,
      GRAIL_CONTROLLER_LABEL,
    );
    const mock = lastController();
    expect(mock.supportedLanguages).toEqual(['python']);
    expect(mock.supportsExecutionOrder).toBe(true);
    expect(typeof mock.executeHandler).toBe('function');
    ctrl.dispose();
  });

  it('executes a cell through evalPythonInScope keyed by the notebook URI', async () => {
    const ctrl = new GrailNotebookController(makeSessionManager(true));
    await runCells([makeCell('1 + 2', 'file:///nb/a.ipynb')]);

    expect(python.evalPythonInScope).toHaveBeenCalledWith(SESSION, '1 + 2', 'file:///nb/a.ipynb');
    const execution = executionAt(0);
    expect(execution.start).toHaveBeenCalled();
    expect(execution.end).toHaveBeenCalledWith(true, expect.any(Number));

    const outputs = execution.replaceOutput.mock.calls[0][0];
    const item = outputs[0].items[0];
    expect(item.mime).toBe('text/plain');
    expect(new TextDecoder().decode(item.data)).toBe('3');
    ctrl.dispose();
  });

  it('increments executionOrder across cells', async () => {
    const ctrl = new GrailNotebookController(makeSessionManager(true));
    await runCells([makeCell('a = 1'), makeCell('a + 1')]);
    expect(executionAt(0).executionOrder).toBe(1);
    expect(executionAt(1).executionOrder).toBe(2);
    ctrl.dispose();
  });

  it('ends with an error output when Grail reports an inline error', async () => {
    vi.mocked(python.evalPythonInScope).mockReturnValueOnce(
      'Error: NameError — name x is not defined',
    );
    const ctrl = new GrailNotebookController(makeSessionManager(true));
    await runCells([makeCell('x')]);

    const execution = executionAt(0);
    expect(execution.end).toHaveBeenCalledWith(false, expect.any(Number));
    const item = execution.replaceOutput.mock.calls[0][0][0].items[0];
    expect(item.mime).toBe('application/vnd.code.notebook.error');
    expect(new TextDecoder().decode(item.data)).toContain('NameError');
    ctrl.dispose();
  });

  it('ends with an error output when Grail is not installed (hint result)', async () => {
    vi.mocked(python.evalPythonInScope).mockReturnValueOnce(
      'Grail (GemStone-Python) not detected: class ModuleAst not found in symbolList.',
    );
    const ctrl = new GrailNotebookController(makeSessionManager(true));
    await runCells([makeCell('x = 1')]);
    expect(executionAt(0).end).toHaveBeenCalledWith(false, expect.any(Number));
    ctrl.dispose();
  });

  it('fails the cell without calling Grail when no session is active', async () => {
    const ctrl = new GrailNotebookController(makeSessionManager(false));
    await runCells([makeCell('1 + 2')]);

    expect(python.evalPythonInScope).not.toHaveBeenCalled();
    const execution = executionAt(0);
    expect(execution.end).toHaveBeenCalledWith(false, expect.any(Number));
    const item = execution.replaceOutput.mock.calls[0][0][0].items[0];
    expect(new TextDecoder().decode(item.data)).toContain('No GemStone session');
    ctrl.dispose();
  });

  it('reports a thrown query error (e.g. session busy) as a cell error', async () => {
    vi.mocked(python.evalPythonInScope).mockImplementationOnce(() => {
      throw new Error('Session is busy with another operation.');
    });
    const ctrl = new GrailNotebookController(makeSessionManager(true));
    await runCells([makeCell('1 + 2')]);

    const execution = executionAt(0);
    expect(execution.end).toHaveBeenCalledWith(false, expect.any(Number));
    const item = execution.replaceOutput.mock.calls[0][0][0].items[0];
    expect(new TextDecoder().decode(item.data)).toContain('busy');
    ctrl.dispose();
  });

  it('skips evaluation for blank cells but still completes them', async () => {
    const ctrl = new GrailNotebookController(makeSessionManager(true));
    await runCells([makeCell('   \n')]);
    expect(python.evalPythonInScope).not.toHaveBeenCalled();
    expect(executionAt(0).end).toHaveBeenCalledWith(true, expect.any(Number));
    ctrl.dispose();
  });

  it('registers the reset-scope command and resets the active notebook scope', async () => {
    const ctrl = new GrailNotebookController(makeSessionManager(true));
    expect(commands.registerCommand).toHaveBeenCalledWith(
      GRAIL_RESET_SCOPE_COMMAND,
      expect.any(Function),
    );

    (window as { activeNotebookEditor: unknown }).activeNotebookEditor = {
      notebook: { uri: { toString: () => 'file:///nb/a.ipynb' } },
    };
    await ctrl.resetActiveNotebookScope();
    expect(python.resetPythonScope).toHaveBeenCalledWith(SESSION, 'file:///nb/a.ipynb');
    expect(window.showInformationMessage).toHaveBeenCalled();
    ctrl.dispose();
  });

  it('reset-scope command reports when there is no active notebook', async () => {
    const ctrl = new GrailNotebookController(makeSessionManager(true));
    await ctrl.resetActiveNotebookScope();
    expect(python.resetPythonScope).not.toHaveBeenCalled();
    expect(window.showErrorMessage).toHaveBeenCalled();
    ctrl.dispose();
  });

  it('dispose releases the controller and the command registration', () => {
    const ctrl = new GrailNotebookController(makeSessionManager(true));
    const mock = lastController();
    ctrl.dispose();
    expect(mock.dispose).toHaveBeenCalled();
  });
});
