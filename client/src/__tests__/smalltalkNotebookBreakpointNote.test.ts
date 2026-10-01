import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../gciLog', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

import { notebooks } from '../__mocks__/vscode';
import { SmalltalkNotebookController } from '../smalltalkNotebookController';
import { SessionManager } from '../sessionManager';
import { SMALLTALK_LANGUAGE } from '../languageIds';

/**
 * A cell runs with GCI flags `0`, which GemStone reads as "debugger disabled", so a method
 * breakpoint the user armed in the Explorer gutter never fires for a cell. Execute It passes
 * `GCI_PERFORM_FLAG_ENABLE_DEBUG` and does stop, which is why the same expression behaves two
 * different ways depending on where it was run from.
 *
 * Cells stay non-debuggable (real debugging from a cell is its own piece of work), so the only
 * thing these pin is that the skip is VISIBLE: a run that walked past an armed breakpoint says
 * so in its own output, instead of printing a result as though nothing were set.
 *
 * The note is carried on every run while something is armed. A breakpoint is per-gem state the
 * user can set, clear and re-arm from outside the notebook at any point, so "has this notebook
 * been told already" is a question with no stable answer; a note tied to the run that actually
 * skipped one always describes that run.
 */

/** One row of `GsNMethod class >> _breakReport:`, in the ten columns getAllBreakpoints reads. */
function breakpointRow(over: { selector?: string; disabled?: boolean } = {}): string {
  return [
    '1',
    'Account',
    'false',
    over.selector ?? 'balance',
    '2',
    over.disabled ? 'true' : 'false',
    '0',
    '12345',
    'UserGlobals',
    'accessing',
  ].join('\t');
}

/**
 * A gci whose blocking execute path answers `report` for the breakpoint query and nothing for
 * everything else (the transcript sink's start/end/drain calls go through the same method).
 */
function makeGci(report: string | (() => string) = '') {
  return {
    GciTsCallInProgress: vi.fn(() => ({ result: 0, err: { number: 0 } })),
    GciTsNbExecute: vi.fn(() => ({ success: true, err: { number: 0, message: '' } })),
    isAvailable: vi.fn(() => true),
    GciTsNbPoll: vi.fn(() => ({ result: 1, err: { number: 0 } })),
    GciTsNbResult: vi.fn(() => ({ result: 200n, err: { number: 0, message: '', context: 0x14n } })),
    GciTsFetchUtf8: vi.fn(() => ({ data: '3', err: { number: 0 } })),
    executeAndFetchString: vi.fn((_handle: unknown, code: string) =>
      code.includes('_breakReport:') ? (typeof report === 'function' ? report() : report) : '',
    ),
  };
}

