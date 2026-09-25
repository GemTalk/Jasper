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
 * plumbing, so it is exempt from the harness-session lint and logs in for
 * itself with the credentials from `resolveTestConnection`.
 * `useIntegrationTest` is here only for its `gciLibrary` and its
 * GEMSTONE_GLOBAL_DIR handling -- the harness's own session is never used.
 */
describe('GCI login (integration)', () => {
  // gcierr.ht -- same values in every vendored release from 3.6.2 through 3.7.5.
  const GS_ERR_LOGIN_DENIAL = 4051;
  const NET_ERR_NO_SUCH_STN = 4065;
  const ERR_IN_LOGIN = 4147;

  // GciTsNbLoginFinished is a synchronous FFI call, so a login that never
  // finishes would spin this loop past vitest's test timeout, which can't
  // interrupt synchronous code.
  const NB_LOGIN_DEADLINE_MS = 30_000;

  let gci: GciLibrary;

  useIntegrationTest(({ gciLibrary }) => {
    gci = gciLibrary;
  });

  const { stoneNrs, gemNrs, gsUser, gsPassword, netldiName } = resolveTestConnection();
  const { gem_host } = requireParsedStoneNrs(stoneNrs);

  // The lint exemption above also lifts the rule that would make these
  // sessions arm the commit guard, so arm them by hand even though the tests
  // never run anything on them.
  function expectLiveSessionThenLogout(session: unknown) {
    expect(session).not.toBeNull();
    gci.disableCommitsUntilLogout(session, COMMIT_GUARD_REASON);
    expect(gci.GciTsLogout(session).success).toBe(true);
  }

  function pollNbLoginFinished(session: unknown) {
    const deadline = Date.now() + NB_LOGIN_DEADLINE_MS;
    for (;;) {
      const finished = gci.GciTsNbLoginFinished(session);
      if (finished.result !== 0) {
        return finished;
      }
      if (Date.now() > deadline) {
        throw new Error(`GciTsNbLoginFinished still pending after ${NB_LOGIN_DEADLINE_MS}ms`);
      }
    }
  }

  describe('successful login', () => {
    it('GciTsLogin returns a live session', () => {
      const { session } = gci.GciTsLogin(
        stoneNrs,
        null,
        null,
        false,
        gemNrs,
        gsUser,
        gsPassword,
        0,
        0,
      );

      expectLiveSessionThenLogout(session);
    });

    it('GciTsLogin_ returns a live session', (ctx) => {
      requireGciCapability('GciTsLogin_', ctx, gci);

      const { session } = gci.GciTsLogin_(
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

      expectLiveSessionThenLogout(session);
    });

    it('GciTsNbLogin finishes with a live session', (ctx) => {
      requireGciCapability('GciTsNbLogin', ctx, gci);

      const { session } = gci.GciTsNbLogin(
        stoneNrs,
        null,
        null,
        false,
        gemNrs,
        gsUser,
        gsPassword,
        0,
        0,
      );

      expect(pollNbLoginFinished(session).result).toBe(1);
      expectLiveSessionThenLogout(session);
    });

    it('GciTsNbLogin_ finishes with a live session', (ctx) => {
      requireGciCapability('GciTsNbLogin_', ctx, gci);

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

      expect(pollNbLoginFinished(session).result).toBe(1);
      expectLiveSessionThenLogout(session);
    });
  });

  // The bad NRSs keep the real host, so a failure means "no such stone/NetLDI
  // there", never "no such host".
  describe('failed login', () => {
    it('GciTsLogin rejects an unknown stone', () => {
      const { session, err } = gci.GciTsLogin(
        stoneNrsFor({ gem_host, stone: 'jasperNoSuchStone' }),
        null,
        null,
        false,
        gemNrs,
        gsUser,
        gsPassword,
        0,
        0,
      );

      expect(session).toBeNull();
      expect(err.number).toBe(NET_ERR_NO_SUCH_STN);
    });

    it('GciTsLogin rejects a wrong password', () => {
      const { session, err } = gci.GciTsLogin(
        stoneNrs,
        null,
        null,
        false,
        gemNrs,
        gsUser,
        'wrongPassword',
        0,
        0,
      );

      expect(session).toBeNull();
      expect(err.number).toBe(GS_ERR_LOGIN_DENIAL);
    });

    it('GciTsLogin rejects an unknown NetLDI in the gem NRS', () => {
      const { session, err } = gci.GciTsLogin(
        stoneNrs,
        null,
        null,
        false,
        gemNrsFor({ gem_host, netldi: 'jasperNoSuchNetldi' }),
        gsUser,
        gsPassword,
        0,
        0,
      );

      expect(session).toBeNull();
      expect(err.number).toBe(ERR_IN_LOGIN);
    });

    it('GciTsNbLogin reports a wrong password when polled', (ctx) => {
      requireGciCapability('GciTsNbLogin', ctx, gci);

      const { session } = gci.GciTsNbLogin(
        stoneNrs,
        null,
        null,
        false,
        gemNrs,
        gsUser,
        'wrongPassword',
        0,
        0,
      );

      // No logout afterward, matching production (sessionManager's
      // non-blocking login throws on -1 without logging out).
      expect(session).not.toBeNull();
      const { result, err } = pollNbLoginFinished(session);
      expect(result).toBe(-1);
      expect(err.number).toBe(GS_ERR_LOGIN_DENIAL);
    });
  });

  describe('GciTsEncrypt', () => {
    it('encrypts a password to a non-empty string that differs from it', () => {
      const encrypted = gci.GciTsEncrypt(gsPassword);

      expect(encrypted).not.toBeNull();
      expect(encrypted!.length).toBeGreaterThan(0);
      expect(encrypted).not.toBe(gsPassword);
    });

    it('returns null for an empty string', () => {
      expect(gci.GciTsEncrypt('')).toBeNull();
    });

    it('produces consistent output for the same input', () => {
      expect(gci.GciTsEncrypt(gsPassword)).toBe(gci.GciTsEncrypt(gsPassword));
    });
  });
});
