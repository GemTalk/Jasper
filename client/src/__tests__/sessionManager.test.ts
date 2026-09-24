import { describe, it, expect, beforeEach, vi } from 'vitest';

const configValues: Record<string, unknown> = {};

vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn() },
  // A real emitter, not a pair of spies: SessionManager announces a transaction-
  // state change through one, and a stub `event` that never registers the
  // listener makes "did it announce?" untestable.
  EventEmitter: class<T> {
    private listeners: Array<(e: T) => void> = [];
    event = (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire = (data: T) => {
      for (const listener of this.listeners) listener(data);
    };
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
// What the stone answers the `System transactionMode … System inTransaction`
// probe with. `autoBegin true` is GemStone's default and what almost every stone
// hands out; a test that wants the manualBegin case sets this before logging in.
let transactionStateAnswer = 'autoBegin true';
// The transcript-sink install (run at login) executes a doit via
// executeAndFetchString; capture the calls so tests can assert on them. The
// transaction-state probe goes through the same call, and is answered from
// `transactionStateAnswer` so a test can say which mode the stone handed out.
const executeAndFetchStringMock = vi.fn((..._args: unknown[]) =>
  typeof _args[1] === 'string' && _args[1].includes('System transactionMode asString,')
    ? transactionStateAnswer
    : 'installed',
);
// The liveness ping (GciTsFetchSize on nil) and the logout itself — the only two
// GCI calls a logout has any reason to make. Spied so a test can assert how many
// times they cross to the gem.
const gciTsFetchSize = vi.fn((..._args: unknown[]) => ({
  result: pingErrNumber ? -1n : 0n,
  err: { number: pingErrNumber, message: pingErrNumber ? 'boom' : '' },
}));
const gciTsLogout = vi.fn((..._args: unknown[]) => undefined);
// login() aborts once after setup to drop the session-method-policy's spurious
// write; capture those calls so tests can assert on them.
const gciTsBegin = vi.fn((..._args: unknown[]) => ({
  success: true,
  err: { number: 0, message: '' },
}));
const gciTsCommit = vi.fn((..._args: unknown[]) => ({
  success: true,
  err: { number: 0, message: '' },
}));
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
    GciTsFetchSize(...args: unknown[]) {
      return gciTsFetchSize(...(args as []));
    }
    executeAndFetchString(...args: unknown[]) {
      return executeAndFetchStringMock(...(args as []));
    }
    GciTsCallInProgress() {
      return { result: 0, err: { number: 0, message: '' } };
    }
    GciTsAbort(...args: unknown[]) {
      return gciTsAbort(...(args as []));
    }
    GciTsBegin(...args: unknown[]) {
      return gciTsBegin(...(args as []));
    }
    GciTsCommit(...args: unknown[]) {
      return gciTsCommit(...(args as []));
    }
    GciTsLogout(...args: unknown[]) {
      return gciTsLogout(...(args as []));
    }
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
    transactionStateAnswer = 'autoBegin true';
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

  describe('the transaction mode the stone hands out at login', () => {
    const armCall = () =>
      executeAndFetchStringMock.mock.calls.find(
        (c) => typeof c[1] === 'string' && c[1].includes('#GemAutoServiceSigAbort'),
      );

    it('is read rather than assumed', () => {
      transactionStateAnswer = 'manualBegin false';

      const session = manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');

      expect(session.transactionMode).toBe('manualBegin');
      expect(session.inTransaction).toBe(false);
    });

    // STN_GEM_INITIAL_TRANSACTION_MODE can hand out manualBegin, and such a
    // session is outside a transaction from its first moment — pinning a commit
    // record the stone will come asking for. Waiting for the user to switch modes
    // by hand would leave it to be force-aborted (3031) with every cache
    // reinitialized, which is the very thing this feature promises it is not.
    it('arms the gem’s own SigAbort servicing when that mode is manualBegin', () => {
      transactionStateAnswer = 'manualBegin false';

      manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');

      expect(armCall()![1]).toContain('#GemAutoServiceSigAbort put: true');
    });

    it('does not arm it for the autoBegin session almost everyone gets', () => {
      // autoBegin is never outside a transaction, so the stone never signals it —
      // and a round trip that can only be a no-op is one not to spend at login.
      manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');

      expect(armCall()).toBeUndefined();
    });

    it('still logs in when the arming fails', () => {
      transactionStateAnswer = 'manualBegin false';
      executeAndFetchStringMock.mockImplementation((..._args: unknown[]) => {
        if (typeof _args[1] === 'string' && _args[1].includes('#GemAutoServiceSigAbort')) {
          throw GciLibraryError.withMessage('no privilege');
        }
        return typeof _args[1] === 'string' && _args[1].includes('System transactionMode asString,')
          ? transactionStateAnswer
          : 'installed';
      });

      const session = manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');

      expect(session.id).toBe(1);
      expect(session.transactionMode).toBe('manualBegin');
    });
  });

  describe('switching the transaction mode', () => {
    it('sends the doit queries/transactionMode owns, and re-reads what the stone reached', () => {
      const session = manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');
      transactionStateAnswer = 'manualBegin false';

      manager.setTransactionMode(session.id, 'manualBegin');

      const switchCall = executeAndFetchStringMock.mock.calls.find(
        (c) => typeof c[1] === 'string' && c[1].includes('System transactionMode: #manualBegin'),
      );
      expect(switchCall).toBeDefined();
      expect(session.transactionMode).toBe('manualBegin');
      expect(session.inTransaction).toBe(false);
    });

    it('arms the gem’s SigAbort servicing on the way into manualBegin', () => {
      const session = manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');
      transactionStateAnswer = 'manualBegin false';

      manager.setTransactionMode(session.id, 'manualBegin');

      expect(
        executeAndFetchStringMock.mock.calls.some(
          (c) => typeof c[1] === 'string' && c[1].includes('#GemAutoServiceSigAbort put: true'),
        ),
      ).toBe(true);
    });

    it('announces the change so every surface that draws it redraws together', () => {
      const session = manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');
      const seen: number[] = [];
      manager.onDidChangeTransactionState((id) => seen.push(id));
      transactionStateAnswer = 'manualBegin false';

      manager.setTransactionMode(session.id, 'manualBegin');

      expect(seen).toEqual([session.id]);
    });

    // Under manualBegin a commit or abort drops the session out of its
    // transaction and nothing starts another one, so the cached state is stale
    // the moment the call returns — which is what leaves a row offering Commit
    // where only Begin can work.
    it.each<[string, (m: SessionManager, id: number) => unknown, boolean]>([
      ['begin', (m, id) => m.begin(id), true],
      ['commit', (m, id) => m.commit(id), false],
      ['abort', (m, id) => m.abort(id), false],
    ])('re-reads the state after %s, so the row stops describing the old one', (_n, act, after) => {
      transactionStateAnswer = `manualBegin ${!after}`;
      const session = manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');
      const seen: number[] = [];
      manager.onDidChangeTransactionState((id) => seen.push(id));
      transactionStateAnswer = `manualBegin ${after}`;

      act(manager, session.id);

      expect(session.inTransaction).toBe(after);
      expect(seen).toEqual([session.id]);
    });

    it('says nothing when the state did not actually move', () => {
      const session = manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');
      const seen: number[] = [];
      manager.onDidChangeTransactionState((id) => seen.push(id));

      // The stone keeps answering autoBegin/true: a redraw here would be noise.
      manager.refreshTransactionState(session.id);

      expect(seen).toEqual([]);
    });
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

    // Three logged in, the MIDDLE one current: the session worked in before it
    // and "the next one along" give different answers here, which is what makes
    // this the case worth having. Leaving nothing current would mean every "act
    // in the current session" command had nothing to act in.
    it('promotes the session worked in before, not the next one along', () => {
      const [first, second, third] = loginN(3);
      manager.selectSession(second.id);

      manager.logout(second.id);

      expect(manager.getSelectedSession()?.id).toBe(first.id);
      expect(manager.getSelectedSession()?.id).not.toBe(third.id);
    });

    // The case that decided the rule: work in 1, switch to 2, switch to 3, log 3
    // out. "Oldest still logged in" hands the window to session 1 — a stone the
    // user last touched hours ago; the session they were actually cycling
    // through is 2.
    it('promotes the most recently worked in session, not the oldest', () => {
      const [first, second, third] = loginN(3);
      manager.selectSession(second.id);
      manager.selectSession(third.id);

      manager.logout(third.id);

      expect(manager.getSelectedSession()?.id).toBe(second.id);
      expect(manager.getSelectedSession()?.id).not.toBe(first.id);
    });

    // Logging out the promoted session falls back another step rather than
    // stopping at the one just handed over.
    it('walks further back when the promoted session is logged out in turn', () => {
      const [first, second, third, fourth] = loginN(4);
      manager.selectSession(third.id);
      manager.selectSession(second.id);
      manager.selectSession(fourth.id);

      manager.logout(fourth.id);
      expect(manager.getSelectedSession()?.id).toBe(second.id);

      manager.logout(second.id);

      expect(manager.getSelectedSession()?.id).toBe(third.id);
      expect(manager.getSelectedSession()?.id).not.toBe(first.id);
    });

    // The risk "most recently worked in" carries that login order does not: a
    // remembered session can be gone by the time it would be promoted. Session 2
    // is the one worked in before the current one, and it is logged out in the
    // background first — so promoting it would hand the window a dead handle: a
    // GCI call that fails quietly, then `Session not found`.
    it('skips a remembered session that has since been logged out', () => {
      const [first, second, third, fourth] = loginN(4);
      manager.selectSession(third.id);
      manager.selectSession(second.id);
      manager.selectSession(fourth.id);

      manager.logout(second.id);
      manager.logout(fourth.id);

      expect(manager.getSelectedSession()?.id).toBe(third.id);
      expect(manager.getSelectedSession()?.id).not.toBe(first.id);
    });

    // Nothing was ever switched between — login makes a session current only
    // when it is the first one — so there is no "before this" to go back to.
    it('falls back to the oldest when no session was ever switched to', () => {
      const [first, second] = loginN(3);
      manager.logout(first.id);

      expect(manager.getSelectedSession()?.id).toBe(second.id);
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

    // Reported from a running window: log in 1, 2 and 3, make 2 current, log 3
    // out — and session 1 became current. Logging out a session that is NOT the
    // current one must not move the selection at all, whatever the promotion rule
    // is, so the case is pinned with the newest session going and the MIDDLE one
    // current, which is where a promotion that fired by mistake would land on 1.
    it('leaves the current session alone when the newest is logged out from under it', () => {
      const [first, second, third] = loginN(3);
      manager.selectSession(second.id);

      manager.logout(third.id);

      expect(manager.getSelectedSession()?.id).toBe(second.id);
      expect(manager.getSelectedSession()?.id).not.toBe(first.id);
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    // Deciding which session to promote must not cost a trip to a gem. "Still
    // logged in" is answered from the manager's own session map, not by asking
    // the stone — a liveness ping (GciTsFetchSize, what `ping()` uses) would put
    // a network round trip per candidate in the middle of a logout, on the path
    // that Display It and a notebook cell are waiting on. The logout's own
    // GciTsLogout is the one call that has to happen.
    it('promotes without a round trip to any gem', () => {
      const [, second, third] = loginN(3);
      manager.selectSession(second.id);
      manager.selectSession(third.id);
      vi.clearAllMocks();

      manager.logout(third.id);

      expect(manager.getSelectedSession()?.id).toBe(second.id);
      expect(gciTsLogout).toHaveBeenCalledTimes(1);
      expect(gciTsFetchSize).not.toHaveBeenCalled();
      expect(executeAndFetchStringMock).not.toHaveBeenCalled();
      expect(gciTsAbort).not.toHaveBeenCalled();
    });

    // The same for the fallback arm, which walks every remaining session to find
    // the lowest id — reading ids off the map, not asking any of them anything.
    it('falls back to the oldest without a round trip to any gem', () => {
      const [first] = loginN(3);
      vi.clearAllMocks();

      manager.logout(first.id);

      expect(gciTsLogout).toHaveBeenCalledTimes(1);
      expect(gciTsFetchSize).not.toHaveBeenCalled();
      expect(executeAndFetchStringMock).not.toHaveBeenCalled();
    });

    // White box, because nothing on the public surface can put a logged-out
    // session into the remembered order: `logout` is the only path that removes
    // one and it prunes as it goes. What is pinned is the backstop behind that —
    // a future removal path that forgets to prune must not hand the window a
    // session that has gone, and must not leave the entry behind to be looked up
    // again on the next logout either.
    const rememberedOrder = (m: SessionManager) =>
      (m as unknown as { selectionOrder: number[] }).selectionOrder;

    it('discards a logged-out session from the remembered order instead of stepping over it', () => {
      const [first, second, third] = loginN(3);
      manager.selectSession(first.id);
      manager.selectSession(second.id);
      manager.selectSession(third.id);
      // Session 2 leaves without the order hearing about it.
      const sessions = (manager as unknown as { sessions: Map<number, unknown> }).sessions;
      sessions.delete(second.id);

      manager.logout(third.id);

      expect(manager.getSelectedSession()?.id).toBe(first.id);
      expect(rememberedOrder(manager)).toEqual([first.id]);
    });
  });

  // The property the palette's Commit and Abort are built on: they read the
  // current session directly, with no picker behind them, because a window with
  // any session logged in always HAS a current one. That is held up by two
  // separate branches in two files (login auto-selects the first; logout
  // promotes a surviving session), so pin the property itself — a later
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

    // Same orders, but each session is made current just before it goes — so the
    // remembered selection order is exercised with its entries removed in every
    // order, which is the way "promote the most recently worked in" could reach
    // a session that is no longer logged in.
    it('holds through every logout order when each session is worked in first', () => {
      configValues['sessionMode'] = 'multiple';
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
        for (const which of order) {
          manager.selectSession(ids[which]);
          manager.logout(ids[which]);
          expect(invariantHolds(), `after logging out ${ids[which]} of ${ids}`).toBe(true);
          const current = manager.getSelectedSession();
          expect(current === undefined || manager.getSession(current.id) !== undefined).toBe(true);
        }
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
