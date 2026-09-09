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

// A halt offers ONE debugger — the GemStone Debugger panel. The DAP debugger is
// still registered (`registerDebugAdapterDescriptorFactory('gemstone', …)` in
// extension.ts, plus the `gemstone` entry under contributes.debuggers), but
// nothing in the extension may put it in front of the user: the only way in is a
// launch configuration the developer wrote themselves, or the Run and Debug view.
//
// This is a source guard rather than a behavioural test because the thing being
// pinned is the ABSENCE of a call — there is no code path left to drive, and the
// way it would come back is somebody re-adding one of these two lines to a halt
// path, where per-path unit tests wouldn't be looking.
const DAP_ENTRY_POINTS: { pattern: RegExp; what: string }[] = [
  { pattern: /\bdebug\.startDebugging\b/, what: 'starts a DAP debug session' },
  { pattern: /['"`]workbench\.view\.debug['"`]/, what: 'reveals the Run and Debug view' },
];

describe('no code path opens the DAP debugger behind the user', () => {
  it.each(DAP_ENTRY_POINTS)('nothing in client/src $what', ({ pattern }) => {
    const offenders: string[] = [];
    for (const file of tsSourceFiles(SRC_ROOT)) {
      if (pattern.test(readFileSync(file, 'utf8'))) offenders.push(file.slice(SRC_ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });
});
