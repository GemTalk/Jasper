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
//
// A thin eager-const layer over `resolveTestConnection()` (see
// ../testConnection.ts for the actual resolution order/logic): calls it once at
// load and re-exports the same named constants this module has always
// exported, so its ~20 importers across the codebase need no changes.

import { resolveTestConnection } from '../testConnection';

// The GCI library finds a local stone through GEMSTONE_GLOBAL_DIR (its locks/
// registry). The automatic tests copy it from VITE_GEMSTONE_GLOBAL_DIR before
// logging in (see ../useIntegrationTest.ts); do the same here so logins reach
// the provisioned test stone instead of whatever the shell points at.
if (process.env.VITE_GEMSTONE_GLOBAL_DIR) {
  process.env.GEMSTONE_GLOBAL_DIR = process.env.VITE_GEMSTONE_GLOBAL_DIR;
}

const connection = resolveTestConnection();

export const GCI_LIBRARY_PATH = connection.gciLibraryPath;
export const STONE_NRS = connection.stoneNrs;
export const GEM_NRS = connection.gemNrs;
export const GS_USER = connection.gsUser;
export const GS_PASSWORD = connection.gsPassword;
export const NETLDI_NAME = connection.netldiName;
