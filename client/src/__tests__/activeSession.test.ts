import { describe, it, expect, vi } from 'vitest';
import type { GemStoneLogin } from '../loginTypes';
import { ActiveSession } from '../activeSession';
import { GCI_ERR_OP_IN_PROGRESS } from '../gciConstants';
import { fakeActiveSession, sessionOn } from './fakeActiveSession';

const login: GemStoneLogin = {
  label: '',
  version: '3.7.5',
  gem_host: 'gemhost',
  stone: 'gs64stone',
  gs_user: 'DataCurator',
  gs_password: 'swordfish',
  netldi: 'gs64ldi',
  host_user: '',
  host_password: '',
};

function libraryWhoseLoginAnswers(result: {
  session: unknown;
  err: { number: number; message: string };
}) {
  return {
    GciTsLogin: vi.fn(() => result),
    logout: vi.fn((_session: unknown) => ({ sessionFreed: true })),
  };
}

describe('a transient login', () => {
  it('logs in on the same library with the given credentials', () => {
    const gci = libraryWhoseLoginAnswers({ session: {}, err: { number: 0, message: '' } });
    const session = sessionOn(gci);

    // eslint-disable-next-line no-restricted-syntax -- transientLogin itself is under test, on a mocked library
    session.transientLogin({ ...login, gs_user: 'SystemUser', gs_password: 'secret' });

    expect(gci.GciTsLogin).toHaveBeenCalledWith(
      '!tcp@gemhost#server!gs64stone',
      null,
      null,
      false,
      '!tcp@gemhost#netldi:gs64ldi#task!gemnetobject',
      'SystemUser',
      'secret',
      0,
      0,
    );
  });

  it('answers an unregistered session on the new login', () => {
    const newHandle = {};
    const gci = libraryWhoseLoginAnswers({ session: newHandle, err: { number: 0, message: '' } });
    const session = sessionOn(gci);
    const systemUser = { ...login, gs_user: 'SystemUser' };

    // eslint-disable-next-line no-restricted-syntax -- transientLogin itself is under test, on a mocked library
    const transient = session.transientLogin(systemUser).session!;
    // Logging out is the only way left to observe which handle the session holds.
    transient.logout();

    expect(transient.id).toBeLessThan(0);
    expect(gci.logout.mock.calls[0][0]).toBe(newHandle);
    expect(transient.login).toBe(systemUser);
    expect(transient.stoneVersion).toBe(session.stoneVersion);
  });

  it('gives every transient login an id of its own', () => {
    const session = sessionOn(
      libraryWhoseLoginAnswers({ session: {}, err: { number: 0, message: '' } }),
    );

    // eslint-disable-next-line no-restricted-syntax -- transientLogin itself is under test, on a mocked library
    const first = session.transientLogin(login).session!;
    // eslint-disable-next-line no-restricted-syntax -- transientLogin itself is under test, on a mocked library
    const second = session.transientLogin(login).session!;

    expect(first.id).toBeLessThan(0);
    expect(second.id).toBeLessThan(0);
    expect(second.id).not.toBe(first.id);
  });

  it("answers GemStone's error and no session when the login is refused", () => {
    const err = { number: 4051, message: 'Login denied' };
    const session = sessionOn(libraryWhoseLoginAnswers({ session: null, err }));

    // eslint-disable-next-line no-restricted-syntax -- transientLogin itself is under test, on a mocked library
    const refused = session.transientLogin(login);

    expect(refused.session).toBeUndefined();
    expect(refused.err).toBe(err);
  });
});

const noError = { number: 0, message: '' };

/** A fake GCI library that records every call and answers whether a logout freed the session. */
function recordingLibrary() {
  const calls: string[] = [];
  const gci = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (..._args: unknown[]) => {
          calls.push(String(name));
          return name === 'logout' ? { sessionFreed: true } : undefined;
        },
    },
  );
  return { gci, calls };
}

const libraryLevelMembers = [
  'constructor',
  'transientLogin',
  'GciTsOopIsSpecial',
  'GciTsVersion',
  'isAvailable',
  'isLoggedOut',
];
// Private helpers that only read or change the busy counts, for callers that
// have already checked the session.
const busyBookkeeping = ['hasCallOutstanding', 'noticeIfFreed'];
const membersThatNeedTheSession = Object.getOwnPropertyNames(ActiveSession.prototype).filter(
  (name) => !libraryLevelMembers.includes(name) && !busyBookkeeping.includes(name),
);

