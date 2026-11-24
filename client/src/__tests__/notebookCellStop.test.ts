import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock('../transcriptSink', () => ({ drainTranscript: vi.fn(() => '') }));

import { notebooks } from '../__mocks__/vscode';
import { GemStoneNotebookKernel, NotebookKernelSpec } from '../gemstoneNotebookKernel';
import { NbCancelledError, NbSessionBusyError } from '../nbRunner';
import { GciLibraryError } from '../gciLibraryError';
import {
  GCI_ERR_BAD_SESSION_ID,
  GCI_ERR_OP_IN_PROGRESS,
  GS_ERR_SESSION_SHUTDOWN,
  NET_ERROR,
} from '../gciConstants';
import {
  ABORT_ERR_LOST_OT_ROOT,
  ERR_GEM_AUTO_ABORT,
  ERR_GEM_AUTO_LOST_OT,
} from '../queries/transactionMode';
import { drainTranscript } from '../transcriptSink';
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

function kernel(evaluate: NotebookKernelSpec['evaluate'], sessionId?: number): Controller {
  new GemStoneNotebookKernel(manager, {
    id: 'k',
    label: 'K',
    description: '',
    supportedLanguages: ['x'],
    evaluate,
    sessionId,
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
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalled());
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
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalled());
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

describe('a cell stopped before its run has started', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tells the run it was stopped, so the run can skip sending it', async () => {
    let signal: AbortSignal | undefined;
    const evaluate = vi.fn(
      (_s: unknown, _src: string, _scope: string, _onStart: unknown, stop: AbortSignal) => {
        signal = stop;
        // Still waiting for the session: no canceller handed out yet.
        return new Promise<string>((_resolve, reject) => {
          stop.addEventListener('abort', () => reject(new NbCancelledError()));
        });
      },
    );
    const controller = kernel(evaluate);

    const running = controller.executeHandler([cell('3 + 4')]);
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalled());
    expect(signal!.aborted).toBe(false);
    execution(controller).stop.cancel();
    await running;

    expect(signal!.aborted).toBe(true);
    expect(outputText(execution(controller))).toBe('Stopped.');
    expect(execution(controller).end).toHaveBeenCalledWith(undefined, expect.any(Number));
  });

  it('says "Stopped.", not the busy error, when the session is still held once the wait ends', async () => {
    const evaluate = vi.fn(
      (_s: unknown, _src: string, _scope: string, _onStart: unknown, stop: AbortSignal) =>
        // The wait ended with a clean-up still holding the session.
        new Promise<string>((_resolve, reject) => {
          stop.addEventListener('abort', () =>
            reject(new NbSessionBusyError('A previous run is still cleaning up on the server.')),
          );
        }),
    );
    const controller = kernel(evaluate);

    const running = controller.executeHandler([cell('3 + 4'), cell('5 + 6')]);
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalled());
    execution(controller).stop.cancel();
    await running;

    expect(outputText(execution(controller))).toBe('Stopped.');
    expect(execution(controller).end).toHaveBeenCalledWith(undefined, expect.any(Number));
    expect(controller.createNotebookCellExecution).toHaveBeenCalledTimes(1);
  });

  it('never runs a cell stopped while its session is being picked', async () => {
    let picked!: (session: typeof SESSION) => void;
    vi.mocked(manager.resolveSession).mockReturnValueOnce(
      new Promise((resolve) => (picked = resolve)) as never,
    );
    const evaluate = vi.fn(async () => '7');
    const controller = kernel(evaluate);

    const running = controller.executeHandler([cell('3 + 4'), cell('5 + 6')]);
    await vi.waitFor(() => expect(manager.resolveSession).toHaveBeenCalled());
    execution(controller).stop.cancel();
    picked(SESSION);
    await running;

    expect(evaluate).not.toHaveBeenCalled();
    expect(controller.createNotebookCellExecution).toHaveBeenCalledTimes(1);
    expect(outputText(execution(controller))).toBe('Stopped.');
  });
});

