// Shared connection config for the on-demand GCI test suite.
//
// These tests talk to a live GemStone, exactly like the automatic GCI tests
// (see ../useIntegrationTest.ts), so they read their connection from the same
// place: the VITE_GEMSTONE_* variables that vitest loads out of .env.test,
// which `npm run test:server:start` generates. Once a test stone is
// provisioned, `npm run test:gci` targets it with no extra setup.
//
// Plain GS_* / GCI_LIBRARY_PATH shell variables are honored as a fallback, so a
// custom stone can be targeted without touching .env.test. There are no
// hardcoded Stone or NetLDI names — every value comes from the environment, and
// a missing value fails fast with an actionable message.

import { netldiNameFromGemNrs } from '../../loginTypes';

// The GCI library finds a local stone through GEMSTONE_GLOBAL_DIR (its locks/
// registry). The automatic tests copy it from VITE_GEMSTONE_GLOBAL_DIR before
// logging in (see ../useIntegrationTest.ts); do the same here so logins reach
// the provisioned test stone instead of whatever the shell points at.
if (process.env.VITE_GEMSTONE_GLOBAL_DIR) {
  process.env.GEMSTONE_GLOBAL_DIR = process.env.VITE_GEMSTONE_GLOBAL_DIR;
}

// Resolve a required connection value from the VITE_ (.env.test) source, then a
// plain shell fallback. Throw an actionable error when neither is set, so an
// unprovisioned/incomplete test env fails at load with guidance instead of
// surfacing later as an opaque GCI login failure. Empty strings count as unset.
function requireEnv(label: string, ...candidates: (string | undefined)[]): string {
  const value = candidates.find((c) => c !== undefined && c !== '');
  if (value === undefined) {
    throw new Error(
      `${label} is not set. Run \`npm run test:server:start\` to provision a test ` +
        'stone (it writes client/.env.test), or set the connection variables in ' +
        'your environment. See CONTRIBUTING.md.',
    );
  }
  return value;
}

export const GCI_LIBRARY_PATH = requireEnv(
  'GCI library path (VITE_GEMSTONE_GCI_LIBRARY_PATH / GCI_LIBRARY_PATH)',
  process.env.VITE_GEMSTONE_GCI_LIBRARY_PATH,
  process.env.GCI_LIBRARY_PATH,
);

export const STONE_NRS = requireEnv(
  'Stone NRS (VITE_GEMSTONE_STONE_NRS / GS_STONE_NRS)',
  process.env.VITE_GEMSTONE_STONE_NRS,
  process.env.GS_STONE_NRS,
);

export const GEM_NRS = requireEnv(
  'Gem NRS (VITE_GEMSTONE_GEM_NRS / GS_GEM_NRS)',
  process.env.VITE_GEMSTONE_GEM_NRS,
  process.env.GS_GEM_NRS,
);

export const GS_USER = requireEnv(
  'GemStone user (VITE_GEMSTONE_USER / GS_USER)',
  process.env.VITE_GEMSTONE_USER,
  process.env.GS_USER,
);

export const GS_PASSWORD = requireEnv(
  'GemStone password (VITE_GEMSTONE_PASSWORD / GS_PASSWORD)',
  process.env.VITE_GEMSTONE_PASSWORD,
  process.env.GS_PASSWORD,
);

// The netldi-name login variants (GciTsLogin_, GciTsNbLogin_) need the NetLDI
// name on its own. Prefer an explicit value, else parse it from the Gem NRS
// (e.g. '...#netldi:jasper-test-3.7.5-gs64-ldi#task!gemnetobject'). The parse
// assumes the '#netldi:<name>#' shape; a NRS that omits it (or embeds a raw
// port) won't yield a usable name, so set VITE_GEMSTONE_NETLDI_NAME /
// GS_NETLDI_NAME explicitly for such setups.
export const NETLDI_NAME = requireEnv(
  'NetLDI name (VITE_GEMSTONE_NETLDI_NAME / GS_NETLDI_NAME, or a #netldi:<name># segment in the Gem NRS)',
  process.env.VITE_GEMSTONE_NETLDI_NAME,
  process.env.GS_NETLDI_NAME,
  netldiNameFromGemNrs(GEM_NRS),
);
