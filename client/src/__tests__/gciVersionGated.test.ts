import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Build-time gate for GemStone 3.6.2 compatibility.
 *
 * Some GCI functions were added after 3.6.2 (see the gcits.hf diff of 3.6.2 vs
 * 3.7.5). gciLibrary.ts binds those through `optionalFunc(...)`, which tolerates
 * their absence so Jasper still loads and logs in against 3.6.2 — but calling
 * one on a 3.6.2 server throws "<name> is not available in this GCI library".
 *
 * Against a 3.7.5 dev image those bindings succeed silently, so it's easy to
 * introduce a dependency on a post-3.6.2 function without noticing. This test
 * makes that a CONSCIOUS decision: if production code calls one of the gated
 * functions and it isn't in ALLOWED_POST_362 below, the test fails and tells
 * you to opt in explicitly (which is then a reviewable diff).
 */

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const gciLibrarySource = fs.readFileSync(
  path.join(repoRoot, 'client', 'src', 'gciLibrary.ts'),
  'utf-8',
);

/** Source of truth: every function bound via optionalFunc() is version-gated. */
function gatedFunctions(): string[] {
  const names = new Set<string>();
  const re = /optionalFunc\(\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(gciLibrarySource)) !== null) names.add(m[1]);
  return [...names].sort();
}

/**
 * Functions the codebase is CONSCIOUSLY allowed to use despite being absent in
 * 3.6.2. Keep this empty to stay fully 3.6.2-compatible. To opt in, add the
 * function name here — that line is the explicit "I accept this needs 3.7+"
 * decision, and any path using it will throw on a 3.6.2 server.
 */
const ALLOWED_POST_362: string[] = [
  // codeExecutor.ts polls with GciTsNbPoll, which doesn't exist before 3.7 —
  // but the call is guarded by gci.isAvailable('GciTsNbPoll') with a
  // GciTsSocket + native poll fallback (pollNbResultReady / socketPoll.ts), so
  // code execution works on 3.6.2 too. Allowlisted because the symbol is still
  // referenced (on the 3.7+ branch).
  'GciTsNbPoll',

  // NOTE: the debugger's named/indexed instVar fetch (debugQueries.ts) used to
  // require GciTsFetchNamedOops / GciTsFetchVaryingOops, but now uses absolute
  // GciTsFetchOops (present in 3.6.2), so those are no longer allowlisted.
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

/** Map of gated function name -> list of "relativePath:line" call sites. */
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
  it('derives a non-empty set of version-gated functions from gciLibrary.ts', () => {
    // Guards against the regex silently breaking (which would disable the gate).
    expect(gatedFunctions().length).toBeGreaterThanOrEqual(16);
    expect(gatedFunctions()).toContain('GciTsLogin_');
  });

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
      .map((name) => `  - ${name} (added after 3.6.2): ${usages[name].join(', ')}`)
      .join('\n');

    expect(
      offenders,
      `Production code uses GCI function(s) that do NOT exist in GemStone 3.6.2:\n${detail}\n\nThese will throw on a 3.6.2 server. If you intend to require GemStone 3.7+ for this path, consciously add the name(s) to ALLOWED_POST_362 in client/src/__tests__/gciVersionGated.test.ts.`,
    ).toEqual([]);
  });
});
