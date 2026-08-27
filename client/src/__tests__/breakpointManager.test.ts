import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  getMethodSource: vi.fn(() => ''),
  getSourceOffsets: vi.fn(() => []),
  getStepPointSelectorRanges: vi.fn(() => []),
  setBreakAtStepPoint: vi.fn(),
  clearBreakAtStepPoint: vi.fn(),
  disableBreakAtStepPoint: vi.fn(),
  clearAllBreaks: vi.fn(),
}));

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
import { BreakpointManager, buildLineOffsets, mapOffsetToStepPoint } from '../breakpointManager';
import { SessionManager } from '../sessionManager';
import { StepPointModel, buildLineStarts } from '../stepPointModel';
import {
  getMethodSource,
  getSourceOffsets,
  setBreakAtStepPoint,
  disableBreakAtStepPoint,
  clearAllBreaks,
} from '../browserQueries';

const mockGetMethodSource = vi.mocked(getMethodSource);
const mockGetSourceOffsets = vi.mocked(getSourceOffsets);
const mockSetBreakAtStepPoint = vi.mocked(setBreakAtStepPoint);
const mockClearAllBreaks = vi.mocked(clearAllBreaks);
const mockDisableBreakAtStepPoint = vi.mocked(disableBreakAtStepPoint);

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

describe('buildLineOffsets', () => {
  it('returns offsets for a single-line source', () => {
    const offsets = buildLineOffsets('hello');
    // offsets[0] = 0 (dummy), offsets[1] = 0 (line 1 starts at 0)
    expect(offsets[1]).toBe(0);
    expect(offsets.length).toBe(2);
  });

  it('returns offsets for multi-line source', () => {
    const offsets = buildLineOffsets('abc\ndef\nghi');
    // Line 1: offset 0, Line 2: offset 4, Line 3: offset 8
    expect(offsets[1]).toBe(0);
    expect(offsets[2]).toBe(4);
    expect(offsets[3]).toBe(8);
    expect(offsets.length).toBe(4);
  });

  it('handles empty source', () => {
    const offsets = buildLineOffsets('');
    expect(offsets[1]).toBe(0);
    expect(offsets.length).toBe(2);
  });
});

// Column-aware mapping for "Run to Cursor": the cursor's column chooses among
// several step points on the same line, rather than taking the leftmost one.
describe('mapOffsetToStepPoint', () => {
  // `x := a asInteger` — 1-based source offsets: sp1@1 (x), sp2@6 (a), sp3@8 (asInteger).
  const so = [1, 6, 8];
  const lineStart = 0;
  const lineEnd = 16; // whole single line

  it('picks the step point nearest the cursor column, not the leftmost on the line', () => {
    // Cursor on `asInteger` (offset 7) → sp3, NOT the leftmost sp1 (the := store).
    expect(mapOffsetToStepPoint(7, so, lineStart, lineEnd)).toEqual({ stepPoint: 3, offset: 8 });
  });

  it('picks the leftmost when the cursor is at the start of the line', () => {
    expect(mapOffsetToStepPoint(0, so, lineStart, lineEnd)).toEqual({ stepPoint: 1, offset: 1 });
  });

  it('breaks inside a one-line block when the cursor is in the block body', () => {
    // `self do: [:e | body ]` style: sp1@5 (self), sp2@10 (do:), sp3@20 (body).
    const blk = [5, 10, 20];
    // Cursor at offset 19 (on `body`) → sp3, not the do:/self sends.
    expect(mapOffsetToStepPoint(19, blk, 0, 30)).toEqual({ stepPoint: 3, offset: 20 });
  });

  it('falls back to the nearest step point AFTER the cursor when its line has none', () => {
    // Cursor on a blank line [10, 20) with no step point → nearest after (offset 25).
    expect(mapOffsetToStepPoint(12, [5, 25, 40], 10, 20)).toEqual({ stepPoint: 2, offset: 25 });
  });

  it('returns null when the cursor is past every step point', () => {
    expect(mapOffsetToStepPoint(100, [5, 10], 90, 110)).toBeNull();
  });
});

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

  // VS Code offers the breakpoint gutter wherever the gemstone-smalltalk language
  // is — a workspace and a .gst file as well as a gemstone:// method editor —
  // because `contributes.breakpoints` names a language and cannot be narrowed by
  // URI scheme. Only the method editor can carry a breakpoint.
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
        { uri: Uri.parse('untitled:Workspace'), languageId: 'gemstone-smalltalk' },
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

    it('leaves a real method editor alone', () => {
      const real = bpOn(METHOD_URI);
      workspace.textDocuments = [
        { uri: Uri.parse(METHOD_URI), languageId: 'gemstone-smalltalk', isDirty: false },
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

    it('warns that a condition is ignored, rather than silently not honouring it', () => {
      fire({ added: [withFields({ condition: 'x > 3' })] });
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalledWith(
        expect.stringContaining('ignore conditions'),
      );
    });

    it('warns for a hit count', () => {
      fire({ added: [withFields({ hitCondition: '5' })] });
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalled();
    });

    it('warns for a log message (a logpoint)', () => {
      fire({ added: [withFields({ logMessage: 'here' })] });
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalled();
    });

    it('warns when a condition is added to an existing breakpoint', () => {
      // Edit Breakpoint on an existing one arrives as a change, not an addition.
      fire({ changed: [withFields({ condition: 'x > 3' })] });
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalled();
    });

    it('says nothing for a plain breakpoint', () => {
      fire({
        added: [new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(0, 0)))],
      });
      expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
    });

    it('warns once for several conditional breakpoints, not once each', () => {
      fire({ added: [withFields({ condition: 'a' }), withFields({ condition: 'b' })] });
      expect(vi.mocked(window.showWarningMessage)).toHaveBeenCalledTimes(1);
    });

    it('ignores a conditional breakpoint on a non-gemstone file', () => {
      const fileBp = new SourceBreakpoint(
        new Location(Uri.parse('file:///a.ts'), new Position(0, 0)),
        true,
        'x > 3',
      );
      fire({ added: [fileBp] });
      expect(vi.mocked(window.showWarningMessage)).not.toHaveBeenCalled();
    });

    it('still carries the fields across an enable/disable round trip', () => {
      // Nothing is lost if conditions are honoured later.
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
});
