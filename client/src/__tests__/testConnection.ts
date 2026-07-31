// Resolves the connection details the on-demand GCI test suite
// (`gci/gciTestConfig.ts`), the refactoring integration tests (via
// `testActiveSession.ts`), and `client/bin/installServerPluginMain.ts` all
// need to reach a live stone.
//
// Deliberately imports only `../loginTypes` (verify with a grep on this file
// if you touch it) — nothing here may pull in `vscode`, a test runner, or
// `sessionManager`. `tsx` loads this module straight from `client/src` (see
// `install-server-plugin.mjs`), and that launcher's `vscode` stub only covers
// `require('vscode')` itself — a stray import here would break that script
// at load time, not just at test time.
//
// Exports a function, not module-load-time constants: a constant computed (and
// validated) at the top of this module would throw the moment anything
// `require()`s it — including a caller that isn't ready to handle a missing/
// incomplete test env yet. `resolveTestConnection` only resolves and validates
// when a caller actually invokes it.
//
// Resolution order respects the `.env.test.local` per-key-override hazard
// (see CONTRIBUTING.md for the practical rule): the composed NRS is the
// most-authoritative source, since an override lands there, so a value it
// carries is parsed out first (via `netldiNameFromGemNrs`);
// only when the NRS doesn't carry that value at all do we fall back to an
// explicit atomic `VITE_GEMSTONE_*` var, then a plain `GS_*`/shell var.
// Disagreement between sources is never an error here — an intentional
// `.env.test.local` override IS a disagreement, not a bug — so this never
// throws over *conflicting* values, only over a value that is missing from
// every source.
//
// This ordering isn't a hypothetical precaution. Before this module existed,
// `gciTestConfig.ts` resolved `NETLDI_NAME` atomic-var-first — it checked
// `VITE_GEMSTONE_NETLDI_NAME` / `GS_NETLDI_NAME` before parsing `GEM_NRS` —
// so a stale or hand-set atomic var silently won over a correct, freshly
// generated NRS, with no error. Parsing the NRS first is what closes that
// hole; it isn't an arbitrary stylistic choice, and reordering it back would
// reopen the same bug.
//
// The seemingly simpler alternative — have `gs-create-test-env-file.sh` also
// emit atomic `host`/`stone` vars, and have every consumer read those
// directly instead of parsing the NRS — was considered and rejected for the
// same reason: it would reintroduce this exact silent-disagreement hazard for
// every value it atomizes, not just NetLDI name. Don't "simplify" this module
// toward that shape.
//
// The `env` parameter (defaulting to `process.env`, overridable for tests)
// exists so `acceptance/helpers/testStone.ts` could share this logic in the
// future. It doesn't today: Playwright doesn't load `.env` files the way Vite
// does for vitest, so `testStone.ts` reads and parses `client/.env.test`
// itself. That's a deliberately separate concern from resolving already-loaded
// `process.env` values, so `testStone.ts` needs no changes here.

import { parseStoneNrs, netldiNameFromGemNrs, GemStoneLogin } from '../loginTypes';

/** Connection details resolved from the environment, ready for a GCI login. */
export interface TestConnection {
  gciLibraryPath: string;
  stoneNrs: string;
  gemNrs: string;
  gsUser: string;
  gsPassword: string;
  /** NetLDI name on its own — the netldi-name login variants need it apart
   *  from the composed Gem NRS. See `netldiNameFromGemNrs`. */
  netldiName: string;
  /** GemStone version. No NRS carries this at all (see
   *  `gs-create-test-env-file.sh` / `acceptance/helpers/testStone.ts`), so it
   *  can only come from the atomic `VITE_GEMSTONE_VERSION`, or — for a stale
   *  `.env.test` that predates it — be parsed out of the GCI library filename.
   *  Left undefined (not required) when neither source has it. */
  version?: string;
}

function firstDefined(...values: (string | undefined)[]): string | undefined {
  return values.find((v) => v !== undefined && v !== '');
}

