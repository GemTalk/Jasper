import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GCI_OPTIONAL_FUNCTIONS } from '../gciLibrary/optionalFunctions';

/**
 * Fails when production code calls a GCI function that GemStone 3.6.2 doesn't
 * export, unless the symbol is consciously opted into via ALLOWED_POST_362.
 *
 * The gated set is every `addedIn` entry in `gciLibrary/optionalFunctions.ts`.
 * Those bind through `optionalFunc`, so Jasper still *loads* against 3.6.2 —
 * it's the call that throws, and a 3.7.5 dev image never shows you that.
 * Background: `docs/explanation/gci-version-compatibility.md`.
 *
 * A test rather than a lint rule because the gated set is imported from the
 * registry, and `eslint.config.mjs` can't import TypeScript: a selector-based
 * rule would have to restate those names, which is the drift the registry
 * exists to end. Worth revisiting if the config ever moves to TS.
 */

const repoRoot = path.resolve(__dirname, '..', '..', '..');

/**
 * Gated symbol -> the release that first exports it. `absentOn`/`removedIn`-only
 * entries (`GciTsNbLogin`, `GciTsEncrypt`) do ship in 3.6.2 — they're gated on
 * platform or removal, which this test says nothing about.
 */
const GATED_FLOORS = new Map(
  Object.entries(GCI_OPTIONAL_FUNCTIONS).flatMap(([name, reason]) =>
    'addedIn' in reason ? [[name, reason.addedIn] as const] : [],
  ),
);

function gatedFunctions(): string[] {
  return [...GATED_FLOORS.keys()].sort();
}

/**
 * Symbols the codebase consciously depends on despite the 3.6.2 floor. Adding a
 * name here is the "I accept this path needs 3.7+" decision, and it is the
 * reviewable diff that makes it one; keep it empty to stay fully compatible.
 */
const ALLOWED_POST_362: string[] = [
  // codeExecutor.ts polls with it (3.7.0), but behind gci.isAvailable, with a
  // GciTsSocket + native poll fallback (pollNbResultReady / socketPoll.ts).
  // Listed because the symbol is still referenced on the 3.7+ branch.
  'GciTsNbPoll',

  // Why no FetchNamedOops/FetchVaryingOops (3.7.1): debugQueries.ts fetches
  // instVars with absolute GciTsFetchOops instead, deliberately. Switching back
  // to the named/indexed variants would mean allowlisting both.
];

/** Production source roots to scan (tests/mocks and the bindings file excluded). */
const SCAN_ROOTS = ['client/src', 'server/src', 'mcp-server/src'];

function tsFilesUnder(root: string): string[] {
  const abs = path.join(repoRoot, root);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => !/(^|[\\/])__tests__[\\/]/.test(f))
    .filter((f) => !/(^|[\\/])__mocks__[\\/]/.test(f))
    .filter((f) => path.basename(f) !== 'gciLibrary.ts') // the bindings themselves
    .map((f) => path.join(abs, f));
}

/**
 * Map of gated function name -> list of "relativePath:line" call sites. Matched
 * syntactically, on `.<name>(`, so an aliased or dynamically dispatched call
 * slips through — the same blind spot a lint selector would have.
 */
function gatedUsages(gated: string[]): Record<string, string[]> {
  const usages: Record<string, string[]> = {};
  const patterns = gated.map((name) => ({ name, re: new RegExp(`\\.${name}\\s*\\(`) }));
  for (const root of SCAN_ROOTS) {
    for (const file of tsFilesUnder(root)) {
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        for (const { name, re } of patterns) {
          if (re.test(line)) {
            (usages[name] ??= []).push(`${path.relative(repoRoot, file)}:${i + 1}`);
          }
        }
      });
    }
  }
  return usages;
}

describe('GemStone 3.6.2 compatibility gate', () => {
  it('keeps the allowlist a subset of the gated functions (no stale entries)', () => {
    const gated = gatedFunctions();
    const stale = ALLOWED_POST_362.filter((name) => !gated.includes(name));
    expect(stale, `ALLOWED_POST_362 names that are no longer gated: ${stale.join(', ')}`).toEqual(
      [],
    );
  });

  it('does not use any post-3.6.2 GCI function outside the allowlist', () => {
    const gated = gatedFunctions();
    const usages = gatedUsages(gated);
    const offenders = Object.keys(usages).filter((name) => !ALLOWED_POST_362.includes(name));

    const detail = offenders
      .map((name) => `  - ${name} (needs ${GATED_FLOORS.get(name)}+): ${usages[name].join(', ')}`)
      .join('\n');

    expect(
      offenders,
      `Production code uses GCI function(s) that do NOT exist in GemStone 3.6.2:\n${detail}\n\nThese will throw on a 3.6.2 server. If you intend to require GemStone 3.7+ for this path, consciously add the name(s) to ALLOWED_POST_362 in client/src/__tests__/gciVersionGated.test.ts.`,
    ).toEqual([]);
  });
});
