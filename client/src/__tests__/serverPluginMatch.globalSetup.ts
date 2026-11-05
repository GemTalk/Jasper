import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Stops the run before any test file when the test stone's server plugin (the
// refactoring engine and the Enhanced Inspector) isn't the one in this checkout:
// its integration tests would otherwise exercise code from another branch or an
// older install. One check for local and
// CI runs alike; see bin/checkServerPluginMain.ts for what it decides, including
// when it installs this checkout's engine instead of stopping.
//
// It runs as a separate process because the main vitest process has no `vscode`
// stub, which the GCI code needs (see bin/install-server-plugin.mjs).

const MISMATCH = 1;

export function decide(status: number | null, output: string): void {
  if (status === MISMATCH) throw new Error(output.trim());
  // Anything else (match, no engine, stone unreachable, the check itself timing
  // out) lets the run go ahead: an unreachable stone is reported by the
  // integration tests, and a unit-only run doesn't need one.
}

export default function setup(): void {
  const clientDir = join(__dirname, '..', '..');
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', join('bin', 'check-server-plugin.mjs')],
    // Room for that install, which takes tens of seconds, minutes on a slow stone.
    { cwd: clientDir, encoding: 'utf8', timeout: 600_000 },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  decide(result.status, output);
  if (output.trim()) console.log(output.trim());
}
