import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { OOP_ILLEGAL, OOP_NIL } from '../../gciConstants';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { wrapWithEnhancedInspectorPerfProxy } from '../../enhancedInspector/enhancedInspectorPerfTracker';

/**
 * Session-lifecycle GCI calls that aren't the login/logout calls themselves:
 * querying whether a session is still alive, the transaction-control
 * primitives, and resuming a suspended process.
 *
 * None of this needs `allowedCommits`: at the default budget of 0 the harness
 * opens no nested transaction levels, so the `afterEach` floor check never
 * runs -- teardown just aborts the single transaction `beforeEach` opened.
 * Do not add a budget here.
 *
 * GciTsLogout frees the session, so calling GciTsSessionIsRemote -- or any
 * GCI function -- on a session that has already been logged out is
 * undefined behavior and is intentionally not exercised here. GciTsNbLogout
 * is skipped for the same reason: the only way to exercise it here is via
 * `withTransientSession`, whose own teardown unconditionally calls
 * GciTsLogout on the session afterward -- a second, undefined-behavior GCI
 * call on a session GciTsNbLogout may have already freed.
 */
describe('GCI session lifecycle (integration)', () => {
  // RT_ERR_NO_PROCESS_TO_CONTINUE in gcierr.ht -- same value in every vendored
  // release from 3.6.2 through 3.7.5. GemStone's message is "The Process nil to
  // continue from is invalid,'argument is not a GsProcess'".
  const RT_ERR_NO_PROCESS_TO_CONTINUE = 2092;

  let gci: GciLibrary;
  let session: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    session = testContext.session;
  });

  describe('GciTsSessionIsRemote', () => {
    it('reports an active session as RPC', () => {
      // The harness always logs in through an RPC gem NRS, never a linked one,
      // so 1 (RPC) is the only value an active session here can answer.
      expect(gci.GciTsSessionIsRemote(session)).toBe(1);
    });
  });

  // GemStone's default transactionMode is #autoBegin, under which an abort
  // re-enters a transaction immediately -- System transactionLevel stays
  // pinned at 1 across both calls (verified live against a 3.6.2 stone:
  // 1 -> abort -> 1 -> begin -> 1). The rollback each performs is the only
  // observable effect that is stable across GemStone releases.
  describe('GciTsAbort / GciTsBegin', () => {
    it('abort discards uncommitted changes', () => {
      const key = gci.storeInUniqueUserGlobalsKey(session, '42');

      const { success } = gci.GciTsAbort(session);

      expect(success).toBe(true);
      expect(gci.isIncludedInUserGlobals(session, key)).toBe(false);
    });

    it('begin discards uncommitted changes', () => {
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

  describe('GciTsContinueWithAsync', () => {
    // The same rejected call as the synchronous test above: whichever path the
    // wrapper takes, it must surface the library's own error rather than a
    // JavaScript one, so both assertions below are the sync test's assertions.
    async function expectRejectedGsProcess() {
      const { result, err } = await gci.GciTsContinueWithAsync(
        session,
        OOP_NIL,
        OOP_ILLEGAL,
        null,
        0,
      );

      expect(result).toBe(OOP_ILLEGAL);
      expect(err.number).toBe(RT_ERR_NO_PROCESS_TO_CONTINUE);
    }

    it('resumes on a worker thread when koffi exposes .async', async () => {
      // Asserted, not assumed: without it this test would pass by silently
      // taking the fallback below, and `.async` going missing is the very
      // failure the fallback exists for -- so a red here is the signal.
      expect(gci.isContinueWithAsyncAvailable()).toBe(true);

      await expectRejectedGsProcess();
    });

    // The harness builds `gci` with createSessionGciLibrary, so this IS the
    // wrapped object SessionManager hands a session -- not a bare library and
    // not a hand-rewrapped one. Any future wrapping added to that factory is
    // covered here automatically, which the hand-wrapped test below cannot do.
    it("keeps koffi's worker-thread variant on every binding production uses", () => {
      const bindings = Object.getOwnPropertyNames(gci).filter(
        (name) => typeof (gci as unknown as Record<string, unknown>)[name] === 'function',
      );

      // Guards the guard: if the bindings ever stop being own properties, an
      // empty list would make every assertion below vacuous.
      expect(bindings.length).toBeGreaterThan(50);
      const withoutAsync = bindings.filter(
        (name) =>
          typeof (
            (gci as unknown as Record<string, { async?: unknown }>)[name].async ?? undefined
          ) !== 'function',
      );
      expect(withoutAsync).toEqual([]);
    });

    it('still exposes .async through the enhanced-inspector perf proxy', async () => {
      // SessionManager hands every caller a proxied GciLibrary, so this -- not
      // the bare library above -- is the object production actually resumes
      // through. The proxy used to bind every function-valued property, and a
      // bound function keeps none of the original's own properties, so koffi's
      // `.async` vanished and every live Transcript write failed (#646). This
      // is the regression test for that; the bare-library test cannot catch it.
      const proxied = wrapWithEnhancedInspectorPerfProxy(gci);

      expect(proxied.isContinueWithAsyncAvailable()).toBe(true);

      const { result, err } = await proxied.GciTsContinueWithAsync(
        session,
        OOP_NIL,
        OOP_ILLEGAL,
        null,
        0,
      );
      expect(result).toBe(OOP_ILLEGAL);
      expect(err.number).toBe(RT_ERR_NO_PROCESS_TO_CONTINUE);
    });

    it('falls back to the blocking call when koffi exposes no .async', async () => {
      // `.async` has been seen missing from the binding at runtime, and the
      // resulting TypeError abandoned the suspended GsProcess -- which left the
      // Transcript mutex held and every later write in the session deadlocked.
      // A plain JS function has no `async` property, so substituting one for
      // the binding reproduces that shape without needing the real cause.
      const bindings = gci as unknown as Record<string, unknown>;
      const realBinding = bindings._GciTsContinueWith as (...args: unknown[]) => unknown;
      const syncOnlyBinding = (...args: unknown[]) => realBinding(...args);
      expect('async' in syncOnlyBinding).toBe(false);

      bindings._GciTsContinueWith = syncOnlyBinding;
      try {
        await expectRejectedGsProcess();
      } finally {
        bindings._GciTsContinueWith = realBinding;
      }
    });
  });
});
