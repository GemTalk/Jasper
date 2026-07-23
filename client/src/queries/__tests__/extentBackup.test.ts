import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import {
  fullLoggingEnabled,
  extentFileNames,
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