function makeSessionManager(gci: ReturnType<typeof makeGci>) {
  const session = { id: 1, gci, handle: {}, login: { label: 'Test' }, stoneVersion: '3.6.2' };
  return {
    resolveSession: vi.fn(async () => session),
    getSelectedSession: vi.fn(() => undefined),
    getSessions: vi.fn(() => []),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
    onDidAddSession: vi.fn(() => ({ dispose: () => {} })),
    onDidRemoveSession: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;
}

function makeCell(source: string) {
  return {
    document: { getText: () => source, languageId: SMALLTALK_LANGUAGE },
    notebook: { uri: { toString: () => 'file:///tmp/demo.ipynb' } },
  };
}

function lastController() {
  const results = notebooks.createNotebookController.mock.results;
  return results[results.length - 1].value;
}

/** The text of the output the cell at `index` ended with. */
function outputText(index: number): string {
  const execution = lastController().createNotebookCellExecution.mock.results[index].value;
  const item = execution.replaceOutput.mock.calls[0][0][0].items[0];
  return new TextDecoder().decode(item.data);
}

function endedSuccessfully(index: number): boolean {
  const execution = lastController().createNotebookCellExecution.mock.results[index].value;
  return execution.end.mock.calls[0][0] === true;
}

async function runCells(cells: unknown[]) {
  await lastController().executeHandler(cells);
}

/** Loose enough to survive a reworded note, strict enough that only a real note matches. */
const MENTIONS_THE_SKIP = /breakpoint/i;
const POINTS_SOMEWHERE_ELSE = /execute it/i;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a notebook cell run while a breakpoint is armed', () => {
  it('says in its own output that the breakpoint did not stop it', async () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeGci(breakpointRow())));

    await runCells([makeCell('1 + 2')]);

    expect(outputText(0)).toMatch(MENTIONS_THE_SKIP);
    ctrl.dispose();
  });

  it('points at the way to debug the same expression instead', async () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeGci(breakpointRow())));

    await runCells([makeCell('1 + 2')]);

    expect(outputText(0)).toMatch(POINTS_SOMEWHERE_ELSE);
    ctrl.dispose();
  });

  it("keeps the cell's result, so the note is added to the output rather than replacing it", async () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeGci(breakpointRow())));

    await runCells([makeCell('1 + 2')]);

    expect(outputText(0)).toContain('3');
    ctrl.dispose();
  });

  it('still reports the cell as succeeded — a skipped breakpoint is not a failure', async () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeGci(breakpointRow())));

    await runCells([makeCell('1 + 2')]);

    expect(endedSuccessfully(0)).toBe(true);
    ctrl.dispose();
  });

  it('carries the note on every run, since a breakpoint can be armed again between cells', async () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeGci(breakpointRow())));

    await runCells([makeCell('1 + 2'), makeCell('1 + 2')]);

    expect(outputText(0)).toMatch(MENTIONS_THE_SKIP);
    expect(outputText(1)).toMatch(MENTIONS_THE_SKIP);
    ctrl.dispose();
  });
});

describe('a notebook cell run with nothing armed to skip', () => {
  it('says nothing about breakpoints when the gem holds none', async () => {
    const ctrl = new SmalltalkNotebookController(makeSessionManager(makeGci('')));

    await runCells([makeCell('1 + 2')]);

    expect(outputText(0)).toBe('3');
    ctrl.dispose();
  });

  it('says nothing when every breakpoint the gem holds is disabled', async () => {
    // A disabled breakpoint would not have stopped the run under any flags, so there is no
    // skip to report and the note would be noise.
    const ctrl = new SmalltalkNotebookController(
      makeSessionManager(makeGci(breakpointRow({ disabled: true }))),
    );

    await runCells([makeCell('1 + 2')]);

    expect(outputText(0)).toBe('3');
    ctrl.dispose();
  });

  it('notes the skip when one of several breakpoints is still enabled', async () => {
    const ctrl = new SmalltalkNotebookController(
      makeSessionManager(
        makeGci(
          [
            breakpointRow({ selector: 'balance', disabled: true }),
            breakpointRow({ selector: 'deposit:', disabled: false }),
          ].join('\n'),
        ),
      ),
    );

    await runCells([makeCell('1 + 2')]);

    expect(outputText(0)).toMatch(MENTIONS_THE_SKIP);
    ctrl.dispose();
  });
});

describe('the breakpoint check itself', () => {
  it('leaves the cell alone when the gem cannot be asked what it holds', async () => {
    // Recording a note must never be the reason a cell fails: the check is a convenience
    // beside the run, not part of it.
    const gci = makeGci(() => {
      throw new Error('session is busy');
    });
    const ctrl = new SmalltalkNotebookController(makeSessionManager(gci));

    await runCells([makeCell('1 + 2')]);

    expect(outputText(0)).toBe('3');
    expect(endedSuccessfully(0)).toBe(true);
    ctrl.dispose();
  });

  it('asks the gem once per cell run, not once per breakpoint', async () => {
    const gci = makeGci(
      [breakpointRow({ selector: 'a' }), breakpointRow({ selector: 'b' })].join('\n'),
    );
    const ctrl = new SmalltalkNotebookController(makeSessionManager(gci));

    await runCells([makeCell('1 + 2')]);

    const asked = gci.executeAndFetchString.mock.calls.filter((c) =>
      c[1].includes('_breakReport:'),
    );
    expect(asked).toHaveLength(1);
    ctrl.dispose();
  });
});
