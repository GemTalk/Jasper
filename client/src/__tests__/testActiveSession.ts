// Builds a real `ActiveSession` for test code that already has a live GCI
// login (a `GciLibrary` instance and its session handle): the integration
// tests and the server-plugin scripts in `client/bin/`.
//
// `ActiveSession` comes from `activeSession.ts`, never `sessionManager.ts`:
// the latter is a `vscode`-dependent module, and `tsx` loads this module
// straight from `client/src` (see `install-server-plugin.mjs`) for a plain
// Node script whose `vscode` stub only covers `require('vscode')` itself.

import { ActiveSession } from '../activeSession';
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
 * fields — callers that need a different shape (the unit tests with mock
 * `gci` objects and no live env) build a fake session around their mock.
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

  // 0, because neither SessionManager (counting up from 1) nor a transient
  // login (counting down from -1) hands it out: a transient login a test opens
  // can't share an id, and with it per-session state, with the harness session.
  // Every wrap of one handle gets the same id, so state keyed by id holds
  // across the fresh session objects these tests build.
  return new ActiveSession(0, gci, handle, login, stoneVersionOf(gci));
}
