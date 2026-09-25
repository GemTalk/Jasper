import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// The GCI writes gci<pid>trace.log into the client process's cwd, except on
// macOS, where it writes under $GEMSTONE_GLOBAL_DIR/log/ (3.7.2+) or a
// hardcoded /opt/gemstone/log/ (older) — openClientTraceFile() in
// linkgc_common.hc. GciTsGemTrace (gciAsync) and a failed GciTsLogout
// (gciSessionUtils) each leave one. Swept in teardown, in the main process once
// every worker has exited, not per file: a log is only complete once its
// session closes, a reused fork worker can hold a sibling file's log under its
// own pid, and Windows won't unlink a file a live GCI still has open.

// The slice of vitest's TestProject used here. A type import from 'vitest/node'
// (ESM-only) doesn't compile under the client's CommonJS tsconfig.
interface TestProject {
  viteConfig: { env: Record<string, unknown> };
}

function traceLogDirs(project: TestProject): string[] {
  if (process.platform !== 'darwin') {
    return [process.cwd()];
  }
  // Read from Vite's resolved env: this runs in the main process, where
  // .env.test is loaded into the config but not into process.env.
  const globalDir: unknown = project.viteConfig.env.VITE_GEMSTONE_GLOBAL_DIR;
  return [...(typeof globalDir === 'string' ? [join(globalDir, 'log')] : []), '/opt/gemstone/log'];
}

function removeTraceLogs(dirs: string[]): void {
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (/^gci\d+trace\.log$/.test(name)) {
        rmSync(join(dir, name), { force: true });
      }
    }
  }
}

export default function setup(project: TestProject): () => void {
  return () => removeTraceLogs(traceLogDirs(project));
}
