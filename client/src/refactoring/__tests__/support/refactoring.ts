import * as path from 'path';
import { escapeString } from '../../../queries/util';
import { toLocalGemPath } from '../../../serverPlugin/installHelpers';

/**
 * Absolute path to the built GS SUnit payload every refactoring engine
 * integration test files in before running its suite in-stone.
 */
const engineTestsPayloadPath = (): string =>
  path.resolve(__dirname, '../../../../../resources/refactoring/engine-tests.gs');

/**
 * The `GsFileIn` statement to file `engineTestsPayloadPath()` into the stone.
 *
 * `fromServerPath:` alone reads the (ASCII-only) payload correctly on every
 * supported release — see gs-src/refactoring/LOADING.md's file-in-signature
 * note — so there is no need for the `#serverUtf8File` form the production
 * loader reserves for 3.7+, nor for a fallback to it. A fallback used to sit
 * here, triggered by any `Error` from the first attempt; on a pre-3.7 stone
 * that signature's `to:` argument is a required Boolean, so passing it `nil`
 * raised `ImproperOperation (error 2085)` — invisible whenever the CI client
 * and gem shared a filesystem (the first attempt always succeeded), but hit
 * as soon as one didn't, because the raw client path wasn't gem-visible
 * either (the Windows-client + WSL-server topology).
 *
 * `toLocalGemPath` is the same path translation the production installers use
 * (`serverPlugin/installHelpers.ts`): on Windows it rewrites a client
 * checkout path to its WSL-visible form, since the gem always runs inside
 * WSL there; a no-op everywhere else.
 */
export const fileInEngineTestsExpr = (): string =>
  `GsFileIn fromServerPath: '${escapeString(toLocalGemPath(engineTestsPayloadPath()))}'.`;
