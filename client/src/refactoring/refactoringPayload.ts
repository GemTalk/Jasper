/**
 * The files of the refactoring payload, in their own module so the installer and
 * the plugin registry can both use the list without importing each other.
 */
import type { ReceiptSpec } from '../serverPlugin/pluginFingerprint';

/**
 * The bootstrap file the client files in itself: it defines `GsRefactoringLoader`
 * (into UserGlobals) and nothing else. Everything after it is filed in by the
 * loader, server-side, in dependency order.
 */
export const REFACTORING_LOADER_FILE = 'refactoring-loader.gs';

/**
 * Every payload file the gem must be able to read: the loader bootstrap plus the
 * four files `GsRefactoringLoader` files in itself. Used for the gem-can-read
 * precheck and for the engine's fingerprint; the client hands the loader the
 * directory and lets it read the rest.
 */
export const REFACTORING_PAYLOAD_FILES: readonly string[] = [
  REFACTORING_LOADER_FILE,
  'ast-core.gs',
  'compat.gs',
  'engine.gs',
  'manifest.gs',
];

/** Where the engine's receipt is kept. The keys are fixed by
 *  `GsRefactoringLoader>>replaceReceiptIn:`, which writes them. */
export const REFACTORING_RECEIPT: ReceiptSpec = {
  files: REFACTORING_PAYLOAD_FILES,
  digestKey: 'GsRefactoringDigest',
  installedByKey: 'GsRefactoringInstalledBy',
};