describe('logging a session out', () => {
  it('logs out its own handle', () => {
    const handle = {};
    const gci = { logout: vi.fn((_session: unknown) => ({ sessionFreed: true })) };
    const session = fakeActiveSession({ gci, handle });

    session.logout();

    expect(gci.logout.mock.calls[0][0]).toBe(handle);
  });

  it('answers whether the logout freed the session', () => {
    const freed = fakeActiveSession({ gci: { logout: () => ({ sessionFreed: true }) } });
    const refused = fakeActiveSession({ gci: { logout: () => ({ sessionFreed: false }) } });

    const answers = [freed.logout(), refused.logout()];

    expect(answers).toEqual([true, false]);
  });

  it('refuses calls once the logout frees the session', () => {
    const { gci, calls } = recordingLibrary();
    const session = sessionOn(gci);
    session.logout();
    calls.length = 0;

    const fetch = () => session.GciTsFetchSize(1n);

    expect(fetch).toThrow('The GemStone session is logged out.');
    expect(calls).toEqual([]);
  });

  it('says whether it has been logged out', () => {
    const gci = { logout: vi.fn((_session: unknown) => ({ sessionFreed: true })) };
    const session = fakeActiveSession({ gci, handle: {} });
    expect(session.isLoggedOut()).toBe(false);

    session.logout();

    expect(session.isLoggedOut()).toBe(true);
  });

  // GciLibrary.logout needs it to read GemStone 3.7.6's unexplained refusal.
  it('tells the library whether one of its calls is running on a worker thread', async () => {
    let finish: (value: { result: bigint; err: object }) => void = () => {};
    const gci = {
      logout: vi.fn((_session: unknown, _ownCallRunning: boolean) => ({ sessionFreed: false })),
      GciTsPerformAsync: vi.fn(
        () =>
          new Promise<{ result: bigint; err: object }>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const session = sessionOn(gci);
    const call = session.GciTsPerformAsync(1n, 1n, null, [], 0, 0);

    session.logout();
    finish({ result: 1n, err: {} });
    await call;
    session.logout();

    expect(gci.logout.mock.calls.map(([, ownCallRunning]) => ownCallRunning)).toEqual([
      true,
      false,
    ]);
  });

  it("keeps GemStone's error from a failed logout, and clears it after one that succeeds", () => {
    const failure = { number: GCI_ERR_OP_IN_PROGRESS, message: 'operation in progress' };
    const gci = {
      logout: vi
        .fn((_session: unknown): object => ({ sessionFreed: false, failure }))
        .mockReturnValueOnce({ sessionFreed: false, failure })
        .mockReturnValueOnce({ sessionFreed: true }),
    };
    const session = sessionOn(gci);

    session.logout();
    const afterFailure = session.lastLogoutFailure;
    session.logout();

    expect(afterFailure).toBe(failure);
    expect(session.lastLogoutFailure).toBeUndefined();
  });

  it('keeps the session usable when the logout leaves it alive', () => {
    const gci = {
      logout: vi.fn((_session: unknown) => ({ sessionFreed: false })),
      GciTsFetchSize: vi.fn((_session: unknown, _obj: bigint) => 3n),
    };
    const session = sessionOn(gci);
    session.logout();

    const size = session.GciTsFetchSize(1n);

    expect(size).toBe(3n);
  });

  it.each(membersThatNeedTheSession)(
    'refuses a call that needs the session once it is logged out (%s)',
    async (name) => {
      const { gci, calls } = recordingLibrary();
      const session = sessionOn(gci);
      session.logout();
      calls.length = 0;

      const call = async () => (session as unknown as Record<string, () => unknown>)[name]();

      await expect(call()).rejects.toThrow('The GemStone session is logged out.');
      expect(calls).toEqual([]);
    },
  );

  it('rejects instead of throwing for a call that answers a promise', async () => {
    const session = sessionOn(recordingLibrary().gci);
    session.logout();

    const continued = session.GciTsContinueWithAsync(1n, 1n, null, 0);

    await expect(continued).rejects.toThrow('The GemStone session is logged out.');
  });

  it('still answers library-level calls once logged out', () => {
    const { gci, calls } = recordingLibrary();
    const session = sessionOn(gci);
    session.logout();
    calls.length = 0;

    session.GciTsOopIsSpecial(1n);
    session.GciTsVersion();
    // eslint-disable-next-line no-restricted-syntax -- the pass-through itself is under test, not a capability skip
    session.isAvailable('GciTsNbPoll');

    expect(calls).toEqual(['GciTsOopIsSpecial', 'GciTsVersion', 'isAvailable']);
  });

  it('can still open a transient login once logged out', () => {
    const gci = libraryWhoseLoginAnswers({ session: {}, err: noError });
    const session = sessionOn(gci);
    session.logout();

    // eslint-disable-next-line no-restricted-syntax -- transientLogin itself is under test, on a mocked library
    const transient = session.transientLogin(login);

    expect(transient.session).toBeDefined();
  });
});

describe('telling listeners the session is free', () => {
  it('stays quiet when a worker call settles after the logout got through', async () => {
    let settle: (value: unknown) => void = () => undefined;
    const gci = {
      GciTsPerformAsync: () => new Promise((resolve) => (settle = resolve)),
      logout: () => ({ sessionFreed: true }),
    };
    const session = fakeActiveSession({ gci, handle: {} });
    const listener = vi.fn();
    session.onFreed(listener);
    const call = session.GciTsPerformAsync(1n, 1n, 'wait', [], 0, 0);
    session.logout();

    settle({ result: 1n, err: { number: 0, message: '' } });
    await call;

    expect(listener).not.toHaveBeenCalled();
  });
});
