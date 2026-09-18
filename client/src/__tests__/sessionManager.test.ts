import { describe, it, expect, beforeEach, vi } from 'vitest';

const configValues: Record<string, unknown> = {};

vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn() },
  EventEmitter: class {
    fire = vi.fn();
    event = vi.fn();
    dispose = vi.fn();
  },
  window: { showQuickPick: vi.fn(), showInformationMessage: vi.fn() },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue),
    })),
  },
}));

let pingErrNumber = 0;
// The transcript-sink install (run at login) executes a doit via
// executeAndFetchString; capture the calls so tests can assert on them.
const executeAndFetchStringMock = vi.fn((..._args: unknown[]) => 'installed');
// login() aborts once after setup to drop the session-method-policy's spurious
// write; capture those calls so tests can assert on them.
const gciTsAbort = vi.fn((..._args: unknown[]) => ({
  success: true,
  err: { number: 0, message: '' },
}));
const gciTsLogin = vi.fn((..._args: unknown[]) => ({
  session: {},
  err: { number: 0, message: '' },
}));

// Non-blocking login controls (loginAsync). `supportsNb` picks the nb vs
// blocking path; `nbLoginStarts` simulates GciTsNbLogin failing to start; the
// GciTsNbLoginFinished sequence is consumed one per poll (0 pending, 1 done,
// -1 failed), defaulting to done once exhausted.
let supportsNb = false;
let nbLoginStarts = true;
let nbFinishedSequence: Array<{ result: number; err?: { number: number; message: string } }> = [];
const gciTsNbLogin = vi.fn((..._args: unknown[]) => ({
  session: nbLoginStarts ? {} : null,
  loginPollSocket: 3,
}));
const gciTsNbLoginFinished = vi.fn(() => {
  const next = nbFinishedSequence.shift() ?? { result: 1 };
  return {
    result: next.result,
    executedSessionInit: false,
    err: next.err ?? { number: 0, message: '' },
  };
});

vi.mock('../gciLibrary', () => ({
  GciLibrary: class {
    GciTsLogin(...args: unknown[]) {
      return gciTsLogin(...(args as []));
    }
    GciTsVersion() {
      return { version: '3.7.2' };
    }
    GciTsFetchSize() {
      return {
        result: pingErrNumber ? -1n : 0n,
        err: { number: pingErrNumber, message: pingErrNumber ? 'boom' : '' },
      };
    }
    executeAndFetchString(...args: unknown[]) {
      return executeAndFetchStringMock(...(args as []));
    }
    GciTsAbort(...args: unknown[]) {
      return gciTsAbort(...(args as []));
    }
    GciTsLogout() {}
    supportsNonBlockingLogin() {
      return supportsNb;
    }
    GciTsNbLogin(...args: unknown[]) {
      return gciTsNbLogin(...(args as []));
    }
    GciTsNbLoginFinished(...args: unknown[]) {
      return gciTsNbLoginFinished(...(args as []));
    }
    close() {}
  },
}));

