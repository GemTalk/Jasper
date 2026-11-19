/**
 * The files of the regular-expression payload (`resources/regex/`), in their own
 * module so the installer and the plugin registry can both use the list without
 * importing each other. Built by `gs-src/regex/build/build-regex.sh`.
 */
import type { ReceiptSpec } from '../serverPlugin/pluginFingerprint';

/** The file the client files in itself: it defines `GsRegexLoader` (into
 *  UserGlobals), which files in the rest. */
export const REGEX_LOADER_FILE = 'regex-loader.gs';

/** Every file the gem must be able to read, in the order the loader needs them. */
export const REGEX_PAYLOAD_FILES: readonly string[] = [
  REGEX_LOADER_FILE,
  'regex-core.gs',
  'engine.gs',
  'manifest.gs',
];

/** Where the receipt is kept; the keys are fixed by `GsRegexLoader>>replaceReceiptIn:`. */
export const REGEX_RECEIPT: ReceiptSpec = {
  files: REGEX_PAYLOAD_FILES,
  digestKey: 'GsRegexDigest',
  installedByKey: 'GsRegexInstalledBy',
};
