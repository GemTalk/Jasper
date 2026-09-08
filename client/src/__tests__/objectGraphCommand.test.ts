// Getting from a selection in the editor to an open reference graph.
//
// codeExecutor owns the three things between the two: turning a selection into a result
// OOP, screening out what cannot be scanned, and resolving the dirty-session question. The
// last is the one that decides whether the feature dead-ends -- every repository-wide scan
// aborts the session, so GemStone refuses to run one while uncommitted work is pending, and
// a selection that CREATES an object lands there every time.
//
// The walk and its panel are stubbed. What is asserted here is the deps codeExecutor hands
// them, which is where its half of the behaviour lives.
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock('../transcriptChannel', () => ({
  appendTranscript: vi.fn(),
  appendTranscriptOutput: vi.fn(),
  showTranscript: vi.fn(),
}));
vi.mock('../socketPoll', () => ({ pollReadable: vi.fn(() => 1) }));
vi.mock('../debuggerPanel', () => ({ DebuggerPanel: { create: vi.fn() } }));
vi.mock('../enhancedInspector/enhancedInspector', () => ({
  EnhancedInspector: { create: vi.fn() },
}));
vi.mock('../objectGraph/objectGraphPanel', () => ({
  ObjectGraphPanel: { create: vi.fn(() => ({ render: vi.fn(), dispose: vi.fn() })) },
}));

// Captures the deps every walk is built with, and never scans anything.
const walks: { deps: ObjectGraphWalkDeps; start: Mock; releaseAll: Mock }[] = [];
vi.mock('../objectGraph/objectGraphWalk', () => ({
  ObjectGraphWalk: vi.fn(function (this: unknown, _session: unknown, deps: ObjectGraphWalkDeps) {
    const entry = { deps, start: vi.fn(async () => undefined), releaseAll: vi.fn() };
    walks.push(entry);
    Object.assign(this as object, { start: entry.start, releaseAll: entry.releaseAll });
  }),
}));

import * as vscode from 'vscode';
import { CodeExecutor, ObjectGraphDeps } from '../codeExecutor';
import type { ObjectGraphWalkDeps } from '../objectGraph/objectGraphWalk';
import { SessionManager, ActiveSession } from '../sessionManager';

const OOP_NIL = 0x14n;
const RESULT_OOP = 200n;

/** A GCI that executes anything and answers {@link RESULT_OOP}. */
const makeGci = (overrides: Record<string, unknown> = {}) => ({
  utf8ClassOop: vi.fn(() => 100n),
  GciTsNbExecute: vi.fn(() => ({ success: true, err: { number: 0, message: '' } })),
  GciTsNbPoll: vi.fn(() => ({ result: 1, err: { number: 0 } })),
  GciTsCallInProgress: vi.fn(() => ({ result: 0, err: { number: 0 } })),
  GciTsNbResult: vi.fn(() => ({
    result: RESULT_OOP,
    err: { number: 0, message: '', context: OOP_NIL },
  })),
  GciTsSocket: vi.fn(() => ({ fd: 7, err: { number: 0 } })),
  isAvailable: vi.fn(() => true),
  GciTsClearStack: vi.fn(),
  GciTsOopIsSpecial: vi.fn(() => false),
  GciTsSaveObjs: vi.fn(() => ({ success: true, err: { number: 0, message: '' } })),
  GciTsReleaseObjs: vi.fn(() => ({ success: true, err: { number: 0, message: '' } })),
  executeAndFetchString: vi.fn(() => ''),
  GciTsPerformFetchBytes: vi.fn(() => ({ data: 'anObject', err: { number: 0 } })),
  GciTsFetchClass: vi.fn(() => ({ result: 300n, err: { number: 0 } })),
  GciTsObjExists: vi.fn(() => true),
  ...overrides,
});

const makeEditor = (text: string, empty = false) => ({
  document: {
    uri: vscode.Uri.file('/workspace/test.gs'),
    getText: vi.fn(() => text),
    lineAt: vi.fn(() => ({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: text.length } },
    })),
    languageId: 'gemstone-smalltalk',
  },
  selection: { isEmpty: empty, active: { line: 0 } },
  setDecorations: vi.fn(),
});

