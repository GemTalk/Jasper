import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: { createOutputChannel: () => ({ appendLine: () => {} }) },
}));

vi.mock('../../gciLog', () => ({ logInfo: vi.fn(), logWarning: vi.fn() }));

import { ActiveSession } from '../../sessionManager';
import { logInfo } from '../../gciLog';
import { fakeActiveSession } from '../../__tests__/fakeActiveSession';
import {
  _resetAutoCommitStateForTests,
  getAutoCommitStatus,
  registerSessionAutoCommit,
  setAutoCommitStatus,
} from '../autoCommitState';
import {
  autoCommitAfterWrite,
  runWithAutoCommitDeferred,
  runWithAutoCommitDeferredSync,
  setAutoCommitFailureHandler,
} from '../autoCommitRunner';

const OK = { success: true, err: { number: 0, message: '' } };
const CONFLICT = { success: false, err: { number: 2261, message: 'commit failed - conflicts' } };

function makeSession(id = 1, commit = vi.fn(() => OK)): ActiveSession {
  return fakeActiveSession({
    id,
    gci: { GciTsCommit: commit },
    handle: {},
    login: { label: 'Test' },
    stoneVersion: '3.7.2',
  });
}

beforeEach(() => {
  _resetAutoCommitStateForTests();
  setAutoCommitFailureHandler(undefined);
});

describe('the commit log line', () => {
  it('names what was committed', () => {
    registerSessionAutoCommit(1, true);
    autoCommitAfterWrite(makeSession(), 'method compile');
    expect(logInfo).toHaveBeenLastCalledWith('[autoCommit] session 1: committed (method compile)');
  });

  it("names a deferred region's commit after the outermost region", async () => {
    registerSessionAutoCommit(1, true);
    const session = makeSession();
    await runWithAutoCommitDeferred(session, 'file-in', () =>
      runWithAutoCommitDeferredSync(session, 'save', () => autoCommitAfterWrite(session, 'x')),
    );
    expect(logInfo).toHaveBeenLastCalledWith('[autoCommit] session 1: committed (file-in)');
  });
});

describe('autoCommitAfterWrite', () => {
  it('does nothing at all on a session that never armed it', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    expect(autoCommitAfterWrite(session, 'test write')).toBe('skipped');
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits on an armed session', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);
    expect(autoCommitAfterWrite(session, 'test write')).toBe('committed');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('stops committing once a commit has failed, rather than retrying every write', () => {
    const commit = vi.fn(() => CONFLICT);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    expect(autoCommitAfterWrite(session, 'test write')).toBe('failed');
    expect(getAutoCommitStatus(1)).toBe('failed');
    // The second write must not try again: the conflict is still there, and a prompt per
    // keystroke is how the message gets buried.
    expect(autoCommitAfterWrite(session, 'test write')).toBe('skipped');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('reports a failure once, with the reason the stone gave', () => {
    const handler = vi.fn();
    setAutoCommitFailureHandler(handler);
    const session = makeSession(
      1,
      vi.fn(() => CONFLICT),
    );
    registerSessionAutoCommit(1, true);

    autoCommitAfterWrite(session, 'test write');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1]).toBe('commit failed - conflicts');
  });

  it('turns auto-commit off, not failed, when the session is not in a transaction', () => {
    // Error 2030: the session left Auto-Begin, so no abort or retry would help.
    const handler = vi.fn();
    setAutoCommitFailureHandler(handler);
    const notInTransaction = { success: false, err: { number: 2030, message: 'not in txn' } };
    const session = makeSession(
      1,
      vi.fn(() => notInTransaction),
    );
    registerSessionAutoCommit(1, true);

    autoCommitAfterWrite(session, 'test write');
    expect(getAutoCommitStatus(1)).toBe('off');
    expect(handler.mock.calls[0][2]).toBe('notInTransaction');
  });

  it('treats a throwing commit as a failure rather than letting it escape', () => {
    const session = makeSession(
      1,
      vi.fn(() => {
        throw new Error('session is dead');
      }),
    );
    registerSessionAutoCommit(1, true);
    expect(autoCommitAfterWrite(session, 'test write')).toBe('failed');
    expect(getAutoCommitStatus(1)).toBe('failed');
  });

  it('keeps each session to its own answer', () => {
    const one = vi.fn(() => OK);
    const two = vi.fn(() => OK);
    registerSessionAutoCommit(1, true);
    registerSessionAutoCommit(2, false);

    autoCommitAfterWrite(makeSession(1, one), 'test write');
    autoCommitAfterWrite(makeSession(2, two), 'test write');
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).not.toHaveBeenCalled();
  });
});

