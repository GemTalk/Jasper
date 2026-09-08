import { SessionManager, ActiveSession } from './sessionManager';
import { wrapExecuteCode } from './queries/executeCode';
import { GemStoneNotebookKernel } from './gemstoneNotebookKernel';
import { setTranscriptLive, settleNbResult } from './transcriptSink';
import { appendTranscriptOutput } from './transcriptChannel';
import { runNbCall } from './nbRunner';
import { OOP_ILLEGAL, OOP_NIL, OOP_CLASS_UTF8 } from './gciConstants';
import { SMALLTALK_LANGUAGE } from './languageIds';

// GemStone Smalltalk as a Jupyter kernel — see gemstoneNotebookKernel.ts for
// the Jupyter integration mechanics. Each cell is an independent doit (the
// same contract as the MCP execute_code tool): the cell's last statement
// value is printed as the output, and wrapExecuteCode's guards report
// compile/runtime errors inline as `Error: <class> — <messageText>`.
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

const MAX_CELL_RESULT = 256 * 1024;

// Cells run on the NON-BLOCKING execute path with the transcript sink in live
// mode, so `Transcript show:` output streams to the GemStone Transcript channel
// while the cell runs (and a long cell doesn't freeze the extension host).
export async function evalSmalltalk(session: ActiveSession, source: string): Promise<string> {
  const { result: inProgress } = session.gci.GciTsCallInProgress(session.handle);
  if (inProgress !== 0) {
    throw new Error(
      'Session is busy with another operation. Please wait or use a different session.',
    );
  }

  const code = wrapExecuteCode(source);
  appendTranscriptOutput(setTranscriptLive(session, true));
  try {
    const resultOop = await runNbCall(
      session,
      () => {
        // OOP_CLASS_UTF8 declares the source bytes UTF-8, so cells with
        // non-ASCII literals compile correctly (same convention as
        // browserQueries.executeFetchString).
        const { success, err } = session.gci.GciTsNbExecute(
          session.handle,
          code,
          OOP_CLASS_UTF8,
          OOP_ILLEGAL,
          OOP_NIL,
          0,
          0,
        );
        return { success, err };
      },
      async () => {
        const { result, err } = await settleNbResult(session, (text) =>
          appendTranscriptOutput(text),
        );
        if (err.number !== 0) {
          throw new Error(err.message || `GCI error ${err.number}`);
        }
        return result;
      },
      { title: 'GemStone: Running cell…' },
    );

    // wrapExecuteCode printStrings server-side, so the result IS a string.
    const { data, err: fetchErr } = session.gci.GciTsFetchUtf8(
      session.handle,
      resultOop,
      MAX_CELL_RESULT,
    );
    if (fetchErr.number !== 0) {
      throw new Error(fetchErr.message || `GCI error ${fetchErr.number}`);
    }
    return data;
  } finally {
    appendTranscriptOutput(setTranscriptLive(session, false));
  }
}

export class SmalltalkNotebookController extends GemStoneNotebookKernel {
  constructor(sessionManager: SessionManager) {
    super(sessionManager, {
      id: SMALLTALK_CONTROLLER_ID,
      label: SMALLTALK_CONTROLLER_LABEL,
      description: 'Run Smalltalk in the active GemStone session',
      supportedLanguages: [SMALLTALK_LANGUAGE_ID],
      evaluate: (session, source) => evalSmalltalk(session, source),
    });
  }
}
