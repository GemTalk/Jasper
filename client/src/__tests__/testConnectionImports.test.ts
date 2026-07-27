import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// testConnection.ts and testActiveSession.ts are compiled and require()'d
// directly by client/bin/install-server-plugin.mjs (see its header) — a plain
// Node script with no `vscode`, no test runner, and no `sessionManager` (a
// `vscode`-dependent module) available. Nothing in `npm test` ever require()s
// `client/out/`, so a regression here wouldn't surface as a test failure at
// all — it would surface in CI as an opaque `Cannot find module 'vscode'`
// during install-server-plugin.mjs's provisioning step. This source-text scan
// is the only thing standing between that regression and `npm test` staying
// green, so it checks the two files' import lines directly rather than
// relying on a runtime assertion that would need `client/out/` to exist.
//
// `ActiveSession` from `sessionManager` is fine as a *type-only* import (tsc
// elides it from compiled output — see testActiveSession.ts's header); only a
// value import of `sessionManager` would reintroduce the `vscode` dependency.
describe('testConnection.ts and testActiveSession.ts stay require()-safe for a plain Node script', () => {
  const testsDir = path.resolve(__dirname);

  const files = ['testConnection.ts', 'testActiveSession.ts'].map((name) => ({
    name,
    contents: fs.readFileSync(path.join(testsDir, name), 'utf8'),
  }));

  it.each(files.map(({ name }) => [name] as const))('finds %s to scan', (name) => {
    expect(files.some((f) => f.name === name)).toBe(true);
  });

  it.each(files.map(({ name, contents }) => [name, contents] as const))(
    'has no non-type import of vscode, vitest, or a value import of sessionManager in %s',
    (_name, contents) => {
      const importLines = contents
        .split(/\r?\n/)
        .filter((line) => /^\s*import\b/.test(line) && !/^\s*\/\//.test(line));

      const offenders = importLines.filter((line) => {
        if (/from\s+['"]vscode['"]/.test(line)) return true;
        if (/from\s+['"]vitest['"]/.test(line)) return true;
        if (/from\s+['"].*sessionManager['"]/.test(line) && !/^\s*import type\b/.test(line)) {
          return true;
        }
        return false;
      });

      expect(offenders).toEqual([]);
    },
  );
});
