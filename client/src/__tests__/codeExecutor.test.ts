import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('../gciLog', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('../transcriptChannel', () => ({
  appendTranscript: vi.fn(),
  appendTranscriptOutput: vi.fn(),
  showTranscript: vi.fn(),
}));

vi.mock('../socketPoll', () => ({
  pollReadable: vi.fn(() => 1),
}));

vi.mock('../debuggerPanel', () => ({
  DebuggerPanel: { create: vi.fn() },
}));

vi.mock('../enhancedInspector', () => ({
  EnhancedInspector: { create: vi.fn() },
}));

import { CodeExecutor } from '../codeExecutor';
import { DebuggerPanel } from '../debuggerPanel';
import { EnhancedInspector } from '../enhancedInspector';
import { SessionManager, ActiveSession } from '../sessionManager';
import * as vscode from 'vscode';
import { __resetConfig } from '../__mocks__/vscode';
import { appendTranscript, appendTranscriptOutput, showTranscript } from '../transcriptChannel';
import { pollReadable } from '../socketPoll';
import {
  GCI_PERFORM_FLAG_ENABLE_DEBUG,
  GCI_PERFORM_FLAG_SINGLE_STEP,
  GCI_PERFORM_FLAG_INTERPRETED,
} from '../gciConstants';

/** Set the gemstone.displayItMode setting for the current test. */
function setDisplayItMode(mode: 'overlay' | 'insert'): void {
  vscode.workspace.getConfiguration('gemstone').update('displayItMode', mode);
}

const OOP_NIL = 0x14n;

// ── Helpers ──────────────────────────────────────────────────

function makeGci(overrides: Record<string, unknown> = {}) {
  return {
    utf8ClassOop: vi.fn(() => 100n),
    GciTsNbExecute: vi.fn((): Record<string, unknown> => ({
      success: true,
      err: { number: 0, message: '' },
    })),
    GciTsNbPoll: vi.fn(() => ({ result: 1, err: { number: 0 } })),
    isAvailable: vi.fn(() => true),
    GciTsSocket: vi.fn(() => ({ fd: 7, err: { number: 0 } })),
    GciTsNbResult: vi.fn((): Record<string, unknown> => ({
      result: 200n,
      err: { number: 0, message: '', context: OOP_NIL },
    })),
    GciTsPerformFetchBytes: vi.fn(() => ({ data: '42', err: { number: 0 } })),
    // Transcript sink toggle/drain calls (see transcriptSink.ts) also go through
    // executeAndFetchString; default them to an empty buffer so tests that don't
    // care about transcript output don't have to configure this mock at all.
    executeAndFetchString: vi.fn((_handle: unknown, code: string) => {
      if (code.includes('jasperLive:') || code.includes('jasperDrain')) return '';
      return expect.unreachable(
        'executeAndFetchString mock not configured for this test -- call ' +
          '(gci.executeAndFetchString as Mock).mockReturnValue(...) before triggering Display It.',
      );
    }),
    GciTsClearStack: vi.fn(),
    GciTsObjExists: vi.fn(() => false),
    GciTsFetchClass: vi.fn(() => ({ result: 0n, err: { number: 0 } })),
    ...overrides,
  };
}

function makeSession(gci = makeGci()): ActiveSession {
  return {
    id: 1,
    gci: gci as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test', gs_user: 'DataCurator' },
    stoneVersion: '3.7.2',
  } as ActiveSession;
}

function makeSessionManager(session?: ActiveSession): SessionManager {
  const s = session ?? makeSession();
  return {
    resolveSession: vi.fn(async () => s),
    getSessions: vi.fn(() => [s]),
    getSession: vi.fn(() => s),
  } as unknown as SessionManager;
}

function makeEditor(text: string, selection?: vscode.Selection) {
  const lines = text.split('\n');
  return {
    document: {
      uri: vscode.Uri.file('/workspace/test.st'),
      getText: vi.fn(() => text),
      lineAt: vi.fn((line: number) => ({
        range: {
          start: new vscode.Position(line, 0),
          end: new vscode.Position(line, (lines[line] || '').length),
        },
        text: lines[line] || '',
      })),
      lineCount: lines.length,
      offsetAt: vi.fn((pos: vscode.Position) => {
        let offset = 0;
        for (let i = 0; i < pos.line && i < lines.length; i++) {
          offset += lines[i].length + 1;
        }
        return offset + pos.character;
      }),
      positionAt: vi.fn((offset: number) => {
        let remaining = offset;
        for (let i = 0; i < lines.length; i++) {
          if (remaining <= lines[i].length) {
            return new vscode.Position(i, remaining);
          }
          remaining -= lines[i].length + 1;
        }
        return new vscode.Position(lines.length - 1, (lines[lines.length - 1] || '').length);
      }),
    },
    selection:
      selection ??
      new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, text.length)),
    edit: vi.fn(async (cb: (builder: { insert: (...args: unknown[]) => void }) => void) => {
      cb({ insert: vi.fn() });
      return true;
    }),
    setDecorations: vi.fn(),
  };
}

function setActiveEditor(
  editor: ReturnType<typeof makeEditor> | ReturnType<typeof makeMutableEditor>,
): void {
  (vscode.window as unknown as Record<string, unknown>).activeTextEditor = editor;
}

/**
 * An editor whose underlying document text grows when `edit()` inserts.
 * Use this when a test depends on `offsetAt` / `positionAt` reflecting the
 * post-insertion document — e.g. assertions about the selection placed over
 * inserted Display It output.
 */
function makeMutableEditor(initialText: string, selection?: vscode.Selection) {
  let text = initialText;
  const linesOf = (s: string) => s.split('\n');

  const document = {
    uri: vscode.Uri.file('/workspace/test.st'),
    getText: vi.fn(() => text),
    lineAt: vi.fn((line: number) => {
      const lines = linesOf(text);
      return {
        range: {
          start: new vscode.Position(line, 0),
          end: new vscode.Position(line, (lines[line] || '').length),
        },
        text: lines[line] || '',
      };
    }),
    get lineCount() {
      return linesOf(text).length;
    },
    offsetAt: vi.fn((pos: vscode.Position) => {
      const lines = linesOf(text);
      let offset = 0;
      for (let i = 0; i < pos.line && i < lines.length; i++) {
        offset += lines[i].length + 1;
      }
      return offset + pos.character;
    }),
    positionAt: vi.fn((offset: number) => {
      const lines = linesOf(text);
      let remaining = offset;
      for (let i = 0; i < lines.length; i++) {
        if (remaining <= lines[i].length) {
          return new vscode.Position(i, remaining);
        }
        remaining -= lines[i].length + 1;
      }
      return new vscode.Position(lines.length - 1, (lines[lines.length - 1] || '').length);
    }),
  };

  return {
    document,
    selection:
      selection ??
      new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, initialText.length)),
    edit: vi.fn(
      async (
        cb: (builder: { insert: (pos: vscode.Position, newText: string) => void }) => void,
      ) => {
        cb({
          insert: (pos: vscode.Position, newText: string) => {
            const off = document.offsetAt(pos);
            text = text.slice(0, off) + newText + text.slice(off);
          },
        });
        return true;
      },
    ),
    setDecorations: vi.fn(),
  };
}

