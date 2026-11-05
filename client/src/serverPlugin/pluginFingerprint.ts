/**
 * Tells whether a server plugin feature in a stone is the one this Jasper ships.
 *
 * Each install stores a receipt in the feature's dictionary: a SHA-256 of the
 * payload files and the Jasper version that filed them in. Only the fingerprint
 * decides; the version is for the reader and never compared, because a different
 * payload may be older or newer and either can be the one the user wants.
 *
 * The receipt describes what was filed in, not what is in the stone now: a method
 * edited afterwards goes unnoticed. `GsRefactoringLoader>>replaceReceiptIn:` and
 * `installEnhancedInspectorSupport` write it, each in the transaction that files
 * the payload in. `vscode`-free, for the test-run check in `bin/`.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ActiveSession } from '../sessionManager';
import { executeFetchString } from '../browserQueries';
import { messageOf } from './installHelpers';

/** Which payload files a feature's fingerprint covers, and where its receipt is kept. */
export interface ReceiptSpec {
  files: readonly string[];
  /** Keys in the feature's dictionary. They must be unique across every
   *  dictionary in the symbol list, since they are read with `objectNamed:`. */
  digestKey: string;
  installedByKey: string;
}

export interface Receipt {
  digest: string;
  /** Jasper version that filed the payload in; '' when it could not be read. */
  installedBy: string;
}

/**
 * Fingerprint of the payload the gem files in. Line endings and a leading BOM are
 * normalized so every client agrees: `.gitattributes` checks the payload out as
 * LF, but a copy may not have come through git. Each file's name and length go
 * in too, so text moved from one file to the next changes the fingerprint.
 */
export function computePayloadDigest(payloadDir: string, files: readonly string[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    const text = fs
      .readFileSync(path.join(payloadDir, file), 'utf8')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n');
    hash.update(`${file}\n${text.length}\n`);
    hash.update(text);
  }
  return hash.digest('hex');
}

/** The `version` in the extension's own package.json, or '' if unreadable. */
export function readJasperVersion(extensionRoot: string): string {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : '';
  } catch {
    return '';
  }
}

/**
 * The receipt an install from `payloadDir` records. Payload directories are
 * `<extension root>/resources/<feature>`, whose package.json names this Jasper.
 * Throws if a payload file can't be read.
 */
export function receiptFor(spec: ReceiptSpec, payloadDir: string): Receipt {
  return {
    digest: computePayloadDigest(payloadDir, spec.files),
    installedBy: readJasperVersion(path.resolve(payloadDir, '..', '..')),
  };
}

/**
 * The receipt stored in the stone. Answers `undefined` when there is none: a
 * payload installed before receipts existed, or loaded by hand. Throws if the
 * stone could not be asked.
 *
 * Looks the keys up by String through the symbol list, for the reason given on
 * `checkRefactoringSupportAvailable`: a `#symbol` literal would have to create
 * the symbol at compile time.
 */
export function readReceipt(session: ActiveSession, spec: ReceiptSpec): Receipt | undefined {
  const raw = executeFetchString(
    session,
    '| list text | list := System myUserProfile symbolList. ' +
      'text := [:key | | v | v := list objectNamed: key. ' +
      "(v isKindOf: CharacterCollection) ifTrue: [v] ifFalse: ['']]. " +
      `(text value: '${spec.digestKey}'), (String with: Character lf), ` +
      `(text value: '${spec.installedByKey}')`,
  );
  const [digest = '', installedBy = ''] = raw.split(/\r?\n/);
  return digest.trim() ? { digest: digest.trim(), installedBy: installedBy.trim() } : undefined;
}

export type PluginState = 'missing' | 'current' | 'different' | 'unknown';

export interface PluginStatus {
  state: PluginState;
  /** Jasper version recorded in the stone's receipt, when there is one. */
  installedBy?: string;
  /** For `different`: the two fingerprints, which identify this mismatch. */
  installedDigest?: string;
  shippedDigest?: string;
  /** For `unknown`: no receipt, or why the stone could not be asked. */
  unknownReason?: 'noReceipt' | 'unreadable';
  detail?: string;
}

/**
 * Status of one feature in the stone reached by `session`, against the payload
 * in `payloadDir`. Never throws: a failed read is `unknown`, not `different`, so
 * a busy session never reads as a payload that needs reinstalling.
 */
export function pluginStatus(
  session: ActiveSession,
  installed: boolean,
  payloadDir: string,
  spec: ReceiptSpec,
): PluginStatus {
  if (!installed) return { state: 'missing' };
  let receipt: Receipt | undefined;
  let shipped: string;
  try {
    receipt = readReceipt(session, spec);
    shipped = computePayloadDigest(payloadDir, spec.files);
  } catch (e: unknown) {
    return { state: 'unknown', unknownReason: 'unreadable', detail: messageOf(e) };
  }
  if (!receipt) return { state: 'unknown', unknownReason: 'noReceipt' };
  const installedBy = receipt.installedBy || undefined;
  if (receipt.digest === shipped) return { state: 'current', installedBy };
  return {
    state: 'different',
    installedBy,
    installedDigest: receipt.digest,
    shippedDigest: shipped,
  };
}
