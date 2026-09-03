import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import {
  OOP_ILLEGAL,
  OOP_NIL,
  GCI_PERFORM_FLAG_ENABLE_DEBUG,
  GCI_PERFORM_FLAG_SINGLE_STEP,
  GCI_PERFORM_FLAG_INTERPRETED,
} from './gciConstants';
import { logError, logInfo } from './gciLog';
import { InspectorTreeProvider } from './inspectorTreeProvider';
import { routeInspect } from './inspectRouter';
import { DebuggerPanel } from './debuggerPanel';
import {
  clearStack,
  getObjectPrintString,
  getObjectClassName,
  isSpecialOop,
  saveObjs,
  releaseObjs,
} from './debugQueries';
import { ObjectGraphPanel } from './objectGraph/objectGraphPanel';
import { ObjectGraphWalk } from './objectGraph/objectGraphWalk';
import { WalkStep } from './objectGraph/objectGraphHtml';
import { appendTranscript, appendTranscriptOutput, showTranscript } from './transcriptChannel';
import { setTranscriptLive, drainTranscript, settleNbResult } from './transcriptSink';
import { pollNbToCompletion, NbCancelledError } from './nbRunner';

const MAX_RESULT_SIZE = 64 * 1024;

// How much of the target's printString the object-graph panel header shows. The
// panel identifies an object, it does not display it — the Inspector is for that.
const OBJECT_GRAPH_PRINT_LIMIT = 512;

// Decoration type for Display It results.
// Uses color + italic so it's visible even while text is selected
// (selection background covers decoration background, but not text color).
const resultDecorationType = vscode.window.createTextEditorDecorationType({
  fontStyle: 'italic',
  dark: {
    color: '#7cc6ff',
    backgroundColor: 'rgba(51, 153, 255, 0.2)',
  },
  light: {
    color: '#005fa3',
    backgroundColor: 'rgba(0, 102, 204, 0.1)',
  },
});

// Decoration type applied to the executing code selection to dim it while busy.
const executingDecorationType = vscode.window.createTextEditorDecorationType({
  opacity: '0.4',
});

// Decoration type for the non-destructive "overlay" Display It result.
// Renders the result as an after-line annotation that is NOT part of the
// document — the file is never modified, never dirtied, never saved. Styling
// lives on `after`; the dynamic result text is supplied per-instance via
// renderOptions.after.contentText.
const overlayDecorationType = vscode.window.createTextEditorDecorationType({
  after: {
    margin: '0 0 0 1ch',
    fontStyle: 'italic',
  },
  light: { after: { color: '#005fa3', backgroundColor: 'rgba(0, 102, 204, 0.1)' } },
  dark: { after: { color: '#7cc6ff', backgroundColor: 'rgba(51, 153, 255, 0.2)' } },
});

// Context key controlling whether Backspace/Escape dismiss the overlay
// (instead of editing the document) while a Display It result is shown.
const DISPLAY_RESULT_CONTEXT = 'gemstone.displayResultVisible';

// Max characters shown in the inline overlay before truncating (full value
// is always available via the hover and the Expand action).
const MAX_OVERLAY_PREVIEW = 100;

// GemStone's "a soft break was received" error. A soft break only ever reaches
// the gem because the user asked to cancel, so it says nothing about the code
// that was running — see executeWithDebugger, which reports it as a cancellation
// rather than opening a debugger on it.
const SOFT_BREAK_ERROR_NUMBER = 6003;

class DebuggableError extends Error {
  constructor(
    message: string,
    public readonly context: bigint,
    public readonly errorNumber: number,
  ) {
    super(message);
  }
}

