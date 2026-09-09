import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => {
  // The step point model reads source, offsets and selector ranges in ONE round
  // trip. These three stay as the knobs the tests turn, with the bundle built
  // from them, so a test still says "this method's source is X" and the args it
  // asserts on still arrive.
  const getMethodSource = vi.fn((..._args: unknown[]) => '');
  const getSourceOffsets = vi.fn((..._args: unknown[]) => [] as number[]);
  const getStepPointSelectorRanges = vi.fn((..._args: unknown[]) => [] as unknown[]);
  return {
    getMethodSource,
    getSourceOffsets,
    getStepPointSelectorRanges,
    getStepPointBundle: vi.fn((...args: unknown[]) => ({
      source: getMethodSource(...args),
      offsets: getSourceOffsets(...args),
      selectors: getStepPointSelectorRanges(...args),
    })),
    setBreakAtStepPoint: vi.fn(),
    clearBreakAtStepPoint: vi.fn(),
    disableBreakAtStepPoint: vi.fn(),
    clearAllBreaks: vi.fn(),
    enableAllBreakpoints: vi.fn(),
    disableAllBreakpoints: vi.fn(),
    removeAllBreakpoints: vi.fn(),
    breakpointByOop: vi.fn(),
  };
});

import {
  Uri,
  debug,
  window,
  workspace,
  Location,
  Position,
  SourceBreakpoint,
  FunctionBreakpoint,
} from '../__mocks__/vscode';
import type * as vscodeApi from 'vscode';
import * as vscode from 'vscode';
import { __resetConfig } from '../__mocks__/vscode';
import { BreakpointManager, conditionLabel } from '../breakpointManager';
import { METHOD_LANGUAGE, SMALLTALK_LANGUAGE } from '../languageIds';
import { SessionManager } from '../sessionManager';
import { StepPointModel, buildLineStarts } from '../stepPointModel';
import {
  getMethodSource,
  getSourceOffsets,
  setBreakAtStepPoint,
  disableBreakAtStepPoint,
  clearBreakAtStepPoint,
  clearAllBreaks,
  getStepPointBundle,
  enableAllBreakpoints,
  disableAllBreakpoints,
  removeAllBreakpoints,
  breakpointByOop,
} from '../browserQueries';

const mockGetMethodSource = vi.mocked(getMethodSource);
const mockGetSourceOffsets = vi.mocked(getSourceOffsets);
const mockSetBreakAtStepPoint = vi.mocked(setBreakAtStepPoint);
const mockClearAllBreaks = vi.mocked(clearAllBreaks);
const mockDisableBreakAtStepPoint = vi.mocked(disableBreakAtStepPoint);
const mockClearBreakAtStepPoint = vi.mocked(clearBreakAtStepPoint);
const mockEnableAll = vi.mocked(enableAllBreakpoints);
const mockDisableAll = vi.mocked(disableAllBreakpoints);
const mockRemoveAll = vi.mocked(removeAllBreakpoints);
const mockByOop = vi.mocked(breakpointByOop);

const METHOD_URI = 'gemstone://1/Globals/Array/instance/accessing/at%3A';

/** A manager wired to a real StepPointModel over the mocked queries. */
function makeManager(hasSession = true) {
  const sessionManager = makeSessionManager(hasSession);
  return new BreakpointManager(sessionManager, new StepPointModel(sessionManager));
}

function session() {
  return makeSessionManager(true).getSelectedSession()!;
}

const TEST_SESSION = {
  id: 1,
  gci: {},
  handle: 'h1',
  login: { label: 'Test' },
  stoneVersion: '3.7.2',
};

