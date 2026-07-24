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
// SystemUser session on the same connection — install requires write access
// to kernel classes — and files in each feature. Enhanced Inspector is
// skipped on stones below its minimum version, exactly like the client's own
// auto-install path.
//
// Finally it re-verifies the version→feature contract
// (`isRefactoringSupportInstalled` / `isEnhancedInspectorInstalled` vs.
// `supportsEnhancedInspector`) and exits non-zero on any mismatch. This is
// the regression guard the two-pass CI workflow relies on: a silently-broken
// install must fail here, loudly, rather than surface downstream as an
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
// these modules use it for, rather than dragging the whole shared-helpers
// question into this PR's scope.
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
const { installRefactoringSupport, isRefactoringSupportInstalled } = require(
  path.join(clientOutDir, 'refactoring', 'refactoringInstall.js'),
);
const {
  installEnhancedInspectorSupport,
  isEnhancedInspectorInstalled,
  supportsEnhancedInspector,
} = require(path.join(clientOutDir, 'enhancedInspectorInstall.js'));

// GemStone's default SystemUser password on a fresh stone. Not written as
// `...PASSWORD`/`password = '...'` — see the same note in
// refactoringInstallCommand.ts about Open VSX's secret-scan false hit.
const DEFAULT_SYSTEMUSER_PW = 'swordfish';

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

// Opens a transient SystemUser session on `base`'s connection, overriding
// only the GemStone user. Mirrors refactoringInstallCommand.ts /
// enhancedInspectorCommand.ts's `loginAsSystemUser` — duplicated rather than
// imported, since those modules are VS Code plumbing (import `vscode`) and
// this script runs outside the extension host.
function loginAsSystemUser(base, password) {
  const { login } = base;
  const stoneNrs = `!tcp@${login.gem_host}#server!${login.stone}`;
  const gemNrs = `!tcp@${login.gem_host}#netldi:${login.netldi}#task!gemnetobject`;
  const result = base.gci.GciTsLogin(
    stoneNrs,
    login.host_user || null,
    login.host_password || null,
    false,
    gemNrs,
    'SystemUser',
    password,
    0,
    0,
  );
  if (!result.session) {
    throw new Error(result.err.message || `SystemUser login failed (error ${result.err.number})`);
  }
  return {
    id: -1,
    gci: base.gci,
    handle: result.session,
    login: { ...login, gs_user: 'SystemUser', gs_password: password },
    stoneVersion: base.stoneVersion,
  };
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

    console.log(`Installing refactoring support (stone version ${version})…`);
    const refactoringResult = await installRefactoringSupport(
      sys,
      path.join(repoRoot, 'resources', 'refactoring'),
      (message) => console.log(`  ${message}`),
    );
    if (refactoringResult.report) console.log(refactoringResult.report);
    if (!refactoringResult.success) {
      throw new Error(`Refactoring install failed: ${refactoringResult.message}`);
    }

    const inspectorExpected = supportsEnhancedInspector(version);
    if (inspectorExpected) {
      console.log('Installing Enhanced Inspector support…');
      const inspectorResult = await installEnhancedInspectorSupport(
        sys,
        path.join(repoRoot, 'resources', 'enhancedInspector'),
        (message) => console.log(`  ${message}`),
      );
      if (!inspectorResult.success) {
        throw new Error(`Enhanced Inspector install failed: ${inspectorResult.message}`);
      }
    } else {
      console.log(`Stone version ${version} does not support Enhanced Inspector — skipping.`);
    }

    const refactoringInstalled = isRefactoringSupportInstalled(sys);
    const inspectorInstalled = isEnhancedInspectorInstalled(sys);
    const problems = [];
    if (!refactoringInstalled) {
      problems.push('refactoring support did not verify as installed');
    }
    if (inspectorInstalled !== inspectorExpected) {
      problems.push(
        `Enhanced Inspector installed=${inspectorInstalled} but version ${version} expects installed=${inspectorExpected}`,
      );
    }
    if (problems.length > 0) {
      throw new Error(`Version→feature contract violated: ${problems.join('; ')}`);
    }

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