describe('a cell the session refuses', () => {
  beforeEach(() => vi.clearAllMocks());

  const gemstoneError = (number: number, message: string) => () =>
    GciLibraryError.fromGciError({ number, message });

  // Each of these fails every cell after it the same way, or (a refreshed view)
  // leaves the cell unrun, so a later cell would run without it.
  const refusals: [string, () => Error][] = [
    [
      'a run Jasper knows holds the session',
      () => new NbSessionBusyError('Another run is still in progress on this session.'),
    ],
    [
      'GemStone refuses the call as busy',
      gemstoneError(GCI_ERR_OP_IN_PROGRESS, 'session has a GciTsNb operation in progress'),
    ],
    [
      "the gem refreshed the session's view instead of running the cell",
      gemstoneError(ERR_GEM_AUTO_ABORT, 'a TransactionBacklog occurred'),
    ],
    [
      "the gem lost the session's object table instead of running the cell",
      gemstoneError(ERR_GEM_AUTO_LOST_OT, 'a LostOtRoot occurred'),
    ],
    [
      'the stone stopped the session',
      gemstoneError(GS_ERR_SESSION_SHUTDOWN, 'Your session has been forcibly terminated'),
    ],
    ['the session is no longer known', gemstoneError(GCI_ERR_BAD_SESSION_ID, 'invalid session')],
    ['the connection to the gem is gone', gemstoneError(NET_ERROR, 'socket read EOF')],
    // Any of GemStone's fatal errors (4001-4999) ends the session.
    ['the stone is shutting down', gemstoneError(4057, 'stone shutdown')],
    [
      "the stone revoked an idle session's object table",
      gemstoneError(ABORT_ERR_LOST_OT_ROOT, 'lost object table root'),
    ],
  ];

  it.each(refusals)(
    'fails the cell and runs none of the cells queued after it, when %s',
    async (_why, refusal) => {
      const evaluate = vi.fn(async () => {
        throw refusal();
      });
      const controller = kernel(evaluate);

      await controller.executeHandler([cell('3 + 4'), cell('5 + 6'), cell('7 + 8')]);

      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(controller.createNotebookCellExecution).toHaveBeenCalledTimes(1);
      expect(execution(controller).end).toHaveBeenCalledWith(false, expect.any(Number));
      expect(JSON.parse(outputText(execution(controller))).message).toBe(refusal().message);
    },
  );

  it('runs none of the cells after the first when no session is logged in', async () => {
    const evaluate = vi.fn(async () => '7');
    vi.mocked(manager.resolveSession).mockResolvedValue(undefined);
    onTestFinished(() => {
      vi.mocked(manager.resolveSession).mockResolvedValue(SESSION as never);
    });
    const controller = kernel(evaluate);

    await controller.executeHandler([cell('3 + 4'), cell('5 + 6'), cell('7 + 8')]);

    expect(manager.resolveSession).toHaveBeenCalledTimes(1);
    expect(controller.createNotebookCellExecution).toHaveBeenCalledTimes(1);
    expect(execution(controller).end).toHaveBeenCalledWith(false, expect.any(Number));
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("runs none of the cells after the first when the kernel's session has logged out", async () => {
    const evaluate = vi.fn(async () => '7');
    const getSession = vi.spyOn(manager, 'getSession').mockReturnValue(undefined);
    onTestFinished(() => getSession.mockRestore());
    const controller = kernel(evaluate, 1);

    await controller.executeHandler([cell('3 + 4'), cell('5 + 6'), cell('7 + 8')]);

    expect(controller.createNotebookCellExecution).toHaveBeenCalledTimes(1);
    expect(JSON.parse(outputText(execution(controller))).message).toMatch(/has logged out/);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("doesn't drain the Transcript of a session that refused the cell", async () => {
    const evaluate = vi.fn(async () => {
      throw gemstoneError(NET_ERROR, 'socket read EOF')();
    });
    const controller = kernel(evaluate);

    await controller.executeHandler([cell('3 + 4')]);

    expect(drainTranscript).not.toHaveBeenCalled();
  });

  it('still runs the next cell after a GemStone error that leaves the session usable', async () => {
    const evaluate = vi
      .fn()
      .mockRejectedValueOnce(gemstoneError(2010, 'a MessageNotUnderstood occurred')())
      .mockResolvedValueOnce('11');
    const controller = kernel(evaluate);

    await controller.executeHandler([cell('3 + 4'), cell('5 + 6')]);

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(drainTranscript).toHaveBeenCalledTimes(2);
  });

  it('still runs the next cell after a cell that failed for any other reason', async () => {
    const evaluate = vi
      .fn()
      .mockRejectedValueOnce(new Error('a ZeroDivide occurred'))
      .mockResolvedValueOnce('11');
    const controller = kernel(evaluate);

    await controller.executeHandler([cell('3 + 4'), cell('5 + 6')]);

    expect(evaluate).toHaveBeenCalledTimes(2);
  });
});
