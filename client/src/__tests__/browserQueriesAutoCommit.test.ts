import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: { createOutputChannel: () => ({ appendLine: () => {} }) },
}));

import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
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

function makeSession(id: number, commit: () => typeof OK): ActiveSession {
  return {
    id,
    gci: {
      executeAndFetchString: vi.fn(() => 'ok'),
      GciTsCallInProgress: vi.fn(() => ({ result: 0 })),
      GciTsCommit: commit,
    } as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
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
    [
      'setBreakAtStepPoint',
      (s: ActiveSession) => queries.setBreakAtStepPoint(s, 'Account', false, 'balance', 1),
    ],
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

  it('commits nothing on a session that never armed it', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);

    queries.compileMethod(session, 'Account', false, 'accessing', 'balance ^balance');
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not commit a mutation that threw', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    (session.gci as unknown as { executeAndFetchString: () => string }).executeAndFetchString =
      () => {
        throw new Error('does not compile');
      };
    registerSessionAutoCommit(1, true);

    expect(() =>
      queries.compileMethod(session, 'Account', false, 'accessing', 'balance ^'),
    ).toThrow();
    expect(commit).not.toHaveBeenCalled();
  });
});