vi.mock('../gciLog', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

import * as vscode from 'vscode';
import { SessionManager, evaluateLoginPolicy } from '../sessionManager';
import { DEFAULT_LOGIN } from '../loginTypes';
import { GciLibraryError } from '../gciLibraryError';

describe('evaluateLoginPolicy', () => {
  it('allows the first login regardless of mode', () => {
    expect(evaluateLoginPolicy('single', 0, '')).toBeNull();
    expect(evaluateLoginPolicy('multiple', 0, '{session}')).toBeNull();
  });

  it('blocks a second login in single mode', () => {
    expect(evaluateLoginPolicy('single', 1, '{session}')).toMatch(/Only one GemStone session/);
  });

  it('treats an unrecognized/unset mode as single', () => {
    expect(evaluateLoginPolicy('', 1, '{session}')).toMatch(/Only one GemStone session/);
  });

  it('allows concurrent sessions in multiple mode with a {session} export path', () => {
    expect(evaluateLoginPolicy('multiple', 1, '{workspaceRoot}/gemstone/{session}')).toBeNull();
    expect(evaluateLoginPolicy('multiple', 1, '')).toBeNull();
  });

  it('blocks a second session in multiple mode when export path lacks {session}', () => {
    expect(evaluateLoginPolicy('multiple', 1, '{workspaceRoot}/gemstone/{dictName}')).toMatch(
      /does not include \{session\}/,
    );
  });
});

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(configValues)) delete configValues[k];
    pingErrNumber = 0;
    supportsNb = false;
    nbLoginStarts = true;
    nbFinishedSequence = [];
    manager = new SessionManager();
  });

  it('allows a first login', () => {
    const session = manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');
    expect(session.id).toBe(1);
  });

  it('installs the server-side Transcript sink at login', () => {
    manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');

    const installCall = executeAndFetchStringMock.mock.calls.find(
      (c) => typeof c[1] === 'string' && c[1].includes('JasperTranscriptSink'),
    );
    expect(installCall).toBeDefined();
    expect(installCall![1]).toContain('TranscriptStream_SessionStream');
  });

  it('still logs in when the Transcript sink install fails', () => {
    executeAndFetchStringMock.mockImplementationOnce(() => {
      throw GciLibraryError.withMessage('no compile privilege');
    });

    const session = manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');

    expect(session.id).toBe(1);
  });

  it('aborts the fresh session after login to drop the spurious session-method-policy write', () => {
    const session = manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');

    expect(gciTsAbort).toHaveBeenCalledWith(session.handle);
  });

  it('still completes login when the post-login abort fails', () => {
    gciTsAbort.mockReturnValueOnce({ success: false, err: { number: 1, message: 'boom' } });

    const session = manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');

    expect(session.id).toBe(1);
  });

  it('still completes login when the post-login abort throws', () => {
    gciTsAbort.mockImplementationOnce(() => {
      throw new Error('gci down');
    });

    const session = manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');

    expect(session.id).toBe(1);
  });

  it('rejects a second login in single mode (the default)', () => {
    manager.login({ ...DEFAULT_LOGIN, label: 'First' }, '/mock/lib');
    expect(() => manager.login({ ...DEFAULT_LOGIN, label: 'Second' }, '/mock/lib')).toThrow(
      'Only one GemStone session is allowed at a time',
    );
  });

  it('allows multiple sessions in multiple mode with default export path (includes {session})', () => {
    configValues['sessionMode'] = 'multiple';
    manager.login({ ...DEFAULT_LOGIN, label: 'First' }, '/mock/lib');
    const session2 = manager.login({ ...DEFAULT_LOGIN, label: 'Second' }, '/mock/lib');
    expect(session2.id).toBe(2);
  });

  it('allows multiple sessions in multiple mode when custom export path includes {session}', () => {
    configValues['sessionMode'] = 'multiple';
    configValues['exportPath'] = '{workspaceRoot}/gemstone/{session}/{dictName}';
    manager.login({ ...DEFAULT_LOGIN, label: 'First' }, '/mock/lib');
    const session2 = manager.login({ ...DEFAULT_LOGIN, label: 'Second' }, '/mock/lib');
    expect(session2.id).toBe(2);
  });

  it('rejects a second login in multiple mode when custom export path lacks {session}', () => {
    configValues['sessionMode'] = 'multiple';
    configValues['exportPath'] = '{workspaceRoot}/gemstone/{dictName}';
    manager.login({ ...DEFAULT_LOGIN, label: 'First' }, '/mock/lib');
    expect(() => manager.login({ ...DEFAULT_LOGIN, label: 'Second' }, '/mock/lib')).toThrow(
      'does not include {session}',
    );
  });

  it('allows login again after logging out', () => {
    const session = manager.login({ ...DEFAULT_LOGIN, label: 'First' }, '/mock/lib');
    manager.logout(session.id);
    const session2 = manager.login({ ...DEFAULT_LOGIN, label: 'Second' }, '/mock/lib');
    expect(session2.id).toBe(2);
  });

  // What logging out of the CURRENT session leaves selected decides whether the
  // palette's Commit and Abort have a session to act in at all, or have to ask.
  describe('logout hands the selection on', () => {
    const loginN = (n: number) => {
      configValues['sessionMode'] = 'multiple';
      return Array.from({ length: n }, (_, i) =>
        manager.login({ ...DEFAULT_LOGIN, label: `Session ${i + 1}` }, '/mock/lib'),
      );
    };

    it('makes the remaining session current when the last one standing is unambiguous', () => {
      const [first, second] = loginN(2);
      manager.selectSession(first.id);

      manager.logout(first.id);

      expect(manager.getSelectedSession()?.id).toBe(second.id);
    });

    // Three logged in, the MIDDLE one current: promoting the oldest and
    // promoting "the next one along" give different answers here, which is what
    // makes this the case worth having. Leaving nothing current would mean every
    // "act in the current session" command had nothing to act in.
    it('promotes the oldest remaining session, not the next one along', () => {
      const [first, second, third] = loginN(3);
      manager.selectSession(second.id);

      manager.logout(second.id);

      expect(manager.getSelectedSession()?.id).toBe(first.id);
      expect(manager.getSelectedSession()?.id).not.toBe(third.id);
    });

    it('promotes by login order when the newest session is the one that goes', () => {
      const [first, , third] = loginN(3);
      manager.selectSession(third.id);

      manager.logout(third.id);

      expect(manager.getSelectedSession()?.id).toBe(first.id);
    });

    it('leaves nothing current when the last session goes', () => {
      const [only] = loginN(1);
      manager.logout(only.id);

      expect(manager.getSelectedSession()).toBeUndefined();
    });

    // `gemstone.hasActiveSession` is what withholds GemStone: Commit and
    // GemStone: Abort from the Command Palette, and those commands now read the
    // current session with no picker behind them — so a key left true over a
    // window with nothing logged in would put back a palette entry that can only
    // report that there is nothing to commit.
    const contextCalls = () =>
      vi
        .mocked(vscode.commands.executeCommand)
        .mock.calls.filter(
          ([cmd, key]) => cmd === 'setContext' && key === 'gemstone.hasActiveSession',
        );

    // The window has just changed which stone Display It / Execute It / a
    // notebook cell will run in, and none of those asks first.
    it('says which session it promoted', () => {
      const [first, second] = loginN(2);
      manager.selectSession(second.id);

      manager.logout(second.id);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining(`Session ${first.id}`),
      );
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('is now the current session'),
      );
    });

    it('says nothing when the session logged out was not the current one', () => {
      const [first, second] = loginN(3);
      manager.selectSession(first.id);

      manager.logout(second.id);

      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('turns hasActiveSession off when the last session goes', () => {
      const [only] = loginN(1);
      manager.logout(only.id);

      expect(contextCalls().at(-1)?.[2]).toBe(false);
    });

    it('leaves hasActiveSession on when a session remains to be promoted', () => {
      const [first] = loginN(3);
      manager.selectSession(first.id);

      manager.logout(first.id);

      expect(contextCalls().at(-1)?.[2]).toBe(true);
    });

    it('keeps the current session when a background session is logged out', () => {
      const [first, second] = loginN(3);
      manager.selectSession(first.id);

      manager.logout(second.id);

      expect(manager.getSelectedSession()?.id).toBe(first.id);
    });
  });

  // The property the palette's Commit and Abort are built on: they read the
  // current session directly, with no picker behind them, because a window with
  // any session logged in always HAS a current one. That is held up by two
  // separate branches in two files (login auto-selects the first; logout
  // promotes the oldest survivor), so pin the property itself — a later
  // "deselect", or a crash-cleanup path that drops a session without re-electing
  // one, would put a QuickPick back in the middle of a Commit.
  describe('a window with sessions always has a current one', () => {
    const invariantHolds = () =>
      manager.getSessions().length === 0 || manager.getSelectedSession() !== undefined;

    it('holds through every order of logging three sessions out', () => {
      configValues['sessionMode'] = 'multiple';
      // Each permutation of the logout order, over a fresh set of logins.
      const orders = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ];
      for (const order of orders) {
        const ids = [1, 2, 3].map(
          (n) => manager.login({ ...DEFAULT_LOGIN, label: `S${n}` }, '/mock/lib').id,
        );
        expect(invariantHolds(), 'after logging in').toBe(true);
        for (const which of order) {
          manager.logout(ids[which]);
          expect(invariantHolds(), `after logging out ${ids[which]} of ${ids}`).toBe(true);
        }
        expect(manager.getSessions()).toHaveLength(0);
        expect(manager.getSelectedSession()).toBeUndefined();
      }
    });

    it('holds when a session is logged out and another logged in again', () => {
      configValues['sessionMode'] = 'multiple';
      const first = manager.login({ ...DEFAULT_LOGIN, label: 'First' }, '/mock/lib');
      const second = manager.login({ ...DEFAULT_LOGIN, label: 'Second' }, '/mock/lib');
      manager.logout(first.id);
      expect(invariantHolds()).toBe(true);

      manager.login({ ...DEFAULT_LOGIN, label: 'Third' }, '/mock/lib');
      expect(invariantHolds()).toBe(true);

      manager.logout(second.id);
      expect(invariantHolds()).toBe(true);
    });
  });

  describe('resolveSession', () => {
    const twoSessions = () => {
      configValues['sessionMode'] = 'multiple';
      manager.login({ ...DEFAULT_LOGIN, label: 'One' }, '/mock/lib');
      const second = manager.login({ ...DEFAULT_LOGIN, label: 'Two' }, '/mock/lib');
      manager.selectSession(second.id);
      return second;
    };

    it('uses the selected session without asking', async () => {
      const selected = twoSessions();

      const resolved = await manager.resolveSession();

      expect(resolved?.id).toBe(selected.id);
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it('asks anyway under alwaysAsk, for a command a wrong stone would cost', async () => {
      const selected = twoSessions();
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue({
        label: 'One',
        session: manager.getSessions()[0],
      } as unknown as vscode.QuickPickItem);

      const resolved = await manager.resolveSession({ alwaysAsk: true });

      expect(vscode.window.showQuickPick).toHaveBeenCalled();
      expect(resolved?.id).not.toBe(selected.id);
    });

    it('leads with the selected session, marked, so Enter keeps it', async () => {
      const selected = twoSessions();
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

      await manager.resolveSession({ alwaysAsk: true });

      const items = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as unknown as {
        description: string;
        session: { id: number };
      }[];
      expect(items[0].session.id).toBe(selected.id);
      expect(items[0].description).toContain('current');
    });

    it('asks nothing when only one session is logged in, however it is called', async () => {
      const only = manager.login({ ...DEFAULT_LOGIN, label: 'One' }, '/mock/lib');

      const resolved = await manager.resolveSession({ alwaysAsk: true });

      expect(resolved?.id).toBe(only.id);
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it("carries the caller's wording into the prompt", async () => {
      twoSessions();
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

      await manager.resolveSession({ alwaysAsk: true, placeHolder: 'file into' });

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ placeHolder: 'file into' }),
      );
    });
  });

  describe('ping', () => {
    it('reports success when the round-trip returns cleanly', () => {
      const session = manager.login({ ...DEFAULT_LOGIN, label: 'First' }, '/mock/lib');
      expect(manager.ping(session.id)).toEqual({ success: true, err: { number: 0, message: '' } });
    });

    it('reports failure when the gem returns an error', () => {
      const session = manager.login({ ...DEFAULT_LOGIN, label: 'First' }, '/mock/lib');
      pingErrNumber = 4100;
      const result = manager.ping(session.id);
      expect(result.success).toBe(false);
      expect(result.err.number).toBe(4100);
    });

    it('throws for an unknown session id', () => {
      expect(() => manager.ping(999)).toThrow('Session not found');
    });
  });

  describe('loginAsync', () => {
    const testLogin = () => ({ ...DEFAULT_LOGIN, label: 'Test' });

    it('logs in over the non-blocking path when the library supports it', async () => {
      supportsNb = true;
      nbFinishedSequence = [{ result: 0 }, { result: 0 }];

      const session = await manager.loginAsync(testLogin(), '/mock/lib');

      expect(session.id).toBe(1);
      expect(session.stoneVersion).toBe('3.7.2');
      expect(gciTsNbLogin).toHaveBeenCalledOnce();
      expect(gciTsNbLoginFinished.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(gciTsLogin).not.toHaveBeenCalled();
    });

    it('falls back to the blocking login when non-blocking is unsupported', async () => {
      supportsNb = false;

      const session = await manager.loginAsync(testLogin(), '/mock/lib');

      expect(session.id).toBe(1);
      expect(gciTsLogin).toHaveBeenCalledOnce();
      expect(gciTsNbLogin).not.toHaveBeenCalled();
    });

    it('rejects with the gem error message when a non-blocking login fails', async () => {
      supportsNb = true;
      nbFinishedSequence = [
        { result: 0 },
        { result: -1, err: { number: 4051, message: 'invalid password' } },
      ];

      await expect(manager.loginAsync(testLogin(), '/mock/lib')).rejects.toThrow(
        /invalid password/,
      );
    });

    it('rejects when a non-blocking login cannot be started', async () => {
      supportsNb = true;
      nbLoginStarts = false;

      await expect(manager.loginAsync(testLogin(), '/mock/lib')).rejects.toThrow(/could not start/);
    });

    it('counts an in-flight async login against the single-session cap', async () => {
      supportsNb = true;

      const pending = manager.loginAsync(testLogin(), '/mock/lib');

      expect(() => manager.login(testLogin(), '/mock/lib')).toThrow(/Only one GemStone session/);

      await pending;
    });

    it('frees the pending slot after a failed async login so a retry is allowed', async () => {
      supportsNb = true;
      nbLoginStarts = false;

      await expect(manager.loginAsync(testLogin(), '/mock/lib')).rejects.toThrow();

      supportsNb = false;
      const session = await manager.loginAsync(testLogin(), '/mock/lib');
      expect(session.id).toBe(1);
    });
  });
});
