// Checks that the test stone's server plugin (the refactoring engine, and the
// Enhanced Inspector where the release supports it) is the one in this
// checkout, so integration tests never exercise a plugin filed in from another
// branch or an older install. See `src/__tests__/serverPluginMatch.globalSetup.ts`.
//
// A feature with no receipt (installed before Jasper recorded one, or by hand)
// gets the plugin reinstalled from this checkout, which records one. A
// DIFFERENT feature is left alone and stops the run: it may be someone's work in
// progress.
//
// Exit codes, which the global setup relies on:
//   0  every installed feature matches (perhaps after that install), or none is
//      installed (the bare-stone pass)
//   1  a feature is different, the install failed, or the stone couldn't be read
//   2  the stone couldn't be reached; the integration tests report that themselves

import path from 'node:path';
import dotenv from 'dotenv';
import { resolveTestConnection } from '../src/__tests__/testConnection';
import { testActiveSession } from '../src/__tests__/testActiveSession';
import { GciLibrary } from '../src/gciLibrary';
import { PLUGIN_FEATURES } from '../src/serverPlugin/pluginFeatures';
import { PluginStatus, pluginStatus } from '../src/serverPlugin/pluginFingerprint';
import { installServerPlugin } from '../src/serverPlugin/installServerPlugin';
import { DEFAULT_SYSTEMUSER_PW, loginAsSystemUser } from '../src/serverPlugin/installHelpers';
import type { ActiveSession } from '../src/activeSession';

const repoRoot = path.resolve(__dirname, '..', '..');
const FIX = "Run `npm run test:server:install-plugin` to install this checkout's plugin.";

// The same files, in the same precedence, as vitest reads, so this checks the
// stone the tests will use: with `override: false` the first file to set a key
// wins. Every option is pinned because dotenv also reads its options from
// DOTENV_* variables in the environment, which would otherwise change how these
// files load; installServerPluginMain.ts has the full explanation.
for (const file of ['.env.test.local', '.env.test', '.env.local', '.env']) {
  dotenv.config({
    path: path.join(repoRoot, 'client', file),
    encoding: 'utf8',
    override: false,
    fast: false,
    debug: false,
    quiet: true,
  });
}
if (process.env.VITE_GEMSTONE_GLOBAL_DIR) {
  process.env.GEMSTONE_GLOBAL_DIR = process.env.VITE_GEMSTONE_GLOBAL_DIR;
}

interface Checked {
  label: string;
  status: PluginStatus;
}

/** Every installed feature's status; features not installed are left out. */
function statuses(session: ActiveSession): Checked[] {
  return PLUGIN_FEATURES.filter(
    (f) => f.isApplicable(session.stoneVersion) && f.probe(session),
  ).map((f) => ({
    label: f.label,
    status: pluginStatus(session, true, path.join(repoRoot, f.payloadSubdir), f.receipt),
  }));
}

async function check(): Promise<number> {
  let gci: GciLibrary;
  let handle;
  try {
    const connection = resolveTestConnection();
    gci = new GciLibrary(connection.gciLibraryPath);
    handle = gci.login(
      connection.stoneNrs,
      connection.gemNrs,
      connection.gsUser,
      connection.gsPassword,
    );
  } catch (e) {
    console.error(`Server plugin not checked: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  try {
    const session = testActiveSession(gci, handle);
    let checked = statuses(session);
    if (checked.length === 0) {
      console.log('No server plugin in the test stone; nothing to compare.');
      return 0;
    }
    const noReceipt = checked.filter(
      (c) => c.status.state === 'unknown' && c.status.unknownReason === 'noReceipt',
    );
    if (noReceipt.length > 0 && !checked.some((c) => c.status.state === 'different')) {
      console.log(
        `No record of which ${noReceipt.map((c) => c.label).join(' and ')} the test stone ` +
          "has; installing this checkout's plugin…",
      );
      const installed = await installPlugin(session);
      if (installed !== true) {
        console.error(`Could not install it: ${installed}. ${FIX}`);
        return 1;
      }
      // The install committed in another session; abort to see it.
      session.GciTsAbort();
      checked = statuses(session);
    }
    const problems = checked.filter((c) => c.status.state !== 'current');
    if (problems.length === 0) {
      console.log("The test stone's server plugin is this checkout's.");
      return 0;
    }
    for (const { label, status } of problems) {
      console.error(
        status.state === 'different'
          ? `The test stone's ${label} isn't this checkout's (installed by Jasper ` +
              `${status.installedBy ?? 'unrecorded'}).`
          : `Could not check the test stone's ${label}: ` +
              `${status.detail ?? 'no record of which version it is'}.`,
      );
    }
    console.error(FIX);
    return 1;
  } finally {
    gci.logout(handle);
  }
}

/** Installs every applicable feature over a SystemUser session; answers true, or why not. */
async function installPlugin(base: ActiveSession): Promise<true | string> {
  let sys: ActiveSession | undefined;
  try {
    sys = loginAsSystemUser(base, DEFAULT_SYSTEMUSER_PW);
    await installServerPlugin(sys, repoRoot);
    return true;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    sys?.logout();
  }
}

void check().then((code) => {
  process.exitCode = code;
});