function makeSessionManager(hasSession: boolean) {
  return {
    getSelectedSession: vi.fn(() => (hasSession ? TEST_SESSION : undefined)),
    // pruneOrphans asks which sessions are logged in, to tell a live breakpoint
    // from one whose gem is gone.
    getSessions: vi.fn(() => (hasSession ? [TEST_SESSION] : [])),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;
}

describe('BreakpointManager', () => {
  beforeEach(() => {
    mockGetMethodSource.mockReset();
    mockGetSourceOffsets.mockReset();
    mockSetBreakAtStepPoint.mockReset();
    mockDisableBreakAtStepPoint.mockReset();
    mockClearAllBreaks.mockReset();
    debug.breakpoints = [];
    // Shared mock state: a dirty document left behind by one test makes the next
    // one's breakpoints be refused, which reads as an unrelated regression.
    workspace.textDocuments = [];
    vi.mocked(debug.addBreakpoints).mockClear();
    vi.mocked(debug.removeBreakpoints).mockClear();
  });

  describe('applyToUri', () => {
    it('returns unverified for a non-gemstone URI', () => {
      const results = makeManager().applyToUri(session(), Uri.parse('file:///test.tpz'), [
        { line: 1, enabled: true },
      ]);
      expect(results).toHaveLength(1);
      expect(results[0].verified).toBe(false);
    });

    it('sets a breakpoint per requested line and reports where each landed', () => {
      // GemStone _sourceOffsets are 1-based: step point 1 at source[0], 2 at source[11].
      mockGetMethodSource.mockReturnValue('at: index\n^self basicAt: index');
      mockGetSourceOffsets.mockReturnValue([1, 11]);

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 1, enabled: true },
        { line: 2, enabled: true },
      ]);

      expect(results).toEqual([
        { stepPoint: 1, actualLine: 1, verified: true },
        { stepPoint: 2, actualLine: 2, verified: true },
      ]);
      expect(mockClearAllBreaks).toHaveBeenCalledTimes(1);
      expect(mockSetBreakAtStepPoint).toHaveBeenCalledTimes(2);
      expect(mockDisableBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('clears the method and sets nothing when no breakpoints are wanted', () => {
      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), []);
      expect(results).toHaveLength(0);
      expect(mockClearAllBreaks).toHaveBeenCalledTimes(1);
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('applies a disabled breakpoint as set-then-disable', () => {
      // disableBreakAtStepPoint: is a no-op on a step point with no breakpoint,
      // so a disabled breakpoint has to be set first or it would not exist at all.
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [{ line: 2, enabled: false }]);

      expect(mockSetBreakAtStepPoint).toHaveBeenCalledTimes(1);
      expect(mockDisableBreakAtStepPoint).toHaveBeenCalledTimes(1);
      const setArgs = mockSetBreakAtStepPoint.mock.calls[0];
      const disableArgs = mockDisableBreakAtStepPoint.mock.calls[0];
      expect(setArgs[4]).toBe(2); // same step point
      expect(disableArgs[4]).toBe(2);
    });

    it('resolves a column to the nearest step point on the line, not the leftmost', () => {
      //           0    5    10   15   20
      //           x := self foo bar
      mockGetMethodSource.mockReturnValue('m\nx := self foo');
      // step points (1-based): 8 -> 'self' area start, 13 -> 'foo'
      mockGetSourceOffsets.mockReturnValue([8, 13]);

      // Line 2 starts at offset 2. Column 10 => offset 12, nearest step point is #2.
      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 2, character: 10, enabled: true },
      ]);
      expect(results[0].stepPoint).toBe(2);
    });

    it('a gutter click (no column) takes the leftmost step point on the line', () => {
      mockGetMethodSource.mockReturnValue('m\nx := self foo');
      mockGetSourceOffsets.mockReturnValue([8, 13]);

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 2, enabled: true },
      ]);
      expect(results[0].stepPoint).toBe(1);
    });

    it('collapses two requests that land on the same step point, keeping it armed', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([5]);

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 2, enabled: false },
        { line: 2, character: 1, enabled: true },
      ]);

      // Both requests report the same step point...
      expect(results.map((r) => r.stepPoint)).toEqual([1, 1]);
      // ...but the gem gets one breakpoint, left enabled because one request wanted it.
      expect(mockSetBreakAtStepPoint).toHaveBeenCalledTimes(1);
      expect(mockDisableBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('falls forward to the next step point when the line has none', () => {
      mockGetMethodSource.mockReturnValue('foo\n"just a comment"\n^1');
      // Only one step point: the '^' at 0-based offset 21, so 22 1-based.
      mockGetSourceOffsets.mockReturnValue([22]);

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 2, enabled: true },
      ]);
      expect(results[0]).toEqual({ stepPoint: 1, actualLine: 3, verified: true });
    });

    it('returns unverified when the method has no step point at or after the line', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1\n');
      mockGetSourceOffsets.mockReturnValue([1]);

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 3, enabled: true },
      ]);
      expect(results[0].verified).toBe(false);
    });

    it('returns unverified when the source cannot be fetched', () => {
      mockGetMethodSource.mockImplementation(() => {
        throw new Error('method gone');
      });

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 1, enabled: true },
      ]);
      expect(results[0].verified).toBe(false);
    });

    it('returns unverified when setting the breakpoint throws', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);
      mockSetBreakAtStepPoint.mockImplementation(() => {
        throw new Error('fail');
      });

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 1, enabled: true },
      ]);
      expect(results[0].verified).toBe(false);
    });

    it('reads the class side and environment id out of the URI', () => {
      mockGetMethodSource.mockReturnValue('new\n^super new');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      makeManager().applyToUri(
        session(),
        Uri.parse('gemstone://1/Globals/Array/class/creation/new?env=2'),
        [{ line: 1, enabled: true }],
      );

      expect(mockGetMethodSource).toHaveBeenCalledWith(expect.anything(), 'Array', true, 'new', 2);
    });
  });

  describe('setBreakpointsForSource', () => {
    it("converts the debug adapter's 1-based columns to 0-based characters", () => {
      mockGetMethodSource.mockReturnValue('m\nx := self foo');
      mockGetSourceOffsets.mockReturnValue([8, 13]);

      // DAP column 11 == character 10 == offset 12 on line 2 => step point 2.
      const results = makeManager().setBreakpointsForSource(
        session(),
        Uri.parse(METHOD_URI),
        [2],
        [11],
      );
      expect(results[0].stepPoint).toBe(2);
    });

    it('treats a missing column as a whole-line request', () => {
      mockGetMethodSource.mockReturnValue('m\nx := self foo');
      mockGetSourceOffsets.mockReturnValue([8, 13]);

      const results = makeManager().setBreakpointsForSource(
        session(),
        Uri.parse(METHOD_URI),
        [2],
        [undefined],
      );
      expect(results[0].stepPoint).toBe(1);
    });
  });

  describe('appliedFor', () => {
    it('reports the step points now set on a method, with their enabled state', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 1, enabled: true },
        { line: 2, enabled: false },
      ]);

      const applied = manager.appliedFor(Uri.parse(METHOD_URI));
      expect(applied.map((a) => [a.stepPoint, a.enabled])).toEqual([
        [1, true],
        [2, false],
      ]);
    });

    it('is empty again once the breakpoints are gone', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      const manager = makeManager();
      const uri = Uri.parse(METHOD_URI);
      manager.applyToUri(session(), uri, [{ line: 1, enabled: true }]);
      expect(manager.appliedFor(uri)).toHaveLength(1);

      manager.applyToUri(session(), uri, []);
      expect(manager.appliedFor(uri)).toHaveLength(0);
    });
  });

  // The gutter is offered in a compiled method's editor alone —
  // `contributes.breakpoints` names gemstone-method, and that is the only
  // document given the language. This refusal is what backstops the routes that
  // bypass the contribution: `allowBreakpointsEverywhere`, and DAP clients that
  // are not VS Code.
  describe('a breakpoint set outside a method editor', () => {
    function fireAdded(added: unknown[]): void {
      const manager = makeManager();
      const context = {
        subscriptions: [] as unknown[],
      } as unknown as import('vscode').ExtensionContext;
      manager.register(context);
      const calls = vi.mocked(debug.onDidChangeBreakpoints).mock.calls;
      calls[calls.length - 1][0]({ added, removed: [], changed: [] });
    }

    const bpOn = (uri: string) =>
      new SourceBreakpoint(new Location(Uri.parse(uri), new Position(0, 0)));

    beforeEach(() => {
      vi.mocked(debug.onDidChangeBreakpoints).mockClear();
      vi.mocked(window.showWarningMessage).mockClear();
      mockGetMethodSource.mockReturnValue('at: index\n^ self basicAt: index');
      mockGetSourceOffsets.mockReturnValue([1, 13]);
    });

    it('takes back a breakpoint set in a workspace, and says where it belongs', () => {
      const stray = bpOn('untitled:Workspace');
      workspace.textDocuments = [
        { uri: Uri.parse('untitled:Workspace'), languageId: SMALLTALK_LANGUAGE },
      ];
      debug.breakpoints = [stray];

      fireAdded([stray]);

      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([stray]);
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalledWith(
        expect.stringContaining('compiled GemStone method'),
      );
    });

    it('takes back one on a .gst file that is not open, as a restore brings back', () => {
      const stray = bpOn('file:///tmp/scratch.gst');
      workspace.textDocuments = [];
      debug.breakpoints = [stray];

      fireAdded([stray]);

      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([stray]);
    });

    it('takes one back with nobody logged in, since it is wrong either way', () => {
      // The refusal deliberately runs BEFORE any session lookup: a breakpoint in
      // a workspace is wrong whether or not a session is live, and a
      // logged-out developer is the one most likely to click that gutter. With
      // the lookup first, this breakpoint would sit there arming nothing and
      // saying nothing.
      const stray = bpOn('untitled:Workspace');
      workspace.textDocuments = [
        { uri: Uri.parse('untitled:Workspace'), languageId: SMALLTALK_LANGUAGE },
      ];
      debug.breakpoints = [stray];

      const manager = makeManager(false); // no session, and none logged in
      const context = { subscriptions: [] as unknown[] } as unknown as vscodeApi.ExtensionContext;
      manager.register(context);
      const calls = vi.mocked(debug.onDidChangeBreakpoints).mock.calls;
      calls[calls.length - 1][0]({ added: [stray], removed: [], changed: [] });

      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([stray]);
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalledWith(
        expect.stringContaining('compiled GemStone method'),
      );
    });

    it("never touches another extension's breakpoints", () => {
      // The guard that matters most. `onDidChangeBreakpoints` reports every
      // extension's breakpoints, so a rule of "not a gemstone:// URI" would take
      // a Python file's breakpoint out of the developer's Breakpoints panel.
      const foreign = bpOn('file:///tmp/app.py');
      workspace.textDocuments = [{ uri: Uri.parse('file:///tmp/app.py'), languageId: 'python' }];
      debug.breakpoints = [foreign];

      fireAdded([foreign]);

      expect(vi.mocked(debug.removeBreakpoints)).not.toHaveBeenCalled();
      expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
    });

    it('leaves an unopened file of no interest alone', () => {
      const foreign = bpOn('file:///tmp/app.py');
      workspace.textDocuments = [];
      debug.breakpoints = [foreign];

      fireAdded([foreign]);

      expect(vi.mocked(debug.removeBreakpoints)).not.toHaveBeenCalled();
    });

    it('takes back one on a gemstone:// class definition, which has no method to arm', () => {
      // Smalltalk source behind our own scheme, but there is no compiled method
      // under a class definition, so `applyToUri` can do nothing with it. It is
      // offered no gutter now (its language is gemstone-smalltalk); reachable
      // via allowBreakpointsEverywhere, and previously dropped on the floor.
      const uri = 'gemstone://1/Globals/Array/definition';
      const stray = bpOn(uri);
      workspace.textDocuments = [
        { uri: Uri.parse(uri), languageId: SMALLTALK_LANGUAGE, isDirty: false },
      ];
      debug.breakpoints = [stray];

      fireAdded([stray]);

      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([stray]);
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('takes back one on an override diff view, where a line names two methods', () => {
      // The diff shows the base and the session override side by side, so a line
      // in it does not identify one compiled method — `applyToUri` refuses it for
      // the same reason, and this stops the dot being left behind saying nothing.
      const uri = 'gemstone://1/Globals/Array/instance/accessing/at%3A%20(base)';
      const stray = bpOn(uri);
      workspace.textDocuments = [
        { uri: Uri.parse(uri), languageId: SMALLTALK_LANGUAGE, isDirty: false },
      ];
      debug.breakpoints = [stray];

      fireAdded([stray]);

      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([stray]);
    });

    it('leaves a class comment alone — prose, and not a document of ours to police', () => {
      // gemstone-class-comment is not a Smalltalk source language and is offered
      // no gutter, so a breakpoint here did not come from our contribution.
      const uri = 'gemstone://1/Globals/Array/comment';
      const stray = bpOn(uri);
      workspace.textDocuments = [
        { uri: Uri.parse(uri), languageId: 'gemstone-class-comment', isDirty: false },
      ];
      debug.breakpoints = [stray];

      fireAdded([stray]);

      expect(vi.mocked(debug.removeBreakpoints)).not.toHaveBeenCalled();
    });

    it('takes back one in a notebook cell, which is Smalltalk with nothing compiled', () => {
      const uri = 'vscode-notebook-cell:/tmp/nb.ipynb#W0';
      const stray = bpOn(uri);
      workspace.textDocuments = [
        { uri: Uri.parse(uri), languageId: SMALLTALK_LANGUAGE, isDirty: false },
      ];
      debug.breakpoints = [stray];

      fireAdded([stray]);

      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([stray]);
    });

    // Which editors are OURS to police, told apart by language. The Smalltalk
    // ids are Jasper's own and get the refusal; a Topaz or Tonel file is a
    // GemStone document too but was never offered a gutter and is not ours to
    // take a breakpoint from; another extension's file is untouchable.
    it.each([
      ['a Topaz .gs file', 'file:///tmp/script.gs', 'gemstone-topaz'],
      ['a Tonel .st file', 'file:///tmp/MyClass.class.st', 'gemstone-tonel'],
      ["another extension's TypeScript", 'file:///tmp/app.ts', 'typescript'],
    ])('leaves %s alone', (_what, uri, languageId) => {
      const foreign = bpOn(uri);
      workspace.textDocuments = [{ uri: Uri.parse(uri), languageId, isDirty: false }];
      debug.breakpoints = [foreign];

      fireAdded([foreign]);

      expect(vi.mocked(debug.removeBreakpoints)).not.toHaveBeenCalled();
      expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
    });

    it('leaves a real method editor alone', () => {
      const real = bpOn(METHOD_URI);
      workspace.textDocuments = [
        { uri: Uri.parse(METHOD_URI), languageId: METHOD_LANGUAGE, isDirty: false },
      ];
      debug.breakpoints = [real];

      fireAdded([real]);

      expect(vi.mocked(debug.removeBreakpoints)).not.toHaveBeenCalled();
      expect(mockSetBreakAtStepPoint).toHaveBeenCalled();
    });
  });

  // Eric's rule: a breakpoint can only be set in an editor whose text is the
  // compiled method's. While it has unsaved edits nothing new is accepted, and —
  // just as important — nothing already armed is disturbed, so reverting the
  // editor leaves the original breakpoints exactly where they were.
  describe('an editor with unsaved edits', () => {
    const DIRTY_DOC = { uri: Uri.parse(METHOD_URI), isDirty: true };
    const CLEAN_DOC = { uri: Uri.parse(METHOD_URI), isDirty: false };

    /** Drive the manager the way VS Code does, through the change event. */
    function fire(event: {
      added?: unknown[];
      removed?: unknown[];
      changed?: unknown[];
    }): BreakpointManager {
      const manager = makeManager();
      const context = {
        subscriptions: [] as unknown[],
      } as unknown as import('vscode').ExtensionContext;
      manager.register(context);
      const calls = vi.mocked(debug.onDidChangeBreakpoints).mock.calls;
      calls[calls.length - 1][0]({
        added: event.added ?? [],
        removed: event.removed ?? [],
        changed: event.changed ?? [],
      });
      return manager;
    }

    /**
     * The most recent `onDidChangeTextDocument` listener the manager registered.
     * The mock declares no parameters, so the listener has to be recovered as a
     * callable rather than through its (empty) argument tuple.
     */
    function fireDocumentChanged(document: unknown): void {
      const calls = vi.mocked(workspace.onDidChangeTextDocument).mock.calls as unknown as ((e: {
        document: unknown;
      }) => void)[][];
      calls[calls.length - 1][0]({ document });
    }

    const bpAt = (line: number) =>
      new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(line, 0)));

    beforeEach(() => {
      vi.mocked(debug.onDidChangeBreakpoints).mockClear();
      vi.mocked(workspace.onDidChangeTextDocument).mockClear();
      vi.mocked(window.showWarningMessage).mockClear();
      mockGetMethodSource.mockReturnValue('at: index\n^ self basicAt: index');
      mockGetSourceOffsets.mockReturnValue([1, 13]);
    });

    it('refuses a breakpoint added while the editor is dirty, and says why', () => {
      workspace.textDocuments = [DIRTY_DOC];
      const added = bpAt(1);
      debug.breakpoints = [added];

      fire({ added: [added] });

      // Taken back out, so no red dot is left arming nothing.
      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([added]);
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalledWith(
        expect.stringContaining('unsaved edits'),
      );
      // Both ways back to a compiled method are named.
      const said = vi.mocked(window.showWarningMessage).mock.calls[0][0] as string;
      expect(said).toContain('Save the method');
      expect(said).toContain('Revert File');
    });

    it('leaves the breakpoints already armed alone while the editor is dirty', () => {
      // The heart of the rule. `applyToUri` is an absolute model — it clears the
      // method and re-arms VS Code's whole list by position — and VS Code shifts
      // those positions as the buffer is edited. Running it now would move
      // breakpoints the developer never touched, so it must not run at all.
      workspace.textDocuments = [DIRTY_DOC];
      const existing = bpAt(1);
      const added = bpAt(0);
      debug.breakpoints = [existing, added];

      fire({ added: [added] });

      expect(mockClearAllBreaks).not.toHaveBeenCalled();
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('does not touch the gem when a breakpoint is removed while the editor is dirty', () => {
      workspace.textDocuments = [DIRTY_DOC];
      const removed = bpAt(1);
      debug.breakpoints = [];

      fire({ removed: [removed] });

      expect(mockClearAllBreaks).not.toHaveBeenCalled();
      // Nothing was added, so there is nothing to take back out and nothing to say.
      expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
    });

    it('applies normally once the editor is clean again', () => {
      // Reverting the editor is the ordinary way out, and this is where the gem
      // catches up with anything the list did during the hold.
      workspace.textDocuments = [DIRTY_DOC];
      const existing = bpAt(1);
      debug.breakpoints = [existing];
      fire({ added: [existing] });
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();

      workspace.textDocuments = [CLEAN_DOC];
      debug.breakpoints = [existing];
      fireDocumentChanged(CLEAN_DOC);

      expect(mockSetBreakAtStepPoint).toHaveBeenCalled();
    });

    it('stops holding a method once it is saved, so a later edit cannot re-apply it', () => {
      // Saving is the ordinary way out of a dirty editor, and it never reaches
      // `thawIfClean` — VS Code fires no text-document change for a save, only
      // the recompile that arrives as `invalidateForUri`. A method left held
      // would be re-applied by the next unrelated clean edit, which nobody asked
      // for, and would stay held for the life of the window.
      workspace.textDocuments = [DIRTY_DOC];
      const held = bpAt(1);
      debug.breakpoints = [held];
      const manager = fire({ added: [held] });
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();

      // The save: the recompile drops the method's breakpoints.
      manager.invalidateForUri(Uri.parse(METHOD_URI));
      mockSetBreakAtStepPoint.mockClear();
      mockClearAllBreaks.mockClear();

      // A later clean change to the same document — an edit that leaves no
      // unsaved state, e.g. an undo back to the saved text.
      workspace.textDocuments = [CLEAN_DOC];
      debug.breakpoints = [];
      fireDocumentChanged(CLEAN_DOC);

      expect(mockClearAllBreaks).not.toHaveBeenCalled();
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('stops holding a method when its session logs out', () => {
      workspace.textDocuments = [DIRTY_DOC];
      const held = bpAt(1);
      debug.breakpoints = [held];
      const manager = fire({ added: [held] });

      manager.clearAllForSession(1);
      mockSetBreakAtStepPoint.mockClear();
      mockClearAllBreaks.mockClear();

      // Nothing is left to catch up to — the gem is gone.
      workspace.textDocuments = [CLEAN_DOC];
      debug.breakpoints = [];
      fireDocumentChanged(CLEAN_DOC);

      expect(mockClearAllBreaks).not.toHaveBeenCalled();
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('ignores a document change that leaves the editor still dirty', () => {
      workspace.textDocuments = [DIRTY_DOC];
      debug.breakpoints = [bpAt(1)];
      fire({ added: [bpAt(1)] });

      fireDocumentChanged(DIRTY_DOC);

      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('reports the gem as it stands, without arming, on the debug adapter path', () => {
      // A live debug session re-sends the whole list for a source. Anything
      // already armed stays verified; a new one is refused with the reason.
      workspace.textDocuments = [CLEAN_DOC];
      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI), [{ line: 1, enabled: true }]);
      mockClearAllBreaks.mockClear();
      mockSetBreakAtStepPoint.mockClear();

      workspace.textDocuments = [DIRTY_DOC];
      const results = manager.setBreakpointsForSource(
        session(),
        Uri.parse(METHOD_URI),
        [1, 2],
        [undefined, undefined],
      );

      expect(mockClearAllBreaks).not.toHaveBeenCalled();
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
      expect(results[0].verified).toBe(true);
      expect(results[0].message).toBeUndefined();
      expect(results[1].verified).toBe(false);
      expect(results[1].message).toContain('unsaved edits');
    });

    it('applies normally when the editor has no unsaved edits', () => {
      workspace.textDocuments = [CLEAN_DOC];
      const added = bpAt(1);
      debug.breakpoints = [added];

      fire({ added: [added] });

      expect(mockSetBreakAtStepPoint).toHaveBeenCalled();
      expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
    });
  });

  describe('function breakpoints', () => {
    /** Drive the manager the way VS Code does, through the change event. */
    function fireAdded(added: unknown[]) {
      const manager = makeManager();
      const context = {
        subscriptions: [] as unknown[],
      } as unknown as import('vscode').ExtensionContext;
      manager.register(context);
      const calls = vi.mocked(debug.onDidChangeBreakpoints).mock.calls;
      const handler = calls[calls.length - 1][0];
      handler({ added, removed: [], changed: [] });
      return manager;
    }

    beforeEach(() => {
      vi.mocked(debug.onDidChangeBreakpoints).mockClear();
      // Tests run in random order, so a warning from an earlier one would
      // otherwise be counted here.
      vi.mocked(window.showWarningMessage).mockClear();
      mockGetMethodSource.mockReturnValue('balance\n^total');
      mockGetSourceOffsets.mockReturnValue([9]);
    });

    it('hands a name arriving as a change to the resolver, not just an addition', async () => {
      // VS Code's + creates the breakpoint blank and opens it for editing, so the
      // typed name arrives in `changed`.
      const named = new FunctionBreakpoint('at:');
      debug.breakpoints = [named];

      const manager = makeManager();
      const context = {
        subscriptions: [] as unknown[],
      } as unknown as import('vscode').ExtensionContext;
      manager.register(context);
      const calls = vi.mocked(debug.onDidChangeBreakpoints).mock.calls;
      calls[calls.length - 1][0]({ added: [], removed: [], changed: [named] });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([named]);
    });

    it('hands a named breakpoint to the resolver, which replaces it', async () => {
      // The + button in the Breakpoints panel makes one of these — a name with no
      // location. It is converted to a located breakpoint on the method's entry;
      // functionBreakpoints.test.ts covers the resolution itself.
      const named = new FunctionBreakpoint('at:');
      debug.breakpoints = [named];
      fireAdded([named]);

      // Resolution is async (it may prompt), so let it settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([named]);
    });

    it('applies an ordinary source breakpoint without involving the resolver', () => {
      fireAdded([new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(0, 0)))]);
      expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
    });
  });

  describe('conditions, hit counts and log messages', () => {
    /** Drive the manager through the change event, the way VS Code does. */
    function fire(event: { added?: unknown[]; removed?: unknown[]; changed?: unknown[] }) {
      const manager = makeManager();
      const context = {
        subscriptions: [] as unknown[],
      } as unknown as import('vscode').ExtensionContext;
      manager.register(context);
      const calls = vi.mocked(debug.onDidChangeBreakpoints).mock.calls;
      calls[calls.length - 1][0]({
        added: event.added ?? [],
        removed: event.removed ?? [],
        changed: event.changed ?? [],
      });
      return manager;
    }

    const withFields = (fields: {
      condition?: string;
      hitCondition?: string;
      logMessage?: string;
    }) =>
      new SourceBreakpoint(
        new Location(Uri.parse(METHOD_URI), new Position(0, 0)),
        true,
        fields.condition,
        fields.hitCondition,
        fields.logMessage,
      );

    beforeEach(() => {
      vi.mocked(debug.onDidChangeBreakpoints).mockClear();
      vi.mocked(window.showWarningMessage).mockClear();
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);
    });

    it('says nothing about a condition — conditions are honoured', () => {
      debug.breakpoints = [withFields({ condition: 'x > 3' })];
      fire({ added: debug.breakpoints });
      expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
    });

    it('warns for a hit count', () => {
      fire({ added: [withFields({ hitCondition: '5' })] });
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalled();
    });

    it('warns for a log message (a logpoint)', () => {
      fire({ added: [withFields({ logMessage: 'here' })] });
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalled();
    });

    it('names only what is really ignored', () => {
      fire({ added: [withFields({ hitCondition: '5' })] });
      const said = vi.mocked(window.showWarningMessage).mock.calls[0][0] as string;
      expect(said).toContain('hit counts and log messages');
      expect(said).not.toContain('ignore conditions');
    });

    it('warns once for several unsupported breakpoints, not once each', () => {
      fire({ added: [withFields({ hitCondition: '1' }), withFields({ logMessage: 'b' })] });
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalledTimes(1);
    });

    it('says nothing for a plain breakpoint', () => {
      fire({
        added: [new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(0, 0)))],
      });
      expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
    });

    it('ignores an unsupported field on a non-gemstone file', () => {
      const fileBp = new SourceBreakpoint(
        new Location(Uri.parse('file:///a.ts'), new Position(0, 0)),
        true,
        undefined,
        '3',
      );
      fire({ added: [fileBp] });
      expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
    });

    it('still carries the fields across an enable/disable round trip', () => {
      const bp = withFields({ condition: 'x > 3', hitCondition: '2', logMessage: 'hi' });
      debug.breakpoints = [bp];

      makeManager().setAllEnabled(false);

      const replacement = vi.mocked(debug.addBreakpoints).mock.calls.at(-1)?.[0][0] as
        SourceBreakpoint | undefined;
      expect(replacement?.condition).toBe('x > 3');
      expect(replacement?.hitCondition).toBe('2');
      expect(replacement?.logMessage).toBe('hi');
      expect(replacement?.enabled).toBe(false);
    });
  });

  describe('conditions', () => {
    beforeEach(() => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);
      vi.mocked(window.showWarningMessage).mockClear();
    });

    const conditional = (condition?: string, enabled = true) =>
      new SourceBreakpoint(
        new Location(Uri.parse(METHOD_URI), new Position(1, 0)),
        enabled,
        condition,
      );

    it('records the condition on the applied breakpoint', () => {
      debug.breakpoints = [conditional('index > 3')];
      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI));
      expect(manager.appliedFor(Uri.parse(METHOD_URI))[0].condition).toBe('index > 3');
    });

    it('arms a conditional breakpoint in the gem like any other', () => {
      // The gem has no idea a breakpoint is conditional: it stops every time and
      // the condition is applied afterwards. Nothing about arming changes.
      debug.breakpoints = [conditional('index > 3')];
      makeManager().applyToUri(session(), Uri.parse(METHOD_URI));
      expect(mockSetBreakAtStepPoint).toHaveBeenCalledTimes(1);
    });

    it('treats a blank condition as no condition', () => {
      // VS Code hands back whatever was typed; a breakpoint that can never stop
      // is not what an accidentally emptied box meant.
      debug.breakpoints = [conditional('   ')];
      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI));
      expect(manager.appliedFor(Uri.parse(METHOD_URI))[0].condition).toBeUndefined();
    });

    it('an unconditional request wins over a conditional one on the same step point', () => {
      // One step point, one gem breakpoint. Honouring the condition would
      // silently break the plain breakpoint sitting on the same token.
      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 2, enabled: true, condition: 'index > 3' },
        { line: 2, enabled: true },
      ]);
      expect(manager.appliedFor(Uri.parse(METHOD_URI))[0].condition).toBeUndefined();
    });

    it('keeps the first of two conditions on one step point', () => {
      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 2, enabled: true, condition: 'a' },
        { line: 2, enabled: true, condition: 'b' },
      ]);
      expect(manager.appliedFor(Uri.parse(METHOD_URI))[0].condition).toBe('a');
    });

    describe('a condition written while the editor is dirty', () => {
      /**
       * The quietest way this feature can fail: the breakpoint is already armed,
       * so nothing is refused and VS Code goes on showing the condition — but
       * the hold means it never reaches the gem and the breakpoint stops every
       * time. Exactly what conditional breakpoints exist to avoid.
       */
      const dirtyEditorOn = (uriStr: string) => {
        workspace.textDocuments = [{ uri: Uri.parse(uriStr), isDirty: true }];
      };

      function fireChanged(changed: unknown[]) {
        const manager = makeManager();
        manager.register({
          subscriptions: [] as unknown[],
        } as unknown as vscodeApi.ExtensionContext);
        const calls = vi.mocked(debug.onDidChangeBreakpoints).mock.calls;
        calls[calls.length - 1][0]({ added: [], removed: [], changed });
        return manager;
      }

      beforeEach(() => {
        vi.mocked(debug.onDidChangeBreakpoints).mockClear();
        vi.mocked(window.showWarningMessage).mockClear();
      });

      it('says the condition is not in effect', () => {
        dirtyEditorOn(METHOD_URI);
        const bp = conditional('index > 3');
        debug.breakpoints = [bp];

        fireChanged([bp]);

        expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalledWith(
          expect.stringContaining('condition is NOT in effect'),
        );
      });

      it('leaves the breakpoint alone — it is still armed and still stops', () => {
        dirtyEditorOn(METHOD_URI);
        const bp = conditional('index > 3');
        debug.breakpoints = [bp];

        fireChanged([bp]);

        expect(vi.mocked(debug.removeBreakpoints)).not.toHaveBeenCalled();
      });

      it('says nothing for a change that carries no condition', () => {
        dirtyEditorOn(METHOD_URI);
        const bp = conditional(undefined);
        debug.breakpoints = [bp];

        fireChanged([bp]);

        expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
      });
    });

    describe('conditionLabel', () => {
      it('names the verb, so the label is a sentence and not a fragment', () => {
        expect(conditionLabel('each > 900')).toBe('Break if each > 900');
      });

      it('flattens a multi-line condition onto one line', () => {
        expect(conditionLabel('each > 900\n  and: [ each even ]')).toBe(
          'Break if each > 900 and: [ each even ]',
        );
      });

      it('elides a condition too long to sit beside the code', () => {
        const long = `each > ${'9'.repeat(80)}`;
        const label = conditionLabel(long);
        expect(label.startsWith('Break if ')).toBe(true);
        expect(label.endsWith('…')).toBe(true);
        // The prefix does not eat into what the developer wrote.
        expect(label.length).toBe('Break if '.length + 48);
      });
    });

    describe('the condition drawn beside the code', () => {
      /**
       * An editor over the fixture source that records what was decorated.
       * `refreshDecorations` is the only thing that draws the label, and where
       * it lands is the whole question: a step point sits on a token in the
       * middle of a statement, so anchoring there splits the code.
       */
      function editorOver(source: string) {
        const starts = buildLineStarts(source);
        const positionAt = (o: number) => {
          let line = 1;
          for (let l = 1; l < starts.length; l++) {
            if (starts[l] <= o) line = l;
            else break;
          }
          return new Position(line - 1, o - starts[line]);
        };
        const lines = source.split('\n');
        const drawn: { type: unknown; value: unknown[] }[] = [];
        return {
          drawn,
          editor: {
            document: {
              uri: Uri.parse(METHOD_URI),
              isDirty: false,
              getText: () => source,
              positionAt,
              lineAt: (line: number) => ({
                range: {
                  start: new Position(line, 0),
                  end: new Position(line, lines[line].length),
                },
              }),
            },
            setDecorations: (type: unknown, value: unknown[]) => drawn.push({ type, value }),
          } as unknown as import('vscode').TextEditor,
        };
      }

      // `x := x + i` — the step point is the `:=`, mid statement.
      const SOURCE = 'm\nx := x + i';

      function drawFor(condition: string | undefined) {
        mockGetMethodSource.mockReturnValue(SOURCE);
        mockGetSourceOffsets.mockReturnValue([3]);
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI), [
          { line: 2, enabled: true, condition },
        ]);
        const { editor, drawn } = editorOver(SOURCE);
        manager.refreshDecorations(editor);
        // The label decoration is the last of the three passes.
        return drawn[drawn.length - 1].value as { range: { start: Position } }[];
      }

      beforeEach(() => {
        __resetConfig();
      });

      it('puts the label at the END of the line, not on the step point token', () => {
        const labels = drawFor('i > 3');
        expect(labels).toHaveLength(1);
        // Line 1 (0-based), at its end — `x := x + i` is 10 characters.
        expect(labels[0].range.start.line).toBe(1);
        expect(labels[0].range.start.character).toBe(10);
      });

      it('draws nothing for a breakpoint with no condition', () => {
        expect(drawFor(undefined)).toHaveLength(0);
      });

      it('draws nothing when the setting is off', () => {
        vscode.workspace
          .getConfiguration('gemstone')
          .update('breakpoints.showConditionInEditor', false);
        expect(drawFor('i > 3')).toHaveLength(0);
      });
    });

    describe('conditionSpecsFor', () => {
      it('answers nothing when no breakpoint is conditional', () => {
        debug.breakpoints = [conditional(undefined)];
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI));
        expect(manager.conditionSpecsFor(session())).toEqual([]);
      });

      it('names the method, step point and condition', () => {
        debug.breakpoints = [conditional('index > 3')];
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI));
        expect(manager.conditionSpecsFor(session())).toEqual([
          {
            methodExpr: "(Array compiledMethodAt: #'at:' environmentId: 0)",
            stepPoint: 2,
            condition: 'index > 3',
          },
        ]);
      });

      it('leaves out a disabled conditional breakpoint', () => {
        // A disabled breakpoint is not armed, so it cannot be why execution
        // stopped — a spec for it would be dead weight in the doit.
        debug.breakpoints = [conditional('index > 3', false)];
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI));
        expect(manager.conditionSpecsFor(session())).toEqual([]);
      });

      it('leaves out another session\u2019s methods', () => {
        debug.breakpoints = [conditional('index > 3')];
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI));
        const other = { ...TEST_SESSION, id: 2 } as unknown as Parameters<
          typeof manager.conditionSpecsFor
        >[0];
        expect(manager.conditionSpecsFor(other)).toEqual([]);
      });
    });

    describe('the same method reached by two URIs', () => {
      /**
       * One compiled method can be addressed by more than one `gemstone://` URI
       * — the Explorer scopes its URIs to a dictionary index, the debugger
       * builds one from what the gem reports, and the two differ in the query
       * or the category while naming the same method. `applyToUri` CLEARS the
       * whole method before arming, so applying either one makes the other's
       * record a description of breakpoints that no longer exist. Left in place
       * it is emitted as a spec of its own, and the gem is handed a stale
       * condition alongside the live one — which is what a developer sees as an
       * edited condition having no effect.
       */
      const OTHER_URI = `${METHOD_URI}?dict=4`;

      it('answers the live record whichever URI asks', () => {
        // An editor left open on the other URI still shows a red dot, so it must
        // show the live marker, condition and hover — not nothing, and not the
        // condition that was replaced.
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI), [
          { line: 2, enabled: true, condition: 'index = 900' },
        ]);
        manager.applyToUri(session(), Uri.parse(OTHER_URI), [
          { line: 2, enabled: true, condition: 'index > 1001' },
        ]);

        expect(manager.appliedFor(Uri.parse(OTHER_URI))[0].condition).toBe('index > 1001');
        expect(manager.appliedFor(Uri.parse(METHOD_URI))[0].condition).toBe('index > 1001');
      });

      it('sends the gem one condition — the live one', () => {
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI), [
          { line: 2, enabled: true, condition: 'index = 900' },
        ]);
        manager.applyToUri(session(), Uri.parse(OTHER_URI), [
          { line: 2, enabled: true, condition: 'index > 1001' },
        ]);

        const specs = manager.conditionSpecsFor(session());
        expect(specs).toHaveLength(1);
        expect(specs[0].condition).toBe('index > 1001');
      });

      it('leaves a different method alone', () => {
        const other = 'gemstone://1/Globals/Array/instance/accessing/size';
        mockGetMethodSource.mockReturnValue('foo\n^1');
        mockGetSourceOffsets.mockReturnValue([1, 5]);
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI), [
          { line: 2, enabled: true, condition: 'index = 900' },
        ]);
        manager.applyToUri(session(), Uri.parse(other), [
          { line: 2, enabled: true, condition: 'n > 1' },
        ]);

        expect(manager.appliedFor(Uri.parse(METHOD_URI))).toHaveLength(1);
        expect(manager.conditionSpecsFor(session())).toHaveLength(2);
      });
    });

    describe('conditionForStoneBreakpoint', () => {
      const stoneBp = (over: Record<string, unknown> = {}) => ({
        breakNumber: 1,
        className: 'Array',
        isMeta: false,
        selector: 'at:',
        stepPoint: 2,
        disabled: false,
        environmentId: 0,
        methodOop: '1',
        dictName: 'Globals',
        category: 'accessing',
        ...over,
      });

      it('finds the condition Jasper set', () => {
        // The gem records no condition, so the view has no other way to know.
        debug.breakpoints = [conditional('index > 3')];
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI));
        expect(manager.conditionForStoneBreakpoint(stoneBp())).toBe('index > 3');
      });

      it('answers nothing for a breakpoint at another step point', () => {
        debug.breakpoints = [conditional('index > 3')];
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI));
        expect(manager.conditionForStoneBreakpoint(stoneBp({ stepPoint: 1 }))).toBeUndefined();
      });

      it('answers nothing for a breakpoint Jasper did not set', () => {
        expect(makeManager().conditionForStoneBreakpoint(stoneBp())).toBeUndefined();
      });
    });

    describe('editing a condition', () => {
      /** The method's editor, open and saved — what `contextFor` needs. */
      const openDocument = (source: string) => {
        const starts = buildLineStarts(source);
        return {
          uri: Uri.parse(METHOD_URI),
          isDirty: false,
          getText: () => source,
          positionAt: (o: number) => {
            let line = 1;
            for (let l = 1; l < starts.length; l++) {
              if (starts[l] <= o) line = l;
              else break;
            }
            return new Position(line - 1, o - starts[line]);
          },
        };
      };

      beforeEach(() => {
        workspace.textDocuments = [openDocument('foo\n^1')];
        vi.mocked(window.showInputBox).mockReset();
      });

      it('opens the box with the condition already in it', async () => {
        // Seeing a condition and changing one are the same gesture.
        debug.breakpoints = [conditional('index > 3')];
        vi.mocked(window.showInputBox).mockResolvedValue(undefined);
        await makeManager().editConditionAtStepPoint(Uri.parse(METHOD_URI), 2);
        expect(vi.mocked(window.showInputBox).mock.calls[0][0]).toMatchObject({
          value: 'index > 3',
        });
      });

      it('replaces the breakpoint with one carrying the new condition', async () => {
        const bp = conditional('index > 3');
        debug.breakpoints = [bp];
        vi.mocked(window.showInputBox).mockResolvedValue('index > 9');

        await makeManager().editConditionAtStepPoint(Uri.parse(METHOD_URI), 2);

        expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([bp]);
        const added = vi.mocked(debug.addBreakpoints).mock.calls.at(-1)?.[0][0] as SourceBreakpoint;
        expect(added.condition).toBe('index > 9');
      });

      it('an emptied box removes the condition', async () => {
        debug.breakpoints = [conditional('index > 3')];
        vi.mocked(window.showInputBox).mockResolvedValue('   ');

        await makeManager().editConditionAtStepPoint(Uri.parse(METHOD_URI), 2);

        const added = vi.mocked(debug.addBreakpoints).mock.calls.at(-1)?.[0][0] as SourceBreakpoint;
        expect(added.condition).toBeUndefined();
      });

      it('a cancelled box changes nothing', async () => {
        debug.breakpoints = [conditional('index > 3')];
        vi.mocked(window.showInputBox).mockResolvedValue(undefined);

        await makeManager().editConditionAtStepPoint(Uri.parse(METHOD_URI), 2);

        expect(vi.mocked(debug.removeBreakpoints)).not.toHaveBeenCalled();
        expect(vi.mocked(debug.addBreakpoints)).not.toHaveBeenCalled();
      });

      it('sets a new conditional breakpoint where there was none', async () => {
        // "Break here, but only when…" is a reasonable thing to ask at a step
        // point with no breakpoint yet.
        debug.breakpoints = [];
        vi.mocked(window.showInputBox).mockResolvedValue('index > 9');

        await makeManager().editConditionAtStepPoint(Uri.parse(METHOD_URI), 2);

        const added = vi.mocked(debug.addBreakpoints).mock.calls.at(-1)?.[0][0] as SourceBreakpoint;
        expect(added.condition).toBe('index > 9');
      });
    });
  });

  describe('pruneOrphans', () => {
    it('drops a restored breakpoint whose session is gone', () => {
      // VS Code persists its list across restarts; a GemStone breakpoint lives in
      // the gem and dies with it, so a restored marker points at nothing.
      const orphan = new SourceBreakpoint(
        new Location(
          Uri.parse('gemstone://7/Globals/Array/instance/accessing/at%3A'),
          new Position(0, 0),
        ),
      );
      debug.breakpoints = [orphan];

      expect(makeManager().pruneOrphans()).toBe(1);
      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([orphan]);
      expect(debug.breakpoints).toEqual([]);
    });

    it('keeps a breakpoint whose session is logged in', () => {
      const live = new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(0, 0)));
      debug.breakpoints = [live];

      expect(makeManager().pruneOrphans()).toBe(0);
      expect(debug.breakpoints).toEqual([live]);
    });

    it('never touches a non-gemstone breakpoint', () => {
      const fileBp = new SourceBreakpoint(
        new Location(Uri.parse('file:///a.ts'), new Position(1, 0)),
      );
      debug.breakpoints = [fileBp];

      expect(makeManager().pruneOrphans()).toBe(0);
      expect(debug.breakpoints).toEqual([fileBp]);
    });

    it('is idempotent, so the removal it triggers cannot loop', () => {
      debug.breakpoints = [
        new SourceBreakpoint(
          new Location(
            Uri.parse('gemstone://7/Globals/Array/instance/accessing/at%3A'),
            new Position(0, 0),
          ),
        ),
      ];
      const manager = makeManager();
      expect(manager.pruneOrphans()).toBe(1);
      expect(manager.pruneOrphans()).toBe(0);
    });
  });

  describe('invalidateForUri', () => {
    it('drops the method’s breakpoints when it is recompiled', () => {
      // A breakpoint belongs to the code it was set in. After an edit, "step
      // point 4" may be a different expression, so moving it silently would be
      // worse than losing it — and a recompiled method's old breaks are
      // unreachable in the gem anyway.
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      const mine = new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(0, 0)));
      const other = new SourceBreakpoint(
        new Location(
          Uri.parse('gemstone://1/Globals/Array/instance/accessing/size'),
          new Position(0, 0),
        ),
      );
      const fileBp = new SourceBreakpoint(
        new Location(Uri.parse('file:///a.ts'), new Position(1, 0)),
      );
      debug.breakpoints = [mine, other, fileBp];

      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI), [{ line: 1, enabled: true }]);
      expect(manager.appliedFor(Uri.parse(METHOD_URI))).toHaveLength(1);

      manager.invalidateForUri(Uri.parse(METHOD_URI));

      // Gone from VS Code's list, and only this method's — another method's
      // breakpoint and a file breakpoint are untouched.
      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([mine]);
      expect(debug.breakpoints).toEqual([other, fileBp]);
      expect(manager.appliedFor(Uri.parse(METHOD_URI))).toHaveLength(0);
    });

    it('does not re-set the breakpoints on the new method', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);
      debug.breakpoints = [
        new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(0, 0))),
      ];

      const manager = makeManager();
      mockSetBreakAtStepPoint.mockClear();
      manager.invalidateForUri(Uri.parse(METHOD_URI));

      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('is harmless for a method that had no breakpoints', () => {
      debug.breakpoints = [];
      makeManager().invalidateForUri(Uri.parse(METHOD_URI));
      expect(vi.mocked(debug.removeBreakpoints)).not.toHaveBeenCalled();
    });

    it('re-queries step points afterwards, since the offsets may have moved', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI), [{ line: 1, enabled: true }]);
      const before = mockGetSourceOffsets.mock.calls.length;

      manager.invalidateForUri(Uri.parse(METHOD_URI));
      manager.applyToUri(session(), Uri.parse(METHOD_URI), [{ line: 1, enabled: true }]);

      expect(mockGetSourceOffsets.mock.calls.length).toBeGreaterThan(before);
    });
  });

  describe('clearAllForSession', () => {
    it('forgets a logged-out session, so nothing is re-pushed for it', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      const manager = makeManager();
      const uri = Uri.parse(METHOD_URI);
      manager.applyToUri(session(), uri, [{ line: 1, enabled: true }]);
      expect(manager.appliedFor(uri)).toHaveLength(1);

      manager.clearAllForSession(1);
      expect(manager.appliedFor(uri)).toHaveLength(0);
    });

    it('removes the session’s breakpoints from VS Code too, so none outlive the gem', () => {
      const mine = new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(0, 0)));
      const other = new SourceBreakpoint(
        new Location(
          Uri.parse('gemstone://2/Globals/Array/instance/accessing/at%3A'),
          new Position(0, 0),
        ),
      );
      const fileBp = new SourceBreakpoint(
        new Location(Uri.parse('file:///a.ts'), new Position(1, 0)),
      );
      debug.breakpoints = [mine, other, fileBp];

      makeManager().clearAllForSession(1);

      // Session 1's breakpoint is gone; session 2's and the file's survive.
      expect(debug.breakpoints).toEqual([other, fileBp]);
    });

    it("leaves another session's breakpoints alone", () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      const manager = makeManager();
      const uri = Uri.parse(METHOD_URI);
      manager.applyToUri(session(), uri, [{ line: 1, enabled: true }]);

      manager.clearAllForSession(2);
      expect(manager.appliedFor(uri)).toHaveLength(1);
    });
  });

  describe('toggleAtCursor', () => {
    /**
     * An editor whose caret is at `offset` in the fixture source. Positions map
     * through the source's real line geometry, because the product relies on the
     * editor's offsets agreeing with the stone's — which they do whenever the
     * buffer is saved, and which is exactly what `explain` refuses to assume
     * when it isn't.
     */
    function makeEditor(source: string, offset: number, isDirty = false) {
      const starts = buildLineStarts(source); // 1-based; [0, 0, ...]
      const positionAt = (o: number) => {
        let line = 1;
        for (let l = 1; l < starts.length; l++) {
          if (starts[l] <= o) line = l;
          else break;
        }
        return new Position(line - 1, o - starts[line]);
      };
      return {
        document: {
          uri: Uri.parse(METHOD_URI),
          isDirty,
          getText: () => source,
          offsetAt: () => offset,
          positionAt,
        },
        selection: { active: positionAt(offset) },
      } as unknown as import('vscode').TextEditor;
    }

    const warn = () => vi.mocked(window.showWarningMessage);

    beforeEach(() => {
      warn().mockClear();
    });

    it('adds a VS Code breakpoint at the caret’s step point', () => {
      mockGetMethodSource.mockReturnValue('m\nx := self foo');
      mockGetSourceOffsets.mockReturnValue([8, 13]);

      makeManager().toggleAtCursor(makeEditor('m\nx := self foo', 12));

      expect(vi.mocked(debug.addBreakpoints)).toHaveBeenCalledTimes(1);
      expect(warn()).not.toHaveBeenCalled();
    });

    it('says why nothing happened when the buffer is unsaved', () => {
      // The failure a developer is most likely to hit and least likely to guess:
      // a silent no-op here is indistinguishable from a dead keybinding.
      makeManager().toggleAtCursor(makeEditor('m\n^1', 2, true));

      expect(vi.mocked(debug.addBreakpoints)).not.toHaveBeenCalled();
      expect(warn()).toHaveBeenCalledWith(expect.stringContaining('unsaved edits'));
    });

    it('says why nothing happened when the method has no step points', () => {
      mockGetMethodSource.mockReturnValue('m\n^1');
      mockGetSourceOffsets.mockReturnValue([]);

      makeManager().toggleAtCursor(makeEditor('m\n^1', 2));

      expect(warn()).toHaveBeenCalledWith(expect.stringContaining('no step points'));
    });

    it('says why nothing happened when the method cannot be read', () => {
      mockGetMethodSource.mockImplementation(() => {
        throw new Error('method not found');
      });

      makeManager().toggleAtCursor(makeEditor('m\n^1', 2));

      expect(warn()).toHaveBeenCalledWith(expect.stringContaining('method not found'));
    });

    it('removes the breakpoint again on a second toggle at the same step point', () => {
      mockGetMethodSource.mockReturnValue('m\nx := self foo');
      mockGetSourceOffsets.mockReturnValue([8, 13]);

      // Offset 12 in 'm\nx := self foo' is line 1, column 10 — the same place
      // the caret is, so the toggle must recognise it as the same breakpoint.
      const existing = new SourceBreakpoint(
        new Location(Uri.parse(METHOD_URI), new Position(1, 10)),
      );
      debug.breakpoints = [existing];

      makeManager().toggleAtCursor(makeEditor('m\nx := self foo', 12));

      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([existing]);
      expect(vi.mocked(debug.addBreakpoints)).not.toHaveBeenCalled();
    });
  });

  describe('removeAll', () => {
    it('drops gemstone breakpoints from VS Code and sweeps the gem', () => {
      const gemstoneBp = new SourceBreakpoint(
        new Location(Uri.parse(METHOD_URI), new Position(0, 0)),
      );
      const fileBp = new SourceBreakpoint(
        new Location(Uri.parse('file:///a.ts'), new Position(1, 0)),
      );
      debug.breakpoints = [gemstoneBp, fileBp];

      makeManager().removeAll();

      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([gemstoneBp]);
      // The file breakpoint survives — "all GemStone breakpoints" is not "all breakpoints".
      expect(debug.breakpoints).toEqual([fileBp]);
    });
  });

  // A method editor stays bound to the session it was opened from while the
  // developer switches the active session (README: "Single vs. multiple
  // sessions"), so with `gemstone.sessionMode: multiple` the selected session is
  // routinely NOT the one holding the method on screen.
  describe('with a second session live and the other one selected', () => {
    const SESSION_ONE = {
      id: 1,
      gci: {},
      handle: 'gem-one',
      login: { label: 'One' },
      stoneVersion: '3.7.2',
    };
    const SESSION_TWO = {
      id: 2,
      gci: {},
      handle: 'gem-two',
      login: { label: 'Two' },
      stoneVersion: '3.7.2',
    };
    /** Both sessions live, session TWO selected; the method URI names session one. */
    function twoSessions() {
      return {
        getSelectedSession: vi.fn(() => SESSION_TWO),
        getSessions: vi.fn(() => [SESSION_ONE, SESSION_TWO]),
        onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
      } as unknown as SessionManager;
    }
    function managerOverTwo(sessionManager = twoSessions()) {
      const manager = new BreakpointManager(sessionManager, new StepPointModel(sessionManager));
      manager.register({ subscriptions: [] as unknown[] } as unknown as vscodeApi.ExtensionContext);
      return manager;
    }
    function fire(event: Partial<{ added: unknown[]; removed: unknown[]; changed: unknown[] }>) {
      const calls = vi.mocked(debug.onDidChangeBreakpoints).mock.calls;
      calls[calls.length - 1][0]({ added: [], removed: [], changed: [], ...event });
    }
    const handlesSetIn = () => mockSetBreakAtStepPoint.mock.calls.map((c) => c[0].handle);

    beforeEach(() => {
      vi.mocked(debug.onDidChangeBreakpoints).mockClear();
      mockSetBreakAtStepPoint.mockClear();
      mockClearAllBreaks.mockClear();
      mockByOop.mockClear();
      vi.mocked(debug.addBreakpoints).mockClear();
      mockGetMethodSource.mockReturnValue('at: index\n^ self basicAt: index');
      mockGetSourceOffsets.mockReturnValue([1, 13]);
      workspace.textDocuments = [
        { uri: Uri.parse(METHOD_URI), languageId: METHOD_LANGUAGE, isDirty: false },
      ];
    });

    it('arms a breakpoint in the gem the method was opened from, not the selected one', () => {
      const bp = new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(1, 0)));
      debug.breakpoints = [bp];

      managerOverTwo();
      fire({ added: [bp] });

      // Armed in session one — the method on screen belongs to its gem.
      expect(handlesSetIn()).toEqual(['gem-one']);
    });

    it("does not clear the selected session's breakpoints on the same method", () => {
      const bp = new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(1, 0)));
      debug.breakpoints = [bp];

      managerOverTwo();
      fire({ added: [bp] });

      // `applyToUri` clears the method before re-arming it. Aimed at the wrong
      // gem, that clear would take out breakpoints the other session had set.
      expect(mockClearAllBreaks.mock.calls.map((c) => c[0].handle)).toEqual(['gem-one']);
    });

    it('leaves a breakpoint whose session has logged out alone', () => {
      const dead = new SourceBreakpoint(
        new Location(
          Uri.parse('gemstone://9/Globals/Array/instance/accessing/at%3A'),
          new Position(1, 0),
        ),
      );
      debug.breakpoints = [dead];
      workspace.textDocuments = [
        { uri: dead.location.uri, languageId: METHOD_LANGUAGE, isDirty: false },
      ];

      managerOverTwo();
      fire({ changed: [dead] });

      // No gem gets it: pruning removes the row, and pushing it at whichever
      // session happens to be selected would arm a stone nobody asked about.
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('does not mistake another session\u2019s method for the row the gem reported', () => {
      // The breakpoint view reads its rows out of the SELECTED session's gem, so
      // a row can only ever be about that session's method. Two sessions holding
      // the same class, selector and step point must not collide.
      const manager = managerOverTwo();
      // Session one's own VS Code breakpoint, the one that must NOT be flipped.
      const theirs = new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(0, 0)));
      debug.breakpoints = [theirs];
      manager.applyToUri(SESSION_ONE as never, Uri.parse(METHOD_URI), [{ line: 1, enabled: true }]);
      vi.mocked(debug.addBreakpoints).mockClear();

      manager.setEnabledForStoneBreakpoint(
        {
          breakNumber: 1,
          className: 'Array',
          isMeta: false,
          selector: 'at:',
          stepPoint: 1,
          disabled: false,
          environmentId: 0,
          methodOop: '1234',
          dictName: 'Globals',
          category: 'accessing',
        },
        false,
      );

      // Session one's VS Code breakpoint is not touched; the row is flipped in
      // the selected gem by OOP instead.
      expect(vi.mocked(debug.addBreakpoints)).not.toHaveBeenCalled();
      expect(mockByOop).toHaveBeenCalled();
    });

    it('sweeps every live gem when all breakpoints are disabled', () => {
      mockDisableAll.mockClear();
      debug.breakpoints = [
        new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(1, 0))),
      ];

      managerOverTwo().setAllEnabled(false);

      // "All" spans one breakpoint list across every session, so a gem left
      // un-swept keeps stopping execution behind a row that reads "disabled".
      expect(mockDisableAll.mock.calls.map((c) => c[0].handle)).toEqual(['gem-one', 'gem-two']);
    });

    it('sweeps every live gem when all breakpoints are enabled again', () => {
      mockEnableAll.mockClear();
      debug.breakpoints = [
        new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(1, 0)), false),
      ];

      managerOverTwo().setAllEnabled(true);

      expect(mockEnableAll.mock.calls.map((c) => c[0].handle)).toEqual(['gem-one', 'gem-two']);
    });

    it('sweeps every live gem when all breakpoints are removed', () => {
      mockRemoveAll.mockClear();
      debug.breakpoints = [
        new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(1, 0))),
      ];

      managerOverTwo().removeAll();

      expect(mockRemoveAll.mock.calls.map((c) => c[0].handle)).toEqual(['gem-one', 'gem-two']);
    });

    it('keeps sweeping the other gems when one fails, and says which failed', () => {
      mockRemoveAll.mockClear();
      mockRemoveAll.mockImplementationOnce(() => {
        throw new Error('gem is busy');
      });
      debug.breakpoints = [
        new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(1, 0))),
      ];

      managerOverTwo().removeAll();

      expect(mockRemoveAll).toHaveBeenCalledTimes(2);
      expect(vi.mocked(window.showErrorMessage)).toHaveBeenCalledWith(
        expect.stringContaining('gem is busy'),
      );
    });
  });

  describe('when the gem refuses a breakpoint', () => {
    beforeEach(() => {
      mockSetBreakAtStepPoint.mockReset();
      mockDisableBreakAtStepPoint.mockReset();
      mockClearBreakAtStepPoint.mockReset();
      vi.mocked(window.showErrorMessage).mockClear();
      vi.mocked(window.showWarningMessage).mockClear();
      mockGetMethodSource.mockReturnValue('at: index\n^ self basicAt: index');
      mockGetSourceOffsets.mockReturnValue([1, 13]);
    });

    it('says so out loud, and carries the reason back for the debug adapter', () => {
      // An unverified marker on its own is unreadable: it looks exactly like a
      // breakpoint on a line with no step point.
      mockSetBreakAtStepPoint.mockImplementation(() => {
        throw new Error('GCI error 2010');
      });

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 1, enabled: true },
      ]);

      expect(results[0].verified).toBe(false);
      expect(results[0].message).toContain('GCI error 2010');
      expect(vi.mocked(window.showErrorMessage)).toHaveBeenCalledWith(
        expect.stringContaining('GCI error 2010'),
      );
    });

    it('takes the break back out when it armed but could not be disabled', () => {
      // A disabled breakpoint is applied as set-then-disable. If the disable
      // fails, the step point is armed while the marker says it is off — the
      // worst state available, so the break is removed instead.
      mockDisableBreakAtStepPoint.mockImplementation(() => {
        throw new Error('GCI error 2010');
      });

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 1, enabled: false },
      ]);

      expect(mockClearBreakAtStepPoint).toHaveBeenCalled();
      expect(results[0].verified).toBe(false);
      expect(vi.mocked(window.showErrorMessage)).toHaveBeenCalledWith(
        expect.stringContaining('GCI error 2010'),
      );
    });

    it('says the step point is still armed when it cannot be taken back out either', () => {
      mockDisableBreakAtStepPoint.mockImplementation(() => {
        throw new Error('disable failed');
      });
      mockClearBreakAtStepPoint.mockImplementation(() => {
        throw new Error('clear failed too');
      });

      makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [{ line: 1, enabled: false }]);

      expect(vi.mocked(window.showErrorMessage)).toHaveBeenCalledWith(
        expect.stringContaining('still armed'),
      );
    });

    it('forgets the method when its step points cannot be read, since they were just cleared', () => {
      // `applyToUri` clears the method first. If the step points then cannot be
      // read, the record left behind would draw markers, hover text and view
      // rows for breakpoints that exist in no gem.
      const sessionManager = makeSessionManager(true);
      const model = new StepPointModel(sessionManager);
      const manager = new BreakpointManager(sessionManager, model);
      const uri = Uri.parse(METHOD_URI);
      manager.applyToUri(session(), uri, [{ line: 1, enabled: true }]);
      expect(manager.appliedFor(uri)).toHaveLength(1);

      let fired = 0;
      manager.onDidApply(() => fired++);
      // Step points are cached per method; the cache is dropped when the
      // selected session changes, so the next apply goes back to the stone —
      // which is where a method that has since been removed fails.
      model.clear();
      vi.mocked(getStepPointBundle).mockImplementationOnce(() => {
        throw new Error('method not found');
      });

      const results = manager.applyToUri(session(), uri, [{ line: 1, enabled: true }]);

      expect(manager.appliedFor(uri)).toHaveLength(0);
      expect(fired).toBeGreaterThan(0);
      expect(results[0].verified).toBe(false);
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalled();
    });
  });
});
