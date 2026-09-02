import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  GCI_OPTIONAL_FUNCTIONS,
  type GciOptionalFunctionName,
} from '../gciLibrary/optionalFunctions';

/**
 * Fails when production code calls a GCI function that may be absent from the
 * loaded library, unless the symbol is opted into via ALLOWED_OPTIONAL_FUNCTION.
 *
 * The gated set is every entry of `gciLibrary/optionalFunctions.ts`, on all
 * three of its axes: `addedIn` (absent from older releases), `absentOn: 'win32'`
 * (absent from the Windows client library) and `removedIn` (gone from 4.0 on).
 * Those all bind through `optionalFunc`, so Jasper still *loads* against a
 * library missing them — it's the call that throws, and neither a 3.7.5 dev
 * image nor a macOS/Linux dev machine ever shows you that.
 * Background: `docs/explanation/gci-version-compatibility.md`.
 *
 * A test rather than a lint rule because the gated set is imported from the
 * registry, and `eslint.config.mjs` can't import TypeScript: a selector-based
 * rule would have to restate those names, which is the drift the registry
 * exists to end. Worth revisiting if the config ever moves to TS.
 */

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function gatedFunctions(): string[] {
  return Object.keys(GCI_OPTIONAL_FUNCTIONS).sort();
}

/**
 * What actually breaks, per symbol, if production calls it unguarded — one
 * clause per axis the registry records, so a two-axis entry reports both.
 */
export function hazardFor(name: GciOptionalFunctionName): string {
  const reason: {
    addedIn?: string;
    absentOn?: 'win32';
    removedIn?: '4.0';
  } = GCI_OPTIONAL_FUNCTIONS[name];
  const hazards: string[] = [];
  if (reason.addedIn) {
    hazards.push(`absent before ${reason.addedIn} — throws on the 3.6.2 and 3.6.8 cells`);
  }
  if (reason.absentOn === 'win32') {
    hazards.push(
      'absent from the Windows client library — throws on every `windows-latest` cell and every Windows install',
    );
  }
  if (reason.removedIn) {
    hazards.push(`removed in ${reason.removedIn}`);
  }
  return hazards.join('; ');
}

/**
 * The production call sites that pair a probe with a raw optional binding.
 *
 * **This list must not grow.** An entry here reads like a reviewable opt-in, but
 * it isn't one: it accepts a cross-version conditional living above the binding
 * layer, where the next reader has no reason to expect one. The intended answer
 * for a new case is to put the conditional in `client/src/gciLibrary/` and call
 * a binding-layer helper — optionality is that layer's knowledge. These three
 * are the population to be *removed* (see the follow-up in
 * `playground/plans/migrate-gci-tests.md`), not a pattern to follow.
 */
const ALLOWED_OPTIONAL_FUNCTION: string[] = [
  // nbRunner.ts's pollNbResultReady, behind gci.isAvailable('GciTsNbPoll').
  // Degrades to GciTsSocket + a native poll of the session socket (socketPoll.ts).
  'GciTsNbPoll',

  // sessionManager.ts's nonBlockingLoginHandle, behind supportsNonBlockingLogin().
  // Degrades to the blocking GciTsLogin, which is present everywhere.
  'GciTsNbLogin',
  'GciTsNbLoginFinished',
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

describe('GCI optionality gate', () => {
  it('keeps the allowlist a subset of the gated functions (no stale entries)', () => {
    const gated = gatedFunctions();
    const stale = ALLOWED_OPTIONAL_FUNCTION.filter((name) => !gated.includes(name));
    expect(
      stale,
      `ALLOWED_OPTIONAL_FUNCTION names that are no longer in the registry: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('does not call any optional GCI function outside the allowlist', () => {
    const gated = gatedFunctions();
    const usages = gatedUsages(gated);
    const offenders = Object.keys(usages).filter(
      (name) => !ALLOWED_OPTIONAL_FUNCTION.includes(name),
    );

    const detail = offenders
      .map(
        (name) =>
          `  - ${name} (${hazardFor(name as GciOptionalFunctionName)}): ${usages[name].join(', ')}`,
      )
      .join('\n');

    expect(
      offenders,
      `Production code calls GCI function(s) that may be absent from the loaded library:\n${detail}\n\nPut the cross-version conditional in client/src/gciLibrary/ and call a helper from there, so the call site above doesn't have to know about optionality. Only if that is genuinely impossible, add the name(s) to ALLOWED_OPTIONAL_FUNCTION in client/src/__tests__/gciOptionalityGate.test.ts — which the comment there discourages, and explains why.`,
    ).toEqual([]);
  });

  describe('hazardFor', () => {
    it.each([
      ['GciTsKeepAliveCount', 'absent before 3.7.2 — throws on the 3.6.2 and 3.6.8 cells'],
      [
        'GciTsNbLogin',
        'absent from the Windows client library — throws on every `windows-latest` cell and every Windows install',
      ],
      ['GciTsEncrypt', 'removed in 4.0'],
      [
        'GciTsNbLogin_',
        'absent before 3.7.4.1 — throws on the 3.6.2 and 3.6.8 cells; absent from the Windows client library — throws on every `windows-latest` cell and every Windows install',
      ],
    ] as const)('names the hazard(s) of %s', (name, expected) => {
      expect(hazardFor(name)).toBe(expected);
    });
  });
});
