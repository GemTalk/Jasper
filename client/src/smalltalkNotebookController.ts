import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { executeCodeRaised, wrapCellCode } from './queries/executeCode';
import { GemStoneNotebookKernel, GEMSTONE_NOTEBOOK_TYPE } from './gemstoneNotebookKernel';
import {
  startClientForwarderMode,
  endClientForwarderMode,
  tryEndClientForwarderMode,
  settleNbResult,
} from './transcriptSink';
import { appendTranscriptOutput } from './transcriptChannel';
import { NbCancelledError, NbRunOptions, runNbCall, whenSessionFree } from './nbRunner';
import { failCell, fetchCellResult } from './notebookCellResult';
import { autoCommitAfterWrite } from './autoCommit/autoCommitRunner';
import {
  GCI_PERFORM_FLAG_ENABLE_DEBUG,
  GCI_PERFORM_FLAG_INTERPRETED,
  GS_ERR_HALT,
  OOP_ILLEGAL,
  OOP_NIL,
  OOP_CLASS_UTF8,
  toBigInt,
} from './gciConstants';
import { SMALLTALK_LANGUAGE } from './languageIds';
import { sessionKernelId } from './sessionKernels';
import { SESSION_BUSY_MESSAGE } from './gciLibraryError';
import {
  BREAKPOINT_ERROR,
  CONTINUE_FLAGS,
  resolveBreakpointStop,
} from './debugger/conditionalBreakpoints';
import { clearShowingTranscript } from './debugger/releaseStoppedProcess';
import { DebuggerPanel } from './debugger/debuggerPanel';

// GemStone Smalltalk as a Jupyter kernel — see gemstoneNotebookKernel.ts for
// the Jupyter integration mechanics. Each cell is an independent doit: the
// cell's last statement value is printed as the output, and wrapCellCode's
// guards report runtime errors inline as `Error: <class> - <messageText>`.
// A halt or a breakpoint opens the GemStone Debugger instead, and the cell
// waits on it: resumed to completion, it shows the result; closed, it stops.
//
// Unlike the Grail kernel there is no synthetic cross-cell scope: Smalltalk
// has no REPL module-scope concept — undeclared variables are compile-time
// errors, not auto-created globals. State persists across cells the way it
// does everywhere else in the session: through the session itself
// (`UserGlobals at: #x put: ...`, class definitions, commits).

export const SMALLTALK_CONTROLLER_ID = 'gemstone-smalltalk-kernel';
export const SMALLTALK_CONTROLLER_LABEL = 'GemStone Smalltalk';
// The language id for Smalltalk notebook cells — must match the controller's
// supportedLanguages and the `gemstone-smalltalk` language contribution. A cell
// is not a compiled method, so it is deliberately NOT gemstone-method and is
// offered no breakpoint gutter (see client/src/languageIds.ts).
export const SMALLTALK_LANGUAGE_ID = SMALLTALK_LANGUAGE;

/** A debugger a stopped cell waits on. */
export interface CellDebugSession {
  /** The cell's printed result once the process runs to completion; rejects with NbCancelledError once it is terminated. */
  result: Promise<string>;
  close(): void;
}

export type OpenCellDebugger = (
  session: ActiveSession,
  gsProcess: bigint,
  message: string,
) => CellDebugSession;

export const openCellDebugger: OpenCellDebugger = (session, gsProcess, message) => {
  let panel: DebuggerPanel | undefined;
  const result = new Promise<string>((resolve, reject) => {
    let answer: { value: string } | { error: unknown } | undefined;
    // Read inside the callback: the panel disposes as it returns, and the clear
    // that starts then holds the session on a worker thread.
    const onComplete = (resultOop: bigint): boolean => {
      try {
        const value = fetchCellResult(session, resultOop);
        answer = { value };
        return !executeCodeRaised(value);
      } catch (error) {
        answer = { error };
        return false;
      }
    };
    // Settled only once the clear has let go of the session, so the kernel's
    // own clean-up after the cell isn't refused by it.
    const onCleared = (): void => {
      if (answer === undefined) reject(new NbCancelledError());
      else if ('value' in answer) resolve(answer.value);
      else reject(answer.error);
    };
    try {
      panel = DebuggerPanel.create(session, gsProcess, message, onComplete, onCleared);
    } catch (e) {
      // Nothing owns the suspended process, so release it.
      const fail = (): void => reject(e);
      void clearShowingTranscript(session, gsProcess).then(fail, fail);
    }
  });
  return { result, close: () => panel?.close() };
};