// koffi returns uint64 as Number when the value fits in MAX_SAFE_INTEGER.
// Normalize to bigint for correct comparison with OOP_NIL etc.
function toBigInt(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

/** What the object-graph feature needs from the rest of the extension.
 *
 *  Injected rather than imported so committing goes through extension.ts's own
 *  `commitSession` / `abortSession` — which also warn about unsaved .gs edits, refresh
 *  the export mirror and rebuild GemStone Search's corpora. A second commit path here
 *  would silently skip all of that. */
/** A scan result with the `needsCommit` case removed — what {@link CodeExecutor.withCleanSession}
 *  hands back once it has resolved the dirty-session question, so callers narrow to the
 *  outcomes they actually have to handle. */
type Clean<T> = Exclude<T, { kind: 'needsCommit' }>;

export interface ObjectGraphDeps {
  inspectorProvider: InspectorTreeProvider;
  commit: (session: ActiveSession) => Promise<void>;
  abort: (session: ActiveSession) => Promise<void>;
  revealClass: (className: string) => Promise<void>;
}

export class CodeExecutor {
  private executing = new Set<number>();
  private diagnostics: vscode.DiagnosticCollection;
  private statusBarItem: vscode.StatusBarItem;
  // Most recent Display It result (full text), used by the Copy/Expand hover
  // actions in overlay mode.
  private lastResult: string | null = null;
  // Active overlay clear-listeners, disposed when the overlay is removed.
  private overlayDisposables: vscode.Disposable[] | undefined;
  // The editor currently showing an overlay result (so it can be cleared).
  private overlayEditor: vscode.TextEditor | undefined;
  // The selection the overlay was anchored on, i.e. where Enter inserts the
  // full result if the user chooses to materialize it in place.
  private overlaySelection: vscode.Selection | undefined;
  // Objects pinned for open object-graph tabs, per session: oop -> how many tabs hold it.
  // Several tabs legitimately hold the same object, and the GCI pin/release pair is not
  // reference-counted, so the count lives here.
  private graphPins = new Map<number, Map<string, number>>();

  constructor(private sessionManager: SessionManager) {
    this.diagnostics = vscode.languages.createDiagnosticCollection('gemstone-execute');
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  }

  dispose(): void {
    this.diagnostics.dispose();
    this.statusBarItem.dispose();
    this.clearOverlay();
  }

  private setExecuting(sessionId: number, busy: boolean): void {
    if (busy) {
      this.executing.add(sessionId);
    } else {
      this.executing.delete(sessionId);
    }
    const isExecuting = this.executing.size > 0;
    vscode.commands.executeCommand('setContext', 'gemstone.executing', isExecuting);
    if (isExecuting) {
      this.statusBarItem.text = '$(sync~spin) GemStone: Executing...';
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  async displayIt(): Promise<void> {
    return this.execute('display');
  }

  async executeIt(): Promise<void> {
    return this.execute('execute');
  }

  async debugIt(): Promise<void> {
    return this.execute('debug');
  }

  private async execute(mode: 'display' | 'execute' | 'debug'): Promise<void> {
    const displayResult = mode === 'display';
    const session = await this.sessionManager.resolveSession();
    if (!session) return;

    if (this.executing.has(session.id)) {
      vscode.window.showWarningMessage(
        'A GemStone execution is already in progress on this session.',
      );
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active text editor.');
      return;
    }

    let selection = editor.selection;
    if (selection.isEmpty) {
      const line = editor.document.lineAt(selection.active.line);
      selection = new vscode.Selection(line.range.start, line.range.end);
    }

    const code = editor.document.getText(selection);
    if (!code.trim()) {
      vscode.window.showWarningMessage('No code to execute.');
      return;
    }

    const oopClassString = this.resolveUtf8ClassOopUsing(session);

    // Dim the selected code while executing
    const execRange = new vscode.Range(selection.start, selection.end);
    editor.setDecorations(executingDecorationType, [execRange]);

    this.setExecuting(session.id, true);
    // Run interpreted (native code off) so a halt/error is steppable in the
    // debugger — GemStone can't step native code (error 6014), and the process
    // must START interpreted. Debug It adds the single-step flag so the server
    // breaks on the first statement of the compiled code and we open the
    // debugger sitting there.
    const execFlags =
      GCI_PERFORM_FLAG_ENABLE_DEBUG |
      GCI_PERFORM_FLAG_INTERPRETED |
      (mode === 'debug' ? GCI_PERFORM_FLAG_SINGLE_STEP : 0);
    // Transcript writes stream live to the output channel while this execute
    // runs (see transcriptSink). Any residue buffered since the last drain is
    // displayed now. Switched back to buffered mode in finally.
    appendTranscriptOutput(setTranscriptLive(session, true));
    try {
      const { success, err: startErr } = session.gci.GciTsNbExecute(
        session.handle,
        code,
        oopClassString,
        OOP_ILLEGAL,
        OOP_NIL,
        execFlags,
        0,
      );
      if (!success) {
        const msg = startErr.message || `error ${startErr.number}`;
        logError(session.id, msg);
        this.showCompileError(editor, selection, code, 0, msg);
        return;
      }

      const resultString = await this.pollForResult(session);

      this.diagnostics.delete(editor.document.uri);

      if (displayResult) {
        await this.displayExecutionResult(editor, selection, resultString);
      } else {
        vscode.window.setStatusBarMessage('GemStone: Executed successfully.', 3000);
      }
    } catch (e: unknown) {
      if (e instanceof NbCancelledError) return;
      const msg = e instanceof Error ? e.message : String(e);
      logError(session.id, msg);

      if (e instanceof DebuggableError) {
        if (mode === 'debug') {
          // Debug It: the single-step flag halted on the first statement —
          // this is an intentional stop, not an error. Open the Enhanced
          // debugger directly on that halt, with no inline diagnostic and no
          // chooser prompt. The panel takes its own stepping ref; if it fails
          // to open, release the suspended process so it doesn't stall.
          try {
            DebuggerPanel.create(session, e.context, 'Debug It');
          } catch (panelErr: unknown) {
            logError(session.id, panelErr instanceof Error ? panelErr.message : String(panelErr));
            clearStack(session, e.context);
          }
          return;
        }
        // Try to show as inline diagnostic first; fall back to debug dialog
        this.showCompileError(editor, selection, code, 0, msg);
        // For a Display It, resuming/stepping to completion should render the
        // result back in the workspace, just as if it had never halted. (Execute
        // It is intentionally silent, so no callback.)
        const onComplete = displayResult
          ? (resultOop: bigint): void => {
              // The debugger runs with the sink in buffered mode; show what
              // accumulated while stepping/resuming to completion.
              appendTranscriptOutput(drainTranscript(session));
              const resultString = getObjectPrintString(session, resultOop, MAX_RESULT_SIZE);
              // Capture the editor's column now, while it is still visible — by the
              // next tick (after the panel disposes) editor.viewColumn may be
              // undefined and the result would drift to whatever column is active.
              const column = editor.viewColumn ?? vscode.ViewColumn.Active;
              // The debugger panel disposes immediately after this callback,
              // stealing focus from the workspace editor. Render once that has
              // settled (next tick), refocusing the editor first — the result's
              // Backspace/Enter keybindings require editorTextFocus, so otherwise
              // the result shows but can't be dismissed/expanded from the keyboard.
              setTimeout(() => {
                this.renderResultWithFocus(editor, selection, resultString, column).catch((err) =>
                  logError(session.id, err instanceof Error ? err.message : String(err)),
                );
              }, 0);
            }
          : undefined;
        await this.promptDebuggableError(session, e.context, msg, onComplete);
      } else {
        this.showCompileError(editor, selection, code, 0, msg);
      }
    } finally {
      editor.setDecorations(executingDecorationType, []);
      // Back to buffered mode; display anything that raced the switch. (After
      // a hard-break cancel the gem may still be settling — the switch then
      // fails quietly and the next execute's switch-on drains the residue.)
      appendTranscriptOutput(setTranscriptLive(session, false));
      this.setExecuting(session.id, false);
    }
  }

  /**
   * Render a Display-It result after refocusing its editor. Used only by the
   * debugger's resume-to-completion path: the Enhanced Debugger panel takes
   * focus and then disposes, so the workspace editor must be re-focused before
   * the result is shown — the Backspace (dismiss) / Enter (expand) keybindings
   * are gated on editorTextFocus. Falls back to the captured editor reference if
   * the document can no longer be shown (e.g. it was closed).
   */
  private async renderResultWithFocus(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    resultString: string,
    column: vscode.ViewColumn,
  ): Promise<void> {
    let target = editor;
    try {
      target = await vscode.window.showTextDocument(editor.document, {
        viewColumn: column,
        preserveFocus: false,
        preview: false,
      });
    } catch {
      // Document gone/unopenable — render on the captured editor as a fallback.
    }
    await this.displayExecutionResult(target, selection, resultString);
  }

  /**
   * Display a Display-It result in the editor — overlay (non-destructive,
   * default) or inline insert, per the `gemstone.displayItMode` setting. Shared
   * by the normal Display It and the debugger's resume-to-completion path so a
   * halted Display It renders its result identically once resumed.
   */
  private async displayExecutionResult(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    resultString: string,
  ): Promise<void> {
    const mode = vscode.workspace
      .getConfiguration('gemstone')
      .get<string>('displayItMode', 'overlay');
    if (mode === 'insert') {
      await this.insertResult(editor, selection, resultString);
    } else {
      this.showResultOverlay(editor, selection, resultString);
    }
  }

  /**
   * Classic workspace behavior: insert the result into the document as
   * editable text after the selection, then select it so a single Backspace
   * removes it. This mutates (and dirties) the file.
   */
  private async insertResult(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    resultString: string,
  ): Promise<void> {
    await editor.edit((editBuilder) => {
      editBuilder.insert(selection.end, ` ${resultString}`);
    });

    // Select the inserted result so a single backspace removes it
    const resultStart = selection.end.translate(0, 1);
    const resultEnd = editor.document.positionAt(
      editor.document.offsetAt(selection.end) + 1 + resultString.length,
    );
    editor.selection = new vscode.Selection(selection.end, resultEnd);

    // Apply decoration so the result is visually distinct (Cmd+Z to undo)
    const decoRange = new vscode.Range(resultStart, resultEnd);
    editor.setDecorations(resultDecorationType, [decoRange]);

    // Clear decoration when document is next edited
    setTimeout(() => {
      const disposable = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === editor.document) {
          editor.setDecorations(resultDecorationType, []);
          disposable.dispose();
        }
      });
    }, 0);
  }

  /**
   * Quokka-style non-destructive result display: render the result as an
   * after-line decoration (an editor overlay, NOT document text) so the file
   * is never modified, dirtied, or saved. Inline overlays are single-line, so
   * the preview is flattened/truncated; the full value is reachable via the
   * hover's Copy and Expand command links.
   */
  private showResultOverlay(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    resultString: string,
  ): void {
    this.lastResult = resultString;
    this.clearOverlay();

    const flat = resultString.replace(/\s*\r?\n\s*/g, ' ⏎ ').trim();
    const preview =
      flat.length > MAX_OVERLAY_PREVIEW ? `${flat.slice(0, MAX_OVERLAY_PREVIEW)} …` : flat;

    // Hover carries the full value plus clickable command links. isTrusted is
    // required for command: links to fire.
    const hover = new vscode.MarkdownString();
    hover.isTrusted = true;
    hover.appendCodeblock(resultString, 'smalltalk');
    hover.appendMarkdown(
      '\n\n[Copy](command:gemstone.copyDisplayItResult "Copy the full result to the clipboard")' +
        ' &nbsp;|&nbsp; ' +
        '[Output](command:gemstone.outputDisplayItResult "Show the full result in the Output panel")' +
        '\n\n_Enter to insert in place · Backspace to dismiss_',
    );

    // Anchor on the last character of the selection so the hover has a target;
    // the `after` annotation still renders past the end of the selection.
    const endOffset = editor.document.offsetAt(selection.end);
    const anchorStart = endOffset > 0 ? editor.document.positionAt(endOffset - 1) : selection.end;
    const decoration: vscode.DecorationOptions = {
      range: new vscode.Range(anchorStart, selection.end),
      hoverMessage: hover,
      renderOptions: { after: { contentText: ` ⇒ ${preview}` } },
    };
    editor.setDecorations(overlayDecorationType, [decoration]);
    this.overlayEditor = editor;
    this.overlaySelection = selection;

    // While the result is showing, Backspace/Escape dismiss it (see the
    // keybindings in package.json) instead of editing the document.
    vscode.commands.executeCommand('setContext', DISPLAY_RESULT_CONTEXT, true);

    // Otherwise the overlay clears as soon as the user edits, moves the
    // cursor, or switches editors. Deferred so we don't catch trailing events
    // from this command.
    const disposables: vscode.Disposable[] = [];
    setTimeout(() => {
      disposables.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
          if (e.document === editor.document) this.clearOverlay();
        }),
        vscode.window.onDidChangeTextEditorSelection((e) => {
          if (e.textEditor === editor) this.clearOverlay();
        }),
        vscode.window.onDidChangeActiveTextEditor(() => this.clearOverlay()),
      );
    }, 0);
    this.overlayDisposables = disposables;
  }

  /**
   * Remove the overlay result: clear its decoration, dispose its listeners,
   * and release the dismiss context key. Never modifies the document.
   */
  private clearOverlay(): void {
    // Release the context key FIRST and unconditionally, so a stale-editor
    // error below can never strand it on — a stranded key would hijack
    // Backspace/Enter/Ctrl+Z with no overlay visible to explain why.
    vscode.commands.executeCommand('setContext', DISPLAY_RESULT_CONTEXT, false);
    this.overlayDisposables?.forEach((d) => d.dispose());
    this.overlayDisposables = undefined;
    if (this.overlayEditor) {
      try {
        this.overlayEditor.setDecorations(overlayDecorationType, []);
      } catch {
        // Editor already disposed (e.g. its file was closed) — the decoration
        // is gone with it, nothing more to clear.
      }
      this.overlayEditor = undefined;
    }
    this.overlaySelection = undefined;
  }

  /** Dismiss the visible overlay result (bound to Backspace/Escape/Ctrl+Z). */
  dismissDisplayResult(): void {
    this.clearOverlay();
  }

  /**
   * Materialize the overlay result into the document as editable text (bound
   * to Enter while a result is shown). Inserts the FULL result — not the
   * truncated inline preview — then clears the overlay. This dirties the file.
   */
  async expandResultInPlace(): Promise<void> {
    const editor = this.overlayEditor;
    const selection = this.overlaySelection;
    const result = this.lastResult;
    if (!editor || !selection || result === null) return;
    this.clearOverlay();
    await this.insertResult(editor, selection, result);
  }

  /** Copy the most recent Display It result to the clipboard. */
  async copyLastResult(): Promise<void> {
    if (this.lastResult === null) {
      vscode.window.showInformationMessage('No Display It result to copy.');
      return;
    }
    await vscode.env.clipboard.writeText(this.lastResult);
    vscode.window.setStatusBarMessage('GemStone: Result copied to clipboard.', 2000);
  }

  /**
   * Execute `code` with the GemStone debugger enabled, for a caller that has no
   * editor behind it — a SUnit test started from a tree row, a gutter icon or a
   * code lens. Deliberately the same execution path as Execute It (interpreted,
   * debug-enabled, same non-blocking poll, same debugger prompt), so a test that
   * halts behaves exactly like halted workspace code.
   *
   * Answers whether the code raised, or whether the user cancelled it — and no
   * more than that. Once the process is suspended it belongs to whichever
   * debugger the user picked, so its eventual fate isn't ours to report. A
   * cancel (a soft or hard break) is reported as `cancelled`, not `raised`, and
   * never opens a debugger: it was the user's decision, not the code's fault.
   * Throws when the execution could not be started at all.
   */
  async executeWithDebugger(
    session: ActiveSession,
    code: string,
    label: string,
  ): Promise<{ raised: boolean; cancelled?: boolean; message?: string }> {
    if (this.executing.has(session.id)) {
      throw new Error('A GemStone execution is already in progress on this session.');
    }

    const oopClassString = this.resolveUtf8ClassOopUsing(session);
    this.setExecuting(session.id, true);
    appendTranscriptOutput(setTranscriptLive(session, true));
    try {
      const { success, err: startErr } = session.gci.GciTsNbExecute(
        session.handle,
        code,
        oopClassString,
        OOP_ILLEGAL,
        OOP_NIL,
        GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
        0,
      );
      if (!success) {
        throw new Error(startErr.message || `GemStone error ${startErr.number}`);
      }

      await this.pollForResultOop(session);
      return { raised: false };
    } catch (e: unknown) {
      // A cancelled run tells us nothing about the code — it was the user's
      // decision, not the test's fault — so report it as cancelled and never
      // open a debugger on it. Cancel arrives two ways: a hard break rejects
      // with NbCancelledError, while a soft break lets the gem raise its "a soft
      // break was received" error (6003), which surfaces here as a
      // DebuggableError with a live context like any other break.
      if (e instanceof NbCancelledError) return { raised: false, cancelled: true };
      if (e instanceof DebuggableError && e.errorNumber === SOFT_BREAK_ERROR_NUMBER) {
        return { raised: false, cancelled: true };
      }

      const msg = e instanceof Error ? e.message : String(e);
      logError(session.id, `${label}: ${msg}`);

      if (e instanceof DebuggableError) {
        await this.promptDebuggableError(session, e.context, `${label} — ${msg}`);
        return { raised: true, message: msg };
      }
      throw e instanceof Error ? e : new Error(msg);
    } finally {
      appendTranscriptOutput(setTranscriptLive(session, false));
      this.setExecuting(session.id, false);
    }
  }

  /** Show the full most recent Display It result in the Output panel. */
  outputLastResult(): void {
    if (this.lastResult === null) {
      vscode.window.showInformationMessage('No Display It result to show in the Output panel.');
      return;
    }
    appendTranscript(this.lastResult);
    showTranscript();
  }

  private validateContextOop(session: ActiveSession, context: bigint): void {
    const hex = '0x' + context.toString(16);
    logInfo(`[Session ${session.id}] Debug context OOP: ${context} (${hex})`);

    // Check if the object exists
    const exists = session.gci.GciTsObjExists(session.handle, context);
    logInfo(`[Session ${session.id}] Debug context ObjExists: ${exists}`);

    if (exists) {
      // Try to get its class
      const { result: classOop, err } = session.gci.GciTsFetchClass(session.handle, context);
      if (err.number === 0) {
        // Get class name
        const { data, err: nameErr } = session.gci.GciTsPerformFetchBytes(
          session.handle,
          classOop,
          'name',
          [],
          256,
        );
        logInfo(
          `[Session ${session.id}] Debug context class: ${nameErr.number === 0 ? data : `error ${nameErr.number}`}`,
        );
      } else {
        logInfo(`[Session ${session.id}] Debug context FetchClass error: ${err.message}`);
      }
    }
  }

  private resolveUtf8ClassOopUsing(session: ActiveSession): bigint {
    return session.gci.utf8ClassOop(session.handle);
  }

  /**
   * Show a compile/syntax error as an inline diagnostic in the editor.
   *
   * GemStone error messages for compile errors typically contain a 1-based
   * character offset into the source string (e.g. "...near source character 45").
   * Since the user code is wrapped in a Transcript-capture template, we subtract
   * the wrapper prefix length to map back to the user's original code, then
   * convert to a line/column position relative to the editor selection.
   */
  private showCompileError(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    userCode: string,
    wrapperPrefixLength: number,
    message: string,
  ): void {
    // Try to extract a character offset from the error message.
    // GemStone formats vary; common patterns include:
    //   "...near source character 45"
    //   "...at or near character 45"
    //   "...Error, (offset 45)"
    const offsetMatch = message.match(/(?:character|offset|position)\s+(\d+)/i);
    let diagRange: vscode.Range;
    if (offsetMatch) {
      const gsOffset = parseInt(offsetMatch[1], 10) - 1; // GemStone is 1-based
      const userOffset = Math.max(0, Math.min(gsOffset - wrapperPrefixLength, userCode.length));
      diagRange = this.offsetToEditorRange(editor, selection, userCode, userOffset);
    } else {
      // No offset found — highlight the entire selection
      diagRange = new vscode.Range(selection.start, selection.end);
    }

    const diag = new vscode.Diagnostic(diagRange, message, vscode.DiagnosticSeverity.Error);
    diag.source = 'GemStone';
    this.diagnostics.set(editor.document.uri, [diag]);

    // Clear diagnostic when the document is next edited
    const disposable = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === editor.document) {
        this.diagnostics.delete(editor.document.uri);
        disposable.dispose();
      }
    });
  }

  /**
   * Single shared notifier for a debuggable GemStone error. Offers two
   * debuggers — the DAP "Debug" (Run and Debug view) and the webview
   * "Enhanced Debug" — plus the implicit Cancel/dismiss. Whichever debugger the
   * user picks OWNS the suspended `gsProcess`; dismissing clears the stack so
   * the process is released. The two debuggers never coexist on one process.
   */
  private async promptDebuggableError(
    session: ActiveSession,
    gsProcess: bigint,
    msg: string,
    onComplete?: (resultOop: bigint) => void,
  ): Promise<void> {
    // Button array order maps to right-to-left placement in the modal, so
    // 'Enhanced Debug' first puts it to the RIGHT of 'Debug'.
    const choice = await vscode.window.showErrorMessage(
      `GemStone error: ${msg}`,
      { modal: true },
      'Enhanced Debug',
      'Debug',
    );
    if (choice === 'Debug') {
      await vscode.debug.startDebugging(
        undefined,
        {
          type: 'gemstone',
          name: 'GemStone Error',
          request: 'attach',
          sessionId: session.id,
          gsProcess: gsProcess.toString(),
          errorMessage: msg,
        },
        { suppressSaveBeforeStart: true },
      );
      // Reveal the Run and Debug view so the call stack is immediately visible
      // instead of silently populating a hidden view.
      await vscode.commands.executeCommand('workbench.view.debug');
    } else if (choice === 'Enhanced Debug') {
      try {
        DebuggerPanel.create(session, gsProcess, msg, onComplete);
      } catch (err: unknown) {
        // If the panel fails to open, nothing owns the suspended process, so
        // release it rather than leaving it stalled on the server.
        logError(session.id, err instanceof Error ? err.message : String(err));
        clearStack(session, gsProcess);
      }
    } else {
      clearStack(session, gsProcess);
    }
  }

  /**
   * Convert a character offset within the user code to an editor Range.
   * The range highlights the line containing the error.
   */
  private offsetToEditorRange(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    userCode: string,
    userOffset: number,
  ): vscode.Range {
    const beforeError = userCode.substring(0, userOffset);
    const lines = beforeError.split('\n');
    const errorLineInCode = lines.length - 1; // 0-based line within user code
    const errorCol = lines[lines.length - 1].length;

    // Map to editor position relative to the selection start
    const editorLine = selection.start.line + errorLineInCode;
    const editorCol = errorLineInCode === 0 ? selection.start.character + errorCol : errorCol;

    const pos = new vscode.Position(editorLine, editorCol);
    // Highlight from the error position to the end of that line
    const lineEnd = editor.document.lineAt(editorLine).range.end;
    return new vscode.Range(pos, lineEnd);
  }

  private pollForCompletion<T>(session: ActiveSession, onReady: () => Promise<T>): Promise<T> {
    // Delegates to the shared non-blocking poll loop (nbRunner) so Execute/Display
    // It and the debugger's step/trim share ONE cancel/break/backoff/progress
    // implementation (no divergence). The Nb call is already started by the caller
    // (GciTsNbExecute above), so we only poll it to completion here.
    return pollNbToCompletion(session, onReady, { title: 'GemStone: Executing…' });
  }

  private pollForResult(session: ActiveSession): Promise<string> {
    return this.pollForCompletion(session, () => this.fetchResultString(session));
  }

  private pollForResultOop(session: ActiveSession): Promise<bigint> {
    return this.pollForCompletion(session, () => this.fetchResultOop(session));
  }

  private async fetchResultOop(session: ActiveSession): Promise<bigint> {
    // Transcript writes arrive here as forwarder sends (error 2336) while the
    // code is still running: settleNbResult displays each one and resumes the
    // execution, only returning when a real result or error arrives.
    const { result: resultOop, err: resultErr } = await settleNbResult(session, (text) =>
      appendTranscriptOutput(text),
    );
    if (resultErr.number !== 0) {
      const msg = resultErr.message || `GemStone error ${resultErr.number}`;
      const context = toBigInt(resultErr.context);
      if (context !== OOP_NIL && context !== 0n) {
        this.validateContextOop(session, context);
        throw new DebuggableError(msg, context, resultErr.number);
      }
      throw new Error(msg);
    }
    return resultOop;
  }

  private async fetchResultString(session: ActiveSession): Promise<string> {
    const resultOop = await this.fetchResultOop(session);

    return session.gci.executeAndFetchString(
      session.handle,
      `(Object objectForOop: ${resultOop}) printString`,
    );
  }

  // ── Inspect ──────────────────────────────────────────

  async inspectIt(inspectorProvider: InspectorTreeProvider): Promise<void> {
    const session = await this.sessionManager.resolveSession();
    if (!session) return;

    if (this.executing.has(session.id)) {
      vscode.window.showWarningMessage(
        'A GemStone execution is already in progress on this session.',
      );
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active text editor.');
      return;
    }

    let selection = editor.selection;
    if (selection.isEmpty) {
      const line = editor.document.lineAt(selection.active.line);
      selection = new vscode.Selection(line.range.start, line.range.end);
    }

    const code = editor.document.getText(selection);
    if (!code.trim()) {
      vscode.window.showWarningMessage('No code to execute.');
      return;
    }

    const label = code.trim().split('\n')[0].slice(0, 40);
    await this.executeAndInspect(session, code, label, inspectorProvider);
  }

  async inspectExpression(
    inspectorProvider: InspectorTreeProvider,
    code: string,
    label: string,
  ): Promise<void> {
    const session = await this.sessionManager.resolveSession();
    if (!session) return;

    if (this.executing.has(session.id)) {
      vscode.window.showWarningMessage(
        'A GemStone execution is already in progress on this session.',
      );
      return;
    }

    await this.executeAndInspect(session, code, label, inspectorProvider);
  }

  private async executeAndInspect(
    session: ActiveSession,
    code: string,
    label: string,
    inspectorProvider: InspectorTreeProvider,
  ): Promise<void> {
    await this.executeForResultOop(session, code, (oop) => {
      routeInspect(session, oop, label, inspectorProvider);
    });
  }

  // ── Object graph ─────────────────────────────────────────────────────

  /** Evaluate the selection (or the cursor's line) and show what points at the
   *  result — every class holding a reference to it, with counts.
   *
   *  Shares Inspect It's selection handling deliberately: the question "what points
   *  at this?" is asked about the same thing Inspect It would open. */
  async showObjectGraphIt(deps: ObjectGraphDeps): Promise<void> {
    const session = await this.sessionManager.resolveSession();
    if (!session) return;

    if (this.executing.has(session.id)) {
      vscode.window.showWarningMessage(
        'A GemStone execution is already in progress on this session.',
      );
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active text editor.');
      return;
    }

    let selection = editor.selection;
    if (selection.isEmpty) {
      const line = editor.document.lineAt(selection.active.line);
      selection = new vscode.Selection(line.range.start, line.range.end);
    }

    const code = editor.document.getText(selection);
    if (!code.trim()) {
      vscode.window.showWarningMessage('No code to execute.');
      return;
    }

    await this.executeForResultOop(session, code, (oop) =>
      this.presentObjectGraph(session, oop, deps),
    );
  }

  /** Run a scan that requires a clean session, prompting when it isn't.
   *
   *  Every repository-wide scan aborts the session, so GemStone refuses to run one while
   *  uncommitted work is present — it raises before doing anything rather than discarding
   *  edits. Rather than dead-ending there, ask which the user wants and retry once.
   *  Commit and abort both go through the extension's own handlers, so the abort keeps its
   *  existing confirmation listing what is at stake.
   *
   *  Returns undefined when the user declines, so callers stay silent instead of
   *  reporting a failure the user chose. */
  private async withCleanSession<T extends { kind: string }>(
    session: ActiveSession,
    deps: ObjectGraphDeps,
    run: () => Promise<T>,
  ): Promise<Clean<T> | undefined> {
    const first = await run();
    if (first.kind !== 'needsCommit') return first as Clean<T>;

    const COMMIT = 'Commit';
    const ABORT = 'Abort';
    const choice = await vscode.window.showWarningMessage(
      'This session has uncommitted changes, and scanning the repository for references ' +
        'aborts the session — so GemStone will not run the scan while they are pending. ' +
        'Commit them, or abort and discard them?',
      { modal: true },
      COMMIT,
      ABORT,
    );
    if (choice === COMMIT) {
      await deps.commit(session);
    } else if (choice === ABORT) {
      await deps.abort(session);
    } else {
      return undefined;
    }

    // The handlers can themselves decline (unsaved .gs edits, an abort confirmation the
    // user cancels, a commit that conflicts), so re-check rather than assuming we are now
    // clean: a second needsCommit is the user's answer, not an error to report.
    const second = await run();
    return second.kind === 'needsCommit' ? undefined : (second as Clean<T>);
  }

  /** Scan for `oop`'s referrers and show them, or explain why we can't.
   *
   *  The object is pinned into the session's export set for the duration. The scan
   *  aborts the session, and an abort can scavenge an unreferenced object and reuse
   *  its OOP number — without the pin, a result the user is still looking at could be
   *  reclaimed mid-question and the panel would describe a different object.
   *
   *  Immediates are screened out here rather than in the query: a SmallInteger has no
   *  identity to scan for and the kernel answers "argument is not a Pom oop", which is
   *  true but unhelpful. */
  /** Show what points at `oop`, and let the user walk the graph from there.
   *
   *  The walk itself — the breadcrumb, the expanded class, the hops — belongs to
   *  ObjectGraphWalk. This method's job is to screen out what cannot be scanned and then
   *  open the first walk; each step into a referrer opens another one in its own tab. */
  async presentObjectGraph(
    session: ActiveSession,
    oop: bigint,
    deps: ObjectGraphDeps,
  ): Promise<void> {
    if (oop === OOP_NIL || isSpecialOop(session, oop)) {
      vscode.window.showInformationMessage(
        'GemStone tracks references to objects, not to immediate values. ' +
          'A SmallInteger, Character, Boolean or nil has no identity to scan for — ' +
          'select something that evaluates to a real object.',
      );
      return;
    }
    await this.openObjectGraphWalk(session, oop, [], deps);
  }

  /** Open one graph tab and start a walk in it.
   *
   *  Recursive by design: the walk's `openWalk` dep comes back here, so stepping into a
   *  referrer opens a sibling tab with its own walk and its own panel rather than
   *  overwriting this one. */
  private async openObjectGraphWalk(
    session: ActiveSession,
    oop: bigint,
    inherited: WalkStep[],
    deps: ObjectGraphDeps,
  ): Promise<void> {
    let panel: ObjectGraphPanel | undefined;
    const walk = new ObjectGraphWalk(session, {
      describe: (target) => ({
        className: getObjectClassName(session, target),
        printString: getObjectPrintString(session, target, OBJECT_GRAPH_PRINT_LIMIT),
      }),
      inspect: (target, label) => routeInspect(session, target, label, deps.inspectorProvider),
      revealClass: (className) => deps.revealClass(className),
      withCleanSession: (run) => this.withCleanSession(session, deps, run),
      // Window location, not Notification: a scan is ~150 ms on a large stone, and a
      // notification that appears and vanishes that fast is worse than none. This shows
      // in the status bar with a spinner for as long as the work takes, however brief.
      // vscode.window.withProgress answers a Thenable, which is not a Promise, so it is
      // adapted rather than returned straight through.
      withProgress: async (title, work) =>
        vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: `GemStone: ${title}` },
          () => work(),
        ),
      pin: (target) => this.pinGraphObject(session, target),
      unpin: (target) => this.unpinGraphObject(session, target),
      openWalk: (target, trail) => this.openObjectGraphWalk(session, target, trail, deps),
      render: (view, actions) => {
        // The panel is created on the FIRST render, not up front: a walk whose opening
        // scan is refused or declined should leave no empty tab behind.
        panel ??= new ObjectGraphPanel(() => walk.releaseAll());
        panel.render(view, actions);
      },
    });

    try {
      await walk.start(oop, inherited);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(session.id, msg);
      vscode.window.showErrorMessage(`Object graph failed: ${msg}`);
      walk.releaseAll();
      panel?.dispose();
    }
  }

  /** Pin an object for a graph tab, reference-counted per session.
   *
   *  Several tabs can hold the same object — a walk seeds its breadcrumb from the tab it
   *  was opened from, so every inherited step is pinned twice over. `GciTsSaveObjs` and
   *  `GciTsReleaseObjs` are not reference-counted themselves, so one tab closing would
   *  otherwise unpin an object its siblings still navigate back to, and an abort could
   *  then scavenge it and reuse its OOP number. The count keeps the release honest. */
  private pinGraphObject(session: ActiveSession, oop: bigint): void {
    let counts = this.graphPins.get(session.id);
    if (!counts) {
      counts = new Map<string, number>();
      this.graphPins.set(session.id, counts);
    }
    const key = oop.toString();
    const held = counts.get(key) ?? 0;
    if (held === 0) {
      try {
        saveObjs(session, [oop]);
      } catch (e: unknown) {
        logError(session.id, `Object graph: couldn't pin oop ${oop}: ${String(e)}`);
        return;
      }
    }
    counts.set(key, held + 1);
  }

  /** Drop one reference to a pinned graph object, releasing it at zero. */
  private unpinGraphObject(session: ActiveSession, oop: bigint): void {
    const counts = this.graphPins.get(session.id);
    if (!counts) return;
    const key = oop.toString();
    const held = counts.get(key) ?? 0;
    if (held === 0) return;
    if (held > 1) {
      counts.set(key, held - 1);
      return;
    }
    counts.delete(key);
    if (counts.size === 0) this.graphPins.delete(session.id);
    try {
      releaseObjs(session, [oop]);
    } catch {
      // Session gone; nothing to release into.
    }
  }

  /** Evaluate `code` and hand the result's OOP to `onResult`.
   *
   *  The shared body of Inspect It and Show Object Graph: start the execution
   *  non-blocking so a halt is steppable in the debugger, dim the selection while it
   *  runs, poll to completion, and route the result. If it halts and the user resumes
   *  to completion, `onResult` still fires — a debugged execution should end up where
   *  an undebugged one would. */
  private async executeForResultOop(
    session: ActiveSession,
    code: string,
    onResult: (oop: bigint) => void | Promise<void>,
  ): Promise<void> {
    const oopClassString = this.resolveUtf8ClassOopUsing(session);

    // Dim the selected code in the active editor while executing
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.setDecorations(executingDecorationType, [editor.selection]);
    }

    this.setExecuting(session.id, true);
    // Live transcript for the duration; see execute() above.
    appendTranscriptOutput(setTranscriptLive(session, true));
    try {
      // Interpreted so a halt/error is steppable in the debugger; see execute().
      const { success, err: startErr } = session.gci.GciTsNbExecute(
        session.handle,
        code,
        oopClassString,
        OOP_ILLEGAL,
        OOP_NIL,
        GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
        0,
      );
      if (!success) {
        const msg = `Execution failed to start: ${startErr.message || `error ${startErr.number}`}`;
        logError(session.id, msg);
        vscode.window.showErrorMessage(msg);
        return;
      }

      const oop = await this.pollForResultOop(session);

      await onResult(oop);
    } catch (e: unknown) {
      if (e instanceof NbCancelledError) return;
      const msg = e instanceof Error ? e.message : String(e);
      logError(session.id, msg);

      if (e instanceof DebuggableError) {
        // If it halts, resuming/stepping to completion should still route the
        // result — mirroring the success path above.
        await this.promptDebuggableError(session, e.context, msg, (resultOop: bigint) => {
          appendTranscriptOutput(drainTranscript(session));
          void onResult(resultOop);
        });
      } else {
        vscode.window.showErrorMessage(`GemStone execution error: ${msg}`);
      }
    } finally {
      if (editor) {
        editor.setDecorations(executingDecorationType, []);
      }
      appendTranscriptOutput(setTranscriptLive(session, false));
      this.setExecuting(session.id, false);
    }
  }
}
