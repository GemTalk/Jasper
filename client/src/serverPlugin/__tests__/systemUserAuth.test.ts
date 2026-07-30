import { describe, it, expect, vi, beforeEach } from 'vitest';

// Note: this suite mocks '../../browserQueries' down to just `sessionNeedsCommit`,
// which leaves installHelpers.ts's `import { executeFetchString } from
// '../browserQueries'` resolving to `undefined` under these mocks. That's
// harmless here because `refreshWorkingSessionAfterInstall` never reaches
// `gemCanRead` (the only caller of `executeFetchString`) — but it's a live
// tripwire: if a future change makes the install path call it, these tests
// will start throwing "executeFetchString is not a function" instead of
// silently mis-mocking it.
const mocks = vi.hoisted(() => ({
  showInformationMessage: vi.fn<() => Promise<string | undefined>>(() =>
    Promise.resolve(undefined),
  ),
  sessionNeedsCommit: vi.fn<() => boolean | undefined>(() => false),
}));

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: mocks.showInformationMessage,
  },
}));

vi.mock('../../browserQueries', () => ({
  sessionNeedsCommit: mocks.sessionNeedsCommit,
}));

import { ActiveSession, SessionManager } from '../../sessionManager';
import { refreshWorkingSessionAfterInstall } from '../systemUserAuth';

function createBaseSession(): ActiveSession {
  return { id: 1 } as unknown as ActiveSession;
}

const DONE_MESSAGE = 'Refactoring engine installed.';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessionNeedsCommit.mockReturnValue(false);
});

describe('refreshWorkingSessionAfterInstall', () => {
  it('refreshes silently without prompting when the session has nothing to commit', async () => {
    const base = createBaseSession();
    const abortMock = vi.fn(() => ({ success: true, err: { number: 0 } }));
    const sessionManager = { abort: abortMock } as unknown as SessionManager;

    const refreshed = await refreshWorkingSessionAfterInstall(base, sessionManager, DONE_MESSAGE);

    expect(mocks.showInformationMessage).not.toHaveBeenCalled();
    expect(abortMock).toHaveBeenCalledWith(base.id);
    expect(refreshed).toBe(true);
  });

  it('prompts with the exact confirmation text when the session has uncommitted changes', async () => {
    mocks.sessionNeedsCommit.mockReturnValue(true);
    mocks.showInformationMessage.mockResolvedValueOnce(undefined);
    const base = createBaseSession();
    const abortMock = vi.fn(() => ({ success: true, err: { number: 0 } }));
    const sessionManager = { abort: abortMock } as unknown as SessionManager;

    await refreshWorkingSessionAfterInstall(base, sessionManager, DONE_MESSAGE);

    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      'Refactoring engine installed. Refresh this session to load it? ' +
        'This discards this session’s uncommitted changes.',
      'Refresh',
      'Later',
    );
  });

  it('prompts with the generic discard wording when commit-need is unknown', async () => {
    mocks.sessionNeedsCommit.mockReturnValue(undefined);
    mocks.showInformationMessage.mockResolvedValueOnce(undefined);
    const base = createBaseSession();
    const abortMock = vi.fn(() => ({ success: true, err: { number: 0 } }));
    const sessionManager = { abort: abortMock } as unknown as SessionManager;

    await refreshWorkingSessionAfterInstall(base, sessionManager, 'Enhanced inspector installed.');

    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      'Enhanced inspector installed. Refresh this session to load it? ' +
        'Any uncommitted changes in this session will be discarded.',
      'Refresh',
      'Later',
    );
  });

  it('does not abort the session when the user picks Later', async () => {
    mocks.sessionNeedsCommit.mockReturnValue(true);
    mocks.showInformationMessage.mockResolvedValueOnce('Later');
    const base = createBaseSession();
    const abortMock = vi.fn(() => ({ success: true, err: { number: 0 } }));
    const sessionManager = { abort: abortMock } as unknown as SessionManager;

    const refreshed = await refreshWorkingSessionAfterInstall(base, sessionManager, DONE_MESSAGE);

    expect(abortMock).not.toHaveBeenCalled();
    expect(refreshed).toBe(false);
  });

  it('aborts the session when the user picks Refresh', async () => {
    mocks.sessionNeedsCommit.mockReturnValue(true);
    mocks.showInformationMessage.mockResolvedValueOnce('Refresh');
    const base = createBaseSession();
    const abortMock = vi.fn(() => ({ success: true, err: { number: 0 } }));
    const sessionManager = { abort: abortMock } as unknown as SessionManager;

    const refreshed = await refreshWorkingSessionAfterInstall(base, sessionManager, DONE_MESSAGE);

    expect(abortMock).toHaveBeenCalledWith(base.id);
    expect(refreshed).toBe(true);
  });

  it('returns false instead of throwing when the abort call itself throws', async () => {
    const base = createBaseSession();
    const abortMock = vi.fn(() => {
      throw new Error('unknown session id');
    });
    const sessionManager = { abort: abortMock } as unknown as SessionManager;

    const refreshed = await refreshWorkingSessionAfterInstall(base, sessionManager, DONE_MESSAGE);

    expect(refreshed).toBe(false);
  });
});