interface CellStop {
  gsProcess: bigint;
  message: string;
}

// Cells run on the NON-BLOCKING execute path in clientForwarder mode, so
// `Transcript show:` output streams to the GemStone Transcript channel while
// the cell runs (and a long cell doesn't freeze the extension host).
export async function evalSmalltalk(
  session: ActiveSession,
  source: string,
  onStart?: NbRunOptions['onStart'],
  openDebugger: OpenCellDebugger = openCellDebugger,
): Promise<string> {
  // Before any GCI call: a stopped call still on the session would make GemStone
  // refuse clientForwarder mode's start, and while a worker still owns the
  // session a call from here could kill the process.
  let runStopRequested = (): boolean => false;
  const outcome = await whenSessionFree(session, () =>
    runCell(session, source, (cancel, stopRequested) => {
      runStopRequested = stopRequested;
      onStart?.(cancel, stopRequested);
    }),
  );
  if (typeof outcome === 'string') return outcome;
  // Stopped while running, but the gem reached the halt before the break.
  if (runStopRequested()) {
    await clearShowingTranscript(session, outcome.gsProcess);
    throw new NbCancelledError();
  }

  const debugging = openDebugger(session, outcome.gsProcess, outcome.message);
  let stopped = false;
  onStart?.(
    () => {
      stopped = true;
      debugging.close();
    },
    () => stopped,
  );
  return await debugging.result;
}

async function runCell(
  session: ActiveSession,
  source: string,
  onStart: NbRunOptions['onStart'],
): Promise<string | CellStop> {
  if (session.isBusy()) {
    throw new Error(SESSION_BUSY_MESSAGE);
  }

  const code = wrapCellCode(source);
  // Before clearing a process too: a clean-up that writes to the Transcript
  // while clientForwarder mode is on stops at that write. A refused end (the
  // `finally`'s, while the runner collects a call it stopped waiting for) leaves
  // the mode on, so the settle loop's own end must still be sent.
  let forwarding = true;
  const endForwarding = (): void => {
    if (!forwarding) return;
    const drained = tryEndClientForwarderMode(session);
    if (drained === undefined) return;
    forwarding = false;
    appendTranscriptOutput(drained);
  };
  appendTranscriptOutput(startClientForwarderMode(session, code));
  try {
    const outcome = await runNbCall(
      session,
      () => {
        // OOP_CLASS_UTF8 declares the source bytes UTF-8, so cells with
        // non-ASCII literals compile correctly (same convention as
        // browserQueries.executeFetchString). INTERPRETED as well as
        // ENABLE_DEBUG: GemStone can't step a process that started native.
        const { success, err } = session.GciTsNbExecute(
          code,
          OOP_CLASS_UTF8,
          OOP_ILLEGAL,
          OOP_NIL,
          GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
          0,
        );
        return { success, err };
      },
      async (signal): Promise<bigint | CellStop> => {
        const onTranscript = (text: string): void => appendTranscriptOutput(text);
        // Resuming after a Transcript write with flags 0 would disarm every
        // breakpoint after the first write.
        const { result, err } = await settleNbResult(session, onTranscript, signal, CONTINUE_FLAGS);
        if (err.number === 0) return result;
        const context = toBigInt(err.context);
        const message = err.message || `GCI error ${err.number}`;
        if (err.number === GS_ERR_HALT && context !== OOP_NIL && context !== 0n) {
          return { gsProcess: context, message };
        }
        if (err.number === BREAKPOINT_ERROR && context !== OOP_NIL && context !== 0n) {
          // A breakpoint's rules may pass this stop, moving the run on to
          // another stop or to completion.
          const stop = await resolveBreakpointStop(session, context, message, {
            signal,
            onTranscript,
          });
          if (stop.kind === 'completed') return stop.resultOop;
          if (stop.cancelled) {
            endForwarding();
            await clearShowingTranscript(session, stop.context);
            throw new NbCancelledError();
          }
          return { gsProcess: stop.context, message: stop.message };
        }
        // wrapCellCode reports every other Smalltalk error inline, so this is
        // a stop that got past its handlers. Left suspended inside a Transcript
        // write, the process would keep the session's Transcript semaphore (#646).
        endForwarding();
        return await failCell(session, err);
      },
      {
        title: 'GemStone: Running cell…',
        disposableProcess: true,
        disposableResult: true,
        onStart,
        // The `finally`'s end is refused while a cell the runner stopped waiting
        // for is being collected; this is where it can succeed.
        onAbandonedCollected: () => appendTranscriptOutput(endClientForwarderMode(session)),
      },
    );

    if (typeof outcome !== 'bigint') return outcome;
    // wrapCellCode printStrings server-side, so the result IS a string.
    const data = fetchCellResult(session, outcome);
    // A cell that raised answers its error inline, so only a clean answer commits.
    if (!executeCodeRaised(data)) autoCommitAfterWrite(session, 'notebook cell');
    return data;
  } finally {
    endForwarding();
  }
}

