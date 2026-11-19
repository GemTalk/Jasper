// The Testing view and Execute It together, on one session with a fake GCI
// library: each side's own tests mock the other, which is how a debug run
// refused mid-queue came to be reported as an execution error.
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarning: vi.fn() }));
vi.mock('../transcriptChannel', () => ({
  appendTranscript: vi.fn(),
  appendTranscriptOutput: vi.fn(),
  showTranscript: vi.fn(),
}));
vi.mock('../socketPoll', () => ({ pollReadable: vi.fn(() => 1) }));
vi.mock('../debugger/debuggerPanel', () => ({ DebuggerPanel: { create: vi.fn() } }));
vi.mock('../sunitQueries', () => ({
  discoverTestClasses: vi.fn(() => [
    { dictName: 'UserGlobals', className: 'MyTestCase', testCount: 2 },
  ]),
  discoverTestMethods: vi.fn(() => [
    { selector: 'testAdd', category: 'unit tests' },
    { selector: 'testRemove', category: 'unit tests' },
  ]),
  SunitQueryError: class extends Error {},
}));

import * as vscode from 'vscode';
import { CodeExecutor } from '../codeExecutor';
import { SunitTestController } from '../sunitTestController';
import { setRunInProgressHandler, stopCallsOn } from '../nbRunner';
import { setBreakpointRuleSource } from '../debugger/conditionalBreakpoints';
import type { ActiveSession, SessionManager } from '../sessionManager';
import { fakeActiveSession } from './fakeActiveSession';

const OOP_NIL = 0x14n;
const LONG_RUN = '(Delay forSeconds: 30) wait';

// nbRunner keeps its state per session id, and a stopped run would hold the next test's session.
let nextSessionId = 1;
let session: ActiveSession | undefined;

afterEach(async () => {
  if (session) await stopCallsOn(session);
  session = undefined;
  setRunInProgressHandler(undefined);
});

/** A session on which the long Execute It never finishes and every test passes at once. */
function setUp() {
  let longRunStarted = false;
  const gci = {
    utf8ClassOop: vi.fn(() => 100n),
    GciTsNbExecute: vi.fn((_handle: unknown, code: string) => {
      if (code === LONG_RUN) longRunStarted = true;
      return { success: true, err: { number: 0, message: '' } };
    }),
    GciTsNbPoll: vi.fn(() => ({ result: longRunStarted ? 0 : 1, err: { number: 0 } })),
    GciTsCallInProgress: vi.fn(() => ({ result: 0, err: { number: 0 } })),
    isAvailable: vi.fn(() => true),
    GciTsNbResult: vi.fn(() => ({
      result: 200n,
      err: { number: 0, message: '', context: OOP_NIL },
    })),
    executeAndFetchString: vi.fn(() => ''),
    GciTsBreak: vi.fn(() => ({ success: true, err: { number: 0 } })),
  };
  const activeSession = fakeActiveSession({
    id: nextSessionId++,
    gci,
    handle: {},
    login: { label: 'Test', gs_user: 'DataCurator' },
    stoneVersion: '3.7.2',
  });
  session = activeSession;
  const sessionManager = {
    resolveSession: vi.fn(async () => activeSession),
    getSelectedSession: vi.fn(() => activeSession),
    getSessions: vi.fn(() => [activeSession]),
    getSession: vi.fn(() => activeSession),
    refreshTransactionState: vi.fn(),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;
  setBreakpointRuleSource({ breakpointRulesFor: () => [] });
  const executor = new CodeExecutor(sessionManager);
  const controller = new SunitTestController(sessionManager, executor);
  const notice = vi.fn();
  setRunInProgressHandler(notice);
  const start = new vscode.Position(0, 0);
  const end = new vscode.Position(0, LONG_RUN.length);
  (vscode.window as unknown as Record<string, unknown>).activeTextEditor = {
    document: {
      uri: vscode.Uri.file('/workspace/test.st'),
      getText: () => LONG_RUN,
      lineAt: () => ({ range: { start, end } }),
    },
    selection: new vscode.Selection(start, end),
    setDecorations: vi.fn(),
  };
  return { session: activeSession, executor, controller, notice };
}

describe('debugging tests while an Execute It runs on the same session', () => {
  // The Testing view's own check before the run, not the executor's: what #930's first steps showed.
  it('refuses a debug run started during the Execute It before any test starts', async () => {
    const { session, executor, controller, notice } = setUp();
    void executor.executeIt();
    await vi.waitFor(() => expect(session.isBusy()).toBe(true));

    await controller.runTestsByName('UserGlobals', 'MyTestCase', ['testAdd'], 'debug');

    expect(controller.resultFor('UserGlobals', 'MyTestCase', 'testAdd')).toBeUndefined();
    expect(notice).toHaveBeenCalledWith(session);
    controller.dispose();
  });

  it('leaves the tests after an Execute It started between two tests without a verdict', async () => {
    const { session, executor, controller, notice } = setUp();
    const debugTest = executor.executeWithDebugger.bind(executor);
    vi.spyOn(executor, 'executeWithDebugger').mockImplementationOnce(async (...args) => {
      const outcome = await debugTest(...args);
      void executor.executeIt();
      await vi.waitFor(() => expect(session.isBusy()).toBe(true));
      return outcome;
    });

    await controller.runClassByName('UserGlobals', 'MyTestCase', 'debug');

    expect(controller.resultFor('UserGlobals', 'MyTestCase', 'testAdd')?.outcome).toBe('passed');
    expect(controller.resultFor('UserGlobals', 'MyTestCase', 'testRemove')).toBeUndefined();
    expect(notice).toHaveBeenCalledWith(session);
    controller.dispose();
  });
});
