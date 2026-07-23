// Shared harness for GCI smoke tests of the shared query layer.
//
// What this gives us that the unit-test suite cannot: a QueryExecutor
// backed by a real GemStone session, so the Smalltalk we synthesize in
// `client/src/queries/*.ts` actually executes against a stone. Catches
// missing selectors (`asUtf8` vs `encodeAsUTF8`), GS-version-specific
// behavior (`Utf8` invariance), and primitive misbehavior that no amount
// of "expect(code).toContain(...)" can spot.
//
// Why it's gated behind its own vitest project ('gci', in vitest.config.ts):
// the suite needs a live stone, GCI library on disk, and credentials.
// `npm test` runs only the 'default' project (which excludes `__tests__/gci/**`);
// run this suite via `npm run test:gci` when a session is reachable.

import { GciLibrary } from '../../gciLibrary';
import { QueryExecutor } from '../../queries/types';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';

export { STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD };

const OOP_NIL = 0x14n;
const OOP_ILLEGAL = 0x01n;
// Match McpSession's fetch budget so smoke tests exercise the same envelope
// real MCP tool calls hit. 256KB is enough for any single query in this
// codebase plus headroom for the largest stack reports.
const MAX_RESULT = 256 * 1024;

export interface HarnessSession {
  gci: GciLibrary;
  handle: unknown;
  exec: QueryExecutor;
  /** Tear down at the end of a test file. Idempotent. */
  logout: () => void;
}

// Open a session and bind a QueryExecutor that goes through
// GciTsExecuteFetchBytes with `Utf8` as the result class — the same envelope
// McpSession uses in production. Tests that want a different envelope can
// build their own executor.
export function login(): HarnessSession {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  const result = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
  if (!result.session) {
    throw new Error(
      `GciTsLogin failed: ${result.err.message || `error ${result.err.number}`}. ` +
        'Verify the stone, NetLDI, and credentials in the harness env vars.',
    );
  }
  const handle = result.session;
  const utf8Class = gci.GciTsResolveSymbol(handle, 'Utf8', OOP_NIL);
  if (utf8Class.err.number !== 0) {
    gci.GciTsLogout(handle);
    throw new Error(`Could not resolve Utf8 class: ${utf8Class.err.message}`);
  }
  const utf8Oop = utf8Class.result;

  const exec: QueryExecutor = (code) => {
    const { data, err } = gci.GciTsExecuteFetchBytes(
      handle,
      code,
      -1,
      utf8Oop,
      OOP_ILLEGAL,
      OOP_NIL,
      MAX_RESULT,
    );
    if (err.number !== 0) {
      throw new Error(`${err.message || `GCI error ${err.number}`} | source: ${code}`);
    }
    return String(data);
  };

  let loggedOut = false;
  return {
    gci,
    handle,
    exec,
    logout: () => {
      if (loggedOut) return;
      loggedOut = true;
      try {
        gci.GciTsLogout(handle);
      } catch {
        /* already gone */
      }
    },
  };
}

// Verify a GemStone selector exists on the given class (or class-side method
// dictionary if `meta` is true). Used by the selector-probe test as a
// regression guard for the `asUtf8` / `encodeAsUTF8` family of typos.
export function selectorExists(
  exec: QueryExecutor,
  className: string,
  selector: string,
  meta = false,
): boolean {
  const receiver = meta ? `${className} class` : className;
  const code = `(${receiver} canUnderstand: #'${selector.replace(/'/g, "''")}') printString`;
  return exec(code).trim() === 'true';
}