const EXTENSION_ID = 'gemtalksystems.gemstone-ide';

/**
 * Build a notebook of Smalltalk cells that stays Smalltalk. VS Code round-trips
 * a new notebook through the built-in ipynb serializer, which reads the cell
 * language from `language_info` and falls back to Python when it is missing.
 */
export function smalltalkNotebookData(cells: vscode.NotebookCellData[]): vscode.NotebookData {
  const data = new vscode.NotebookData(cells);
  data.metadata = { metadata: { language_info: { name: SMALLTALK_LANGUAGE_ID } } };
  return data;
}

/** A notebook whose code cells are all Smalltalk — Jasper's own, or one saved from them. */
export function isSmalltalkNotebook(doc: vscode.NotebookDocument): boolean {
  if (doc.notebookType !== GEMSTONE_NOTEBOOK_TYPE) return false;
  const code = doc.getCells().filter((c) => c.kind === vscode.NotebookCellKind.Code);
  return code.length > 0 && code.every((c) => c.document.languageId === SMALLTALK_LANGUAGE_ID);
}

/**
 * Bind the active notebook editor to the Smalltalk kernel, so its first run
 * doesn't stop at the kernel picker. `{ id, extension }` with no editor means
 * "the active one" — pass it right after showNotebookDocument.
 */
export async function selectSmalltalkKernel(): Promise<void> {
  try {
    await vscode.commands.executeCommand('notebook.selectKernel', {
      id: SMALLTALK_CONTROLLER_ID,
      extension: EXTENSION_ID,
    });
  } catch {
    // The Preferred affinity SmalltalkNotebookController sets on open still
    // makes it the suggested kernel.
  }
}

/** The Smalltalk kernel bound to one session — one per logged-in session, in multiple-session mode. */
export function smalltalkSessionKernel(
  sessionManager: SessionManager,
  sessionId: number,
): GemStoneNotebookKernel {
  return new GemStoneNotebookKernel(sessionManager, {
    id: sessionKernelId(SMALLTALK_CONTROLLER_ID, sessionId),
    label: SMALLTALK_CONTROLLER_LABEL,
    description: `Always runs Smalltalk in Session ${sessionId}`,
    supportedLanguages: [SMALLTALK_LANGUAGE_ID],
    evaluate: (session, source, _scopeId, onStart) => evalSmalltalk(session, source, onStart),
    sessionId,
  });
}

export class SmalltalkNotebookController extends GemStoneNotebookKernel {
  private readonly openListener: vscode.Disposable;

  constructor(sessionManager: SessionManager) {
    super(sessionManager, {
      id: SMALLTALK_CONTROLLER_ID,
      label: SMALLTALK_CONTROLLER_LABEL,
      description: 'Run Smalltalk in the active GemStone session',
      supportedLanguages: [SMALLTALK_LANGUAGE_ID],
      evaluate: (session, source, _scopeId, onStart) => evalSmalltalk(session, source, onStart),
    });
    // Offer this kernel first for Smalltalk notebooks, including ones that
    // hot-exit restored before the extension activated.
    vscode.workspace.notebookDocuments.forEach((doc) => this.preferIfSmalltalk(doc));
    this.openListener = vscode.workspace.onDidOpenNotebookDocument((doc) =>
      this.preferIfSmalltalk(doc),
    );
  }

  dispose(): void {
    super.dispose();
    this.openListener.dispose();
  }

  private preferIfSmalltalk(doc: vscode.NotebookDocument): void {
    if (isSmalltalkNotebook(doc)) this.prefer(doc);
  }
}
