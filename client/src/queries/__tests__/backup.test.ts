import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import {
  hasFileControlPrivilege,
  sessionNeedsCommit,
  abortTransaction,
  fullBackupCode,
} from '../backup';

describe('full logical backup queries', () => {
  describe('FileControl privilege check', () => {
    it('reports the privilege is held when the stone answers true', () => {
      const execute = vi.fn<QueryExecutor>(() => 'true\n');

      const held = hasFileControlPrivilege(execute);

      expect(held).toBe(true);
      expect(execute.mock.calls[0][0]).toContain('privileges includes: #FileControl');
    });

    it('reports the privilege is missing for any non-true answer', () => {
      const execute = vi.fn<QueryExecutor>(() => 'false');

      expect(hasFileControlPrivilege(execute)).toBe(false);
    });
  });

  describe('uncommitted-changes check', () => {
    it('detects uncommitted changes when the session needs a commit', () => {
      const execute = vi.fn<QueryExecutor>(() => 'true');

      const dirty = sessionNeedsCommit(execute);

      expect(dirty).toBe(true);
      expect(execute.mock.calls[0][0]).toContain('System needsCommit');
    });

    it('reports a clean session as having nothing to lose', () => {
      const execute = vi.fn<QueryExecutor>(() => 'false');

      expect(sessionNeedsCommit(execute)).toBe(false);
    });
  });

  describe('discarding changes before a backup', () => {
    it('aborts the session to drop uncommitted changes', () => {
      const execute = vi.fn<QueryExecutor>(() => 'aborted');

      abortTransaction(execute);

      expect(execute.mock.calls[0][0]).toContain('System abortTransaction');
    });
  });

  describe('backup Smalltalk', () => {
    it('backs the repository up to the requested destination', () => {
      const code = fullBackupCode('/data/backups/gs.dbf');

      expect(code).toContain("SystemRepository fullBackupTo: '/data/backups/gs.dbf'");
    });

    it('escapes single quotes in the destination path', () => {
      const code = fullBackupCode("/data/o'brien/gs.dbf");

      expect(code).toContain("fullBackupTo: '/data/o''brien/gs.dbf'");
    });

    it('evaluates to a success marker on completion', () => {
      const code = fullBackupCode('/x.dbf');

      expect(code).toContain("ifTrue: ['OK']");
    });

    it('restores the session transaction mode after the backup', () => {
      const code = fullBackupCode('/x.dbf');

      expect(code).toContain('mode := System transactionMode');
      expect(code).toContain('ensure: [System transactionMode: mode]');
    });
  });
});
