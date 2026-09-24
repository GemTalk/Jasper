import { describe, it, expect, beforeAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { useIntegrationTest, type GciTestContext } from '../../__tests__/useIntegrationTest';
import { requireGciCapability } from './requireGciCapability';

describe('GCI session utilities (integration)', () => {
  let gci: GciLibrary;
  let session: unknown;
  let login: GciTestContext['login'];
  let logout: GciTestContext['logout'];
  let withTransientSession: GciTestContext['withTransientSession'];

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    session = testContext.session;
    login = testContext.login;
    logout = testContext.logout;
    withTransientSession = testContext.withTransientSession;
  });

  // GciTsKeyfilePermissions requires SystemUser. Runs after the harness's own
  // beforeAll, so this swaps its default login for a SystemUser one that the
  // harness then keeps managing. Only the shared session: withTransientSession
  // still logs in as the default user.
  beforeAll(() => {
    logout();
    login({ user: 'SystemUser' });
  });

  // GciTsWaitForEvent and GciTsCancelWaitForEvent block the calling thread
  // and are designed for multi-threaded use. They cannot be tested in a
  // synchronous koffi FFI context. The bindings are verified to load correctly.

  describe('GciTsDirtyExportedObjs', () => {
    it('returns no dirty objects when none have been modified', (ctx) => {
      requireGciCapability('GciTsDirtyExportedObjs', ctx, gci);

      // Once DirtyObjsInit has run, every commit or abort on that session raises
      // RT_ERR_COMMIT_ABORT_PENDING (gcits.hf), which breaks the abort the harness
      // ends each test with. A transient session is only ever logged out, but that
      // logout's implicit abort hits the same error: expect a `GciTsLogout failed
      // [2231]` warning and a gci<pid>trace.log dump (swept by
      // gciTraceLogs.globalSetup.ts).
      withTransientSession((transientSession) => {
        const { err: initErr } = gci.GciTsDirtyObjsInit(transientSession);
        expect(initErr.number).toBe(0);

        const { oops, err } = gci.GciTsDirtyExportedObjs(transientSession, 100);
        expect(err.number).toBe(0);
        expect(oops.length).toBe(0);
      });
    });
  });

  describe('GciTsKeepAliveCount', () => {
    it('returns a non-negative count', (ctx) => {
      requireGciCapability('GciTsKeepAliveCount', ctx, gci);

      const { result, err } = gci.GciTsKeepAliveCount(session);
      expect(err.number).toBe(0);
      expect(result).toBeGreaterThanOrEqual(0n);
    });
  });

  describe('GciTsKeyfilePermissions', () => {
    it('returns a permissions bitmask when logged in as SystemUser', (ctx) => {
      requireGciCapability('GciTsKeyfilePermissions', ctx, gci);

      const { result, err } = gci.GciTsKeyfilePermissions(session);
      expect(err.number).toBe(0);
      expect(result).toBeGreaterThanOrEqual(0n);
    });
  });
});
