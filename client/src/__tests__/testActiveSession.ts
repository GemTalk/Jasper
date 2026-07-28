// Builds a real `ActiveSession` for test code that already has a live GCI
// login (a `GciLibrary` instance and its session handle) — the refactoring
// integration tests (`client/src/refactoring/__tests__/*.integration.test.ts`)
// and `client/bin/install-server-plugin.mjs`.
//
// `ActiveSession` is imported type-only: tsc elides a type-only import from
// compiled JS output, so this compiles to a module with no `require('../
// sessionManager')` at all (confirm by checking `client/out/__tests__/
// testActiveSession.js` after `npm run compile`). That matters because
// `sessionManager.ts` is a `vscode`-dependent module, and this file's compiled
// output is `require()`d directly by `install-server-plugin.mjs`, a plain Node
// script with no `vscode` available.

import type { ActiveSession } from '../sessionManager';
import type { GciLibrary } from '../gciLibrary';
import { resolveTestConnection, requireParsedStoneNrs } from './testConnection';
import type { GemStoneLogin } from '../loginTypes';

// `stoneVersion` on `ActiveSession` means the connected *client library's* own
// version (`gci.GciTsVersion().version` — see `sessionManager.ts`'s
// `finalizeSession`, around line 276), which is what
// `pluginFeatures.isApplicable` version-gates against. It is a genuine GCI
// round trip, not a free property read, so it's cached per `GciLibrary`
// instance here rather than looked up on every call — the refactoring
// integration tests build a fresh `ActiveSession` on every `exec()`.
const versionCache = new WeakMap<GciLibrary, string>();

function stoneVersionOf(gci: GciLibrary): string {
  let version = versionCache.get(gci);
  if (version === undefined) {
    version = gci.GciTsVersion().version;
    versionCache.set(gci, version);
  }
  return version;
}

/**
 * Build an `ActiveSession` around an already-open `gci`/`handle` pair, with a
 * real `login` (from the test environment, via `resolveTestConnection`) and a
 * cached `stoneVersion`. Deliberately narrow: there is no
 * `testActiveSession(partial)` convenience helper for overriding individual
 * fields — callers that need a different shape (the ~25 unit tests with mock
 * `gci` objects and no live env) should keep building their own fakes.
 */
export function testActiveSession(gci: GciLibrary, handle: unknown): ActiveSession {
  const conn = resolveTestConnection();

  const login: GemStoneLogin = {
    label: '',
    // The GemStone *product* version (e.g. `3.7.5`), not the client library's
    // own version below (`stoneVersion`) — this is what `extension.ts` uses
    // for its `libgcits-<v>-64` lookups. `conn.version` is best-effort (see
    // `TestConnection`), hence the fallback.
    version: conn.version ?? '',
    ...requireParsedStoneNrs(conn.stoneNrs),
    gs_user: conn.gsUser,
    gs_password: conn.gsPassword,
    netldi: conn.netldiName,
    host_user: '',
    host_password: '',
  };

  return {
    // Not a real `SessionManager`-managed id — signals "not managed" to any
    // code path that checks it.
    id: -1,
    gci,
    handle,
    login,
    stoneVersion: stoneVersionOf(gci),
  };
}
