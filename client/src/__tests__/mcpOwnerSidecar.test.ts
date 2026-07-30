import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  McpOwnerInfo,
  deleteOwnerSidecar,
  isPidAlive,
  readOwnerSidecar,
  writeOwnerSidecar,
} from '../mcpOwnerSidecar';
import { safelyRemovePath, temporarySidecarPath, withTemporaryFolderDo } from './support/file';

function sampleInfo(overrides: Partial<McpOwnerInfo> = {}): McpOwnerInfo {
  return {
    pid: process.pid,
    workspacePath: '/tmp/jasper-test-workspace',
    socketPath: '/tmp/test/mcp.sock',
    claimedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('writeOwnerSidecar / readOwnerSidecar', () => {
  let sidecarPath: string;
  beforeEach(() => {
    sidecarPath = temporarySidecarPath();
  });
  afterEach(() => {
    safelyRemovePath(sidecarPath);
  });

  it('round-trips an info record through disk', () => {
    const info = sampleInfo({ pid: 12345 });
    writeOwnerSidecar(info, sidecarPath);
    const read = readOwnerSidecar(sidecarPath);
    expect(read).toEqual(info);
  });

  it('creates the parent directory if it does not exist', () => {
    withTemporaryFolderDo((temporaryFolder) => {
      const nested = path.join(temporaryFolder, 'sub', 'mcp.owner.json');

      writeOwnerSidecar(sampleInfo(), nested);

      expect(fs.existsSync(nested)).toBe(true);
    });
  });

  it('returns undefined when the sidecar does not exist', () => {
    expect(readOwnerSidecar(sidecarPath)).toBeUndefined();
  });

  it('returns undefined when the sidecar contents are not valid JSON', () => {
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, 'not json{');
    expect(readOwnerSidecar(sidecarPath)).toBeUndefined();
  });

  it('returns undefined when the JSON is missing required fields', () => {
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, JSON.stringify({ pid: 1, workspacePath: 'x' }));
    expect(readOwnerSidecar(sidecarPath)).toBeUndefined();
  });

  it('overwrites a previous owner record atomically (via tmp + rename)', () => {
    writeOwnerSidecar(sampleInfo({ pid: 1 }), sidecarPath);
    writeOwnerSidecar(sampleInfo({ pid: 2 }), sidecarPath);
    expect(readOwnerSidecar(sidecarPath)?.pid).toBe(2);
  });

  it('round-trips the optional selectedSession label', () => {
    const info = sampleInfo({ selectedSession: 'foo (id 12)' });
    writeOwnerSidecar(info, sidecarPath);
    const read = readOwnerSidecar(sidecarPath);
    expect(read?.selectedSession).toBe('foo (id 12)');
  });

  it('omits selectedSession when none was written (owner has no session)', () => {
    writeOwnerSidecar(sampleInfo(), sidecarPath);
    expect(readOwnerSidecar(sidecarPath)?.selectedSession).toBeUndefined();
  });

  it('ignores a non-string selectedSession in stored JSON (forward-compat)', () => {
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(
      sidecarPath,
      JSON.stringify({
        pid: 1,
        workspacePath: 'x',
        socketPath: 'y',
        claimedAt: 'z',
        selectedSession: 12, // unexpected type
      }),
    );
    expect(readOwnerSidecar(sidecarPath)?.selectedSession).toBeUndefined();
  });
});

describe('deleteOwnerSidecar', () => {
  let sidecarPath: string;
  beforeEach(() => {
    sidecarPath = temporarySidecarPath();
  });
  afterEach(() => {
    safelyRemovePath(sidecarPath);
  });

  it('removes the sidecar when the recorded pid matches', () => {
    writeOwnerSidecar(sampleInfo({ pid: 4242 }), sidecarPath);
    expect(deleteOwnerSidecar(4242, sidecarPath)).toBe(true);
    expect(fs.existsSync(sidecarPath)).toBe(false);
  });

  it('refuses to remove a sidecar a different pid has since written', () => {
    writeOwnerSidecar(sampleInfo({ pid: 4242 }), sidecarPath);
    expect(deleteOwnerSidecar(9999, sidecarPath)).toBe(false);
    expect(fs.existsSync(sidecarPath)).toBe(true);
  });

  it('returns false (no error) when the sidecar does not exist', () => {
    expect(deleteOwnerSidecar(1, sidecarPath)).toBe(false);
  });
});

describe('isPidAlive', () => {
  it('returns true for the current process', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('returns false for a sentinel pid that is almost certainly not running', () => {
    // Pid 0 / negative / huge values are not valid live processes.
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(Number.NaN)).toBe(false);
  });
});
