import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock('../transcriptSink', () => ({ drainTranscript: vi.fn(() => '') }));

import { notebooks } from '../__mocks__/vscode';
import { GemStoneNotebookKernel, NotebookKernelSpec } from '../gemstoneNotebookKernel';
import { NbCancelledError } from '../nbRunner';
import type { SessionManager } from '../sessionManager';

const SESSION = { id: 1, login: { gs_user: 'DataCurator', stone: 'gs64stone' } };

const manager = {
  getSessions: () => [SESSION],
  getSession: () => SESSION,
  getSelectedSession: () => SESSION,
  resolveSession: vi.fn(async () => SESSION),
  onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
  onDidAddSession: vi.fn(() => ({ dispose: () => {} })),
  onDidRemoveSession: vi.fn(() => ({ dispose: () => {} })),
} as unknown as SessionManager;

type Controller = {
  executeHandler: (cells: unknown[]) => Promise<void>;
  createNotebookCellExecution: ReturnType<typeof vi.fn>;
};
type Execution = {
  stop: { cancel: () => void };
  clearOutput: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  replaceOutput: ReturnType<typeof vi.fn>;
};

function kernel(evaluate: NotebookKernelSpec['evaluate']): Controller {
  new GemStoneNotebookKernel(manager, {
    id: 'k',
    label: 'K',
    description: '',
    supportedLanguages: ['x'],
    evaluate,
  });
  return vi.mocked(notebooks.createNotebookController).mock.results.at(-1)!.value as Controller;
}

const cell = (source: string) => ({
  document: { getText: () => source },
  notebook: { uri: { toString: () => 'nb' } },
});

const execution = (controller: Controller, index = 0): Execution =>
  vi.mocked(controller.createNotebookCellExecution).mock.results[index].value as Execution;

/** The text of the cell's output. */
function outputText(e: Execution): string {
  const [[outputs]] = e.replaceOutput.mock.calls as [[{ items: { data: Uint8Array }[] }[]]];
  return new TextDecoder().decode(outputs[0].items[0].data);
}

/**
 * A run that waits for its stop: pressing the cell's ■ calls the canceller it
 * handed out, and the run then rejects the way the runner does.
 */
function stoppableRun() {
  const cancelled = vi.fn();
  const evaluate = vi.fn(
    (
      _s: unknown,
      _src: string,
      _scope: string,
      onStart?: (c: () => void, r: () => boolean) => void,
    ) =>
      new Promise<string>((_resolve, reject) => {
        onStart?.(
          () => {
            cancelled();
            reject(new NbCancelledError());
          },
          () => cancelled.mock.calls.length > 0,
        );
      }),
  );
  return { evaluate, cancelled };
}

describe("a notebook cell's stop button", () => {
  beforeEach(() => vi.clearAllMocks());

  it('stops the run, and the cell says "Stopped." with no verdict', async () => {
    const { evaluate, cancelled } = stoppableRun();
    const controller = kernel(evaluate);

    const running = controller.executeHandler([cell('[true] whileTrue')]);
    await Promise.resolve();
    execution(controller).stop.cancel();
    await running;

    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(outputText(execution(controller))).toBe('Stopped.');
    expect(execution(controller).end).toHaveBeenCalledWith(undefined, expect.any(Number));
  });

  it('runs none of the cells queued after a stopped one', async () => {
    const { evaluate } = stoppableRun();
    const controller = kernel(evaluate);

    const running = controller.executeHandler([cell('[true] whileTrue'), cell('3 + 4')]);
    await Promise.resolve();
    execution(controller).stop.cancel();
    await running;

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(controller.createNotebookCellExecution).toHaveBeenCalledTimes(1);
  });

  it('counts a run that answered the stop with an error as stopped, not failed', async () => {
    const evaluate = vi.fn(
      async (
        _s: unknown,
        _src: string,
        _scope: string,
        onStart?: (c: () => void, r: () => boolean) => void,
      ) => {
        onStart?.(
          () => {},
          () => true,
        );
        return 'Error: Break — a soft break';
      },
    );
    const controller = kernel(evaluate);

    await controller.executeHandler([cell('[true] whileTrue')]);

    expect(outputText(execution(controller))).toBe('Stopped.');
    expect(execution(controller).end).toHaveBeenCalledWith(undefined, expect.any(Number));
  });

  it("clears the last run's output as soon as the cell starts", async () => {
    let clearedBeforeRun = false;
    const controller = kernel(
      vi.fn(async () => {
        clearedBeforeRun = execution(controller).clearOutput.mock.calls.length === 1;
        return '7';
      }),
    );

    await controller.executeHandler([cell('3 + 4')]);

    expect(clearedBeforeRun).toBe(true);
  });

  it('shows a cell error as GemStone reported it, without a JavaScript stack', async () => {
    const controller = kernel(vi.fn(async () => 'Error: ZeroDivide — divide by zero'));

    await controller.executeHandler([cell('1/0')]);

    const shown = outputText(execution(controller));
    expect(shown).toContain('divide by zero');
    expect(shown).not.toMatch(/\bat /);
  });

  it('still reports an error result as an error when nobody stopped the cell', async () => {
    const controller = kernel(vi.fn(async () => 'Error: ZeroDivide — divide by zero'));

    await controller.executeHandler([cell('1/0')]);

    expect(execution(controller).end).toHaveBeenCalledWith(false, expect.any(Number));
  });
});
