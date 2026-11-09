import path from 'node:path';
import dotenv from 'dotenv';

// For the plain Node scripts in client/bin: reads the test stone's settings from
// the same files, in the same precedence, as vitest, so they reach the stone the
// tests use. The first file to set a key wins, and a real variable beats them all.
//
// Every option is pinned because dotenv also reads its options from ambient
// DOTENV_* / DOTENV_CONFIG_* variables; a stray DOTENV_OVERRIDE would otherwise
// let a file clobber real variables, and DOTENV_FAST would change the parser.
export function loadTestEnv(clientDir: string, env: NodeJS.ProcessEnv = process.env): void {
  dotenv.config({
    path: ['.env.test.local', '.env.test', '.env.local', '.env'].map((f) =>
      path.join(clientDir, f),
    ),
    processEnv: env,
    encoding: 'utf8',
    override: false,
    fast: false,
    debug: false,
    quiet: true,
  });
  // GCI finds a local stone through GEMSTONE_GLOBAL_DIR, which vite only exposes
  // with the VITE_ prefix.
  if (env.VITE_GEMSTONE_GLOBAL_DIR) env.GEMSTONE_GLOBAL_DIR = env.VITE_GEMSTONE_GLOBAL_DIR;
}
