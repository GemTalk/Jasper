import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Checks, before any test file, that the test stone's server plugin is this
// checkout's, so integration tests never exercise another branch's code.
// bin/checkServerPluginMain.ts decides, and installs this checkout's plugin over
// one with no receipt. It runs as a separate process because only its launcher
// stubs `vscode`, which the GCI code needs.
// A mismatch fails the integration suites (see useIntegrationTest), not the run.

declare module 'vitest' {
  export interface ProvidedContext {
    /** Why the test stone's plugin isn't this checkout's, or null when it is fine. */
    serverPluginMismatch: string | null;
  }
}

// The slice of vitest's TestProject used here; gciTraceLogs.globalSetup.ts says
// why it isn't imported from 'vitest/node'.
interface TestProject {
  provide(key: 'serverPluginMismatch', value: string | null): void;
}

const MISMATCH = 1;

export function mismatchFrom(status: number | null, output: string): string | null {
  // An unreachable stone or a timeout is for the integration tests to report.
  return status === MISMATCH ? output.trim() : null;
}

export default function setup(project: TestProject): void {
  const clientDir = join(__dirname, '..', '..');
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', join('bin', 'check-server-plugin.mjs')],
    // Room for that install, which takes tens of seconds, minutes on a slow stone.
    { cwd: clientDir, encoding: 'utf8', timeout: 600_000 },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const mismatch = mismatchFrom(result.status, output);
  project.provide('serverPluginMismatch', mismatch);
  if (mismatch) console.error(mismatch);
  else if (output.trim()) console.log(output.trim());
}
