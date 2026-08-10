import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import {
  fullLoggingEnabled,
  extentFileNames,
  extentFolderInServer,
  backupFolderInServer,
  suspendCheckpoints,
  resumeCheckpoints,
} from '../extentBackup';

describe('fullLoggingEnabled', () => {
  it('reports full logging on when the stone says true', () => {
    expect(fullLoggingEnabled(vi.fn<QueryExecutor>(() => 'true'))).toBe(true);
  });

  it('reports full logging off when the stone says false', () => {
    expect(fullLoggingEnabled(vi.fn<QueryExecutor>(() => 'false'))).toBe(false);
  });

  it('is undecided when the setting cannot be read', () => {
    expect(fullLoggingEnabled(vi.fn<QueryExecutor>(() => 'unknown'))).toBeUndefined();
  });

  it('reads the full-logging stone configuration parameter', () => {
    const exec = vi.fn<QueryExecutor>(() => 'true');
    fullLoggingEnabled(exec);

    expect(exec.mock.calls[0][0]).toContain('STN_TRAN_FULL_LOGGING');
  });
});

describe('extentFileNames', () => {
  it('splits the newline-separated extent paths', () => {
    const exec = vi.fn<QueryExecutor>(() => '/db/data/extent0.dbf\n/db/data/extent1.dbf\n');

    expect(extentFileNames(exec)).toEqual(['/db/data/extent0.dbf', '/db/data/extent1.dbf']);
  });

  it('returns nothing when the stone query yields an empty string', () => {
    expect(extentFileNames(vi.fn<QueryExecutor>(() => ''))).toEqual([]);
  });

  it('asks the repository for its file names', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    extentFileNames(exec);

    expect(exec.mock.calls[0][0]).toContain('SystemRepository fileNames');
  });
});

describe('extentFolderInServer', () => {
  it('answers the directory holding the stone’s extent', () => {
    const exec = vi.fn<QueryExecutor>(() => '/root/db-1/data/extent0.dbf\n');

    expect(extentFolderInServer(exec)).toBe('/root/db-1/data');
  });

  it('answers the first extent’s directory when the repository spans several', () => {
    const exec = vi.fn<QueryExecutor>(() => '/srv/gs/data/extent0.dbf\n/mnt/fast/extent1.dbf\n');

    expect(extentFolderInServer(exec)).toBe('/srv/gs/data');
  });

  // Windows is a client-only platform — the stone never runs there — so its
  // paths stay POSIX even when the client is Windows. Guards against path.posix
  // here being "simplified" to plain path, whose dirname answers backslashes on
  // a Windows client.
  it('answers a POSIX directory, never one in the client’s own separator', () => {
    const exec = vi.fn<QueryExecutor>(() => '/root/db-1/data/extent0.dbf\n');

    expect(extentFolderInServer(exec)).not.toContain('\\');
  });

  it('throws when the stone cannot say where its extents are', () => {
    expect(() => extentFolderInServer(vi.fn<QueryExecutor>(() => ''))).toThrow(
      'Expected the stone to report at least one extent, got none',
    );
  });

  it('throws rather than answering a relative directory', () => {
    const exec = vi.fn<QueryExecutor>(() => 'data/extent0.dbf\n');

    expect(() => extentFolderInServer(exec)).toThrow(
      'Expected an absolute extent path from the stone, got "data/extent0.dbf"',
    );
  });
});

describe('backupFolderInServer', () => {
  // The folder the admin views list and the restore picker reads. A backup written
  // to the extent directory instead would be invisible to both.
  it('answers the backups folder alongside the database’s data folder', () => {
    const exec = vi.fn<QueryExecutor>(() => '/root/db-1/data/extent0.dbf\n');

    expect(backupFolderInServer(exec)).toBe('/root/db-1/backups');
  });

  // "Replace extent" deletes every .dbf in the extent directory, so a backup kept
  // there would be destroyed by a routine database reset.
  it('answers a folder outside the extent folder', () => {
    const exec = vi.fn<QueryExecutor>(() => '/root/db-1/data/extent0.dbf\n');

    expect(backupFolderInServer(exec)).not.toContain('/data');
  });

  it('resolves the parent rather than leaving it for the stone to interpret', () => {
    const exec = vi.fn<QueryExecutor>(() => '/root/db-1/data/extent0.dbf\n');

    expect(backupFolderInServer(exec)).not.toContain('..');
  });

  it('answers a POSIX path, never one in the client’s own separator', () => {
    const exec = vi.fn<QueryExecutor>(() => '/root/db-1/data/extent0.dbf\n');

    expect(backupFolderInServer(exec)).not.toContain('\\');
  });

  it('throws when the stone cannot say where its extents are', () => {
    expect(() => backupFolderInServer(vi.fn<QueryExecutor>(() => ''))).toThrow();
  });
});

describe('suspendCheckpoints', () => {
  it('succeeds when the stone suspends checkpoints', () => {
    expect(
      suspendCheckpoints(
        vi.fn<QueryExecutor>(() => 'OK'),
        30,
      ),
    ).toBe(true);
  });

  it('fails when the stone declines to suspend checkpoints', () => {
    expect(
      suspendCheckpoints(
        vi.fn<QueryExecutor>(() => 'FAILED'),
        30,
      ),
    ).toBe(false);
  });

  it('suspends for the requested whole number of minutes', () => {
    const exec = vi.fn<QueryExecutor>(() => 'OK');
    suspendCheckpoints(exec, 45);

    expect(exec.mock.calls[0][0]).toContain('suspendCheckpointsForMinutes: 45');
  });
});

describe('resumeCheckpoints', () => {
  it('succeeds when checkpoints were still suspended', () => {
    expect(resumeCheckpoints(vi.fn<QueryExecutor>(() => 'OK'))).toBe(true);
  });

  it('fails when checkpoints had already resumed', () => {
    expect(resumeCheckpoints(vi.fn<QueryExecutor>(() => 'FAILED'))).toBe(false);
  });
});
