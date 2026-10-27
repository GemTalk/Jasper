import { describe, it, expect, afterEach, onTestFinished, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type { ActiveSession } from '../activeSession';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { forceStop } from '../forceStop';
import {
  NbCancelledError,
  runNbCall,
  whenSessionFree,
  setRunInProgressHandler,
  setStillRunningHandler,
  setStoppedRunCollectedHandler,
  stoppedRunHolds,
} from '../nbRunner';
import { installTranscriptSink } from '../transcriptSink';
import { executeFetchString } from '../browserQueries';
import { SESSION_BUSY_MESSAGE } from '../gciLibraryError';
import { GemStoneFileSystemProvider } from '../gemstoneFileSystemProvider';
import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { evalSmalltalk } from '../smalltalkNotebookController';
import { evalPythonInScopeNb } from '../pythonQueries';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';
import { forceStopSupport } from './forceStopSupport';

describe('Force Stop from notebooks, the Explorer and saves (integration)', () => {
  let session: ActiveSession;

  useIntegrationTest((testContext) => {
    session = testActiveSession(testContext.gciLibrary, testContext.session);
  });

  afterEach(() => {
    setStoppedRunCollectedHandler(undefined);
    setStillRunningHandler(undefined);
  });

  const { armedSession, deps, stopAndAbandon } = forceStopSupport(() => session);

  it("stops a notebook cell from the cell's own stop, and Force Stop frees the session", async () => {
    const own = armedSession();
    installTranscriptSink(own);
    let cancel: (() => void) | undefined;
    const cellRun = evalSmalltalk(
      own,
      '[[true] whileTrue] on: Break do: [:e | e resume]',
      (c) => (cancel = c),
    );
    cellRun.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 500));
    cancel!();

    await expect(cellRun).rejects.toBeInstanceOf(NbCancelledError);
    expect(stoppedRunHolds(own)).toBe(true);
    await expect(forceStop(own, deps)).resolves.toBe(true);
    await expect(evalSmalltalk(own, '3 + 4')).resolves.toBe('7');
  }, 30_000);

  // No test stone has Grail, so this shows the path works, not a stop of real Python.
  it('runs a Python cell without blocking, handing out its canceller', async () => {
    const own = armedSession();
    const onStart = vi.fn();

    const answer = await evalPythonInScopeNb(own, 'x = 1', 'file:///nb.ipynb', onStart);

    expect(answer).toMatch(/^Grail \(GemStone-Python\) not detected/);
    expect(onStart).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
  }, 30_000);

  it('offers Force Stop when an Explorer query is blocked by the stopped run', async () => {
    const told = vi.fn();
    setStillRunningHandler(told);
    const own = armedSession();
    await stopAndAbandon(own, '[[true] whileTrue: [nil]] on: Break do: [:e | e resume]');
    told.mockClear();

    expect(() => executeFetchString(own, '(3 + 4) printString')).toThrow(SESSION_BUSY_MESSAGE);
    expect(told).toHaveBeenCalledWith(own);

    await expect(forceStop(own, deps)).resolves.toBe(true);
    expect(executeFetchString(own, '(3 + 4) printString')).toBe('7');
  }, 30_000);

  it('offers Stop, in plain words, when an Explorer query or a save meets a run still going', async () => {
    const told = vi.fn();
    setRunInProgressHandler(told);
    onTestFinished(() => setRunInProgressHandler(undefined));
    const own = armedSession();
    let cancel: (() => void) | undefined;
    const run = runNbCall(
      own,
      () =>
        own.GciTsNbExecute(
          '(Delay forSeconds: 30) wait',
          OOP_CLASS_UTF8,
          OOP_ILLEGAL,
          OOP_NIL,
          0,
          0,
        ),
      () => own.GciTsNbResult(),
      { suppressNotification: true, disposableProcess: true, onStart: (c) => (cancel = c) },
    );
    run.catch(() => {});

    expect(() => executeFetchString(own, '(3 + 4) printString')).toThrow(SESSION_BUSY_MESSAGE);
    expect(told).toHaveBeenCalledWith(own);
    // A save goes the same way, and says why it did not happen.
    expect(() =>
      queries.compileMethod(own, 'Object', false, 'jasper-test', 'jasperBusySave ^ 1'),
    ).toThrow(SESSION_BUSY_MESSAGE);

    cancel!();
    await run.catch(() => {});
  }, 30_000);

  it('fails a save made during a run, so the edit stays unsaved, and saves it once the run ends', async () => {
    const own = armedSession();
    const CLASS = 'JasperBusySaveTest';
    queries.compileClassDefinition(
      own,
      `Object subclass: '${CLASS}' instVarNames: #() classVars: #() classInstVars: #() ` +
        `poolDictionaries: #() inDictionary: UserGlobals options: #()`,
    );
    const provider = new GemStoneFileSystemProvider({
      getSession: () => own,
      getSessions: () => [own],
    } as unknown as SessionManager);
    const uri = vscode.Uri.parse(
      `gemstone://${own.id}/UserGlobals/${CLASS}/instance/test/jasperBusySave`,
    );
    const save = () =>
      provider.writeFile(uri, new TextEncoder().encode('jasperBusySave\n  ^ 42'), {
        create: false,
        overwrite: true,
      });
    const hasMethod = () =>
      own.executeAndFetchString(`(${CLASS} includesSelector: #jasperBusySave) printString`);
    let cancel: (() => void) | undefined;
    const run = runNbCall(
      own,
      () =>
        own.GciTsNbExecute(
          '(Delay forSeconds: 30) wait',
          OOP_CLASS_UTF8,
          OOP_ILLEGAL,
          OOP_NIL,
          0,
          0,
        ),
      () => own.GciTsNbResult(),
      { suppressNotification: true, disposableProcess: true, onStart: (c) => (cancel = c) },
    );
    run.catch(() => {});

    expect(save).toThrow(SESSION_BUSY_MESSAGE);

    cancel!();
    await run.catch(() => {});
    // On a loaded machine the stopped run can still be finishing.
    await whenSessionFree(own, () => {});
    expect(hasMethod()).toBe('false');
    save();
    expect(hasMethod()).toBe('true');
  }, 30_000);
});