function requireValue(label: string, value: string | undefined): string {
  if (value === undefined) {
    throw new Error(
      `${label} is not set. Run \`npm run test:server:start\` to provision a test ` +
        'stone (it writes client/.env.test), or set the connection variables in ' +
        'your environment. See CONTRIBUTING.md.',
    );
  }
  return value;
}

// This throws rather than returning `undefined` like `parseStoneNrs` itself,
// because its caller (`testActiveSession`, for the SystemUser elevation in
// `installServerPluginMain.ts`) rebuilds a real `GemStoneLogin` from the
// result: a silent fallback to a bogus host/stone there risks a SystemUser
// login that either fails with a confusing GCI error or, worse, silently
// succeeds against the wrong stone (e.g. a coincidental default at
// `localhost`). That risk is specific to *reconstructing a login* — a caller
// that only ever passes `stoneNrs` through to GCI opaquely (as
// `resolveTestConnection`'s other 17 callers do) has nothing to protect, so
// the requirement lives here, in the one function that needs parsed
// `gem_host`/`stone`, not in `resolveTestConnection`. Legal-but-unrecognized
// shapes (a bare `gs64stone`, `#netldi:`/`#auth:` forms) are fine for that
// opaque use; this only rejects a shape none of them are.
export function requireParsedStoneNrs(stoneNrs: string): Pick<GemStoneLogin, 'gem_host' | 'stone'> {
  const parsed = parseStoneNrs(stoneNrs);
  if (parsed === undefined) {
    throw new Error(
      `Could not parse gem_host/stone from Stone NRS: ${stoneNrs}. Expected the ` +
        '`!tcp@<host>#server!<stone>` shape.',
    );
  }
  return parsed;
}

/**
 * Resolve the connection details needed to log in to a test stone, from
 * `env` (defaulting to `process.env`). Throws an actionable error if a
 * required value (everything except `version`, which is best-effort) is
 * missing from every source — but only when called, never as a side effect
 * of importing this module.
 */
export function resolveTestConnection(env: NodeJS.ProcessEnv = process.env): TestConnection {
  const gciLibraryPath = firstDefined(env.VITE_GEMSTONE_GCI_LIBRARY_PATH, env.GCI_LIBRARY_PATH);
  const stoneNrs = firstDefined(env.VITE_GEMSTONE_STONE_NRS, env.GS_STONE_NRS);
  const gemNrs = firstDefined(env.VITE_GEMSTONE_GEM_NRS, env.GS_GEM_NRS);
  const gsUser = firstDefined(env.VITE_GEMSTONE_USER, env.GS_USER);
  const gsPassword = firstDefined(env.VITE_GEMSTONE_PASSWORD, env.GS_PASSWORD);

  const netldiName = firstDefined(
    gemNrs ? netldiNameFromGemNrs(gemNrs) : undefined,
    env.VITE_GEMSTONE_NETLDI_NAME,
    env.GS_NETLDI_NAME,
  );

  const version = firstDefined(
    env.VITE_GEMSTONE_VERSION,
    gciLibraryPath?.match(/libgcits-([\d.]+)-/)?.[1],
  );

  return {
    gciLibraryPath: requireValue(
      'GCI library path (VITE_GEMSTONE_GCI_LIBRARY_PATH / GCI_LIBRARY_PATH)',
      gciLibraryPath,
    ),
    stoneNrs: requireValue('Stone NRS (VITE_GEMSTONE_STONE_NRS / GS_STONE_NRS)', stoneNrs),
    gemNrs: requireValue('Gem NRS (VITE_GEMSTONE_GEM_NRS / GS_GEM_NRS)', gemNrs),
    gsUser: requireValue('GemStone user (VITE_GEMSTONE_USER / GS_USER)', gsUser),
    gsPassword: requireValue(
      'GemStone password (VITE_GEMSTONE_PASSWORD / GS_PASSWORD)',
      gsPassword,
    ),
    netldiName: requireValue(
      'NetLDI name (VITE_GEMSTONE_NETLDI_NAME / GS_NETLDI_NAME, or a #netldi:<name># segment in the Gem NRS)',
      netldiName,
    ),
    version,
  };
}
