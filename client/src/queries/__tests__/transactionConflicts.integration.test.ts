// Conflict reporting against a live stone.
//
// The doit in queries/transactionConflicts.ts is the half no unit test can
// vouch for: it leans on `asOop`, `class name`, `isSeparator`, `collect:`,
// `on:Error do:` and a Unicode7 WriteStream, and it has to run on every
// GemStone in the support matrix. This suite runs it for real and parses what
// comes back.
//
// What it deliberately does NOT cover: a genuine write-write refusal. That needs
// a second session to really commit to the repository, and the harness arms
// GemStone's own commit guard on every session it opens (see
// useIntegrationTest's armCommitGuard) precisely so integration tests cannot
// write to the stone. The refusal path is verified by hand — two Jasper windows
// on one stone — and the error path, which the guard DOES produce, is pinned
// below.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import { QueryExecutor } from '../types';
import { commitTransaction } from '../commitTransaction';
import {
  conflictsCode,
  describeCommitResult,
  parseTransactionConflicts,
  transactionConflicts,
} from '../transactionConflicts';
import { commitFailureMessage, isCommitConflict } from '../../commitFailure';

describe('transaction conflicts on a live stone', () => {
  let gci: GciLibrary;
  let session: unknown;
  let execute: QueryExecutor;

  useIntegrationTest(({ gciLibrary, session: s }) => {
    gci = gciLibrary;
    session = s;
    execute = (code) => gci.executeAndFetchString(session, code);
  });

  // §9.2: the dictionary "contains an Association whose key is #commitResult".
  // If a release stops answering one, or spells it differently, the parser goes
  // quiet rather than wrong — so pin it here.
  it('answers a #commitResult that GemStone documents', () => {
    const { commitResult } = transactionConflicts(execute);

    expect(describeCommitResult(commitResult)).toBeDefined();
  });

  // A clean transaction has no conflicts: "If there are no conflicts for the
  // transaction, the returned symbol dictionary has no additional Associations."
  it('names no conflicts for a transaction that has had none', () => {
    expect(transactionConflicts(execute).categories).toEqual([]);
  });

  // No conflict this suite can provoke answers a text value or an empty kind,
  // so the doit is fed a dictionary of its own shape: a String (a Collection in
  // GemStone) must come back as one T record, not a Character per object, and
  // an empty kind — 3.7.5's #RcReadSet on a clean transaction — not at all.
  it('renders text as text, a collection as its objects, and skips an empty kind', () => {
    const source =
      'SymbolKeyValueDictionary new at: #commitResult put: #failure; ' +
      "at: #'Synchronized-Commit' put: 'peer timed out'; " +
      "at: #'Write-Write' put: (Array with: #jasperProbe); " +
      'at: #RcReadSet put: #(); yourself';
    const { commitResult, categories } = parseTransactionConflicts(execute(conflictsCode(source)));

    expect(commitResult).toBe('failure');
    expect(categories).toHaveLength(2);
    expect(categories).toContainEqual({
      key: 'Synchronized-Commit',
      total: 0,
      objects: [],
      text: "'peer timed out'",
    });
    expect(categories).toContainEqual({
      key: 'Write-Write',
      total: 1,
      objects: [expect.objectContaining({ className: 'Symbol' })],
    });
  });

  it('can be read twice without the first read disturbing the second', () => {
    const first = transactionConflicts(execute);
    expect(transactionConflicts(execute)).toEqual(first);
  });

  // The other half of the refused/errored split. The harness's commit guard
  // makes a commit fail with TransactionError 2249, and a populated error struct
  // is exactly what must NOT be read as a conflict — otherwise every errored
  // commit would claim another session got there first.
  describe('a commit that errors rather than being refused', () => {
    it('leaves an error number in the struct, so it is not read as a conflict', () => {
      const { success, err } = gci.GciTsCommit(session);

      expect(success).toBe(false);
      expect(err.number).not.toBe(0);
      expect(isCommitConflict(err)).toBe(false);
    });

    it('is reported as failed, in the stone’s own words', () => {
      const { err } = gci.GciTsCommit(session);
      const failure = commitFailureMessage(err, undefined);

      expect(failure.verb).toBe('failed');
      expect(failure.reason).toBe(err.message);
      expect(failure.details).toBeUndefined();
    });
  });

  // `System commitTransaction` raises here rather than answering false, because
  // the guard is an error and not a conflict. The query must let that through as
  // an error rather than dressing it up as a refusal nobody caused.
  it('lets an errored commit out of commitTransaction rather than calling it a refusal', () => {
    expect(() => commitTransaction(execute)).toThrow();
  });
});
