import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

vi.mock('../../browserQueries', () => {
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
} from '../../__mocks__/vscode';
import type * as vscodeApi from 'vscode';
import * as vscode from 'vscode';
import { __resetConfig } from '../../__mocks__/vscode';
import { BreakpointManager } from '../breakpointManager';
import { conditionLabel, editorLabel } from '../breakpointRuleText';
import { METHOD_LANGUAGE, SMALLTALK_LANGUAGE } from '../../languageIds';
import { SessionManager } from '../../sessionManager';
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
} from '../../browserQueries';
import { fakeActiveSession } from '../../__tests__/fakeActiveSession';

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

/**
 * Make `wanted` VS Code's whole breakpoint list, all on `uri` — the list
 * `applyToUri` reads. Lines are 1-based, as the gem counts them; no `character`
 * is a gutter click.
 */
function setVsCodeBreakpoints(uri: string, wanted: Wanted[]): void {
  debug.breakpoints = wanted.map((w) => sourceBreakpoint(uri, w));
}

type Wanted = {
  line: number;
  character?: number;
  enabled?: boolean;
  condition?: string;
  logMessage?: string;
};

function sourceBreakpoint(uri: string, w: Wanted): SourceBreakpoint {
  return new SourceBreakpoint(
    new Location(Uri.parse(uri), new Position(w.line - 1, w.character ?? 0)),
    w.enabled ?? true,
    w.condition,
    undefined,
    w.logMessage,
  );
}

/**
 * Make `wanted` VS Code's breakpoints on `uri`, keeping every other method's,
 * then apply `uri` — so several methods can be armed side by side.
 */
function applyWith(manager: BreakpointManager, uri: string, wanted: Wanted[]): void {
  debug.breakpoints = [
    ...debug.breakpoints.filter(
      (bp) => !(bp instanceof SourceBreakpoint) || bp.location.uri.toString() !== uri,
    ),
    ...wanted.map((w) => sourceBreakpoint(uri, w)),
  ];
  manager.applyToUri(session(), Uri.parse(uri));
}

/** The step point each `setBreakAtStepPoint` call armed, in order. */
function armedStepPoints(): unknown[] {
  return mockSetBreakAtStepPoint.mock.calls.map((args) => args[4]);
}

