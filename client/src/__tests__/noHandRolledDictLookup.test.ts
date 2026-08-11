import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// client/src — resolved from this test's own location (client/src/__tests__) so cwd
// doesn't matter. __dirname (not import.meta) because the project compiles to CommonJS.
const SRC_ROOT = join(__dirname, '..');

function tsSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === '__tests__' ||
        entry.name === '__mocks__' ||
        entry.name === 'node_modules'
      ) {
        continue;
      }
      out.push(...tsSourceFiles(full));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

// The hand-rolled "resolve a dictionary from a `dict` parameter" snippets that
// dictLookupExpr (and classLookupExpr, for a class within a dict) exist to replace.
// These are precise on the `dict` parameter, so legitimate uses don't trip: index-only
// lookups use `${dictIndex}` / `${srcDictIndex}`, and well-known globals use a literal
// name (e.g. objectNamed: #'Rowan'). Adding a new one should reuse the shared helper.
const HAND_ROLLED: RegExp[] = [
  /symbolList at: \$\{dict\}/,
  /objectNamed: #'\$\{escapeString\(dict\)\}'/,
];

describe('no hand-rolled dictionary resolution outside queries/util.ts', () => {
  it('callers reuse dictLookupExpr / classLookupExpr instead of inlining the dict-by-parameter lookup', () => {
    const offenders: string[] = [];
    for (const file of tsSourceFiles(SRC_ROOT)) {
      // The shared helpers legitimately contain the pattern — that's their home.
      if (file.endsWith(join('queries', 'util.ts'))) continue;
      const src = readFileSync(file, 'utf8');
      if (HAND_ROLLED.some((re) => re.test(src))) offenders.push(file.slice(SRC_ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });
});
