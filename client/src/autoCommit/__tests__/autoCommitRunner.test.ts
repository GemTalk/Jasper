import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: { createOutputChannel: () => ({ appendLine: () => {} }) },
}));

import { ActiveSession } from '../../sessionManager';
import { GemStoneLogin } from '../../loginTypes';
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
  return {
    id,
    gci: { GciTsCommit: commit } as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
}

beforeEach(() => {
  _resetAutoCommitStateForTests();
  setAutoCommitFailureHandler(undefined);
});

describe('autoCommitAfterWrite', () => {
  it('does nothing at all on a session that never armed it', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    expect(autoCommitAfterWrite(session)).toBe('skipped');
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits on an armed session', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);
    expect(autoCommitAfterWrite(session)).toBe('committed');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('stops committing once a commit has failed, rather than retrying every write', () => {
    const commit = vi.fn(() => CONFLICT);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    expect(autoCommitAfterWrite(session)).toBe('failed');
    expect(getAutoCommitStatus(1)).toBe('failed');
    // The second write must not try again: the conflict is still there, and a prompt per
    // keystroke is how the message gets buried.
    expect(autoCommitAfterWrite(session)).toBe('skipped');
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

    autoCommitAfterWrite(session);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1]).toBe('commit failed - conflicts');
  });

  it('treats a throwing commit as a failure rather than letting it escape', () => {
    const session = makeSession(
      1,
      vi.fn(() => {
        throw new Error('session is dead');
      }),
    );
    registerSessionAutoCommit(1, true);
    expect(autoCommitAfterWrite(session)).toBe('failed');
    expect(getAutoCommitStatus(1)).toBe('failed');
  });

  it('keeps each session to its own answer', () => {
    const one = vi.fn(() => OK);
    const two = vi.fn(() => OK);
    registerSessionAutoCommit(1, true);
    registerSessionAutoCommit(2, false);

    autoCommitAfterWrite(makeSession(1, one));
    autoCommitAfterWrite(makeSession(2, two));
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).not.toHaveBeenCalled();
  });
});

describe('runWithAutoCommitDeferred', () => {
  it('commits once for a run of writes, not once each', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await runWithAutoCommitDeferred(session, async () => {
      expect(autoCommitAfterWrite(session)).toBe('deferred');
      expect(autoCommitAfterWrite(session)).toBe('deferred');
      expect(autoCommitAfterWrite(session)).toBe('deferred');
      expect(commit).not.toHaveBeenCalled();
    });

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('commits nothing when the operation throws, so the caller can still abort', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await expect(
      runWithAutoCommitDeferred(session, () => {
        autoCommitAfterWrite(session);
        throw new Error('the engine stopped at the first failure');
      }),
    ).rejects.toThrow('the engine stopped at the first failure');

    expect(commit).not.toHaveBeenCalled();
  });

  it('commits nothing when the operation wrote nothing', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await runWithAutoCommitDeferred(session, () => 'nothing to do');
    expect(commit).not.toHaveBeenCalled();
  });

  it('nests: only the outermost region commits', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await runWithAutoCommitDeferred(session, async () => {
      await runWithAutoCommitDeferred(session, () => {
        autoCommitAfterWrite(session);
      });
      expect(commit).not.toHaveBeenCalled();
      autoCommitAfterWrite(session);
    });

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not leave a session suspended after an inner failure', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await expect(
      runWithAutoCommitDeferred(session, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // The next ordinary write commits immediately — the suspension did not leak.
    expect(autoCommitAfterWrite(session)).toBe('committed');
  });

  it('does not commit when the failure prompt turned auto-commit off mid-region', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await runWithAutoCommitDeferred(session, () => {
      autoCommitAfterWrite(session);
      setAutoCommitStatus(1, 'off');
    });

    expect(commit).not.toHaveBeenCalled();
  });

  it('runs the operation untouched on a session with auto-commit off', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    const answer = await runWithAutoCommitDeferred(session, () => 42);
    expect(answer).toBe(42);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('runWithAutoCommitDeferredSync', () => {
  it('commits once at the end of a synchronous run of writes', () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    const answer = runWithAutoCommitDeferredSync(session, () => {
      autoCommitAfterWrite(session);
      autoCommitAfterWrite(session);
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
      runWithAutoCommitDeferredSync(session, () => {
        autoCommitAfterWrite(session);
        throw new Error('unreadable file');
      }),
    ).toThrow('unreadable file');
    expect(commit).not.toHaveBeenCalled();
  });

  it('nests inside the async form', async () => {
    const commit = vi.fn(() => OK);
    const session = makeSession(1, commit);
    registerSessionAutoCommit(1, true);

    await runWithAutoCommitDeferred(session, () => {
      runWithAutoCommitDeferredSync(session, () => autoCommitAfterWrite(session));
      expect(commit).not.toHaveBeenCalled();
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
