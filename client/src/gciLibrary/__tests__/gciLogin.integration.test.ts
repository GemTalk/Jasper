import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { COMMIT_GUARD_REASON, useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { requireParsedStoneNrs, resolveTestConnection } from '../../__tests__/testConnection';
import { gemNrsFor, stoneNrsFor } from '../../loginTypes';
import { requireGciCapability } from './requireGciCapability';

/**
 * The raw GCI login entry points (GciTsLogin, GciTsLogin_, GciTsNbLogin,
 * GciTsNbLogin_) and GciTsEncrypt.
 *
 * This is the one file where a raw login is the test subject rather than
 * plumbing. Each entry point is called from one wrapper below, which carries
 * the scoped harness-session lint disable and arms whatever session it gets
 * back. The credentials come from `resolveTestConnection`.
 * `useIntegrationTest` is here only for its `gciLibrary` and its
 * GEMSTONE_GLOBAL_DIR handling -- the harness's own session is never used.
 */
describe('GCI login (integration)', () => {
  // gcierr.ht -- same values in every vendored release from 3.6.2 through 3.7.5.
  const GS_ERR_LOGIN_DENIAL = 4051;
  const NET_ERR_NO_SUCH_STN = 4065;
  const ERR_IN_LOGIN = 4147;

  let gci: GciLibrary;

  useIntegrationTest(({ gciLibrary }) => {
    gci = gciLibrary;
  });

  // eslint-disable-next-line no-restricted-syntax -- the raw logins below are this file's subject and need the password; see the header comment
  const { stoneNrs, gemNrs, gsUser, gsPassword, netldiName } = resolveTestConnection();

  // A raw login returns a session the harness never armed, and lint does not
  // see the calls the wrappers below make on a test's behalf -- so each
  // wrapper passes its session through here, and no test can come away with a
  // live, unarmed one. As strict as the harness's own `armCommitGuard`: a
  // guard that was already set is not this file's doing, so it fails too.
  // Either failure logs out first, so it doesn't leave the session open until
  // the worker exits.
  function armIfLive<T extends { session: unknown }>(result: T): T {
    if (result.session === null) {
      return result;
    }
    let armedNewly: boolean;
    try {
      armedNewly = gci.disableCommitsUntilLogout(result.session, COMMIT_GUARD_REASON);
    } catch (error) {
      gci.GciTsLogout(result.session);
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(
        `gciLogin.integration.test: could not arm the "no commits allowed" guard on this session. Cause: ${cause}`,
        { cause: error },
      );
    }
    if (!armedNewly) {
      gci.GciTsLogout(result.session);
      throw new Error(
        `gciLogin.integration.test: GemStone reports commits were already disabled on this fresh session, so the "no commits allowed" guard is not this file's doing. Usual causes: this user's UserProfile has "disableCommits" set, or the stone is mid-restore. Check the stone and the credentials in .env.test (or .env.test.local).`,
      );
    }
    return result;
  }

  function expectLiveSessionThenLogout(session: unknown) {
    expect(session).not.toBeNull();
    expect(gci.GciTsLogout(session).success).toBe(true);
  }

  // Same 25ms cadence as sessionManager. The signal is the test's own, so a
  // login that hangs fails on vitest's timeout and stops polling there too.
  async function pollNbLoginFinished(session: unknown, signal: AbortSignal) {
    for (;;) {
      // eslint-disable-next-line no-restricted-syntax -- finishes the raw non-blocking logins below; finishNbLogin arms any session that succeeds
      const finished = gci.GciTsNbLoginFinished(session);
      if (finished.result !== 0) {
        return finished;
      }
      await sleep(25, undefined, { signal });
    }
  }

  // A non-blocking session is live only once polling reports success.
  async function finishNbLogin(session: unknown, signal: AbortSignal) {
    const finished = await pollNbLoginFinished(session, signal);
    if (finished.result === 1) {
      armIfLive({ session });
    }
    return { session, ...finished };
  }

  // One wrapper per raw entry point, each that entry point's only call site.
  // Every one must pass its session through armIfLive (directly or via
  // finishNbLogin): that is the guarantee lint gave before the calls moved in
  // here, and lint can't check it now.
  function gciTsLogin({ stone = stoneNrs, gem = gemNrs, password = gsPassword } = {}) {
    // eslint-disable-next-line no-restricted-syntax -- this file's subject; the one GciTsLogin call site, armed by armIfLive
    const result = gci.GciTsLogin(stone, null, null, false, gem, gsUser, password, 0, 0);
    return armIfLive(result);
  }

  function gciTsLogin_() {
    // eslint-disable-next-line no-restricted-syntax -- this file's subject; the one GciTsLogin_ call site, armed by armIfLive
    const result = gci.GciTsLogin_(
      stoneNrs,
      null,
      null,
      false,
      gemNrs,
      gsUser,
      gsPassword,
      netldiName,
      0,
      0,
    );
    return armIfLive(result);
  }

  async function gciTsNbLogin(signal: AbortSignal, { password = gsPassword } = {}) {
    // eslint-disable-next-line no-restricted-syntax -- this file's subject; the one GciTsNbLogin call site, armed by finishNbLogin
    const { session } = gci.GciTsNbLogin(
      stoneNrs,
      null,
      null,
      false,
      gemNrs,
      gsUser,
      password,
      0,
      0,
    );
    return finishNbLogin(session, signal);
  }

  async function gciTsNbLogin_(signal: AbortSignal) {
    // eslint-disable-next-line no-restricted-syntax -- this file's subject; the one GciTsNbLogin_ call site, armed by finishNbLogin
    const { session } = gci.GciTsNbLogin_(
      stoneNrs,
      null,
      null,
      false,
      gemNrs,
      gsUser,
      gsPassword,
      netldiName,
      0,
      0,
    );
    return finishNbLogin(session, signal);
  }

  describe('successful login', () => {
    it('GciTsLogin returns a live session', () => {
      expectLiveSessionThenLogout(gciTsLogin().session);
    });

    it('GciTsLogin_ returns a live session', (ctx) => {
      requireGciCapability('GciTsLogin_', ctx, gci);

      expectLiveSessionThenLogout(gciTsLogin_().session);
    });

    it('GciTsNbLogin finishes with a live session', async (ctx) => {
      requireGciCapability('GciTsNbLogin', ctx, gci);
      requireGciCapability('GciTsNbLoginFinished', ctx, gci);

      const { session, result } = await gciTsNbLogin(ctx.signal);

      expect(result).toBe(1);
      expectLiveSessionThenLogout(session);
    });

    it('GciTsNbLogin_ finishes with a live session', async (ctx) => {
      requireGciCapability('GciTsNbLogin_', ctx, gci);
      requireGciCapability('GciTsNbLoginFinished', ctx, gci);

      const { session, result } = await gciTsNbLogin_(ctx.signal);

      expect(result).toBe(1);
      expectLiveSessionThenLogout(session);
    });
  });

  // The bad NRSs keep the real host, so a failure means "no such stone/NetLDI
  // there", never "no such host".
  describe('failed login', () => {
    it('GciTsLogin rejects an unknown stone', () => {
      const { gem_host } = requireParsedStoneNrs(stoneNrs);

      const { session, err } = gciTsLogin({
        stone: stoneNrsFor({ gem_host, stone: 'jasperNoSuchStone' }),
      });

      expect(session).toBeNull();
      expect(err.number).toBe(NET_ERR_NO_SUCH_STN);
    });

    it('GciTsLogin rejects a wrong password', () => {
      const { session, err } = gciTsLogin({ password: 'wrongPassword' });

      expect(session).toBeNull();
      expect(err.number).toBe(GS_ERR_LOGIN_DENIAL);
    });

    it('GciTsLogin rejects an unknown NetLDI in the gem NRS', () => {
      const { gem_host } = requireParsedStoneNrs(stoneNrs);

      const { session, err } = gciTsLogin({
        gem: gemNrsFor({ gem_host, netldi: 'jasperNoSuchNetldi' }),
      });

      expect(session).toBeNull();
      expect(err.number).toBe(ERR_IN_LOGIN);
      expect(err.message).toContain("NetLDI service 'jasperNoSuchNetldi'");
    });

    it('GciTsNbLogin reports a wrong password when polled', async (ctx) => {
      requireGciCapability('GciTsNbLogin', ctx, gci);
      requireGciCapability('GciTsNbLoginFinished', ctx, gci);

      const { session, result, err } = await gciTsNbLogin(ctx.signal, {
        password: 'wrongPassword',
      });

      // No logout afterward, matching production (sessionManager's
      // non-blocking login throws on -1 without logging out).
      expect(session).not.toBeNull();
      expect(result).toBe(-1);
      expect(err.number).toBe(GS_ERR_LOGIN_DENIAL);
    });
  });

  describe('GciTsEncrypt', () => {
    it('encrypts a password to a non-empty string that differs from it', (ctx) => {
      requireGciCapability('GciTsEncrypt', ctx, gci);

      const encrypted = gci.GciTsEncrypt(gsPassword);

      expect(encrypted).not.toBeNull();
      expect(encrypted!.length).toBeGreaterThan(0);
      expect(encrypted).not.toBe(gsPassword);
    });

    it('returns null for an empty string', (ctx) => {
      requireGciCapability('GciTsEncrypt', ctx, gci);

      expect(gci.GciTsEncrypt('')).toBeNull();
    });

    it('produces consistent output for the same input', (ctx) => {
      requireGciCapability('GciTsEncrypt', ctx, gci);

      expect(gci.GciTsEncrypt(gsPassword)).toBe(gci.GciTsEncrypt(gsPassword));
    });
  });
});
