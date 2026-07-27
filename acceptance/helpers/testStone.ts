import * as fs from 'fs';
import * as path from 'path';
import { netldiNameFromGemNrs, parseStoneNrs } from '../../client/src/loginTypes';

/** Connection details for the provisioned test stone, drawn from `.env.test`. */
export interface TestStone {
  version: string;
  host: string;
  stone: string;
  netldi: string;
  user: string;
  password: string;
  gciLibraryPath: string;
}

const envTestPath = path.resolve(__dirname, '..', '..', 'client', '.env.test');

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) out[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/**
 * Read the test stone provisioned by `npm run test:server:start`. Returns
 * `undefined` when it hasn't been provisioned or its GCI library is missing, so
 * the connect spec can skip rather than fail on a machine without a stone.
 */
export function readTestStone(): TestStone | undefined {
  if (!fs.existsSync(envTestPath)) return undefined;
  const env = parseEnv(fs.readFileSync(envTestPath, 'utf8'));

  const gciLibraryPath = env.VITE_GEMSTONE_GCI_LIBRARY_PATH ?? '';
  if (!gciLibraryPath || !fs.existsSync(gciLibraryPath)) return undefined;

  // The NRS strings carry the names: `…#server!<stone>` and `…netldi:<netldi>#…`.
  const stoneNrs = env.VITE_GEMSTONE_STONE_NRS
    ? parseStoneNrs(env.VITE_GEMSTONE_STONE_NRS)
    : undefined;
  const netldi = env.VITE_GEMSTONE_GEM_NRS
    ? netldiNameFromGemNrs(env.VITE_GEMSTONE_GEM_NRS)
    : undefined;
  const version = gciLibraryPath.match(/libgcits-([\d.]+)-/)?.[1];
  if (!stoneNrs || !netldi || !version) return undefined;

  return {
    version,
    host: stoneNrs.gem_host,
    stone: stoneNrs.stone,
    netldi,
    user: env.VITE_GEMSTONE_USER ?? 'DataCurator',
    password: env.VITE_GEMSTONE_PASSWORD ?? '',
    gciLibraryPath,
  };
}
