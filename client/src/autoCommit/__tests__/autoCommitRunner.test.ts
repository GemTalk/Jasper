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
  beforeChangeCommitNote,
  commitStateNote,
  forgetSessionAutoCommit,
  getAutoCommitStatus,
  heldBackNote,
  registerSessionAutoCommit,
  setAutoCommitStatus,
} from '../autoCommitState';
import {
  autoCommitAfterWrite,
  holdAutoCommit,
  runRawWritesWithAutoCommit,
  runWithAutoCommitDeferred,
  runWithAutoCommitDeferredSync,
  setAutoCommitCommittedHandler,
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
  setAutoCommitCommittedHandler(undefined);
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

  it('reports a commit that threw as one that got no answer, not as a refusal', () => {
    const handler = vi.fn();
    setAutoCommitFailureHandler(handler);
    const session = makeSession(
      1,
      vi.fn(() => {
        throw new Error('operation in progress');
      }),
    );
    registerSessionAutoCommit(1, true);

    autoCommitAfterWrite(session, 'test write');
    expect(getAutoCommitStatus(1)).toBe('failed');
    expect(handler.mock.calls[0][2]).toBe('threw');
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

describe('after a commit lands', () => {
  it('tells the registered handler, so the caches a manual Commit drops are dropped too', () => {
    const committed = vi.fn();
    setAutoCommitCommittedHandler(committed);
    registerSessionAutoCommit(1, true);
    const session = makeSession();

    autoCommitAfterWrite(session, 'method compile');

    expect(committed).toHaveBeenCalledWith(session);
  });

  it('does not tell it about a commit that was refused', () => {
    const committed = vi.fn();
    setAutoCommitCommittedHandler(committed);
    registerSessionAutoCommit(1, true);

    autoCommitAfterWrite(
      makeSession(
        1,
        vi.fn(() => CONFLICT),
      ),
      'method compile',
    );

    expect(committed).not.toHaveBeenCalled();
  });
});

/** Writes made through a raw executor never call `autoCommitAfterWrite` themselves. */
describe('runRawWritesWithAutoCommit', () => {
  it('commits once when the writes landed, though none of them said so', () => {
    const commit = vi.fn(() => OK);
    registerSessionAutoCommit(1, true);

    runRawWritesWithAutoCommit(makeSession(1, commit), 'undo', () => 'ok');

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('commits nothing when the answer says they landed only in part', () => {
    const commit = vi.fn(() => OK);
    registerSessionAutoCommit(1, true);

    runRawWritesWithAutoCommit(
      makeSession(1, commit),
      'undo',
      () => ['ok', 'failed'],
      (answer) => !answer.includes('failed'),
    );

    expect(commit).not.toHaveBeenCalled();
  });

  it('costs nothing on a session that is not auto-committing', () => {
    const commit = vi.fn(() => OK);

    expect(runRawWritesWithAutoCommit(makeSession(1, commit), 'undo', () => 42)).toBe(42);
    expect(commit).not.toHaveBeenCalled();
  });
});

/** A debugger holding a halted run: nothing may commit its half-done work until it finishes. */
describe('holdAutoCommit', () => {
  it('holds every write back, and commits them once when released as finished', () => {
    const commit = vi.fn(() => OK);
    registerSessionAutoCommit(1, true);
    const session = makeSession(1, commit);
    const release = holdAutoCommit(session, 'run finished in the Debugger');

    autoCommitAfterWrite(session, 'Debugger evaluate');
    autoCommitAfterWrite(session, 'save');
    expect(commit).not.toHaveBeenCalled();

    expect(release(true)).toBe(false);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('commits nothing when released as unfinished, and says something was held back', () => {
    const commit = vi.fn(() => OK);
    registerSessionAutoCommit(1, true);
    const session = makeSession(1, commit);
    const release = holdAutoCommit(session, 'run finished in the Debugger');
    autoCommitAfterWrite(session, 'Debugger evaluate');

    expect(release(false)).toBe(true);
    expect(commit).not.toHaveBeenCalled();
  });

  it('says nothing was held back when nothing was written', () => {
    registerSessionAutoCommit(1, true);
    expect(holdAutoCommit(makeSession(), 'x')(false)).toBe(false);
  });

  it('closes only once, so a release after the run finished cannot close another hold', () => {
    const commit = vi.fn(() => OK);
    registerSessionAutoCommit(1, true);
    const session = makeSession(1, commit);
    const first = holdAutoCommit(session, 'first');
    const second = holdAutoCommit(session, 'second');
    first(true);
    first(false);

    autoCommitAfterWrite(session, 'save');
    expect(commit).not.toHaveBeenCalled();
    second(true);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('holds nothing on a session that is not auto-committing', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    const release = holdAutoCommit(session, 'x');
    registerSessionAutoCommit(1, true);

    autoCommitAfterWrite(session, 'save');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(release(false)).toBe(false);
  });
});

describe('a session logged out partway through a region', () => {
  it('commits nothing when the region closes', async () => {
    const commit = vi.fn(() => OK);
    registerSessionAutoCommit(1, true);
    const session = makeSession(1, commit);

    await runWithAutoCommitDeferred(session, 'file-in', () => {
      autoCommitAfterWrite(session, 'method compile');
      forgetSessionAutoCommit(1);
    });

    expect(commit).not.toHaveBeenCalled();
  });
});

/** The wording notices use, which has to follow whether a commit really happens now. */
describe('the commit-state notes', () => {
  const OFF = 'Not committed — commit when ready.';

  it('say committed only when a write now would commit at once', () => {
    expect(commitStateNote(1, OFF)).toBe(OFF);
    registerSessionAutoCommit(1, true);
    expect(commitStateNote(1, OFF)).toBe('Committed — this session has auto-commit on.');
    expect(beforeChangeCommitNote(1, OFF)).toContain('Abort will not bring it back');
  });

  it('say not committed while commits are held, as under a halted debugger', () => {
    registerSessionAutoCommit(1, true);
    const release = holdAutoCommit(makeSession(), 'run finished in the Debugger');

    expect(commitStateNote(1, OFF)).toBe(OFF);
    expect(beforeChangeCommitNote(1, OFF)).toBe(OFF);
    release(false);
  });

  it('say not committed after a commit was refused', () => {
    registerSessionAutoCommit(1, true);
    setAutoCommitStatus(1, 'failed');
    expect(commitStateNote(1, OFF)).toBe(OFF);
  });

  it('add the hold-back advice only on an auto-commit session', () => {
    expect(heldBackNote(1)).toBe('');
    registerSessionAutoCommit(1, true);
    expect(heldBackNote(1)).toContain('Nothing was committed. Abort to discard it');
  });
});

/**
 * An inner region that failed must not be committed by an outer one that succeeds: two halted
 * debuggers, the first Terminated, the second run to the end.
 */
describe('a failed region nested in one that succeeds', () => {
  it('commits nothing when the outer region closes, and says the inner one held work back', () => {
    const commit = vi.fn(() => OK);
    registerSessionAutoCommit(1, true);
    const session = makeSession(1, commit);
    const outer = holdAutoCommit(session, 'run finished in the Debugger');
    const inner = holdAutoCommit(session, 'run finished in the Debugger');
    autoCommitAfterWrite(session, 'halted run');

    expect(inner(false)).toBe(true);
    outer(true);

    expect(commit).not.toHaveBeenCalled();
  });

  it('commits again normally once that outermost region has closed', () => {
    const commit = vi.fn(() => OK);
    registerSessionAutoCommit(1, true);
    const session = makeSession(1, commit);
    const outer = holdAutoCommit(session, 'x');
    holdAutoCommit(session, 'y')(false);
    outer(true);

    autoCommitAfterWrite(session, 'save');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('applies to the region forms too, sync inside async', async () => {
    const commit = vi.fn(() => OK);
    registerSessionAutoCommit(1, true);
    const session = makeSession(1, commit);

    await runWithAutoCommitDeferred(session, 'outer', () =>
      runWithAutoCommitDeferredSync(
        session,
        'inner',
        () => autoCommitAfterWrite(session, 'w'),
        () => false,
      ),
    );

    expect(commit).not.toHaveBeenCalled();
  });
});
