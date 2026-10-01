import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { OOP_ILLEGAL, OOP_NIL } from '../../gciConstants';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { createSessionGciLibrary } from '../../enhancedInspector/enhancedInspectorPerfTracker';
import { NativeSocketLibrary } from '../../sockets/nativeSocketLibrary';

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
  let nativeSocketLibrary: NativeSocketLibrary;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    session = testContext.session;
    nativeSocketLibrary = testContext.nativeSocketLibrary;
  });

  describe('the library a session is given', () => {
    // Every property name a caller can reach on a GciLibrary: its own (the
    // koffi bindings and fields) and its prototype chain's (the methods).
    function reachableNames(gciLibrary: GciLibrary): string[] {
      const names = new Set<string>();
      for (
        let o: object | null = gciLibrary;
        o !== null && o !== Object.prototype;
        o = Object.getPrototypeOf(o)
      ) {
        for (const name of Object.getOwnPropertyNames(o)) {
          if (name !== 'constructor') names.add(name);
        }
      }
      return [...names];
    }

    // What a function carries beyond being callable. `name` and `length` are
    // left out: a wrapper may legitimately rename a function or take `...args`.
    function carriedProperties(fn: object): Map<PropertyKey, string> {
      return new Map(
        Reflect.ownKeys(fn)
          .filter((key) => key !== 'name' && key !== 'length' && key !== 'prototype')
          .map((key) => [key, typeof (fn as Record<PropertyKey, unknown>)[key]]),
      );
    }

    // Wrapping must not change what a caller gets back. Checked generally,
    // not for one known property: a wrapper that bound every function once
    // stripped koffi's `.async` off each binding, and nothing failed except
    // the Transcript (#646). Whatever the next wrapper drops, this names it.
    // Shape, not identity: two libraries hold two sets of koffi bindings.
    it('hands back everything a bare GciLibrary carries', () => {
      const libraryPath = process.env.VITE_GEMSTONE_GCI_LIBRARY_PATH!;
      // eslint-disable-next-line no-restricted-syntax -- the unwrapped baseline is the point of the test; it never logs in, and login is banned separately
      const bare = new GciLibrary(libraryPath, nativeSocketLibrary);
      const wrapped = createSessionGciLibrary(libraryPath, nativeSocketLibrary);
      try {
        const names = reachableNames(bare);
        // Guards the guard: an empty list would make this pass vacuously.
        expect(names.length).toBeGreaterThan(150);

        const lost: string[] = [];
        for (const name of names) {
          const want = (bare as unknown as Record<string, unknown>)[name];
          const got = (wrapped as unknown as Record<string, unknown>)[name];
          if (typeof got !== typeof want) {
            lost.push(`${name}: ${typeof want} became ${typeof got}`);
            continue;
          }
          if (typeof want !== 'function') continue;
          const gotCarried = carriedProperties(got as object);
          for (const [key, type] of carriedProperties(want)) {
            if (gotCarried.get(key) !== type) lost.push(`${name}.${String(key)}`);
          }
        }
        expect(lost).toEqual([]);
      } finally {
        wrapped.close();
        bare.close();
      }
    });
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
    // The same rejected call as the synchronous test above: the worker thread
    // must surface the library's own error rather than a JavaScript one, so
    // both assertions below are the sync test's assertions.
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
      await expectRejectedGsProcess();
    });

    // The harness builds `gci` with createSessionGciLibrary, so this IS the
    // wrapped object SessionManager hands a session -- not a bare library and
    // not a hand-rewrapped one. Any future wrapping added to that factory is
    // covered here automatically.
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

    it('throws, rather than blocking the extension host, when koffi exposes no .async', async () => {
      // A blocking route would keep output arriving, so nothing would fail,
      // while the window froze and Cancel went undeliverable.
      // A plain JS function has no `async` property, so substituting one for
      // the binding reproduces a lost `.async` without needing the real cause.
      const bindings = gci as unknown as Record<string, unknown>;
      const realBinding = bindings._GciTsContinueWith as (...args: unknown[]) => unknown;
      const syncOnlyBinding = (...args: unknown[]) => realBinding(...args);
      expect('async' in syncOnlyBinding).toBe(false);

      bindings._GciTsContinueWith = syncOnlyBinding;
      try {
        await expect(async () =>
          gci.GciTsContinueWithAsync(session, OOP_NIL, OOP_ILLEGAL, null, 0),
        ).rejects.toThrow(TypeError);
      } finally {
        bindings._GciTsContinueWith = realBinding;
      }
    });
  });
});
