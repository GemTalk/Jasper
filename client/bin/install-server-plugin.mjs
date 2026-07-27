#!/usr/bin/env node
//
// Provisions a test stone with the Jasper Server Plugin (Refactoring +
// Enhanced Inspector, version-gated) so CI can run the feature-test suite
// a second time in the "present" world, not just the bare-stone "absent"
// world. Run after `npm run test:server:start` (which writes
// `client/.env.test`) and after `npm run compile` (this script loads the
// compiled client output under `client/out/`, not the TS source).
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
//
//   node client/bin/install-server-plugin.mjs

import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const clientOutDir = path.join(repoRoot, 'client', 'out');

// The compiled client output is written for the extension host: some modules
// (transitively, gciLog.ts) `require('vscode')` at load time to get an output
// channel for incidental logging we don't care about here. There's no real
// `vscode` module outside the extension host, so stub it in for the one thing
// these modules use it for. (installHelpers.js, which this script also loads,
// is deliberately `vscode`-free — see its header — so it doesn't need this.)
const originalModuleLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      window: {
        createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
      },
    };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

const { GciLibrary } = require(path.join(clientOutDir, 'gciLibrary.js'));
const { installServerPlugin } = require(
  path.join(clientOutDir, 'serverPlugin', 'installServerPlugin.js'),
);
const { loginAsSystemUser, DEFAULT_SYSTEMUSER_PW } = require(
  path.join(clientOutDir, 'serverPlugin', 'installHelpers.js'),
);

// Loads `client/.env.test` into process.env (vite/vitest do this automatically;
// a plain Node script has to do it itself). Missing file is fine — requireEnv
// below reports it with actionable guidance. Real environment variables win
// (dotenv's default: it never overwrites an already-set process.env value).
function loadEnvTestFile() {
  // quiet: suppress dotenv's stdout banner (injected-env tip) — noise in CI logs.
  dotenv.config({ path: path.join(repoRoot, 'client', '.env.test'), quiet: true });
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run \`npm run test:server:start\` first (it writes client/.env.test).`,
    );
  }
  return value;
}

// `VITE_GEMSTONE_STONE_NRS` / `VITE_GEMSTONE_GEM_NRS` encode the connection's
// host/stone/netldi, which the SystemUser elevation below needs to rebuild
// its own NRS strings (mirrors gciTestConfig.ts's NETLDI_NAME parse).
function parseLoginFromNrs(stoneNrs, gemNrs) {
  const stoneMatch = stoneNrs.match(/^!tcp@([^#]+)#server!(.+)$/);
  if (!stoneMatch) {
    throw new Error(`Could not parse gem_host/stone from VITE_GEMSTONE_STONE_NRS: ${stoneNrs}`);
  }
  const netldiMatch = gemNrs.match(/#netldi:([^#]+)#/);
  if (!netldiMatch) {
    throw new Error(`Could not parse netldi name from VITE_GEMSTONE_GEM_NRS: ${gemNrs}`);
  }
  return { gem_host: stoneMatch[1], stone: stoneMatch[2], netldi: netldiMatch[1] };
}

async function main() {
  loadEnvTestFile();
  // GCI finds a local stone through GEMSTONE_GLOBAL_DIR (its locks/registry);
  // copy the VITE_-prefixed variant over, same as gciTestConfig.ts.
  if (process.env.VITE_GEMSTONE_GLOBAL_DIR) {
    process.env.GEMSTONE_GLOBAL_DIR = process.env.VITE_GEMSTONE_GLOBAL_DIR;
  }

  const gciLibraryPath = requireEnv('VITE_GEMSTONE_GCI_LIBRARY_PATH');
  const stoneNrs = requireEnv('VITE_GEMSTONE_STONE_NRS');
  const gemNrs = requireEnv('VITE_GEMSTONE_GEM_NRS');
  const gsUser = requireEnv('VITE_GEMSTONE_USER');
  const gsPassword = requireEnv('VITE_GEMSTONE_PASSWORD');

  const gci = new GciLibrary(gciLibraryPath);
  let baseHandle;
  let sysHandle;
  try {
    baseHandle = gci.login(stoneNrs, gemNrs, gsUser, gsPassword);
    const { version } = gci.GciTsVersion();
    const { gem_host, stone, netldi } = parseLoginFromNrs(stoneNrs, gemNrs);

    const base = {
      id: -1,
      gci,
      handle: baseHandle,
      login: {
        label: '',
        version,
        gem_host,
        stone,
        gs_user: gsUser,
        gs_password: gsPassword,
        netldi,
        host_user: '',
        host_password: '',
      },
      stoneVersion: version,
    };

    const sys = loginAsSystemUser(base, DEFAULT_SYSTEMUSER_PW);
    sysHandle = sys.handle;

    console.log(`Installing server plugin (stone version ${version})…`);

    // Files in every applicable feature and re-verifies the version→feature
    // contract, throwing on a failed install or a contract mismatch. The shared
    // registry (client/src/serverPlugin/pluginFeatures.ts) is the single source
    // of truth for the feature list, so this script stays feature-agnostic.
    await installServerPlugin(sys, repoRoot, (m) => console.log(m));

    console.log('Server plugin installed and verified.');
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
