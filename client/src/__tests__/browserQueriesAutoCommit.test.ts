import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: { createOutputChannel: () => ({ appendLine: () => {} }) },
}));

import { ActiveSession } from '../sessionManager';
import { fakeActiveSession } from './fakeActiveSession';
import * as queries from '../browserQueries';
import {
  _resetAutoCommitStateForTests,
  registerSessionAutoCommit,
} from '../autoCommit/autoCommitState';
import { setAutoCommitFailureHandler } from '../autoCommit/autoCommitRunner';

/**
 * The write path is where auto-commit actually meets the user's work (issue #254), so this
 * checks the two halves of the bargain against the real `browserQueries` exports: a
 * mutation commits, and a READ never does. The second half is the one that would go wrong
 * silently — the Explorer reads on every expand, and a commit hidden behind each of those
 * would double the round trips and quietly promote work the user had not finished.
 */
const OK = { success: true, err: { number: 0, message: '' } };

function makeSession(
  id: number,
  commit: () => typeof OK,
  executeAndFetchString: () => string = vi.fn(() => 'ok'),
): ActiveSession {
  return fakeActiveSession({
    id,
    gci: {
      executeAndFetchString,
      GciTsCallInProgress: vi.fn(() => ({ result: 0 })),
      GciTsCommit: commit,
    },
    handle: {},
    login: { label: 'Test' },
    stoneVersion: '3.7.2',
  });
}

beforeEach(() => {
  _resetAutoCommitStateForTests();
  setAutoCommitFailureHandler(undefined);
});

describe('the write path with auto-commit armed', () => {
  it('commits a compiled method', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    queries.compileMethod(session, 'Account', false, 'accessing', 'balance ^balance');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['deleteMethod', (s: ActiveSession) => queries.deleteMethod(s, 'Account', false, 'balance')],
    ['deleteClass', (s: ActiveSession) => queries.deleteClass(s, 'Globals', 'Account')],
    ['addDictionary', (s: ActiveSession) => queries.addDictionary(s, 'MyDict')],
    ['renameDictionary', (s: ActiveSession) => queries.renameDictionary(s, 2, 'MyDict')],
    [
      'recategorizeMethod',
      (s: ActiveSession) => queries.recategorizeMethod(s, 'Account', false, 'balance', 'printing'),
    ],
    ['setClassComment', (s: ActiveSession) => queries.setClassComment(s, 'Account', 'A bank one')],
    ['addClassVariable', (s: ActiveSession) => queries.addClassVariable(s, 'Account', 'Rate')],
    [
      'deleteClassVariable',
      (s: ActiveSession) => queries.deleteClassVariable(s, 'Account', 'Rate'),
    ],
    [
      'addAccessors',
      (s: ActiveSession) =>
        queries.addAccessors(s, 'Account', false, [{ selector: 'rate', source: 'rate ^rate' }]),
    ],
    ['removeClassVersion', (s: ActiveSession) => queries.removeClassVersion(s, 'Account', 1)],
    [
      'compileClassDefinition',
      (s: ActiveSession) => queries.compileClassDefinition(s, "Object subclass: 'Account'"),
    ],
    ['recategorizeClass', (s: ActiveSession) => queries.recategorizeClass(s, 'Account', 'Bank')],
    [
      'copyMethodToClass',
      (s: ActiveSession) => queries.copyMethodToClass(s, 'Account', 'Savings', false, 'balance'),
    ],
    [
      'removeMethodCategory',
      (s: ActiveSession) => queries.removeMethodCategory(s, 'Account', false, 'printing'),
    ],
    [
      'renameCategory',
      (s: ActiveSession) => queries.renameCategory(s, 'Account', false, 'printing', 'display'),
    ],
    ['removeCategory', (s: ActiveSession) => queries.removeCategory(s, 'Account', false, 'old')],
    ['moveClass', (s: ActiveSession) => queries.moveClass(s, 1, 2, 'Account')],
    ['removeDictionary', (s: ActiveSession) => queries.removeDictionary(s, 'MyDict')],
    [
      'renameClassCategory',
      (s: ActiveSession) => queries.renameClassCategory(s, 2, 'Bank-Old', 'Bank-New'),
    ],
    ['moveDictionaryUp', (s: ActiveSession) => queries.moveDictionaryUp(s, 2)],
    ['moveDictionaryDown', (s: ActiveSession) => queries.moveDictionaryDown(s, 2)],
    // A file-in's doit chunks and `removeallmethods` write too; its region makes them one commit.
    ['fileInChunk', (s: ActiveSession) => queries.fileInChunk(s, 'UserGlobals at: #X put: 1')],
    ['removeAllMethods', (s: ActiveSession) => queries.removeAllMethods(s, 'Account', false)],
  ])('commits after %s', (_name, run) => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    run(session);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['getMethodCategories', (s: ActiveSession) => queries.getMethodCategories(s, 'Account', false)],
    ['getDictionaryNames', (s: ActiveSession) => queries.getDictionaryNames(s)],
    ['sessionNeedsCommit', (s: ActiveSession) => queries.sessionNeedsCommit(s)],
  ])('does not commit after %s, which only reads', (_name, run) => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    run(session);
    expect(commit).not.toHaveBeenCalled();
  });

  // These answer a partial result rather than throwing, so their caller commits from the answer.
  it.each([
    ['revertClassToVersion', (s: ActiveSession) => queries.revertClassToVersion(s, 'Account', 1)],
  ])('leaves the commit after %s to its caller', (_name, run) => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    run(session);
    expect(commit).not.toHaveBeenCalled();
  });

  // A breakpoint is per-gem state a commit does not persist, so committing here would only
  // commit the user's other pending work at a moment they did not choose.
  it.each([
    [
      'setBreakAtStepPoint',
      (s: ActiveSession) => queries.setBreakAtStepPoint(s, 'Account', false, 'balance', 1),
    ],
    [
      'clearBreakAtStepPoint',
      (s: ActiveSession) => queries.clearBreakAtStepPoint(s, 'Account', false, 'balance', 1),
    ],
    [
      'disableBreakAtStepPoint',
      (s: ActiveSession) => queries.disableBreakAtStepPoint(s, 'Account', false, 'balance', 1),
    ],
    [
      'clearAllBreaks',
      (s: ActiveSession) => queries.clearAllBreaks(s, 'Account', false, 'balance'),
    ],
    ['enableAllBreakpoints', (s: ActiveSession) => queries.enableAllBreakpoints(s)],
    ['disableAllBreakpoints', (s: ActiveSession) => queries.disableAllBreakpoints(s)],
    ['removeAllBreakpoints', (s: ActiveSession) => queries.removeAllBreakpoints(s)],
    [
      'breakpointByOop',
      (s: ActiveSession) => queries.breakpointByOop(s, '12345', 'setBreakAtStepPoint:', 1),
    ],
  ])('does not commit after %s, a breakpoint the stone does not keep', (_name, run) => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    run(session);
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits nothing on a session that never armed it', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);

    queries.compileMethod(session, 'Account', false, 'accessing', 'balance ^balance');
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not commit a mutation that threw', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit, () => {
      throw new Error('does not compile');
    });
    registerSessionAutoCommit(1, true);

    expect(() =>
      queries.compileMethod(session, 'Account', false, 'accessing', 'balance ^'),
    ).toThrow();
    expect(commit).not.toHaveBeenCalled();
  });
});
