import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../browserQueries', () => ({
  executeFetchString: vi.fn(),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { executeFetchString } from '../../browserQueries';
import { fakeActiveSession } from '../../__tests__/fakeActiveSession';
import {
  computePayloadDigest,
  pluginStatus,
  readJasperVersion,
  readReceipt,
  ReceiptSpec,
  receiptFor,
} from '../pluginFingerprint';
import { REFACTORING_RECEIPT } from '../../refactoring/refactoringPayload';
import { ENHANCED_INSPECTOR_RECEIPT } from '../../enhancedInspector/enhancedInspectorInstall';

const executeFetchStringMock = vi.mocked(executeFetchString);
const session = fakeActiveSession({ id: 1, handle: {}, stoneVersion: '3.7.5' });

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const RESOURCES = path.join(REPO_ROOT, 'resources');

const SPEC: ReceiptSpec = {
  files: ['loader.gs', 'compat.gs', 'engine.gs'],
  digestKey: 'TestDigest',
  installedByKey: 'TestInstalledBy',
};

let dir: string;

function writePayload(target: string, transform: (text: string) => string = (t) => t): void {
  for (const file of SPEC.files) {
    fs.writeFileSync(path.join(target, file), transform(`! ${file}\nline one\nline two\n`));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-fingerprint-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('computePayloadDigest', () => {
  // The same engine must fingerprint the same from a Windows, macOS or Linux
  // client, whatever line endings its copy of the payload ended up with.
  it.each([
    ['CRLF', (t: string) => t.replace(/\n/g, '\r\n')],
    ['CR', (t: string) => t.replace(/\n/g, '\r')],
    ['a leading BOM', (t: string) => `\uFEFF${t}`],
  ])('gives the same fingerprint for a payload saved with %s as for LF', (_name, transform) => {
    writePayload(dir);
    const lf = computePayloadDigest(dir, SPEC.files);
    writePayload(dir, transform);

    expect(computePayloadDigest(dir, SPEC.files)).toBe(lf);
  });

  it('changes when any payload file changes', () => {
    writePayload(dir);
    const before = computePayloadDigest(dir, SPEC.files);
    fs.appendFileSync(path.join(dir, 'engine.gs'), 'one more line\n');

    expect(computePayloadDigest(dir, SPEC.files)).not.toBe(before);
  });

  it('tells apart text moved from one payload file to the next', () => {
    writePayload(dir);
    fs.writeFileSync(path.join(dir, 'compat.gs'), 'ab');
    fs.writeFileSync(path.join(dir, 'engine.gs'), 'c');
    const before = computePayloadDigest(dir, SPEC.files);
    fs.writeFileSync(path.join(dir, 'compat.gs'), 'a');
    fs.writeFileSync(path.join(dir, 'engine.gs'), 'bc');

    expect(computePayloadDigest(dir, SPEC.files)).not.toBe(before);
  });

  it('throws when a payload file is missing', () => {
    expect(() => computePayloadDigest(dir, SPEC.files)).toThrow();
  });

  it.each([
    ['refactoring', REFACTORING_RECEIPT],
    ['enhancedInspector', ENHANCED_INSPECTOR_RECEIPT],
  ])('fingerprints the %s payload this checkout ships', (dir, spec) => {
    expect(computePayloadDigest(path.join(RESOURCES, dir), spec.files)).toMatch(/^[0-9a-f]{64}$/);
  });

  // objectNamed: searches every dictionary in the symbol list.
  it('gives each feature its own receipt keys', () => {
    const keys = [REFACTORING_RECEIPT, ENHANCED_INSPECTOR_RECEIPT].flatMap((r) => [
      r.digestKey,
      r.installedByKey,
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('receiptFor', () => {
  it("records this Jasper's version, read from the extension root above the payload", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const receipt = receiptFor(REFACTORING_RECEIPT, path.join(RESOURCES, 'refactoring'));
    expect(receipt.installedBy).toBe(manifest.version);
    expect(receipt.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('readJasperVersion', () => {
  it('answers an empty string when there is no package.json', () => {
    expect(readJasperVersion(dir)).toBe('');
  });
});

describe('readReceipt', () => {
  it('reads the fingerprint and the installing Jasper version', () => {
    executeFetchStringMock.mockReturnValue('abc123\n1.15.0');
    expect(readReceipt(session, SPEC)).toEqual({ digest: 'abc123', installedBy: '1.15.0' });
  });

  it('tolerates CRLF in the reply', () => {
    executeFetchStringMock.mockReturnValue('abc123\r\n1.15.0\r\n');
    expect(readReceipt(session, SPEC)).toEqual({ digest: 'abc123', installedBy: '1.15.0' });
  });

  it('answers undefined for an engine installed before receipts existed', () => {
    executeFetchStringMock.mockReturnValue('\n');
    expect(readReceipt(session, SPEC)).toBeUndefined();
  });

  // A `#symbol` literal forces symbol creation when the query compiles.
  it('looks the keys up by String, not by Symbol literal', () => {
    executeFetchStringMock.mockReturnValue('\n');
    readReceipt(session, SPEC);
    const code = String(executeFetchStringMock.mock.calls[0][1]);
    expect(code).toContain("'TestDigest'");
    expect(code).not.toContain('#TestDigest');
  });
});

describe('pluginStatus', () => {
  let shipped: string;
  beforeEach(() => {
    writePayload(dir);
    shipped = computePayloadDigest(dir, SPEC.files);
  });

  it('is missing when the engine is not installed, without asking the stone', () => {
    expect(pluginStatus(session, false, dir, SPEC)).toEqual({ state: 'missing' });
    expect(executeFetchStringMock).not.toHaveBeenCalled();
  });

  it('is current when the stone holds the fingerprint of the shipped payload', () => {
    executeFetchStringMock.mockReturnValue(`${shipped}\n1.15.0`);
    expect(pluginStatus(session, true, dir, SPEC)).toEqual({
      state: 'current',
      installedBy: '1.15.0',
    });
  });

  // A different engine may be older or newer, and either can be the one the
  // user wants, so the Jasper versions are never compared.
  it('is different when the fingerprints differ, whichever Jasper installed it', () => {
    for (const installedBy of ['1.15.0', '1.99.0']) {
      executeFetchStringMock.mockReturnValue(`0000\n${installedBy}`);
      expect(pluginStatus(session, true, dir, SPEC)).toEqual({
        state: 'different',
        installedBy,
        installedDigest: '0000',
        shippedDigest: shipped,
      });
    }
  });

  it('is unknown, not different, for an engine installed before receipts existed', () => {
    executeFetchStringMock.mockReturnValue('\n');
    expect(pluginStatus(session, true, dir, SPEC)).toEqual({
      state: 'unknown',
      unknownReason: 'noReceipt',
    });
  });

  it('is unknown, not different, when the stone cannot be asked', () => {
    executeFetchStringMock.mockImplementation(() => {
      throw new Error('session busy');
    });
    expect(pluginStatus(session, true, dir, SPEC)).toEqual({
      state: 'unknown',
      unknownReason: 'unreadable',
      detail: 'session busy',
    });
  });

  it('is unknown when the shipped payload cannot be read', () => {
    executeFetchStringMock.mockReturnValue(`${shipped}\n1.15.0`);
    const status = pluginStatus(session, true, path.join(dir, 'absent'), SPEC);
    expect(status.state).toBe('unknown');
    expect(status.unknownReason).toBe('unreadable');
  });
});
