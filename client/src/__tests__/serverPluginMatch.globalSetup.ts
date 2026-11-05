import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Stops the run before any test file when the test stone's server plugin isn't
// this checkout's, so its integration tests never exercise another branch's code.
// bin/checkServerPluginMain.ts decides, and installs this checkout's plugin over
// one with no receipt. It runs as a separate process because only its launcher
// stubs `vscode`, which the GCI code needs.

const MISMATCH = 1;

export function decide(status: number | null, output: string): void {
  if (status === MISMATCH) throw new Error(output.trim());
  // Anything else (match, no plugin, unreachable stone, timeout) lets the run go
  // ahead: the integration tests report an unreachable stone, and a unit-only run
  // doesn't need one.
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
