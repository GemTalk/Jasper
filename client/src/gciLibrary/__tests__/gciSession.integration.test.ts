import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { OOP_ILLEGAL, OOP_NIL } from '../../gciConstants';
import { GciTestContext, useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * Session-lifecycle GCI calls that aren't the login/logout calls themselves:
 * querying whether a session is still alive, logging one out non-blockingly,
 * the transaction-control primitives, and resuming a suspended process.
 *
 * None of this needs `allowedCommits`: at the default budget of 0 the harness
 * opens no nested transaction levels, so the `afterEach` floor check never
 * runs -- teardown just aborts the single transaction `beforeEach` opened.
 * Do not add a budget here.
 */
describe('GCI session lifecycle (integration)', () => {
  // RT_ERR_NO_PROCESS_TO_CONTINUE in gcierr.ht -- same value in every vendored
  // release from 3.6.2 through 3.7.5. GemStone's message is "The Process nil to
  // continue from is invalid,'argument is not a GsProcess'".
  const RT_ERR_NO_PROCESS_TO_CONTINUE = 2092;

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

  describe('GciTsSessionIsRemote', () => {
    it('reports an active session as RPC', () => {
      // The harness always logs in through an RPC gem NRS, never a linked one,
      // so 1 (RPC) is the only value an active session here can answer.
      expect(gci.GciTsSessionIsRemote(session)).toBe(1);
    });

    it('reports a logged-out session as invalid', () => {
      const loggedOutSession = logout();

      expect(gci.GciTsSessionIsRemote(loggedOutSession)).toBe(-1);

      login();
    });
  });

  describe('GciTsNbLogout', () => {
    it('logs the session out non-blockingly', () => {
      withTransientSession((transientSession) => {
        const { success } = gci.GciTsNbLogout(transientSession);

        expect(success).toBe(true);
        expect(gci.GciTsSessionIsRemote(transientSession)).toBe(-1);
      });
    });
  });

  // GemStone's default transactionMode is #autoBegin, under which an abort
  // re-enters a transaction immediately -- System transactionLevel stays
  // pinned at 1 across both calls (verified live against a 3.6.2 stone:
  // 1 -> abort -> 1 -> begin -> 1). The rollback each performs is the only
  // observable effect that is stable across GemStone releases.
  describe('GciTsAbort / GciTsBegin', () => {
    it('abort discards uncommitted changes and opens a fresh transaction', () => {
      const key = gci.storeInUniqueUserGlobalsKey(session, '42');

      const { success } = gci.GciTsAbort(session);

      expect(success).toBe(true);
      expect(gci.isIncludedInUserGlobals(session, key)).toBe(false);
    });

    it('begin discards uncommitted changes and opens a fresh transaction', () => {
      const key = gci.storeInUniqueUserGlobalsKey(session, '42');

      const { success } = gci.GciTsBegin(session);

      expect(success).toBe(true);
      expect(gci.isIncludedInUserGlobals(session, key)).toBe(false);
    });
  });

  describe('GciTsContinueWith', () => {
    it('rejects a gsProcess argument that is not a GsProcess', () => {
      // OOP_ILLEGAL as replaceTopOfStack is the documented "leave TopOfStack
      // unchanged" value, so the only thing wrong with this call is gsProcess.
      const { result, err } = gci.GciTsContinueWith(session, OOP_NIL, OOP_ILLEGAL, null, 0);

      expect(result).toBe(OOP_ILLEGAL);
      expect(err.number).toBe(RT_ERR_NO_PROCESS_TO_CONTINUE);
    });
  });
});
