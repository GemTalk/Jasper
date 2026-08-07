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
// Logs in as `VITE_GEMSTONE_USER` (from .env.test), elevates to a transient
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
import dotenv from 'dotenv';
import { resolveTestConnection } from '../src/__tests__/testConnection';
import { testActiveSession } from '../src/__tests__/testActiveSession';
import { GciLibrary } from '../src/gciLibrary';
import { uninstallServerPlugin } from '../src/serverPlugin/uninstallServerPlugin';
import { loginAsSystemUser, DEFAULT_SYSTEMUSER_PW } from '../src/serverPlugin/installHelpers';

const repoRoot = path.resolve(__dirname, '..', '..');

// Loads `client/.env.test` into process.env (vite/vitest do this automatically;
// a plain Node script has to do it itself). Missing file is fine —
// `resolveTestConnection` (called below) reports it with actionable guidance.
// Real environment variables win (dotenv's default: it never overwrites an
// already-set process.env value).
function loadEnvTestFile() {
  // quiet: suppress dotenv's stdout banner (injected-env tip) — noise in CI logs.
  dotenv.config({ path: path.join(repoRoot, 'client', '.env.test'), quiet: true });
}

async function main() {
  loadEnvTestFile();
  // GCI finds a local stone through GEMSTONE_GLOBAL_DIR (its locks/registry);
  // copy the VITE_-prefixed variant over, same as gciTestConfig.ts.
  if (process.env.VITE_GEMSTONE_GLOBAL_DIR) {
    process.env.GEMSTONE_GLOBAL_DIR = process.env.VITE_GEMSTONE_GLOBAL_DIR;
  }

  const connection = resolveTestConnection();

  const gci = new GciLibrary(connection.gciLibraryPath);
  let baseHandle;
  let sysHandle;
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

    const sys = loginAsSystemUser(base, DEFAULT_SYSTEMUSER_PW);
    sysHandle = sys.handle;

    console.log(`Uninstalling server plugin (stone version ${base.stoneVersion})…`);

    // Removes every feature currently present and verifies none remains, throwing
    // on a failed removal or a feature still detected afterwards. The shared
    // registry (client/src/serverPlugin/pluginFeatures.ts) is the single source
    // of truth for the feature list, so this script stays feature-agnostic.
    // Idempotent: a stone with nothing installed is a no-op, not an error.
    await uninstallServerPlugin(sys, (m) => console.log(m));

    console.log('Server plugin uninstalled and verified.');
  } finally {
    if (sysHandle) gci.logout(sysHandle);
    if (baseHandle) gci.logout(baseHandle);
    gci.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