describe('Show Reference Graph, from a selection to an open graph', () => {
  let gci: ReturnType<typeof makeGci>;
  let session: ActiveSession;
  let executor: CodeExecutor;
  let deps: ObjectGraphDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    walks.length = 0;
    gci = makeGci();
    session = {
      id: 1,
      gci,
      handle: {},
      login: { label: 'T' },
      stoneVersion: '3.7.5',
    } as unknown as ActiveSession;
    executor = new CodeExecutor({
      resolveSession: vi.fn(async () => session),
      getSessions: vi.fn(() => [session]),
      getSession: vi.fn(() => session),
    } as unknown as SessionManager);
    deps = {
      inspectorProvider: {} as ObjectGraphDeps['inspectorProvider'],
      commit: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
      revealClass: vi.fn(async () => undefined),
    };
    (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor =
      makeEditor('Globals at: #Array');
  });

  describe('what it asks about', () => {
    it('evaluates the selection and opens a graph on the result', async () => {
      await executor.showReferenceGraphIt(deps);

      expect(walks).toHaveLength(1);
      expect(walks[0].start).toHaveBeenCalledWith(RESULT_OOP, []);
    });

    it('takes the cursor’s line when nothing is selected', async () => {
      // The same selection handling as Inspect It, deliberately: "what points at this?" is
      // asked about the thing Inspect It would open.
      const editor = makeEditor('Globals at: #Array', true);
      (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = editor;

      await executor.showReferenceGraphIt(deps);

      expect(editor.document.lineAt).toHaveBeenCalled();
      expect(walks).toHaveLength(1);
    });

    it('says there is nothing to run rather than executing whitespace', async () => {
      (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor =
        makeEditor('   ');

      await executor.showReferenceGraphIt(deps);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('No code to execute.');
      expect(gci.GciTsNbExecute).not.toHaveBeenCalled();
    });

    it('needs an editor to have a selection at all', async () => {
      (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = undefined;

      await executor.showReferenceGraphIt(deps);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No active text editor.');
      expect(walks).toHaveLength(0);
    });
  });

  describe('what cannot be scanned', () => {
    it('explains an immediate instead of letting the kernel say “not a Pom oop”', async () => {
      // A SmallInteger, Character, Boolean or nil has no identity to scan for. The kernel's
      // own message is true and useless, so this is screened out before the scan.
      gci.GciTsOopIsSpecial = vi.fn(() => true);

      await executor.presentObjectGraph(session, 42n, deps);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('references to objects, not to immediate values'),
      );
      expect(walks).toHaveLength(0);
    });

    it('screens out nil, which is an immediate the GCI does not flag', async () => {
      await executor.presentObjectGraph(session, OOP_NIL, deps);

      expect(walks).toHaveLength(0);
    });

    it('opens a graph on a real object', async () => {
      await executor.presentObjectGraph(session, 31553793n, deps);

      expect(walks).toHaveLength(1);
      expect(walks[0].start).toHaveBeenCalledWith(31553793n, []);
    });
  });

  describe('the dirty-session question', () => {
    /** The walk's own `withCleanSession`, as codeExecutor built it. */
    const withCleanSession = async (): Promise<ObjectGraphWalkDeps['withCleanSession']> => {
      await executor.presentObjectGraph(session, 31553793n, deps);
      return walks[0].deps.withCleanSession;
    };

    it('asks nothing when the session is already clean', async () => {
      const run = await withCleanSession();
      const scan = vi.fn(async () => ({ kind: 'ok' as const, value: 1 }));

      await expect(run(scan)).resolves.toEqual({ kind: 'ok', value: 1 });
      expect(scan).toHaveBeenCalledTimes(1);
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('offers Commit and Abort rather than dead-ending', async () => {
      const run = await withCleanSession();
      (vscode.window.showWarningMessage as Mock).mockResolvedValue(undefined);

      await run(vi.fn(async () => ({ kind: 'needsCommit' as const })));

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('uncommitted changes'),
        { modal: true },
        'Commit',
        'Abort',
      );
    });

    it('commits and retries once when the user says Commit', async () => {
      const run = await withCleanSession();
      (vscode.window.showWarningMessage as Mock).mockResolvedValue('Commit');
      const scan = vi
        .fn()
        .mockResolvedValueOnce({ kind: 'needsCommit' })
        .mockResolvedValueOnce({ kind: 'ok', value: 2 });

      await expect(run(scan)).resolves.toEqual({ kind: 'ok', value: 2 });
      expect(deps.commit).toHaveBeenCalledWith(session);
      expect(deps.abort).not.toHaveBeenCalled();
      expect(scan).toHaveBeenCalledTimes(2);
    });

    it('aborts through the extension’s own handler, keeping its confirmation', async () => {
      // So the abort still lists what is at stake instead of discarding work silently.
      const run = await withCleanSession();
      (vscode.window.showWarningMessage as Mock).mockResolvedValue('Abort');
      const scan = vi
        .fn()
        .mockResolvedValueOnce({ kind: 'needsCommit' })
        .mockResolvedValueOnce({ kind: 'ok', value: 3 });

      await expect(run(scan)).resolves.toEqual({ kind: 'ok', value: 3 });
      expect(deps.abort).toHaveBeenCalledWith(session);
      expect(deps.commit).not.toHaveBeenCalled();
    });

    it('stays silent when the user declines, having chosen that', async () => {
      const run = await withCleanSession();
      (vscode.window.showWarningMessage as Mock).mockResolvedValue(undefined);
      const scan = vi.fn(async () => ({ kind: 'needsCommit' as const }));

      await expect(run(scan)).resolves.toBeUndefined();
      expect(deps.commit).not.toHaveBeenCalled();
      expect(deps.abort).not.toHaveBeenCalled();
      expect(scan).toHaveBeenCalledTimes(1);
    });

    it('takes a second needsCommit as the user’s answer, not as a failure', async () => {
      // The handlers can themselves decline -- unsaved .gs edits, a cancelled abort
      // confirmation, a commit that conflicts -- so the retry re-checks rather than
      // assuming the session is now clean.
      const run = await withCleanSession();
      (vscode.window.showWarningMessage as Mock).mockResolvedValue('Commit');
      const scan = vi.fn(async () => ({ kind: 'needsCommit' as const }));

      await expect(run(scan)).resolves.toBeUndefined();
      expect(scan).toHaveBeenCalledTimes(2);
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
  });

  describe('pinning what the panel can still act on', () => {
    // A scan aborts, and an abort can scavenge an unreferenced object and hand its OOP
    // number to another -- a box the user is still looking at would then describe something
    // else. Counted per session, because two graph tabs can hold the same object.
    const pinning = async (): Promise<ObjectGraphWalkDeps> => {
      await executor.presentObjectGraph(session, 31553793n, deps);
      return walks[0].deps;
    };

    it('pins an object into the session’s export set', async () => {
      (await pinning()).pin(555n);

      expect(gci.GciTsSaveObjs).toHaveBeenCalledWith(session.handle, [555n]);
    });

    it('holds it until the last holder lets go', async () => {
      const d = await pinning();

      d.pin(555n);
      d.pin(555n);
      d.unpin(555n);
      expect(gci.GciTsReleaseObjs).not.toHaveBeenCalled();

      d.unpin(555n);
      expect(gci.GciTsReleaseObjs).toHaveBeenCalledWith(session.handle, [555n]);
    });

    it('pins once however many times it is asked', async () => {
      const d = await pinning();

      d.pin(555n);
      d.pin(555n);

      expect(gci.GciTsSaveObjs).toHaveBeenCalledTimes(1);
    });

    it('carries on when the session cannot pin', async () => {
      // A failed pin is worth logging, not worth refusing to draw the graph over.
      gci.GciTsSaveObjs = vi.fn(() => ({ success: false, err: { number: 1, message: 'gone' } }));
      const d = await pinning();

      expect(() => d.pin(555n)).not.toThrow();
    });

    it('ignores a release for something never pinned', async () => {
      const d = await pinning();

      d.unpin(999n);

      expect(gci.GciTsReleaseObjs).not.toHaveBeenCalled();
    });
  });
});
