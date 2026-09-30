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
  it('reports full logging on when the stone says true', async () => {
    expect(await fullLoggingEnabled(vi.fn<QueryExecutor>(async () => 'true'))).toBe(true);
  });

  it('reports full logging off when the stone says false', async () => {
    expect(await fullLoggingEnabled(vi.fn<QueryExecutor>(async () => 'false'))).toBe(false);
  });

  it('is undecided when the setting cannot be read', async () => {
    expect(await fullLoggingEnabled(vi.fn<QueryExecutor>(async () => 'unknown'))).toBeUndefined();
  });

  it('reads the full-logging stone configuration parameter', async () => {
    const exec = vi.fn<QueryExecutor>(async () => 'true');
    await fullLoggingEnabled(exec);

    expect(exec.mock.calls[0][0]).toContain('STN_TRAN_FULL_LOGGING');
  });
});

describe('extentFileNames', () => {
  it('splits the newline-separated extent paths', async () => {
    const exec = vi.fn<QueryExecutor>(async () => '/db/data/extent0.dbf\n/db/data/extent1.dbf\n');

    expect(await extentFileNames(exec)).toEqual(['/db/data/extent0.dbf', '/db/data/extent1.dbf']);
  });

  it('returns nothing when the stone query yields an empty string', async () => {
    expect(await extentFileNames(vi.fn<QueryExecutor>(async () => ''))).toEqual([]);
  });

  it('asks the repository for its file names', async () => {
    const exec = vi.fn<QueryExecutor>(async () => '');
    await extentFileNames(exec);

    expect(exec.mock.calls[0][0]).toContain('SystemRepository fileNames');
  });
});

describe('extentFolderInServer', () => {
  it('answers the directory holding the stone’s extent', async () => {
    const exec = vi.fn<QueryExecutor>(async () => '/root/db-1/data/extent0.dbf\n');

    expect(await extentFolderInServer(exec)).toBe('/root/db-1/data');
  });

  it('answers the first extent’s directory when the repository spans several', async () => {
    const exec = vi.fn<QueryExecutor>(
      async () => '/srv/gs/data/extent0.dbf\n/mnt/fast/extent1.dbf\n',
    );

    expect(await extentFolderInServer(exec)).toBe('/srv/gs/data');
  });

  // Windows is a client-only platform — the stone never runs there — so its
  // paths stay POSIX even when the client is Windows. Guards against path.posix
  // here being "simplified" to plain path, whose dirname answers backslashes on
  // a Windows client.
  it('answers a POSIX directory, never one in the client’s own separator', async () => {
    const exec = vi.fn<QueryExecutor>(async () => '/root/db-1/data/extent0.dbf\n');

    expect(await extentFolderInServer(exec)).not.toContain('\\');
  });

  it('throws when the stone cannot say where its extents are', async () => {
    await expect(extentFolderInServer(vi.fn<QueryExecutor>(async () => ''))).rejects.toThrow(
      'Expected the stone to report at least one extent, got none',
    );
  });

  it('throws rather than answering a relative directory', async () => {
    const exec = vi.fn<QueryExecutor>(async () => 'data/extent0.dbf\n');

    await expect(extentFolderInServer(exec)).rejects.toThrow(
      'Expected an absolute extent path from the stone, got "data/extent0.dbf"',
    );
  });
});

describe('backupFolderInServer', () => {
  // The folder the admin views list and the restore picker reads. A backup written
  // to the extent directory instead would be invisible to both.
  it('answers the backups folder alongside the database’s data folder', async () => {
    const exec = vi.fn<QueryExecutor>(async () => '/root/db-1/data/extent0.dbf\n');

    expect(await backupFolderInServer(exec)).toBe('/root/db-1/backups');
  });

  // "Replace extent" deletes every .dbf in the extent directory, so a backup kept
  // there would be destroyed by a routine database reset.
  it('answers a folder outside the extent folder', async () => {
    const exec = vi.fn<QueryExecutor>(async () => '/root/db-1/data/extent0.dbf\n');

    expect(await backupFolderInServer(exec)).not.toContain('/data');
  });

  it('resolves the parent rather than leaving it for the stone to interpret', async () => {
    const exec = vi.fn<QueryExecutor>(async () => '/root/db-1/data/extent0.dbf\n');

    expect(await backupFolderInServer(exec)).not.toContain('..');
  });

  it('answers a POSIX path, never one in the client’s own separator', async () => {
    const exec = vi.fn<QueryExecutor>(async () => '/root/db-1/data/extent0.dbf\n');

    expect(await backupFolderInServer(exec)).not.toContain('\\');
  });

  it('throws when the stone cannot say where its extents are', async () => {
    await expect(backupFolderInServer(vi.fn<QueryExecutor>(async () => ''))).rejects.toThrow();
  });
});

describe('suspendCheckpoints', () => {
  it('succeeds when the stone suspends checkpoints', async () => {
    expect(
      await suspendCheckpoints(
        vi.fn<QueryExecutor>(async () => 'OK'),
        30,
      ),
    ).toBe(true);
  });

  it('fails when the stone declines to suspend checkpoints', async () => {
    expect(
      await suspendCheckpoints(
        vi.fn<QueryExecutor>(async () => 'FAILED'),
        30,
      ),
    ).toBe(false);
  });

  it('suspends for the requested whole number of minutes', async () => {
    const exec = vi.fn<QueryExecutor>(async () => 'OK');
    await suspendCheckpoints(exec, 45);

    expect(exec.mock.calls[0][0]).toContain('suspendCheckpointsForMinutes: 45');
  });
});

describe('resumeCheckpoints', () => {
  it('succeeds when checkpoints were still suspended', async () => {
    expect(await resumeCheckpoints(vi.fn<QueryExecutor>(async () => 'OK'))).toBe(true);
  });

  it('fails when checkpoints had already resumed', async () => {
    expect(await resumeCheckpoints(vi.fn<QueryExecutor>(async () => 'FAILED'))).toBe(false);
  });
});