/** Return the most recently created mock DiagnosticCollection. */
function lastDiagCollection() {
  const results = vi.mocked(vscode.languages.createDiagnosticCollection).mock.results;
  return results[results.length - 1].value;
}

// ── Tests ────────────────────────────────────────────────────

describe('CodeExecutor', () => {
  let executor: CodeExecutor;
  let session: ActiveSession;
  let gci: ReturnType<typeof makeGci>;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetConfig();
    gci = makeGci();
    session = makeSession(gci);
    executor = new CodeExecutor(makeSessionManager(session));
  });

  // ── Syntax error diagnostics ───────────────────────────────

  describe('syntax error diagnostics', () => {
    it('shows a diagnostic when GciTsNbExecute fails with a compile error', async () => {
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: {
          number: 1001,
          message:
            'a CompileError occurred (error 1001), expected expression, near source character 250',
        },
      });

      const editor = makeEditor('!!! bad syntax');
      setActiveEditor(editor);

      await executor.executeIt();

      const dc = lastDiagCollection();
      expect(dc.set).toHaveBeenCalled();
      const [uri, diags] = dc.set.mock.calls[0];
      expect(uri.toString()).toBe(editor.document.uri.toString());
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('CompileError');
      expect(diags[0].source).toBe('GemStone');
    });

    it('extracts character offset from error and maps to user code position', async () => {
      // The code executes verbatim (no wrapper), so GemStone's 1-based source
      // character offsets map straight onto the user's selection.
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: {
          number: 1001,
          message: 'a CompileError occurred (error 1001), near source character 5',
        },
      });

      const editor = makeEditor('abcdefghij');
      setActiveEditor(editor);

      await executor.executeIt();

      const dc = lastDiagCollection();
      const [, diags] = dc.set.mock.calls[0];
      // Character 5 (0-based: 4) in user code → column 4 on line 0
      expect(diags[0].range.start.line).toBe(0);
      expect(diags[0].range.start.character).toBe(4);
    });

    it('highlights entire selection when no offset found in error message', async () => {
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: {
          number: 1001,
          message: 'some generic error with no position info',
        },
      });

      const code = 'bad code here';
      const sel = new vscode.Selection(new vscode.Position(2, 5), new vscode.Position(2, 18));
      const editor = makeEditor('line0\nline1\n     bad code here\nline3', sel);
      editor.document.getText = vi.fn(() => code);
      setActiveEditor(editor);

      await executor.executeIt();

      const dc = lastDiagCollection();
      const [, diags] = dc.set.mock.calls[0];
      expect(diags[0].range.start.line).toBe(2);
      expect(diags[0].range.start.character).toBe(5);
      expect(diags[0].range.end.line).toBe(2);
      expect(diags[0].range.end.character).toBe(18);
    });

    it('clears diagnostics on successful execution', async () => {
      (gci.executeAndFetchString as Mock).mockReturnValue('7');

      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      await executor.executeIt();

      const dc = lastDiagCollection();
      expect(dc.delete).toHaveBeenCalledWith(editor.document.uri);
    });

    it('shows diagnostic for runtime errors (non-debuggable)', async () => {
      (gci.GciTsNbResult as Mock).mockReturnValue({
        result: 0x01n,
        err: {
          number: 2003,
          message: 'a UndefinedObject does not understand #foo',
          context: OOP_NIL,
        },
      });

      const editor = makeEditor('nil foo');
      setActiveEditor(editor);

      await executor.executeIt();

      const dc = lastDiagCollection();
      expect(dc.set).toHaveBeenCalled();
      const [, diags] = dc.set.mock.calls[0];
      expect(diags[0].message).toContain('does not understand');
    });

    it('maps multi-line code offset to correct editor line', async () => {
      const code = '| x |\nx := 42.\nx foo';
      // 'foo' starts at offset 18 in user code: "| x |\n" (6) + "x := 42.\n" (9) + "x " (2) + "f" = 17; 1-based = 18
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: {
          number: 1001,
          message: 'near source character 18',
        },
      });

      // Selection starts at line 3
      const sel = new vscode.Selection(new vscode.Position(3, 0), new vscode.Position(5, 5));
      const editor = makeEditor('line0\nline1\nline2\n| x |\nx := 42.\nx foo', sel);
      editor.document.getText = vi.fn(() => code);
      setActiveEditor(editor);

      await executor.executeIt();

      const dc = lastDiagCollection();
      const [, diags] = dc.set.mock.calls[0];
      // 'foo' is at offset 17 (0-based) in user code, which is line 2 col 2
      // Editor line = selection start (3) + 2 = 5
      expect(diags[0].range.start.line).toBe(5);
      expect(diags[0].range.start.character).toBe(2);
    });

    it('registers cleanup listener that clears diagnostics on document edit', async () => {
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: { number: 1001, message: 'compile error' },
      });

      const editor = makeEditor('bad');
      setActiveEditor(editor);

      await executor.executeIt();

      expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalled();
    });
  });

  // ── Execute It / Display It basic flow ─────────────────────

  describe('executeIt', () => {
    it('sends user code with single quotes unescaped to GemStone', async () => {
      const code = "UserGlobals at: #'James' put: 'Foster'.";
      const editor = makeEditor(code);
      setActiveEditor(editor);

      await executor.executeIt();

      const wrappedCode = (gci.GciTsNbExecute as Mock).mock.calls[0][1] as string;
      expect(wrappedCode).toContain("UserGlobals at: #'James' put: 'Foster'.");
      expect(wrappedCode).not.toContain("''James''");
      expect(wrappedCode).not.toContain("''Foster''");
    });

    it('runs with the transcript sink live, restoring buffered mode after', async () => {
      setActiveEditor(makeEditor('3 + 4'));

      await executor.executeIt();

      const sinkCalls = (gci.executeAndFetchString as Mock).mock.calls
        .map((c) => c[1] as string)
        .filter((code) => code.includes('jasperLive:'));
      expect(sinkCalls.some((code) => code.includes('jasperLive: true'))).toBe(true);
      expect(sinkCalls.some((code) => code.includes('jasperLive: false'))).toBe(true);
    });

    it('restores buffered mode even when the execution errors', async () => {
      (gci.GciTsNbResult as Mock).mockReturnValue({
        result: 0x01n,
        err: {
          number: 2003,
          message: 'a UndefinedObject does not understand #foo',
          context: OOP_NIL,
        },
      });
      setActiveEditor(makeEditor('nil foo'));

      await executor.executeIt();

      const sinkCalls = (gci.executeAndFetchString as Mock).mock.calls.map((c) => c[1] as string);
      expect(sinkCalls.some((code) => code.includes('jasperLive: false'))).toBe(true);
    });

    it('streams a mid-execution Transcript write to the channel and resumes to the result', async () => {
      // First NbResult: a forwarder send (error 2336) carrying 'live text';
      // ContinueWithAsync then completes with the real result.
      (gci.GciTsNbResult as Mock).mockReturnValue({
        result: 0x01n,
        err: {
          number: 2336,
          context: 0x999n,
          argCount: 4,
          args: [0x10n, 0x11n, 0x12n, 0x13n],
          message: 'clientForwarderSend',
        },
      });
      (gci as Record<string, unknown>).GciTsOopToI64 = vi.fn(() => ({
        success: true,
        value: 2n,
        err: { number: 0 },
      }));
      (gci as Record<string, unknown>).GciTsFetchUtf8 = vi.fn((_h: unknown, oop: bigint) =>
        oop === 0x12n
          ? { data: 'nextPutAll:', err: { number: 0 } }
          : { data: 'live text', err: { number: 0 } },
      );
      (gci as Record<string, unknown>).GciTsFetchOops = vi.fn(() => ({
        result: 1,
        oops: [0x77n],
        err: { number: 0 },
      }));
      (gci as Record<string, unknown>).GciTsContinueWithAsync = vi.fn(async () => ({
        result: 200n,
        err: { number: 0, context: 0n },
      }));
      setActiveEditor(makeEditor("Transcript show: 'live text'. 3 + 4"));

      await executor.executeIt();

      expect(appendTranscriptOutput).toHaveBeenCalledWith('live text');
      expect((gci as Record<string, unknown>).GciTsContinueWithAsync).toHaveBeenCalledTimes(1);
      // The execution completed normally — no error dialog, no diagnostic.
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
  });

  describe('displayIt', () => {
    it('sends user code with single quotes unescaped to GemStone', async () => {
      const code = "'hello' reversed";
      const editor = makeEditor(code);
      setActiveEditor(editor);

      await executor.displayIt();

      const wrappedCode = (gci.GciTsNbExecute as Mock).mock.calls[0][1] as string;
      expect(wrappedCode).toContain("'hello' reversed");
    });

    it('runs interpreted (native code off) so a halt would be steppable', async () => {
      const editor = makeEditor("'hello' reversed");
      setActiveEditor(editor);

      await executor.displayIt();

      const flags = (gci.GciTsNbExecute as Mock).mock.calls[0][5] as number;
      expect(flags & GCI_PERFORM_FLAG_INTERPRETED).toBe(GCI_PERFORM_FLAG_INTERPRETED);
    });
  });

  // ── Debug It ───────────────────────────────────────────────
  //
  // Debug It runs the selection with the single-step flag so the server breaks
  // on the FIRST statement, and opens the Enhanced debugger directly on that
  // halt. Two things make stepping actually work and must not regress:
  //   1. the single-step flag is OR'd into the exec flags (display/execute must
  //      NOT set it), and
  //   2. the RAW selection is sent — no transcript-capture wrapper — so the
  //      halt lands on the user's code, not the wrapper's outer block.

  describe('debugIt', () => {
    /** The flags argument (param 5) of the most recent GciTsNbExecute call. */
    function lastExecFlags(): number {
      const calls = (gci.GciTsNbExecute as Mock).mock.calls;
      return calls[calls.length - 1][5] as number;
    }
    /** The code argument (param 1) of the most recent GciTsNbExecute call. */
    function lastExecCode(): string {
      const calls = (gci.GciTsNbExecute as Mock).mock.calls;
      return calls[calls.length - 1][1] as string;
    }

    it('sets the single-step flag so the server breaks on the first statement', async () => {
      setActiveEditor(makeEditor('Array new add: 1; add: 2'));

      await executor.debugIt();

      expect(lastExecFlags()).toBe(
        GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED | GCI_PERFORM_FLAG_SINGLE_STEP,
      );
    });

    it('does NOT set the single-step flag for Execute It or Display It', async () => {
      setActiveEditor(makeEditor('Array new add: 1; add: 2'));
      await executor.executeIt();
      expect(lastExecFlags()).toBe(GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED);
      expect(lastExecFlags() & GCI_PERFORM_FLAG_SINGLE_STEP).toBe(0);

      (gci.GciTsNbExecute as Mock).mockClear();
      setActiveEditor(makeEditor('3 + 4'));
      await executor.displayIt();
      expect(lastExecFlags()).toBe(GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED);
      expect(lastExecFlags() & GCI_PERFORM_FLAG_SINGLE_STEP).toBe(0);
    });

    it('runs the RAW selection so the halt lands on user code', async () => {
      const code = 'Array new add: 1; add: 2';
      setActiveEditor(makeEditor(code));

      await executor.debugIt();

      expect(lastExecCode()).toBe(code);
    });

    it('Execute It also runs the raw selection (transcript arrives via the sink, not a wrapper)', async () => {
      const code = 'Array new add: 1; add: 2';
      setActiveEditor(makeEditor(code));

      await executor.executeIt();

      expect(lastExecCode()).toBe(code);
    });
  });

  // ── Debug It opens the Enhanced debugger directly on a halt ──
  //
  // Unlike Execute It (which prompts the user to pick a debugger on an error),
  // Debug It's halt is an intentional first-statement stop, so it opens the
  // Enhanced debugger straight away — no modal chooser, no DAP, and it must NOT
  // clear the stack (the panel owns the suspended process).

  describe('debugIt opens the Enhanced debugger on the first-statement halt', () => {
    function debuggableGci() {
      // Non-nil context (≠ OOP_NIL) makes fetchResultOop throw a DebuggableError,
      // exactly as the single-step breakpoint would on the server.
      return makeGci({
        GciTsNbResult: vi.fn(() => ({
          result: 0x01n,
          err: { number: 6001, message: 'halt at step 1', context: 0x123n },
        })),
      });
    }

    function setup() {
      gci = debuggableGci();
      session = makeSession(gci);
      executor = new CodeExecutor(makeSessionManager(session));
      setActiveEditor(makeEditor('Array new add: 1; add: 2'));
    }

    it('opens the Enhanced Debugger panel directly, with no completion callback', async () => {
      setup();

      await executor.debugIt();

      // 3 args: no onComplete (Debug It is silent on resume-to-completion).
      expect(DebuggerPanel.create).toHaveBeenCalledWith(session, 0x123n, 'Debug It');
    });

    it('does NOT show the debugger chooser prompt or start the DAP debugger', async () => {
      setup();

      await executor.debugIt();

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
    });

    it('does NOT clear the stack — the Enhanced debugger owns the suspended process', async () => {
      setup();

      await executor.debugIt();

      expect(gci.GciTsClearStack).not.toHaveBeenCalled();
    });

    it('clears the stack if the Enhanced Debugger panel fails to open', async () => {
      setup();
      vi.mocked(DebuggerPanel.create).mockImplementationOnce(() => {
        throw new Error('panel boom');
      });

      await executor.debugIt();

      // Nothing owns the process when the panel throws, so it must be released.
      expect(gci.GciTsClearStack).toHaveBeenCalledWith(session.handle, 0x123n);
    });
  });

  // ── Display It: select inserted result so backspace removes it ───
  //
  // After Display It, the inserted ` ${result}` text should be the editor's
  // active selection so that a single Backspace press (Smalltalk workspace
  // convention) deletes the result. The selection anchor is placed at the
  // end of the user code; the active position is past the inserted result.

  describe('displayIt result selection', () => {
    // These tests cover the classic "insert" mode, which is no longer the
    // default — opt in explicitly.
    beforeEach(() => {
      setDisplayItMode('insert');
    });

    it('selects the inserted result (including leading space)', async () => {
      (gci.executeAndFetchString as Mock).mockReturnValue('42');

      const userCode = '3 + 4';
      const sel = new vscode.Selection(
        new vscode.Position(0, 0),
        new vscode.Position(0, userCode.length),
      );
      const editor = makeMutableEditor(userCode, sel);
      setActiveEditor(editor);

      await executor.displayIt();

      // Selection anchor stays at end of user code; active extends past " 42"
      expect(editor.selection.anchor.line).toBe(0);
      expect(editor.selection.anchor.character).toBe(userCode.length);
      expect(editor.selection.active.line).toBe(0);
      expect(editor.selection.active.character).toBe(userCode.length + ' 42'.length);

      // And the document was actually mutated to include the result
      expect(editor.document.getText()).toBe('3 + 4 42');
    });

    it('selection spans exactly the inserted text so backspace removes it cleanly', async () => {
      (gci.executeAndFetchString as Mock).mockReturnValue("'hello'");

      const userCode = "'hi'";
      const editor = makeMutableEditor(userCode);
      setActiveEditor(editor);

      await executor.displayIt();

      // The text covered by the selection should be exactly ` ${result}`
      const doc = editor.document.getText();
      const startOff = editor.document.offsetAt(editor.selection.start);
      const endOff = editor.document.offsetAt(editor.selection.end);
      expect(doc.slice(startOff, endOff)).toBe(" 'hello'");
    });

    it('places selection correctly when user code is on a non-first line', async () => {
      (gci.executeAndFetchString as Mock).mockReturnValue('7');

      const text = 'line0\n3 + 4\nline2';
      const sel = new vscode.Selection(new vscode.Position(1, 0), new vscode.Position(1, 5));
      const editor = makeMutableEditor(text, sel);
      // Real VSCode's getText(selection) returns only the selected substring
      editor.document.getText = vi.fn(() => '3 + 4');
      setActiveEditor(editor);

      await executor.displayIt();

      expect(editor.selection.anchor.line).toBe(1);
      expect(editor.selection.anchor.character).toBe(5);
      expect(editor.selection.active.line).toBe(1);
      expect(editor.selection.active.character).toBe(5 + ' 7'.length);
    });

    it('does not modify selection on Execute It (no result inserted)', async () => {
      const userCode = '3 + 4';
      const originalSel = new vscode.Selection(
        new vscode.Position(0, 0),
        new vscode.Position(0, userCode.length),
      );
      const editor = makeMutableEditor(userCode, originalSel);
      setActiveEditor(editor);

      await executor.executeIt();

      // Execute It must NOT touch the selection
      expect(editor.selection).toBe(originalSel);
      // And must not mutate the document
      expect(editor.document.getText()).toBe(userCode);
    });

    it('does not change selection when Display It fails with a compile error', async () => {
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: { number: 1001, message: 'a CompileError occurred' },
      });

      const userCode = 'bad syntax';
      const originalSel = new vscode.Selection(
        new vscode.Position(0, 0),
        new vscode.Position(0, userCode.length),
      );
      const editor = makeMutableEditor(userCode, originalSel);
      setActiveEditor(editor);

      await executor.displayIt();

      expect(editor.selection).toBe(originalSel);
      expect(editor.document.getText()).toBe(userCode);
    });

    it('applies the result decoration to the inserted result range', async () => {
      (gci.executeAndFetchString as Mock).mockReturnValue('42');

      const userCode = '3 + 4';
      const editor = makeMutableEditor(userCode);
      setActiveEditor(editor);

      await executor.displayIt();

      // setDecorations is called for: dim-on, dim-off, and result-decoration.
      // Find the call whose range covers exactly the inserted result string
      // (without the leading space — the decoration highlights the value).
      const calls = editor.setDecorations.mock.calls as [unknown, vscode.Range[]][];
      const decoCall = calls.find(
        ([, ranges]) =>
          ranges.length === 1 &&
          ranges[0].start.character === userCode.length + 1 &&
          ranges[0].end.character === userCode.length + 1 + '42'.length,
      );
      expect(decoCall).toBeDefined();
    });
  });

  // ── Display It: non-destructive overlay mode (default) ─────
  //
  // In overlay mode the result is shown as an after-line decoration and the
  // document is never modified. A hover exposes Copy and Expand actions.

  describe('displayIt overlay mode', () => {
    function mockResult(value: string): void {
      (gci.executeAndFetchString as Mock).mockReturnValue(value);
    }

    /** The decoration options passed to the last after-content setDecorations call. */
    function lastOverlayDecoration(
      editor: ReturnType<typeof makeEditor> | ReturnType<typeof makeMutableEditor>,
    ) {
      const calls = editor.setDecorations.mock.calls as [unknown, unknown[]][];
      const overlayCall = [...calls]
        .reverse()
        .find(
          ([, opts]) =>
            Array.isArray(opts) &&
            opts.length === 1 &&
            (opts[0] as { renderOptions?: { after?: { contentText?: string } } }).renderOptions
              ?.after?.contentText !== undefined,
        );
      return overlayCall?.[1][0] as
        | {
            range: vscode.Range;
            hoverMessage: { value: string; isTrusted?: boolean };
            renderOptions: { after: { contentText: string } };
          }
        | undefined;
    }

    it('does not modify the document', async () => {
      mockResult('42');
      const userCode = '3 + 4';
      const editor = makeMutableEditor(userCode);
      setActiveEditor(editor);

      await executor.displayIt();

      expect(editor.document.getText()).toBe(userCode);
    });

    it('does not insert text or move the selection', async () => {
      mockResult('42');
      const userCode = '3 + 4';
      const sel = new vscode.Selection(
        new vscode.Position(0, 0),
        new vscode.Position(0, userCode.length),
      );
      const editor = makeMutableEditor(userCode, sel);
      setActiveEditor(editor);

      await executor.displayIt();

      expect(editor.edit).not.toHaveBeenCalled();
      expect(editor.selection).toBe(sel);
    });

    it('renders the result as an after-content overlay decoration', async () => {
      mockResult('42');
      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      await executor.displayIt();

      const deco = lastOverlayDecoration(editor);
      expect(deco).toBeDefined();
      expect(deco!.renderOptions.after.contentText).toContain('42');
    });

    it('flattens newlines and truncates long results in the inline preview', async () => {
      const long = 'line one\n' + 'x'.repeat(200);
      mockResult(long);
      const editor = makeEditor('aCollection');
      setActiveEditor(editor);

      await executor.displayIt();

      const text = lastOverlayDecoration(editor)!.renderOptions.after.contentText;
      expect(text).not.toContain('\n');
      expect(text).toContain('⏎');
      expect(text).toContain('…');
      expect(text.length).toBeLessThan(120);
    });

    it('attaches a trusted hover with Copy and Expand command links', async () => {
      mockResult("'the full value'");
      const editor = makeEditor("'x'");
      setActiveEditor(editor);

      await executor.displayIt();

      const hover = lastOverlayDecoration(editor)!.hoverMessage;
      expect(hover.isTrusted).toBe(true);
      expect(hover.value).toContain("'the full value'");
      expect(hover.value).toContain('command:gemstone.copyDisplayItResult');
      expect(hover.value).toContain('command:gemstone.outputDisplayItResult');
    });

    it('copyLastResult writes the full result to the clipboard', async () => {
      mockResult('a multi\nline\nresult');
      const editor = makeEditor('foo');
      setActiveEditor(editor);

      await executor.displayIt();
      await executor.copyLastResult();

      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('a multi\nline\nresult');
    });

    it('outputLastResult sends the full result to the Output panel', async () => {
      mockResult('a multi\nline\nresult');
      const editor = makeEditor('foo');
      setActiveEditor(editor);

      await executor.displayIt();
      executor.outputLastResult();

      expect(appendTranscript).toHaveBeenCalledWith('a multi\nline\nresult');
      expect(showTranscript).toHaveBeenCalled();
    });

    it('copyLastResult is a no-op (no clipboard write) when there is no result yet', async () => {
      await executor.copyLastResult();
      expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('activates the dismiss context while the overlay is shown', async () => {
      mockResult('42');
      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      await executor.displayIt();

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'setContext',
        'gemstone.displayResultVisible',
        true,
      );
    });

    it('dismissDisplayResult clears the overlay and context without editing the document', async () => {
      mockResult('42');
      const editor = makeMutableEditor('3 + 4');
      setActiveEditor(editor);

      await executor.displayIt();
      editor.setDecorations.mockClear();
      (vscode.commands.executeCommand as Mock).mockClear();

      executor.dismissDisplayResult();

      // Overlay decoration cleared (last setDecorations call passes an empty array)
      const lastDeco = editor.setDecorations.mock.calls.at(-1);
      expect(lastDeco?.[1]).toEqual([]);
      // Context released
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'setContext',
        'gemstone.displayResultVisible',
        false,
      );
      // Document untouched
      expect(editor.edit).not.toHaveBeenCalled();
      expect(editor.document.getText()).toBe('3 + 4');
    });

    it('expandResultInPlace inserts the FULL result (not the preview) and clears the overlay', async () => {
      // Multi-line result: the inline preview is flattened, but the in-place
      // expansion must insert the real multi-line value.
      const full = 'a\nb\nc';
      mockResult(full);
      const userCode = '3 + 4';
      const editor = makeMutableEditor(userCode);
      setActiveEditor(editor);

      await executor.displayIt();
      await executor.expandResultInPlace();

      expect(editor.document.getText()).toBe('3 + 4 a\nb\nc');
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'setContext',
        'gemstone.displayResultVisible',
        false,
      );
    });

    it('expandResultInPlace is a no-op when no overlay is showing', async () => {
      const editor = makeMutableEditor('3 + 4');
      setActiveEditor(editor);

      await executor.expandResultInPlace();

      expect(editor.edit).not.toHaveBeenCalled();
      expect(editor.document.getText()).toBe('3 + 4');
    });

    it('releases the dismiss context even if clearing the decoration throws (closed editor)', async () => {
      mockResult('42');
      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      await executor.displayIt();

      // Simulate the overlay editor having been disposed (e.g. its file was
      // closed): setDecorations now throws when we try to clear the overlay.
      editor.setDecorations.mockImplementation(() => {
        throw new Error('TextEditor disposed');
      });
      (vscode.commands.executeCommand as Mock).mockClear();

      // Must not propagate the error...
      expect(() => executor.dismissDisplayResult()).not.toThrow();
      // ...and must still release the context key.
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'setContext',
        'gemstone.displayResultVisible',
        false,
      );
    });

    it('anchors the overlay on the selection end when code is on a non-first line', async () => {
      mockResult('7');
      const text = 'line0\n3 + 4\nline2';
      const sel = new vscode.Selection(new vscode.Position(1, 0), new vscode.Position(1, 5));
      const editor = makeMutableEditor(text, sel);
      // Real VSCode's getText(selection) returns only the selected substring
      editor.document.getText = vi.fn(() => '3 + 4');
      setActiveEditor(editor);

      await executor.displayIt();

      const deco = lastOverlayDecoration(editor);
      expect(deco).toBeDefined();
      // Anchored on the last character of the selection: line 1, chars 4–5
      expect(deco!.range.start.line).toBe(1);
      expect(deco!.range.start.character).toBe(4);
      expect(deco!.range.end.line).toBe(1);
      expect(deco!.range.end.character).toBe(5);
      expect(deco!.renderOptions.after.contentText).toContain('7');
    });

    it('shows no overlay and never activates the context on a compile error', async () => {
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: { number: 1001, message: 'a CompileError occurred' },
      });
      const editor = makeMutableEditor('bad syntax');
      setActiveEditor(editor);

      await executor.displayIt();

      // No after-content overlay decoration was rendered
      expect(lastOverlayDecoration(editor)).toBeUndefined();
      // The dismiss context was never turned on, so Backspace/Enter/Ctrl+Z
      // are not hijacked after a failed Display It
      expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
        'setContext',
        'gemstone.displayResultVisible',
        true,
      );
      // And nothing was inserted into the document
      expect(editor.document.getText()).toBe('bad syntax');
    });
  });

  // ── Code selection handling (mode-independent) ────────────
  //
  // Selecting nothing executes/displays the whole current line; selecting
  // text executes/displays only that text. This happens upstream of the
  // display branch, so it must hold in both overlay and insert mode.

  describe('code selection handling', () => {
    for (const mode of ['overlay', 'insert'] as const) {
      describe(`${mode} mode`, () => {
        beforeEach(() => {
          setDisplayItMode(mode);
          (gci.executeAndFetchString as Mock).mockReturnValue('42');
        });

        it('executes the whole current line when the selection is empty', async () => {
          const text = 'line0\n3 + 4\nline2';
          // Collapsed (empty) caret on line 1
          const caret = new vscode.Selection(new vscode.Position(1, 2), new vscode.Position(1, 2));
          const editor = makeMutableEditor(text, caret);
          setActiveEditor(editor);

          await executor.displayIt();

          // getText was asked for the full line range, not the empty caret
          const arg = (editor.document.getText as Mock).mock.calls[0][0];
          expect(arg.start.line).toBe(1);
          expect(arg.start.character).toBe(0);
          expect(arg.end.line).toBe(1);
          expect(arg.end.character).toBe('3 + 4'.length);
        });

        it('executes only the selected text when a selection is present', async () => {
          const text = 'line0\n3 + 4\nline2';
          const sel = new vscode.Selection(new vscode.Position(1, 0), new vscode.Position(1, 5));
          const editor = makeMutableEditor(text, sel);
          setActiveEditor(editor);

          await executor.displayIt();

          // getText was called with the exact selection (not the whole document)
          const arg = (editor.document.getText as Mock).mock.calls[0][0];
          expect(arg).toBe(sel);
        });
      });
    }
  });

  // ── Execution busy-state indicators ───────────────────────

  describe('execution busy-state indicators', () => {
    it('sets gemstone.executing context to true on start and false on finish', async () => {
      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      await executor.executeIt();

      const calls = vi
        .mocked(vscode.commands.executeCommand)
        .mock.calls.filter(([cmd]) => cmd === 'setContext');
      // First call: set to true, last call: set to false
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls[0]).toEqual(['setContext', 'gemstone.executing', true]);
      expect(calls[calls.length - 1]).toEqual(['setContext', 'gemstone.executing', false]);
    });

    it('shows status bar spinner during execution', async () => {
      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      const statusBar = vi.mocked(vscode.window.createStatusBarItem).mock.results[0].value;

      await executor.executeIt();

      expect(statusBar.show).toHaveBeenCalled();
      expect(statusBar.hide).toHaveBeenCalled();
    });

    it('applies dim decoration to selection during execution', async () => {
      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      await executor.executeIt();

      // setDecorations is called at least twice: once to dim, once to clear
      const calls = editor.setDecorations.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      // First call applies the executing decoration (non-empty ranges)
      expect(calls[0][1].length).toBe(1);
      // A later call clears it (empty array)
      const clearCall = (calls as [unknown, unknown[]][]).find(
        (c) => (c[1].length === 0 && c[0] !== calls[calls.length - 1][0]) || c[1].length === 0,
      );
      expect(clearCall).toBeDefined();
    });

    it('clears dim decoration and context even when execution errors', async () => {
      (gci.GciTsNbResult as Mock).mockReturnValue({
        result: 0x01n,
        err: {
          number: 2003,
          message: 'a UndefinedObject does not understand #foo',
          context: OOP_NIL,
        },
      });

      const editor = makeEditor('nil foo');
      setActiveEditor(editor);

      await executor.executeIt();

      // Context should be reset to false
      const setCalls = vi
        .mocked(vscode.commands.executeCommand)
        .mock.calls.filter(([cmd]) => cmd === 'setContext');
      const lastCall = setCalls[setCalls.length - 1];
      expect(lastCall).toEqual(['setContext', 'gemstone.executing', false]);

      // Dim decoration should be cleared
      const clearCall = (editor.setDecorations.mock.calls as [unknown, unknown[]][]).find(
        (c) => c[1].length === 0,
      );
      expect(clearCall).toBeDefined();
    });

    it('sets context for inspectIt and clears on completion', async () => {
      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      const inspectorProvider = {
        addRoot: vi.fn(),
        findRootByLabel: vi.fn(),
      };

      await executor.inspectIt(
        inspectorProvider as unknown as import('../inspectorTreeProvider').InspectorTreeProvider,
      );

      const calls = vi
        .mocked(vscode.commands.executeCommand)
        .mock.calls.filter(([cmd]) => cmd === 'setContext');
      expect(calls[0]).toEqual(['setContext', 'gemstone.executing', true]);
      expect(calls[calls.length - 1]).toEqual(['setContext', 'gemstone.executing', false]);
    });

    it('opens the result in an enhanced inspector when the session has one', async () => {
      session.enhancedInspectorAvailable = true;
      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      const inspectorProvider = { addRoot: vi.fn(), findRootByLabel: vi.fn() };
      await executor.inspectIt(
        inspectorProvider as unknown as import('../inspectorTreeProvider').InspectorTreeProvider,
      );

      expect(EnhancedInspector.create).toHaveBeenCalledWith(session, 200n, '3 + 4');
      expect(inspectorProvider.addRoot).not.toHaveBeenCalled();
    });

    it('opens the result in the sidebar Inspector when the session has no enhanced inspector', async () => {
      session.enhancedInspectorAvailable = false;
      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      const inspectorProvider = { addRoot: vi.fn(), findRootByLabel: vi.fn() };
      await executor.inspectIt(
        inspectorProvider as unknown as import('../inspectorTreeProvider').InspectorTreeProvider,
      );

      expect(inspectorProvider.addRoot).toHaveBeenCalledWith(1, 200n, '3 + 4');
      expect(EnhancedInspector.create).not.toHaveBeenCalled();
    });

    // The dim decoration is applied before setExecuting(true) so that if anything
    // between decoration and the try block throws, the session is not left stuck.
    it('applies dim decoration before setting gemstone.executing context (executeIt)', async () => {
      const callOrder: string[] = [];
      const editor = makeEditor('3 + 4');
      (editor.setDecorations as ReturnType<typeof vi.fn>).mockImplementation(
        (_type: unknown, ranges: unknown[]) => {
          if (ranges.length > 0) callOrder.push('decoration:apply');
        },
      );
      vi.mocked(vscode.commands.executeCommand).mockImplementation(
        async (cmd: string, ...args: unknown[]) => {
          if (cmd === 'setContext' && args[0] === 'gemstone.executing' && args[1] === true) {
            callOrder.push('executing:true');
          }
          return undefined;
        },
      );
      setActiveEditor(editor);

      await executor.executeIt();

      expect(callOrder.indexOf('decoration:apply')).toBeLessThan(
        callOrder.indexOf('executing:true'),
      );
    });

    it('applies dim decoration before setting gemstone.executing context (inspectIt)', async () => {
      const callOrder: string[] = [];
      const editor = makeEditor('3 + 4');
      (editor.setDecorations as ReturnType<typeof vi.fn>).mockImplementation(
        (_type: unknown, ranges: unknown[]) => {
          if (ranges.length > 0) callOrder.push('decoration:apply');
        },
      );
      vi.mocked(vscode.commands.executeCommand).mockImplementation(
        async (cmd: string, ...args: unknown[]) => {
          if (cmd === 'setContext' && args[0] === 'gemstone.executing' && args[1] === true) {
            callOrder.push('executing:true');
          }
          return undefined;
        },
      );
      setActiveEditor(editor);

      const inspectorProvider = { addRoot: vi.fn(), findRootByLabel: vi.fn() };
      await executor.inspectIt(
        inspectorProvider as unknown as import('../inspectorTreeProvider').InspectorTreeProvider,
      );

      expect(callOrder.indexOf('decoration:apply')).toBeLessThan(
        callOrder.indexOf('executing:true'),
      );
    });

    it('does not set gemstone.executing when the Utf8 class oop cannot be resolved (executeIt)', async () => {
      (gci.utf8ClassOop as Mock).mockImplementation(() => {
        throw new Error('cannot resolve Utf8');
      });

      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      await expect(executor.executeIt()).rejects.toThrow('cannot resolve Utf8');

      const setCalls = vi
        .mocked(vscode.commands.executeCommand)
        .mock.calls.filter(([cmd, key]) => cmd === 'setContext' && key === 'gemstone.executing');
      expect(setCalls.some(([, , value]) => value === true)).toBe(false);
    });

    it('does not set gemstone.executing when the Utf8 class oop cannot be resolved (inspectIt)', async () => {
      (gci.utf8ClassOop as Mock).mockImplementation(() => {
        throw new Error('cannot resolve Utf8');
      });

      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      const inspectorProvider = { addRoot: vi.fn(), findRootByLabel: vi.fn() };
      await expect(
        executor.inspectIt(
          inspectorProvider as unknown as import('../inspectorTreeProvider').InspectorTreeProvider,
        ),
      ).rejects.toThrow('cannot resolve Utf8');

      const setCalls = vi
        .mocked(vscode.commands.executeCommand)
        .mock.calls.filter(([cmd, key]) => cmd === 'setContext' && key === 'gemstone.executing');
      expect(setCalls.some(([, , value]) => value === true)).toBe(false);
    });

    it('clears gemstone.executing after a GciTsNbExecute start failure (executeIt)', async () => {
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: { number: 1001, message: 'a CompileError occurred (error 1001), expected expression' },
      });

      const editor = makeEditor('bad syntax');
      setActiveEditor(editor);

      await executor.executeIt();

      const setCalls = vi
        .mocked(vscode.commands.executeCommand)
        .mock.calls.filter(([cmd, key]) => cmd === 'setContext' && key === 'gemstone.executing');
      expect(setCalls.length).toBeGreaterThanOrEqual(2);
      expect(setCalls[setCalls.length - 1][2]).toBe(false);
    });

    it('clears gemstone.executing after a GciTsNbExecute start failure (inspectIt)', async () => {
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: { number: 1001, message: 'Execution failed to start' },
      });

      const editor = makeEditor('bad syntax');
      setActiveEditor(editor);

      const inspectorProvider = { addRoot: vi.fn(), findRootByLabel: vi.fn() };
      await executor.inspectIt(
        inspectorProvider as unknown as import('../inspectorTreeProvider').InspectorTreeProvider,
      );

      const setCalls = vi
        .mocked(vscode.commands.executeCommand)
        .mock.calls.filter(([cmd, key]) => cmd === 'setContext' && key === 'gemstone.executing');
      expect(setCalls.length).toBeGreaterThanOrEqual(2);
      expect(setCalls[setCalls.length - 1][2]).toBe(false);
    });
  });

  // ── Debuggable error dialog must be modal ──────────────────
  //
  // When execution raises a DebuggableError, we prompt the user with a
  // "Debug" choice. That prompt MUST be modal — a non-modal
  // toast would be easy to miss and would let the stalled GemStone process
  // linger unnoticed. These tests guard the `{ modal: true }` option.

  describe('debuggable error dialog is modal', () => {
    function debuggableGci() {
      // Non-nil context (≠ OOP_NIL) makes fetchResultOop throw a DebuggableError.
      return makeGci({
        GciTsNbResult: vi.fn(() => ({
          result: 0x01n,
          err: {
            number: 2003,
            message: 'a UndefinedObject does not understand #foo',
            context: 0x123n,
          },
        })),
      });
    }

    /** The options object passed as the 2nd arg of the most recent showErrorMessage call. */
    function lastErrorMessageOptions() {
      const calls = vi.mocked(vscode.window.showErrorMessage).mock.calls;
      return calls[calls.length - 1][1] as { modal?: boolean } | undefined;
    }

    it('shows a modal dialog when Execute It raises a DebuggableError', async () => {
      gci = debuggableGci();
      session = makeSession(gci);
      executor = new CodeExecutor(makeSessionManager(session));

      const editor = makeEditor('nil foo');
      setActiveEditor(editor);

      await executor.executeIt();

      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
      expect(lastErrorMessageOptions()).toEqual({ modal: true });
    });

    it('offers Debug in the modal dialog on Execute It', async () => {
      gci = debuggableGci();
      session = makeSession(gci);
      executor = new CodeExecutor(makeSessionManager(session));

      const editor = makeEditor('nil foo');
      setActiveEditor(editor);

      await executor.executeIt();

      const calls = vi.mocked(vscode.window.showErrorMessage).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall.slice(2)).toEqual(['Enhanced Debug', 'Debug']);
    });

    it('shows a modal dialog when Inspect It raises a DebuggableError', async () => {
      gci = debuggableGci();
      session = makeSession(gci);
      executor = new CodeExecutor(makeSessionManager(session));

      const editor = makeEditor('nil foo');
      setActiveEditor(editor);

      const inspectorProvider = {
        addRoot: vi.fn(),
        findRootByLabel: vi.fn(),
      };

      await executor.inspectIt(
        inspectorProvider as unknown as import('../inspectorTreeProvider').InspectorTreeProvider,
      );

      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
      expect(lastErrorMessageOptions()).toEqual({ modal: true });
    });

    it('offers Debug in the modal dialog on Inspect It', async () => {
      gci = debuggableGci();
      session = makeSession(gci);
      executor = new CodeExecutor(makeSessionManager(session));

      const editor = makeEditor('nil foo');
      setActiveEditor(editor);

      const inspectorProvider = {
        addRoot: vi.fn(),
        findRootByLabel: vi.fn(),
      };

      await executor.inspectIt(
        inspectorProvider as unknown as import('../inspectorTreeProvider').InspectorTreeProvider,
      );

      const calls = vi.mocked(vscode.window.showErrorMessage).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall.slice(2)).toEqual(['Enhanced Debug', 'Debug']);
    });
  });

  // ── Reveal the Run and Debug view when debugging starts ────
  //
  // After the user clicks "Debug", the debug session attaches but VSCode does
  // not switch to the Run and Debug view on its own, so the call stack lands
  // in a hidden view and the session looks like it did nothing. We explicitly
  // reveal the view via the workbench.view.debug command. Dismissing the
  // dialog must NOT reveal the view and must clear the stalled GsProcess.

  describe('reveals the Run and Debug view on Debug', () => {
    function debuggableGci() {
      return makeGci({
        GciTsNbResult: vi.fn(() => ({
          result: 0x01n,
          err: {
            number: 2003,
            message: 'a UndefinedObject does not understand #foo',
            context: 0x123n,
          },
        })),
      });
    }

    function setup() {
      gci = debuggableGci();
      session = makeSession(gci);
      executor = new CodeExecutor(makeSessionManager(session));
      const editor = makeEditor('nil foo');
      setActiveEditor(editor);
    }

    function revealedView(): boolean {
      return vi
        .mocked(vscode.commands.executeCommand)
        .mock.calls.some(([cmd]) => cmd === 'workbench.view.debug');
    }

    it('starts debugging and focuses the Run and Debug view when the user clicks Debug', async () => {
      vi.mocked(vscode.window.showErrorMessage).mockResolvedValue('Debug' as never);
      vi.mocked(vscode.debug.startDebugging).mockResolvedValue(true);
      setup();

      await executor.executeIt();

      expect(vscode.debug.startDebugging).toHaveBeenCalled();
      const config = vi.mocked(vscode.debug.startDebugging).mock.calls[0][1] as unknown as {
        type: string;
        gsProcess: string;
        sessionId: number;
      };
      expect(config.type).toBe('gemstone');
      expect(config.sessionId).toBe(session.id);
      expect(config.gsProcess).toBe(0x123n.toString());
      expect(revealedView()).toBe(true);
    });

    it('does not reveal the view or start debugging, and clears the stack, when the dialog is dismissed', async () => {
      vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
      setup();

      await executor.executeIt();

      expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
      expect(revealedView()).toBe(false);
      // The stalled GsProcess must be released so it does not linger.
      expect(gci.GciTsClearStack).toHaveBeenCalledWith(session.handle, 0x123n);
    });

    it('opens the Enhanced Debugger panel (and not the DAP debugger) when the user clicks Enhanced Debug', async () => {
      vi.mocked(vscode.window.showErrorMessage).mockResolvedValue('Enhanced Debug' as never);
      setup();

      await executor.executeIt();

      // The webview debugger owns the gsProcess for this error. Execute It is
      // intentionally silent, so no completion callback is passed.
      expect(DebuggerPanel.create).toHaveBeenCalledWith(
        session,
        0x123n,
        expect.any(String),
        undefined,
      );
      // The DAP path must not run, and the stack must NOT be cleared — the
      // panel now owns the suspended process.
      expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
      expect(revealedView()).toBe(false);
      expect(gci.GciTsClearStack).not.toHaveBeenCalled();
    });

    it('passes a completion callback to the Enhanced Debugger for a halted Display It', async () => {
      vi.mocked(vscode.window.showErrorMessage).mockResolvedValue('Enhanced Debug' as never);
      setup();

      await executor.displayIt();

      // Display It → on Resume/step-to-completion the result is rendered back in
      // the workspace, so a completion callback IS provided.
      expect(DebuggerPanel.create).toHaveBeenCalledWith(
        session,
        0x123n,
        expect.any(String),
        expect.any(Function),
      );
    });

    it('the Display It completion callback renders the result back in the workspace, refocusing the editor', async () => {
      vi.mocked(vscode.window.showErrorMessage).mockResolvedValue('Enhanced Debug' as never);
      setup();
      await executor.displayIt();

      // Invoke the captured callback exactly as the panel would on Resume/step-
      // to-completion. Rendering is deferred to the next tick (after the panel
      // disposes) and the editor is refocused first so the result's
      // Backspace/Enter keybindings (editorTextFocus) work.
      const onComplete = vi.mocked(DebuggerPanel.create).mock.calls.at(-1)![3] as (
        oop: bigint,
      ) => void;
      const editor = vscode.window.activeTextEditor as unknown as {
        setDecorations: ReturnType<typeof vi.fn>;
      };
      editor.setDecorations.mockClear();
      // showTextDocument resolves with the same editor (as it would for the same doc).
      vi.mocked(vscode.window.showTextDocument).mockResolvedValue(
        editor as unknown as vscode.TextEditor,
      );

      vi.useFakeTimers();
      try {
        onComplete(0x222n);
        await vi.runAllTimersAsync();
      } finally {
        vi.useRealTimers();
      }

      expect(vscode.window.showTextDocument).toHaveBeenCalled(); // editor refocused
      expect(editor.setDecorations).toHaveBeenCalled(); // result rendered into the workspace
    });
  });

  // ── Result polling: GciTsNbPoll (3.7+) vs GciTsSocket fallback (3.6.2) ──

  describe('result polling fallback for GemStone 3.6.2', () => {
    it('uses GciTsNbPoll when it is available (3.7+)', async () => {
      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      await executor.executeIt();

      expect(gci.GciTsNbPoll).toHaveBeenCalled();
      expect(gci.GciTsSocket).not.toHaveBeenCalled();
      expect(pollReadable).not.toHaveBeenCalled();
    });

    it('falls back to GciTsSocket + native poll when GciTsNbPoll is absent (3.6.2)', async () => {
      (gci.isAvailable as Mock).mockImplementation((name: string) => name !== 'GciTsNbPoll');

      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      await executor.executeIt();

      // Did not call the missing 3.7+ function...
      expect(gci.GciTsNbPoll).not.toHaveBeenCalled();
      // ...and instead polled the session socket fd.
      expect(gci.GciTsSocket).toHaveBeenCalledWith(session.handle);
      expect(pollReadable).toHaveBeenCalledWith(7, 0);
      // Execution still completed (result fetched).
      expect(gci.GciTsNbResult).toHaveBeenCalled();
    });

    it('reports an error when the session socket cannot be obtained on 3.6.2', async () => {
      (gci.isAvailable as Mock).mockImplementation((name: string) => name !== 'GciTsNbPoll');
      (gci.GciTsSocket as Mock).mockReturnValue({
        fd: -1,
        err: { number: 4100, message: 'no socket' },
      });

      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      await executor.executeIt();

      expect(pollReadable).not.toHaveBeenCalled();
      const dc = lastDiagCollection();
      expect(dc.set).toHaveBeenCalled();
      const [, diags] = dc.set.mock.calls[0];
      expect(diags[0].message).toContain('no socket');
    });
  });
});