const TEST_SESSION = fakeActiveSession({
  id: 1,
  gci: {},
  handle: 'h1',
  login: { label: 'Test' },
  stoneVersion: '3.7.2',
});

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
    it('does nothing for a non-gemstone URI', () => {
      setVsCodeBreakpoints('file:///test.tpz', [{ line: 1 }]);
      makeManager().applyToUri(session(), Uri.parse('file:///test.tpz'));
      expect(mockClearAllBreaks).not.toHaveBeenCalled();
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('sets a breakpoint per VS Code breakpoint, at the step point each lands on', () => {
      // GemStone _sourceOffsets are 1-based: step point 1 at source[0], 2 at source[11].
      mockGetMethodSource.mockReturnValue('at: index\n^self basicAt: index');
      mockGetSourceOffsets.mockReturnValue([1, 11]);
      setVsCodeBreakpoints(METHOD_URI, [{ line: 1 }, { line: 2 }]);

      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI));

      expect(mockClearAllBreaks).toHaveBeenCalledTimes(1);
      expect(armedStepPoints()).toEqual([1, 2]);
      expect(mockDisableBreakAtStepPoint).not.toHaveBeenCalled();
      expect(manager.appliedFor(Uri.parse(METHOD_URI)).map((a) => [a.stepPoint, a.line])).toEqual([
        [1, 1],
        [2, 2],
      ]);
    });

    it('clears the method and sets nothing when no breakpoints are wanted', () => {
      makeManager().applyToUri(session(), Uri.parse(METHOD_URI));
      expect(mockClearAllBreaks).toHaveBeenCalledTimes(1);
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('applies a disabled breakpoint as set-then-disable', () => {
      // disableBreakAtStepPoint: is a no-op on a step point with no breakpoint,
      // so a disabled breakpoint has to be set first or it would not exist at all.
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      setVsCodeBreakpoints(METHOD_URI, [{ line: 2, enabled: false }]);
      makeManager().applyToUri(session(), Uri.parse(METHOD_URI));

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
      setVsCodeBreakpoints(METHOD_URI, [{ line: 2, character: 10 }]);
      makeManager().applyToUri(session(), Uri.parse(METHOD_URI));
      expect(armedStepPoints()).toEqual([2]);
    });

    it('a gutter click (no column) takes the leftmost step point on the line', () => {
      mockGetMethodSource.mockReturnValue('m\nx := self foo');
      mockGetSourceOffsets.mockReturnValue([8, 13]);

      setVsCodeBreakpoints(METHOD_URI, [{ line: 2 }]);
      makeManager().applyToUri(session(), Uri.parse(METHOD_URI));
      expect(armedStepPoints()).toEqual([1]);
    });

    it('collapses two breakpoints that land on the same step point, keeping it armed', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([5]);
      setVsCodeBreakpoints(METHOD_URI, [
        { line: 2, enabled: false },
        { line: 2, character: 1, enabled: true },
      ]);

      makeManager().applyToUri(session(), Uri.parse(METHOD_URI));

      // The gem gets one breakpoint, left enabled because one of the two wanted it.
      expect(armedStepPoints()).toEqual([1]);
      expect(mockDisableBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('falls forward to the next step point when the line has none', () => {
      mockGetMethodSource.mockReturnValue('foo\n"just a comment"\n^1');
      // Only one step point: the '^' at 0-based offset 21, so 22 1-based.
      mockGetSourceOffsets.mockReturnValue([22]);

      setVsCodeBreakpoints(METHOD_URI, [{ line: 2 }]);
      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI));
      expect(manager.appliedFor(Uri.parse(METHOD_URI)).map((a) => [a.stepPoint, a.line])).toEqual([
        [1, 3],
      ]);
    });

    it('takes back, and says why, a breakpoint below the last statement', () => {
      vi.mocked(window.showWarningMessage).mockClear();
      mockGetMethodSource.mockReturnValue('foo\n^1\n');
      mockGetSourceOffsets.mockReturnValue([1]);
      setVsCodeBreakpoints(METHOD_URI, [{ line: 3 }]);
      const [pastEnd] = debug.breakpoints;

      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI));
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
      expect(manager.appliedFor(Uri.parse(METHOD_URI))).toHaveLength(0);
      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([pastEnd]);
      expect(debug.breakpoints).toHaveLength(0);
      // Names the method, so that an event touching several says which one lost
      // a breakpoint.
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalledWith(
        expect.stringContaining('Array >> #at:'),
      );
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalledWith(
        expect.stringContaining("below the method's last statement"),
      );
    });

    it('still arms the rest when one breakpoint is below the last statement', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1\n');
      // One step point: the '^' at 0-based offset 4, so 5 1-based.
      mockGetSourceOffsets.mockReturnValue([5]);
      setVsCodeBreakpoints(METHOD_URI, [{ line: 2 }, { line: 3 }]);
      const [onStatement, pastEnd] = debug.breakpoints;

      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI));
      expect(armedStepPoints()).toEqual([1]);
      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([pastEnd]);
      expect(debug.breakpoints).toEqual([onStatement]);
    });

    // VS Code's `removeBreakpoints` fires `onDidChangeBreakpoints` before it
    // returns, so taking the past-the-end breakpoint back re-enters
    // `applyToUri` for the same URI. The shared mock does not fire it, so this
    // test does: without the guard, the method is cleared and armed twice.
    it('clears and arms the method once when taking a breakpoint back re-enters', () => {
      vi.mocked(window.showWarningMessage).mockClear();
      mockGetMethodSource.mockReturnValue('foo\n^1\n');
      // One step point: the '^' at 0-based offset 4, so 5 1-based.
      mockGetSourceOffsets.mockReturnValue([5]);
      setVsCodeBreakpoints(METHOD_URI, [{ line: 2 }, { line: 3 }]);
      const manager = makeManager();
      const plainRemove = (bps: unknown[]): void => {
        debug.breakpoints = debug.breakpoints.filter((bp) => !bps.includes(bp));
      };
      vi.mocked(debug.removeBreakpoints).mockImplementation((bps: unknown[]) => {
        plainRemove(bps);
        manager.applyToUri(session(), Uri.parse(METHOD_URI));
      });

      try {
        manager.applyToUri(session(), Uri.parse(METHOD_URI));

        expect(armedStepPoints()).toEqual([1]);
        expect(mockClearAllBreaks).toHaveBeenCalledTimes(1);
        expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalledTimes(1);
      } finally {
        vi.mocked(debug.removeBreakpoints).mockImplementation(plainRemove);
      }
    });

    it('takes nothing back when every breakpoint has a step point', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);
      setVsCodeBreakpoints(METHOD_URI, [{ line: 1 }]);

      makeManager().applyToUri(session(), Uri.parse(METHOD_URI));
      expect(vi.mocked(debug.removeBreakpoints)).not.toHaveBeenCalled();
    });

    it('arms nothing, and says why, when the source cannot be fetched', () => {
      vi.mocked(window.showWarningMessage).mockClear();
      mockGetMethodSource.mockImplementation(() => {
        throw new Error('method gone');
      });
      setVsCodeBreakpoints(METHOD_URI, [{ line: 1 }]);

      makeManager().applyToUri(session(), Uri.parse(METHOD_URI));
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalled();
    });

    it('records nothing as applied, and says why, when setting the breakpoint throws', () => {
      vi.mocked(window.showErrorMessage).mockClear();
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);
      mockSetBreakAtStepPoint.mockImplementation(() => {
        throw new Error('fail');
      });
      setVsCodeBreakpoints(METHOD_URI, [{ line: 1 }]);

      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI));
      expect(manager.appliedFor(Uri.parse(METHOD_URI))).toHaveLength(0);
      expect(vi.mocked(window.showErrorMessage)).toHaveBeenCalledWith(
        expect.stringContaining('Could not set the breakpoint at step point 1'),
      );
    });

    it('reads the class side and environment id out of the URI', () => {
      mockGetMethodSource.mockReturnValue('new\n^super new');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      const uri = 'gemstone://1/Globals/Array/class/creation/new?env=2';
      setVsCodeBreakpoints(uri, [{ line: 1 }]);
      makeManager().applyToUri(session(), Uri.parse(uri));

      expect(mockGetMethodSource).toHaveBeenCalledWith(expect.anything(), 'Array', true, 'new', 2);
    });
  });

  describe('appliedFor', () => {
    it('reports the step points now set on a method, with their enabled state', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      setVsCodeBreakpoints(METHOD_URI, [{ line: 1 }, { line: 2, enabled: false }]);
      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI));

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
      setVsCodeBreakpoints(METHOD_URI, [{ line: 1 }]);
      manager.applyToUri(session(), uri);
      expect(manager.appliedFor(uri)).toHaveLength(1);

      debug.breakpoints = [];
      manager.applyToUri(session(), uri);
      expect(manager.appliedFor(uri)).toHaveLength(0);
    });
  });

  // The gutter is offered in a compiled method's editor alone —
  // `contributes.breakpoints` names gemstone-method, and that is the only
  // document given the language. This refusal is what backstops the route that
  // bypasses the contribution: `allowBreakpointsEverywhere`.
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

    it('says nothing about a log message — logpoints are honoured', () => {
      debug.breakpoints = [withFields({ logMessage: 'here' })];
      fire({ added: debug.breakpoints });
      expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
    });

    it('names only what is really ignored, and where log output goes', () => {
      fire({ added: [withFields({ hitCondition: '5' })] });
      const said = vi.mocked(window.showWarningMessage).mock.calls[0][0] as string;
      expect(said).toContain('ignore hit counts');
      expect(said).not.toContain('log messages —');
      expect(said).toContain('GemStone Logpoints');
    });

    it('warns once for several unsupported breakpoints, not once each', () => {
      fire({ added: [withFields({ hitCondition: '1' }), withFields({ hitCondition: '2' })] });
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

    it('an unconditional breakpoint wins over a conditional one on the same step point', () => {
      // One step point, one gem breakpoint. Honouring the condition would
      // silently break the plain breakpoint sitting on the same token.
      const manager = makeManager();
      applyWith(manager, METHOD_URI, [
        { line: 2, enabled: true, condition: 'index > 3' },
        { line: 2, enabled: true },
      ]);
      expect(manager.appliedFor(Uri.parse(METHOD_URI))[0].condition).toBeUndefined();
    });

    it('keeps the first of two conditions on one step point', () => {
      const manager = makeManager();
      applyWith(manager, METHOD_URI, [
        { line: 2, enabled: true, condition: 'a' },
        { line: 2, enabled: true, condition: 'b' },
      ]);
      expect(manager.appliedFor(Uri.parse(METHOD_URI))[0].condition).toBe('a');
    });

    describe('two breakpoints on one step point', () => {
      // A gutter click on a blank line falls forward onto the next line's step
      // point, so two breakpoints sharing one is easy to come by.
      const sole = (manager: BreakpointManager) => {
        const applied = manager.appliedFor(Uri.parse(METHOD_URI));
        expect(applied).toHaveLength(1);
        return applied[0];
      };

      it('does not let a disabled logpoint stop an enabled breakpoint from stopping', () => {
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [
          { line: 2, enabled: false, logMessage: 'x={x}' },
          { line: 2, enabled: true },
        ]);
        expect(sole(manager)).toMatchObject({ enabled: true, logMessage: undefined });
      });

      it("does not let a disabled plain breakpoint erase an enabled one's condition", () => {
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [
          { line: 2, enabled: false },
          { line: 2, enabled: true, condition: 'index > 3' },
        ]);
        expect(sole(manager).condition).toBe('index > 3');
      });

      it('does not let a disabled plain breakpoint stop an enabled logpoint from logging', () => {
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [
          { line: 2, enabled: false },
          { line: 2, enabled: true, logMessage: 'x={x}' },
        ]);
        expect(sole(manager).logMessage).toBe('x={x}');
      });

      it('still stops for an enabled plain breakpoint beside an enabled logpoint', () => {
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [
          { line: 2, enabled: true, logMessage: 'x={x}' },
          { line: 2, enabled: true },
        ]);
        expect(sole(manager).logMessage).toBeUndefined();
      });

      it('keeps the log message when every breakpoint on it logs', () => {
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [
          { line: 2, enabled: true, logMessage: 'first' },
          { line: 2, enabled: true, logMessage: 'second' },
        ]);
        expect(sole(manager).logMessage).toBe('first');
      });

      it('reads the disabled ones when none is enabled', () => {
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [
          { line: 2, enabled: false, condition: 'a' },
          { line: 2, enabled: false, condition: 'b' },
        ]);
        expect(sole(manager)).toMatchObject({ enabled: false, condition: 'a' });
      });
    });

    it('treats a blank log message as none, so the breakpoint still stops', () => {
      // A blank message would make a breakpoint that never stops and logs
      // nothing but empty lines.
      const manager = makeManager();
      applyWith(manager, METHOD_URI, [{ line: 2, enabled: true, logMessage: '   ' }]);
      expect(manager.appliedFor(Uri.parse(METHOD_URI))[0].logMessage).toBeUndefined();
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
          expect.stringContaining('condition or log message is NOT in effect'),
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

      /** Apply `bp` while the editor is clean, then dirty it and report `edit`. */
      function appliedThenChanged(bp: SourceBreakpoint, edit: (bp: SourceBreakpoint) => void) {
        debug.breakpoints = [bp];
        const manager = makeManager();
        manager.register({
          subscriptions: [] as unknown[],
        } as unknown as vscodeApi.ExtensionContext);
        manager.applyToUri(session(), Uri.parse(METHOD_URI));
        dirtyEditorOn(METHOD_URI);
        edit(bp);
        const calls = vi.mocked(debug.onDidChangeBreakpoints).mock.calls;
        calls[calls.length - 1][0]({ added: [], removed: [], changed: [bp] });
      }

      it('says nothing when the condition is the one already in effect', () => {
        // Unticking an applied conditional breakpoint changes no condition: the
        // gem is still deciding with the one shown, so a warning that it is
        // NOT in effect would be false.
        appliedThenChanged(conditional('index > 3'), (bp) => {
          bp.enabled = false;
        });
        expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
      });

      it('says so when an applied condition is cleared — the old one still decides', () => {
        appliedThenChanged(conditional('index > 3'), (bp) => {
          bp.condition = undefined;
        });
        expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalledWith(
          expect.stringContaining('NOT in effect'),
        );
      });

      it('says so when a log message is edited', () => {
        const bp = conditional(undefined);
        bp.logMessage = 'n={n}';
        appliedThenChanged(bp, (b) => {
          b.logMessage = 'n={n} m={m}';
        });
        expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalledWith(
          expect.stringContaining('NOT in effect'),
        );
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

    describe('the label for a breakpoint that waits', () => {
      const TRIGGER = { uri: 'gemstone://1/Globals/Array/instance/accessing/size', stepPoint: 4 };

      it('names the breakpoint that has to be reached first', () => {
        expect(editorLabel({ triggeredBy: TRIGGER })).toBe('Break after Array>>size @4');
      });

      it('leads with the trigger and keeps the condition as a clause', () => {
        // `Break after …, Break if …` would repeat the verb, and the trigger has
        // to come first: it is why the breakpoint will be passed over at all.
        expect(editorLabel({ triggeredBy: TRIGGER, condition: 'each > 900' })).toBe(
          'Break after Array>>size @4, if each > 900',
        );
      });

      it('falls back to the step point when the URI is not a method', () => {
        expect(editorLabel({ triggeredBy: { uri: 'file:///tmp/x.st', stepPoint: 7 } })).toBe(
          'Break after @7',
        );
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
        applyWith(manager, METHOD_URI, [{ line: 2, enabled: true, condition }]);
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

      it('the label’s own hover names the channel and links to it', () => {
        // The label is one of the two things a developer actually hovers, and
        // "Logs: …" alone does not say where the output went.
        mockGetMethodSource.mockReturnValue(SOURCE);
        mockGetSourceOffsets.mockReturnValue([3]);
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [{ line: 2, enabled: true, logMessage: 'x={x}' }]);
        const { editor, drawn } = editorOver(SOURCE);
        manager.refreshDecorations(editor);

        const labels = drawn[drawn.length - 1].value as { hoverMessage: { value: string } }[];
        expect(labels[0].hoverMessage.value).toContain('GemStone Logpoints');
        expect(labels[0].hoverMessage.value).toContain(
          'command:gemstone.breakpoints.showLogpointOutput',
        );
      });

      it('draws the label of a breakpoint that only waits, with a hover saying so', () => {
        // A breakpoint waiting on another carries nothing else, so without its
        // own hover text the label's hover was empty.
        mockGetMethodSource.mockReturnValue(SOURCE);
        mockGetSourceOffsets.mockReturnValue([3]);
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [{ line: 2, enabled: true }]);
        const trigger = { uri: 'gemstone://1/Globals/Array/instance/accessing/size', stepPoint: 4 };
        manager.setTrigger(Uri.parse(METHOD_URI), 1, trigger);
        const { editor, drawn } = editorOver(SOURCE);
        manager.refreshDecorations(editor);

        const labels = drawn[drawn.length - 1].value as {
          hoverMessage: { value: string };
          renderOptions: { after: { contentText: string } };
        }[];
        // Nothing is set at size @4, so the label says it will not stop.
        expect(labels[0].renderOptions.after.contentText).toBe(
          'Break after Array>>size @4 (removed)',
        );
        expect(labels[0].hoverMessage.value).toContain('Waits for **Array>>size @4**');
      });

      it('trusts the label hover for its own link only', () => {
        mockGetMethodSource.mockReturnValue(SOURCE);
        mockGetSourceOffsets.mockReturnValue([3]);
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [{ line: 2, enabled: true, logMessage: 'x={x}' }]);
        const { editor, drawn } = editorOver(SOURCE);
        manager.refreshDecorations(editor);
        const labels = drawn[drawn.length - 1].value as { hoverMessage: { isTrusted: unknown } }[];
        expect(labels[0].hoverMessage.isTrusted).toEqual({
          enabledCommands: ['gemstone.breakpoints.showLogpointOutput'],
        });
      });

      it('says which breakpoint each label is about when a line holds two', () => {
        // `x := x + i`: step points on `:=` and `+`, both on line 2.
        mockGetMethodSource.mockReturnValue(SOURCE);
        mockGetSourceOffsets.mockReturnValue([5, 10]);
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [
          { line: 2, character: 2, enabled: true, condition: 'i > 3' },
          { line: 2, character: 7, enabled: true },
        ]);
        const { editor, drawn } = editorOver(SOURCE);
        manager.refreshDecorations(editor);
        const labels = drawn[drawn.length - 1].value as {
          renderOptions: { after: { contentText: string } };
        }[];
        expect(labels.map((l) => l.renderOptions.after.contentText)).toEqual(['@1 Break if i > 3']);
      });

      it('draws nothing when the setting is off', () => {
        vscode.workspace
          .getConfiguration('gemstone')
          .update('breakpoints.showRulesInEditor', false);
        expect(drawFor('i > 3')).toHaveLength(0);
      });
    });

    describe('breakpointRulesFor', () => {
      it('answers nothing when no breakpoint is conditional', () => {
        debug.breakpoints = [conditional(undefined)];
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI));
        expect(manager.breakpointRulesFor(session())).toEqual([]);
      });

      it('labels the method for a log line, without an environment when it is 0', () => {
        debug.breakpoints = [
          new SourceBreakpoint(
            new Location(Uri.parse(METHOD_URI), new Position(1, 0)),
            true,
            undefined,
            undefined,
            'x={x}',
          ),
        ];
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI));

        const [rule] = manager.breakpointRulesFor(session());
        expect(rule.label).toBe('Array>>at:');
        expect(rule.logMessage).toBe("'x=', (x) printString");
      });

      it('names the method, step point and condition', () => {
        debug.breakpoints = [conditional('index > 3')];
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI));
        expect(manager.breakpointRulesFor(session())).toEqual([
          {
            methodExpr: "(Array compiledMethodAt: #'at:' environmentId: 0)",
            stepPoint: 2,
            condition: 'index > 3',
            logMessage: undefined,
            label: 'Array>>at:',
          },
        ]);
      });

      it('leaves out a disabled conditional breakpoint', () => {
        // A disabled breakpoint is not armed, so it cannot be why execution
        // stopped — a spec for it would be dead weight in the doit.
        debug.breakpoints = [conditional('index > 3', false)];
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI));
        expect(manager.breakpointRulesFor(session())).toEqual([]);
      });

      it('leaves out another session\u2019s methods', () => {
        debug.breakpoints = [conditional('index > 3')];
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI));
        const other = { ...TEST_SESSION, id: 2 } as unknown as Parameters<
          typeof manager.breakpointRulesFor
        >[0];
        expect(manager.breakpointRulesFor(other)).toEqual([]);
      });
    });

    describe('triggers', () => {
      // A second method, so a trigger can point across methods the way the
      // picker offers it — and so a renumbering bug cannot hide behind both
      // ends being the same record.
      const OTHER_METHOD = 'gemstone://1/Globals/Array/instance/accessing/size';

      /** Arm `METHOD_URI` and `OTHER_METHOD`, each with one breakpoint. */
      const twoMethods = (manager: ReturnType<typeof makeManager>) => {
        applyWith(manager, METHOD_URI, [{ line: 2, enabled: true }]);
        mockGetMethodSource.mockReturnValue('foo\n^1');
        mockGetSourceOffsets.mockReturnValue([1, 5]);
        applyWith(manager, OTHER_METHOD, [{ line: 2, enabled: true }]);
      };

      it('answers no rules at all while nothing is triggered', () => {
        // The ordinary case stays free: two plain breakpoints, no decider.
        const manager = makeManager();
        twoMethods(manager);
        expect(manager.breakpointRulesFor(session())).toEqual([]);
      });

      it('gives a plain triggered breakpoint and its plain trigger a spec each', () => {
        // Both ends earn a spec purely by being in a trigger relationship: a
        // step point no spec claims answers Stop, so leaving either out would
        // mean the triggered one stopped on its first hit, or the trigger armed
        // nothing.
        const manager = makeManager();
        twoMethods(manager);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });

        const rules = manager.breakpointRulesFor(session());
        expect(rules).toHaveLength(2);
        const triggered = rules.find((r) => r.label === 'Array>>at:');
        const trigger = rules.find((r) => r.label === 'Array>>size');
        expect(trigger?.triggeredBy).toBeUndefined();
        // 1-based, and pointing at the trigger's position in this same array.
        expect(triggered?.triggeredBy).toBe(rules.indexOf(trigger!) + 1);
      });

      it('records the trigger on the applied breakpoint', () => {
        const manager = makeManager();
        twoMethods(manager);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });
        expect(manager.appliedFor(Uri.parse(METHOD_URI))[0].triggeredBy).toEqual({
          uri: OTHER_METHOD,
          stepPoint: 2,
        });
        expect(manager.triggerFor(Uri.parse(METHOD_URI), 2)).toEqual({
          uri: OTHER_METHOD,
          stepPoint: 2,
        });
      });

      it('renumbers a trigger index past a breakpoint that earns no spec', () => {
        // The regression this guards: specs are pruned to the ones the gem needs,
        // so a trigger's index has to be translated into the pruned array. A
        // third, plain, untriggered breakpoint sits between the two ends and must
        // NOT shift the index that reaches the decider.
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [
          { line: 2, enabled: true },
          { line: 1, enabled: true },
        ]);
        mockGetMethodSource.mockReturnValue('foo\n^1');
        mockGetSourceOffsets.mockReturnValue([1, 5]);
        applyWith(manager, OTHER_METHOD, [{ line: 2, enabled: true }]);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });

        const rules = manager.breakpointRulesFor(session());
        // Only the two ends of the relationship, not the bystander.
        expect(rules).toHaveLength(2);
        const triggered = rules.find((r) => r.triggeredBy !== undefined)!;
        // The index resolves, inside this array, to the breakpoint in the other
        // method — which is the whole point of renumbering.
        expect(rules[triggered.triggeredBy! - 1].label).toBe('Array>>size');
      });

      /** The rule for `label`, and whether it names itself as its trigger. */
      const disarmed = (
        rules: ReturnType<BreakpointManager['breakpointRulesFor']>,
        label: string,
      ) => {
        const at = rules.findIndex((r) => r.label === label);
        return at >= 0 && rules[at].triggeredBy === at + 1;
      };

      it('keeps a breakpoint waiting on a disabled breakpoint disarmed', () => {
        // As VS Code's own triggered breakpoints do: disabling the trigger must
        // not quietly turn the pair into a breakpoint that stops every time.
        // The spec names itself as its trigger, which it can never reach.
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [{ line: 2, enabled: true }]);
        mockGetMethodSource.mockReturnValue('foo\n^1');
        mockGetSourceOffsets.mockReturnValue([1, 5]);
        applyWith(manager, OTHER_METHOD, [{ line: 2, enabled: false }]);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });

        const rules = manager.breakpointRulesFor(session());
        expect(rules).toHaveLength(1);
        expect(disarmed(rules, 'Array>>at:')).toBe(true);
        expect(manager.ruleOf(manager.appliedFor(Uri.parse(METHOD_URI))[0]).triggerProblem).toBe(
          'disabled',
        );
      });

      it('keeps a breakpoint waiting on a step point with no breakpoint left disarmed', () => {
        const manager = makeManager();
        twoMethods(manager);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 99 });
        const rules = manager.breakpointRulesFor(session());
        expect(rules).toHaveLength(1);
        expect(disarmed(rules, 'Array>>at:')).toBe(true);
      });

      it('arms it again once the breakpoint it waits for is enabled again', () => {
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [{ line: 2, enabled: true }]);
        mockGetMethodSource.mockReturnValue('foo\n^1');
        mockGetSourceOffsets.mockReturnValue([1, 5]);
        applyWith(manager, OTHER_METHOD, [{ line: 2, enabled: false }]);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });
        applyWith(manager, OTHER_METHOD, [{ line: 2, enabled: true }]);

        const rules = manager.breakpointRulesFor(session());
        expect(rules).toHaveLength(2);
        expect(disarmed(rules, 'Array>>at:')).toBe(false);
        expect(rules[rules.find((r) => r.label === 'Array>>at:')!.triggeredBy! - 1].label).toBe(
          'Array>>size',
        );
      });

      it('keeps the condition on a breakpoint that also waits for a trigger', () => {
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [{ line: 2, enabled: true, condition: 'index > 3' }]);
        mockGetMethodSource.mockReturnValue('foo\n^1');
        mockGetSourceOffsets.mockReturnValue([1, 5]);
        applyWith(manager, OTHER_METHOD, [{ line: 2, enabled: true }]);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });

        const rules = manager.breakpointRulesFor(session());
        const triggered = rules.find((r) => r.label === 'Array>>at:')!;
        expect(triggered.condition).toBe('index > 3');
        expect(triggered.triggeredBy).toBeDefined();
      });

      it('clearing a trigger puts the breakpoint back to stopping every time', () => {
        const manager = makeManager();
        twoMethods(manager);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });
        manager.setTrigger(Uri.parse(METHOD_URI), 2, undefined);

        expect(manager.triggerFor(Uri.parse(METHOD_URI), 2)).toBeUndefined();
        expect(manager.breakpointRulesFor(session())).toEqual([]);
      });

      it('forgets a trigger when the triggered method is recompiled', () => {
        const manager = makeManager();
        twoMethods(manager);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });
        manager.invalidateForUri(Uri.parse(METHOD_URI));
        expect(manager.triggerFor(Uri.parse(METHOD_URI), 2)).toBeUndefined();
      });

      it('keeps the waiting breakpoint disarmed when the TRIGGERING method is recompiled', () => {
        // The recompile takes the trigger's breakpoint away. The breakpoint
        // waiting on it keeps waiting, and says the one it waits for is gone,
        // rather than starting to stop every time.
        const manager = makeManager();
        twoMethods(manager);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });
        manager.invalidateForUri(Uri.parse(OTHER_METHOD));

        const rules = manager.breakpointRulesFor(session());
        expect(disarmed(rules, 'Array>>at:')).toBe(true);
        expect(manager.ruleOf(manager.appliedFor(Uri.parse(METHOD_URI))[0]).triggerProblem).toBe(
          'removed',
        );
      });

      it('forgets the trigger when the breakpoint that waited is removed', () => {
        // Otherwise a breakpoint set later on the same step point silently
        // inherits "Break after …", which nobody asked it to.
        const manager = makeManager();
        twoMethods(manager);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });

        applyWith(manager, METHOD_URI, []);
        applyWith(manager, METHOD_URI, [{ line: 2, enabled: true }]);

        expect(manager.triggerFor(Uri.parse(METHOD_URI), 2)).toBeUndefined();
        expect(manager.appliedFor(Uri.parse(METHOD_URI))[0].triggeredBy).toBeUndefined();
        expect(manager.breakpointRulesFor(session())).toEqual([]);
      });

      describe('when VS Code reports the change before the call returns', () => {
        // VS Code fires `onDidChangeBreakpoints` from inside `removeBreakpoints`
        // and `addBreakpoints`. The shared mock does not, so these tests do —
        // without that, a trigger lost between the remove and the add goes unseen.
        const plainAdd = (bps: unknown[]): void => {
          debug.breakpoints = [...debug.breakpoints, ...bps];
        };
        const plainRemove = (bps: unknown[]): void => {
          debug.breakpoints = debug.breakpoints.filter((bp) => !bps.includes(bp));
        };
        const reportAtOnce = (manager: ReturnType<typeof makeManager>): void => {
          vi.mocked(debug.addBreakpoints).mockImplementation((bps: unknown[]) => {
            plainAdd(bps);
            manager.applyToUri(session(), Uri.parse(METHOD_URI));
          });
          vi.mocked(debug.removeBreakpoints).mockImplementation((bps: unknown[]) => {
            plainRemove(bps);
            manager.applyToUri(session(), Uri.parse(METHOD_URI));
          });
        };

        afterEach(() => {
          vi.mocked(debug.addBreakpoints).mockImplementation(plainAdd);
          vi.mocked(debug.removeBreakpoints).mockImplementation(plainRemove);
          workspace.textDocuments = [];
        });

        it('keeps the trigger of a breakpoint that is disabled and enabled again', () => {
          const manager = makeManager();
          twoMethods(manager);
          manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });
          reportAtOnce(manager);

          manager.setAllEnabled(false);
          manager.setAllEnabled(true);

          expect(manager.triggerFor(Uri.parse(METHOD_URI), 2)).toEqual({
            uri: OTHER_METHOD,
            stepPoint: 2,
          });
          const rules = manager.breakpointRulesFor(session());
          const triggered = rules.find((r) => r.label === 'Array>>at:')!;
          expect(rules[triggered.triggeredBy! - 1].label).toBe('Array>>size');
        });

        it('keeps the trigger of a breakpoint whose condition is edited', async () => {
          const starts = buildLineStarts('foo\n^1');
          workspace.textDocuments = [
            {
              uri: Uri.parse(METHOD_URI),
              isDirty: false,
              getText: () => 'foo\n^1',
              positionAt: (o: number) => {
                const line = o >= starts[2] ? 2 : 1;
                return new Position(line - 1, o - starts[line]);
              },
            },
          ];
          const manager = makeManager();
          twoMethods(manager);
          manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });
          reportAtOnce(manager);
          vi.mocked(window.showInputBox).mockResolvedValue('index > 3');

          await manager.editConditionAtStepPoint(Uri.parse(METHOD_URI), 2);

          const edited = (debug.breakpoints as SourceBreakpoint[]).find(
            (bp) => bp.location.uri.toString() === Uri.parse(METHOD_URI).toString(),
          );
          expect(edited?.condition).toBe('index > 3');
          expect(manager.triggerFor(Uri.parse(METHOD_URI), 2)).toEqual({
            uri: OTHER_METHOD,
            stepPoint: 2,
          });
        });

        it('still forgets the trigger when the breakpoint that waited is removed', () => {
          const manager = makeManager();
          twoMethods(manager);
          manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });
          reportAtOnce(manager);

          debug.removeBreakpoints(
            debug.breakpoints.filter(
              (bp) => (bp as SourceBreakpoint).location.uri.toString() === METHOD_URI,
            ),
          );

          expect(manager.triggerFor(Uri.parse(METHOD_URI), 2)).toBeUndefined();
        });
      });

      it('keeps the trigger of a breakpoint that is still there when another goes', () => {
        const manager = makeManager();
        mockGetMethodSource.mockReturnValue('foo\n^1');
        mockGetSourceOffsets.mockReturnValue([1, 5]);
        applyWith(manager, OTHER_METHOD, [{ line: 2, enabled: true }]);
        applyWith(manager, METHOD_URI, [
          { line: 1, enabled: true },
          { line: 2, enabled: true },
        ]);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });

        applyWith(manager, METHOD_URI, [{ line: 2, enabled: true }]);

        expect(manager.triggerFor(Uri.parse(METHOD_URI), 2)).toEqual({
          uri: OTHER_METHOD,
          stepPoint: 2,
        });
      });

      it('forgets every trigger on Remove All', () => {
        const manager = makeManager();
        twoMethods(manager);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });
        manager.removeAll();
        expect(manager.triggerFor(Uri.parse(METHOD_URI), 2)).toBeUndefined();
      });

      it('tells the views a trigger changed — no breakpoint event will', () => {
        const manager = makeManager();
        twoMethods(manager);
        const fired = vi.fn();
        manager.onDidApply(fired);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });
        expect(fired).toHaveBeenCalledTimes(1);
      });

      describe('the picker', () => {
        const THIRD = 'gemstone://1/Globals/Array/instance/accessing/first';

        /** Arm three methods, one breakpoint each, and answer their URIs. */
        const threeMethods = (manager: ReturnType<typeof makeManager>) => {
          applyWith(manager, METHOD_URI, [{ line: 2, enabled: true }]);
          mockGetMethodSource.mockReturnValue('foo\n^1');
          mockGetSourceOffsets.mockReturnValue([1, 5]);
          applyWith(manager, OTHER_METHOD, [{ line: 2, enabled: true }]);
          applyWith(manager, THIRD, [{ line: 2, enabled: true }]);
        };

        /** The labels the picker offered, minus the "always armed" escape. */
        const offered = (): string[] => {
          const items = vi.mocked(window.showQuickPick).mock.calls[0][0] as {
            label: string;
          }[];
          return items.map((i) => i.label).filter((l) => l !== 'Always armed');
        };

        beforeEach(() => {
          vi.mocked(window.showQuickPick).mockReset();
          vi.mocked(window.showInformationMessage).mockClear();
        });

        it('offers every other breakpoint in the session', async () => {
          const manager = makeManager();
          threeMethods(manager);
          vi.mocked(window.showQuickPick).mockResolvedValue(undefined);

          await manager.editTriggerAtStepPoint(Uri.parse(METHOD_URI), 2);

          expect(offered()).toEqual(['Array>>size @2', 'Array>>first @2']);
        });

        it('leaves out the breakpoint being edited', async () => {
          const manager = makeManager();
          threeMethods(manager);
          vi.mocked(window.showQuickPick).mockResolvedValue(undefined);

          await manager.editTriggerAtStepPoint(Uri.parse(OTHER_METHOD), 2);

          expect(offered()).not.toContain('Array>>size @2');
        });

        it('leaves out a breakpoint that already waits on this one', async () => {
          const manager = makeManager();
          threeMethods(manager);
          // size waits on at:, so at: cannot be made to wait on size.
          manager.setTrigger(Uri.parse(OTHER_METHOD), 2, { uri: METHOD_URI, stepPoint: 2 });
          vi.mocked(window.showQuickPick).mockResolvedValue(undefined);

          await manager.editTriggerAtStepPoint(Uri.parse(METHOD_URI), 2);

          expect(offered()).toEqual(['Array>>first @2']);
        });

        it('leaves out a breakpoint that waits on this one through a chain', async () => {
          // first → size → at:. Offering either as at:'s trigger would close a
          // ring in which nothing is ever reached and nothing ever says so.
          const manager = makeManager();
          threeMethods(manager);
          manager.setTrigger(Uri.parse(OTHER_METHOD), 2, { uri: METHOD_URI, stepPoint: 2 });
          manager.setTrigger(Uri.parse(THIRD), 2, { uri: OTHER_METHOD, stepPoint: 2 });
          vi.mocked(window.showQuickPick).mockResolvedValue(undefined);

          await manager.editTriggerAtStepPoint(Uri.parse(METHOD_URI), 2);

          // Nothing left to offer, so it says so rather than showing an empty list.
          expect(vi.mocked(window.showQuickPick)).not.toHaveBeenCalled();
          expect(vi.mocked(window.showInformationMessage)).toHaveBeenCalledWith(
            expect.stringContaining('no other breakpoint to wait for'),
          );
        });

        it('refuses a step point with no breakpoint on it', async () => {
          const manager = makeManager();
          threeMethods(manager);

          await manager.editTriggerAtStepPoint(Uri.parse(METHOD_URI), 99);

          expect(vi.mocked(window.showQuickPick)).not.toHaveBeenCalled();
          expect(vi.mocked(window.showInformationMessage)).toHaveBeenCalledWith(
            expect.stringContaining('no breakpoint at step point 99'),
          );
        });

        it('records what was picked, and clears on "Always armed"', async () => {
          const manager = makeManager();
          threeMethods(manager);

          vi.mocked(window.showQuickPick).mockResolvedValue({
            label: 'Array>>size @2',
            ref: { uri: OTHER_METHOD, stepPoint: 2 },
          });
          await manager.editTriggerAtStepPoint(Uri.parse(METHOD_URI), 2);
          expect(manager.triggerFor(Uri.parse(METHOD_URI), 2)).toEqual({
            uri: OTHER_METHOD,
            stepPoint: 2,
          });

          // The escape hatch carries no ref, which is what clears the trigger.
          vi.mocked(window.showQuickPick).mockResolvedValue({ label: 'Always armed' });
          await manager.editTriggerAtStepPoint(Uri.parse(METHOD_URI), 2);
          expect(manager.triggerFor(Uri.parse(METHOD_URI), 2)).toBeUndefined();
        });

        it('lets the picker close when focus moves away, like every other picker', async () => {
          // Nothing is typed into it, so nothing is lost by closing it.
          const manager = makeManager();
          threeMethods(manager);
          vi.mocked(window.showQuickPick).mockResolvedValue(undefined);
          await manager.editTriggerAtStepPoint(Uri.parse(METHOD_URI), 2);
          expect(vi.mocked(window.showQuickPick).mock.calls[0][1]).not.toHaveProperty(
            'ignoreFocusOut',
          );
        });

        it('changes nothing when the picker is cancelled', async () => {
          const manager = makeManager();
          threeMethods(manager);
          manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });

          vi.mocked(window.showQuickPick).mockResolvedValue(undefined);
          await manager.editTriggerAtStepPoint(Uri.parse(METHOD_URI), 2);

          expect(manager.triggerFor(Uri.parse(METHOD_URI), 2)).toEqual({
            uri: OTHER_METHOD,
            stepPoint: 2,
          });
        });
      });

      it('forgets every trigger when the session logs out', () => {
        const manager = makeManager();
        twoMethods(manager);
        manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: OTHER_METHOD, stepPoint: 2 });
        manager.clearAllForSession(1);
        expect(manager.triggerFor(Uri.parse(METHOD_URI), 2)).toBeUndefined();
      });
    });

    describe('the same method reached by two URIs', () => {
      /**
       * One compiled method can be addressed by more than one `gemstone://` URI
       * — the Explorer scopes its URIs to a dictionary index, a GemStone
       * Breakpoints row builds one from what the gem reports. The gem has ONE
       * set of breakpoints for the method, so whatever is done through either
       * URI has to act on the breakpoints set through both: a row's buttons
       * open the gem-built URI for a breakpoint set in an Explorer editor.
       */
      const OTHER_URI = `${METHOD_URI}?dict=4`;
      const SIZE_METHOD = 'gemstone://1/Globals/Array/instance/accessing/size';

      it('arms the breakpoints set through either URI, whichever one is applied', () => {
        // The gem's method is cleared before anything is armed, so arming only
        // the applied URI's breakpoints would silently disarm the other's while
        // its red dot stayed.
        const manager = makeManager();
        applyWith(manager, OTHER_URI, [{ line: 2, enabled: true, condition: 'index = 900' }]);
        mockSetBreakAtStepPoint.mockClear();
        applyWith(manager, METHOD_URI, [{ line: 1, enabled: true }]);

        expect([...armedStepPoints()].sort()).toEqual([1, 2]);
        expect(manager.appliedFor(Uri.parse(METHOD_URI)).map((a) => a.stepPoint)).toEqual([2, 1]);
      });

      it('answers the same record whichever URI asks', () => {
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [{ line: 2, enabled: true, condition: 'index = 900' }]);
        applyWith(manager, OTHER_URI, [{ line: 1, enabled: true }]);

        expect(manager.appliedFor(Uri.parse(OTHER_URI))).toBe(
          manager.appliedFor(Uri.parse(METHOD_URI)),
        );
        expect(manager.appliedFor(Uri.parse(METHOD_URI))[0].condition).toBe('index = 900');
      });

      it('sends the gem one rule per breakpoint, not one per URI', () => {
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [{ line: 2, enabled: true, condition: 'index = 900' }]);
        applyWith(manager, OTHER_URI, [{ line: 1, enabled: true }]);

        const specs = manager.breakpointRulesFor(session());
        expect(specs).toHaveLength(1);
        expect(specs[0].condition).toBe('index = 900');
      });

      it('leaves a different method alone', () => {
        mockGetMethodSource.mockReturnValue('foo\n^1');
        mockGetSourceOffsets.mockReturnValue([1, 5]);
        const manager = makeManager();
        applyWith(manager, METHOD_URI, [{ line: 2, enabled: true, condition: 'index = 900' }]);
        applyWith(manager, SIZE_METHOD, [{ line: 2, enabled: true, condition: 'n > 1' }]);

        expect(manager.appliedFor(Uri.parse(METHOD_URI))).toHaveLength(1);
        expect(manager.breakpointRulesFor(session())).toHaveLength(2);
      });

      describe('acting through the other URI', () => {
        /** METHOD_URI open and saved — the editor a Breakpoints row reveals. */
        beforeEach(() => {
          const starts = buildLineStarts('foo\n^1');
          workspace.textDocuments = [
            {
              uri: Uri.parse(METHOD_URI),
              isDirty: false,
              getText: () => 'foo\n^1',
              positionAt: (o: number) => {
                const line = o >= starts[2] ? 2 : 1;
                return new Position(line - 1, o - starts[line]);
              },
            },
          ];
          vi.mocked(window.showInputBox).mockReset();
          vi.mocked(window.showQuickPick).mockReset();
          vi.mocked(window.showInformationMessage).mockClear();
        });

        it('edits the condition of the breakpoint set through the Explorer URI', async () => {
          const manager = makeManager();
          applyWith(manager, OTHER_URI, [{ line: 2, enabled: true, condition: 'index = 900' }]);
          const original = debug.breakpoints[0];
          vi.mocked(window.showInputBox).mockResolvedValue('index = 950');

          await manager.editConditionAtStepPoint(Uri.parse(METHOD_URI), 2);

          // The box shows the condition the breakpoint has, and the edit replaces
          // that breakpoint — not a second one added beside it.
          expect(vi.mocked(window.showInputBox).mock.calls[0][0]).toMatchObject({
            value: 'index = 900',
          });
          expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([original]);
          expect(debug.breakpoints).toHaveLength(1);
          const [edited] = debug.breakpoints as SourceBreakpoint[];
          expect(edited.condition).toBe('index = 950');
          expect(edited.location.uri.toString()).toBe(Uri.parse(OTHER_URI).toString());
        });

        it('clears, from a hover link, the breakpoint set through the Explorer URI', () => {
          const manager = makeManager();
          applyWith(manager, OTHER_URI, [{ line: 2, enabled: true }]);
          manager.clearAtStepPoint(Uri.parse(METHOD_URI), 2);
          expect(debug.breakpoints).toEqual([]);
        });

        it('offers the trigger picker for a breakpoint applied through the Explorer URI', async () => {
          const manager = makeManager();
          applyWith(manager, OTHER_URI, [{ line: 2, enabled: true }]);
          applyWith(manager, SIZE_METHOD, [{ line: 2, enabled: true }]);
          vi.mocked(window.showQuickPick).mockResolvedValue(undefined);

          await manager.editTriggerAtStepPoint(Uri.parse(METHOD_URI), 2);

          expect(vi.mocked(window.showInformationMessage)).not.toHaveBeenCalled();
          expect(vi.mocked(window.showQuickPick)).toHaveBeenCalled();
        });

        it('keeps a trigger set through one URI when the method is applied through the other', () => {
          const manager = makeManager();
          applyWith(manager, METHOD_URI, [{ line: 2, enabled: true }]);
          applyWith(manager, SIZE_METHOD, [{ line: 2, enabled: true }]);
          manager.setTrigger(Uri.parse(METHOD_URI), 2, { uri: SIZE_METHOD, stepPoint: 2 });

          applyWith(manager, OTHER_URI, [{ line: 1, enabled: true }]);

          expect(
            manager.appliedFor(Uri.parse(OTHER_URI)).find((a) => a.stepPoint === 2),
          ).toMatchObject({ triggeredBy: { uri: SIZE_METHOD, stepPoint: 2 } });
          const rules = manager.breakpointRulesFor(session());
          const waiting = rules.find((r) => r.label === 'Array>>at:')!;
          expect(rules[waiting.triggeredBy! - 1].label).toBe('Array>>size');
        });

        it('drops the breakpoints set through every URI when the method is recompiled', () => {
          const manager = makeManager();
          applyWith(manager, OTHER_URI, [{ line: 2, enabled: true }]);
          manager.invalidateForUri(Uri.parse(METHOD_URI));
          expect(debug.breakpoints).toEqual([]);
          expect(manager.appliedFor(Uri.parse(OTHER_URI))).toEqual([]);
        });
      });
    });

    describe('ruleForStoneBreakpoint', () => {
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
        expect(manager.ruleForStoneBreakpoint(stoneBp())?.condition).toBe('index > 3');
      });

      it('answers nothing for a breakpoint at another step point', () => {
        debug.breakpoints = [conditional('index > 3')];
        const manager = makeManager();
        manager.applyToUri(session(), Uri.parse(METHOD_URI));
        expect(manager.ruleForStoneBreakpoint(stoneBp({ stepPoint: 1 }))).toBeUndefined();
      });

      it('answers nothing for a breakpoint Jasper did not set', () => {
        expect(makeManager().ruleForStoneBreakpoint(stoneBp())).toBeUndefined();
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
      manager.applyToUri(session(), Uri.parse(METHOD_URI));
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

      setVsCodeBreakpoints(METHOD_URI, [{ line: 1 }]);
      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI));
      const before = mockGetSourceOffsets.mock.calls.length;

      // Invalidating takes the breakpoint out of VS Code's list; set it again.
      manager.invalidateForUri(Uri.parse(METHOD_URI));
      setVsCodeBreakpoints(METHOD_URI, [{ line: 1 }]);
      manager.applyToUri(session(), Uri.parse(METHOD_URI));

      expect(mockGetSourceOffsets.mock.calls.length).toBeGreaterThan(before);
    });
  });

  describe('clearAllForSession', () => {
    it('forgets a logged-out session, so nothing is re-pushed for it', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      setVsCodeBreakpoints(METHOD_URI, [{ line: 1 }]);
      const manager = makeManager();
      const uri = Uri.parse(METHOD_URI);
      manager.applyToUri(session(), uri);
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

      setVsCodeBreakpoints(METHOD_URI, [{ line: 1 }]);
      const manager = makeManager();
      const uri = Uri.parse(METHOD_URI);
      manager.applyToUri(session(), uri);

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

  describe('the at-Cursor commands that edit a breakpoint', () => {
    /**
     * The breakpoint they act on is the one on the caret's line when the caret
     * is not on its exact token: a developer right-clicking a line with one red
     * dot means that breakpoint, and the caret's nearest step point is
     * routinely another token on the same line.
     */
    // 'x := self foo': step point 1 is `self` (column 5), 2 is `foo` (column 10).
    const SOURCE = 'm\nx := self foo';
    const editorAt = (offset: number) => {
      const starts = buildLineStarts(SOURCE);
      const positionAt = (o: number) => {
        const line = o >= starts[2] ? 2 : 1;
        return new Position(line - 1, o - starts[line]);
      };
      return {
        document: {
          uri: Uri.parse(METHOD_URI),
          isDirty: false,
          getText: () => SOURCE,
          offsetAt: () => offset,
          positionAt,
        },
        selection: { active: positionAt(offset) },
      } as unknown as import('vscode').TextEditor;
    };
    // The caret on `foo`, right of a gutter breakpoint that sits on `self`.
    const ON_FOO = 12;

    beforeEach(() => {
      mockGetMethodSource.mockReturnValue(SOURCE);
      mockGetSourceOffsets.mockReturnValue([8, 13]);
      vi.mocked(window.showInputBox).mockReset();
      vi.mocked(window.showQuickPick).mockReset();
      vi.mocked(window.showInformationMessage).mockClear();
    });

    it("edits the line's breakpoint rather than adding a second one", async () => {
      const gutter = sourceBreakpoint(METHOD_URI, { line: 2, condition: 'x > 1' });
      debug.breakpoints = [gutter];
      vi.mocked(window.showInputBox).mockResolvedValue('x > 2');

      await makeManager().editConditionAtCursor(editorAt(ON_FOO));

      expect(vi.mocked(window.showInputBox).mock.calls[0][0]).toMatchObject({ value: 'x > 1' });
      expect(debug.breakpoints).toHaveLength(1);
      expect((debug.breakpoints[0] as SourceBreakpoint).condition).toBe('x > 2');
    });

    it("offers the trigger picker for the line's breakpoint", async () => {
      const manager = makeManager();
      applyWith(manager, METHOD_URI, [{ line: 2 }]);
      applyWith(manager, 'gemstone://1/Globals/Array/instance/accessing/size', [{ line: 2 }]);
      vi.mocked(window.showQuickPick).mockResolvedValue(undefined);

      await manager.editTriggerAtCursor(editorAt(ON_FOO));

      expect(vi.mocked(window.showInformationMessage)).not.toHaveBeenCalled();
      expect(vi.mocked(window.showQuickPick).mock.calls[0][1]).toMatchObject({
        title: 'Break at step point 1 only after…',
      });
    });

    it('names the line, not a step point, when the line has no breakpoint', async () => {
      debug.breakpoints = [];
      await makeManager().editTriggerAtCursor(editorAt(ON_FOO));
      expect(vi.mocked(window.showInformationMessage)).toHaveBeenCalledWith(
        expect.stringContaining('no breakpoint on line 2'),
      );
    });

    it("disables the line's breakpoint", () => {
      const gutter = sourceBreakpoint(METHOD_URI, { line: 2 });
      debug.breakpoints = [gutter];

      makeManager().setEnabledAtCursor(editorAt(ON_FOO), false);

      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([gutter]);
      expect(debug.breakpoints).toHaveLength(1);
      expect((debug.breakpoints[0] as SourceBreakpoint).enabled).toBe(false);
    });

    it('takes the nearest when the line has several and the caret is on neither', async () => {
      // Three step points: `x` (2), `self` (7), `foo` (12). Breakpoints on the
      // first and last; the caret on `self` is nearer `foo`.
      mockGetSourceOffsets.mockReturnValue([3, 8, 13]);
      const onX = sourceBreakpoint(METHOD_URI, { line: 2, condition: 'on x' });
      const onFoo = sourceBreakpoint(METHOD_URI, { line: 2, character: 10, condition: 'on foo' });
      debug.breakpoints = [onX, onFoo];
      vi.mocked(window.showInputBox).mockResolvedValue(undefined);

      await makeManager().editConditionAtCursor(editorAt(8));

      expect(vi.mocked(window.showInputBox).mock.calls[0][0]).toMatchObject({ value: 'on foo' });
    });

    it('still toggles exactly at the caret, beside the breakpoint already on the line', () => {
      const gutter = sourceBreakpoint(METHOD_URI, { line: 2 });
      debug.breakpoints = [gutter];

      makeManager().toggleAtCursor(editorAt(ON_FOO));

      expect(vi.mocked(debug.removeBreakpoints)).not.toHaveBeenCalled();
      expect(debug.breakpoints).toHaveLength(2);
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
    const SESSION_ONE = fakeActiveSession({
      id: 1,
      gci: {},
      login: { label: 'One' },
      stoneVersion: '3.7.2',
    });
    const SESSION_TWO = fakeActiveSession({
      id: 2,
      gci: {},
      login: { label: 'Two' },
      stoneVersion: '3.7.2',
    });
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
    const sessionsSetIn = () => mockSetBreakAtStepPoint.mock.calls.map((c) => c[0].id);

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

    it("offers as triggers only the breakpoints in the method's own gem", async () => {
      // A trigger is judged in the gem the run is in. One from the selected
      // session's gem could never be reached there, and would leave this
      // breakpoint reading "Break after …" while stopping every time.
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);
      const manager = managerOverTwo();
      const inOne = 'gemstone://1/Globals/Array/instance/accessing/size';
      const inTwo = 'gemstone://2/Globals/Array/instance/accessing/size';
      const apply = (uri: string, s: typeof SESSION_ONE) => {
        debug.breakpoints = [
          ...debug.breakpoints,
          new SourceBreakpoint(new Location(Uri.parse(uri), new Position(1, 0))),
        ];
        manager.applyToUri(s, Uri.parse(uri));
      };
      debug.breakpoints = [];
      apply(METHOD_URI, SESSION_ONE);
      apply(inOne, SESSION_ONE);
      apply(inTwo, SESSION_TWO);
      vi.mocked(window.showQuickPick).mockReset().mockResolvedValue(undefined);

      await manager.editTriggerAtStepPoint(Uri.parse(METHOD_URI), 2);

      const items = vi.mocked(window.showQuickPick).mock.calls[0][0] as unknown as {
        label: string;
        ref?: { uri: string };
      }[];
      expect(items.filter((i) => i.ref).map((i) => i.ref!.uri)).toEqual([inOne]);
    });

    it('arms a breakpoint in the gem the method was opened from, not the selected one', () => {
      const bp = new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(1, 0)));
      debug.breakpoints = [bp];

      managerOverTwo();
      fire({ added: [bp] });

      // Armed in session one — the method on screen belongs to its gem.
      expect(sessionsSetIn()).toEqual([1]);
    });

    it("does not clear the selected session's breakpoints on the same method", () => {
      const bp = new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(1, 0)));
      debug.breakpoints = [bp];

      managerOverTwo();
      fire({ added: [bp] });

      // `applyToUri` clears the method before re-arming it. Aimed at the wrong
      // gem, that clear would take out breakpoints the other session had set.
      expect(mockClearAllBreaks.mock.calls.map((c) => c[0].id)).toEqual([1]);
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
      manager.applyToUri(SESSION_ONE, Uri.parse(METHOD_URI));
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
      expect(mockDisableAll.mock.calls.map((c) => c[0].id)).toEqual([1, 2]);
    });

    it('sweeps every live gem when all breakpoints are enabled again', () => {
      mockEnableAll.mockClear();
      debug.breakpoints = [
        new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(1, 0)), false),
      ];

      managerOverTwo().setAllEnabled(true);

      expect(mockEnableAll.mock.calls.map((c) => c[0].id)).toEqual([1, 2]);
    });

    it('sweeps every live gem when all breakpoints are removed', () => {
      mockRemoveAll.mockClear();
      debug.breakpoints = [
        new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(1, 0))),
      ];

      managerOverTwo().removeAll();

      expect(mockRemoveAll.mock.calls.map((c) => c[0].id)).toEqual([1, 2]);
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

    it('says so out loud', () => {
      // An unverified marker on its own is unreadable: it looks exactly like a
      // breakpoint on a line with no step point.
      mockSetBreakAtStepPoint.mockImplementation(() => {
        throw new Error('GCI error 2010');
      });

      setVsCodeBreakpoints(METHOD_URI, [{ line: 1 }]);
      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI));

      expect(manager.appliedFor(Uri.parse(METHOD_URI))).toHaveLength(0);
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

      setVsCodeBreakpoints(METHOD_URI, [{ line: 1, enabled: false }]);
      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI));

      expect(mockClearBreakAtStepPoint).toHaveBeenCalled();
      expect(manager.appliedFor(Uri.parse(METHOD_URI))).toHaveLength(0);
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

      setVsCodeBreakpoints(METHOD_URI, [{ line: 1, enabled: false }]);
      makeManager().applyToUri(session(), Uri.parse(METHOD_URI));

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
      setVsCodeBreakpoints(METHOD_URI, [{ line: 1 }]);
      manager.applyToUri(session(), uri);
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

      manager.applyToUri(session(), uri);

      expect(manager.appliedFor(uri)).toHaveLength(0);
      expect(fired).toBeGreaterThan(0);
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalled();
    });
  });
});