describe('runWithAutoCommitDeferred', () => {
  it('commits once for a run of writes, not once each', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await runWithAutoCommitDeferred(session, 'test op', async () => {
      expect(autoCommitAfterWrite(session, 'test write')).toBe('deferred');
      expect(autoCommitAfterWrite(session, 'test write')).toBe('deferred');
      expect(autoCommitAfterWrite(session, 'test write')).toBe('deferred');
      expect(commit).not.toHaveBeenCalled();
    });

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('commits nothing when the operation throws, so the caller can still abort', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await expect(
      runWithAutoCommitDeferred(session, 'test op', () => {
        autoCommitAfterWrite(session, 'test write');
        throw new Error('the engine stopped at the first failure');
      }),
    ).rejects.toThrow('the engine stopped at the first failure');

    expect(commit).not.toHaveBeenCalled();
  });

  it('commits nothing when the operation reports a failure it did not throw', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await runWithAutoCommitDeferred(
      session,
      'test op',
      () => {
        autoCommitAfterWrite(session, 'test write');
        return { errors: 1 };
      },
      (answer) => answer.errors === 0,
    );
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits nothing when the operation wrote nothing', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await runWithAutoCommitDeferred(session, 'test op', () => 'nothing to do');
    expect(commit).not.toHaveBeenCalled();
  });

  it('nests: only the outermost region commits', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await runWithAutoCommitDeferred(session, 'test op', async () => {
      await runWithAutoCommitDeferred(session, 'test op', () => {
        autoCommitAfterWrite(session, 'test write');
      });
      expect(commit).not.toHaveBeenCalled();
      autoCommitAfterWrite(session, 'test write');
    });

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not leave a session suspended after an inner failure', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await expect(
      runWithAutoCommitDeferred(session, 'test op', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // The next ordinary write commits immediately — the suspension did not leak.
    expect(autoCommitAfterWrite(session, 'test write')).toBe('committed');
  });

  it('does not commit when the failure prompt turned auto-commit off mid-region', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await runWithAutoCommitDeferred(session, 'test op', () => {
      autoCommitAfterWrite(session, 'test write');
      setAutoCommitStatus(1, 'off');
    });

    expect(commit).not.toHaveBeenCalled();
  });

  it('runs the operation untouched on a session with auto-commit off', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    const answer = await runWithAutoCommitDeferred(session, 'test op', () => 42);
    expect(answer).toBe(42);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('runWithAutoCommitDeferredSync', () => {
  it('commits once at the end of a synchronous run of writes', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    const answer = runWithAutoCommitDeferredSync(session, 'test op', () => {
      autoCommitAfterWrite(session, 'test write');
      autoCommitAfterWrite(session, 'test write');
      return 'filed in';
    });

    expect(answer).toBe('filed in');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('commits nothing when the synchronous operation throws', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    expect(() =>
      runWithAutoCommitDeferredSync(session, 'test op', () => {
        autoCommitAfterWrite(session, 'test write');
        throw new Error('unreadable file');
      }),
    ).toThrow('unreadable file');
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits nothing when the synchronous operation reports a failure', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    runWithAutoCommitDeferredSync(
      session,
      'test op',
      () => {
        autoCommitAfterWrite(session, 'test write');
        return false;
      },
      (ok) => ok,
    );
    expect(commit).not.toHaveBeenCalled();
  });

  it('nests inside the async form', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await runWithAutoCommitDeferred(session, 'test op', () => {
      runWithAutoCommitDeferredSync(session, 'test op', () =>
        autoCommitAfterWrite(session, 'test write'),
      );
      expect(commit).not.toHaveBeenCalled();
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
