// The real body of the CI provisioning script — split out from
// `install-server-plugin.mjs` so that file can install the `vscode` stub via
// `Module._load` *before* any static import runs. See that file's header for
// why the split exists.
//
// Provisions a test stone with the Jasper Server Plugin (Refactoring +
// Enhanced Inspector, version-gated) so CI can run the feature-test suite
// a second time in the "present" world, not just the bare-stone "absent"
// world. Run after `npm run test:server:start` (which writes
// `client/.env.test`).
//
// Logs in as `VITE_GEMSTONE_USER` (see loadTestEnv), elevates to a transient
// SystemUser session on the same connection — install requires write access to
// kernel classes — and delegates to `installServerPlugin`, which files in every
// plugin feature applicable to this stone's version and then re-verifies the
// version→feature contract. Version-gated features (Enhanced Inspector) are
// skipped below their minimum, exactly like the client's own auto-install path.
//
// The contract check is the regression guard the two-pass CI workflow relies
// on: `installServerPlugin` throws on any mismatch between a feature's live
// presence and whether its version supports it, so this script exits non-zero
// rather than letting a silently-broken install surface downstream as an
// indistinguishable "feature not installed" skip in the second test pass.

import path from 'node:path';
import { loadTestEnv } from '../src/__tests__/loadTestEnv';
import { resolveTestConnection } from '../src/__tests__/testConnection';
import { testActiveSession } from '../src/__tests__/testActiveSession';
import { GciLibrary } from '../src/gciLibrary';
import type { ActiveSession } from '../src/activeSession';
import { uninstallServerPlugin } from '../src/serverPlugin/uninstallServerPlugin';
import { loginAsSystemUser, DEFAULT_SYSTEMUSER_PW } from '../src/serverPlugin/installHelpers';

const repoRoot = path.resolve(__dirname, '..', '..');

async function main() {
  loadTestEnv(path.join(repoRoot, 'client'));

  const connection = resolveTestConnection();

  const gci = new GciLibrary(connection.gciLibraryPath);
  let baseHandle;
  let sys: ActiveSession | undefined;
  try {
    baseHandle = gci.login(
      connection.stoneNrs,
      connection.gemNrs,
      connection.gsUser,
      connection.gsPassword,
    );

    // testActiveSession rebuilds a real login (host/stone/netldi/user/password)
    // from the same resolved connection, and caches the client library's own
    // version (GciTsVersion()) per GciLibrary instance — see its header.
    const base = testActiveSession(gci, baseHandle);

    sys = loginAsSystemUser(base, DEFAULT_SYSTEMUSER_PW);

    console.log(`Uninstalling server plugin (stone version ${base.stoneVersion})…`);

    // Removes every feature currently present and verifies none remains, throwing
    // on a failed removal or a feature still detected afterwards. The shared
    // registry (client/src/serverPlugin/pluginFeatures.ts) is the single source
    // of truth for the feature list, so this script stays feature-agnostic.
    // Idempotent: a stone with nothing installed is a no-op, not an error.
    await uninstallServerPlugin(sys, (m) => console.log(m));

    console.log('Server plugin uninstalled and verified.');
  } finally {
    sys?.logout();
    if (baseHandle) gci.logout(baseHandle);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
