import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({ refactoringUndoStatus: vi.fn() }));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));

import * as queries from '../../browserQueries';
import { logInfo } from '../../gciLog';
import { checkRefactoringUndoAvailable } from '../refactoringUndoAvailability';
import type { ActiveSession } from '../../sessionManager';

/**
 * The "does the stone still hold a refactoring undo" probe (#434).
 *
 * Its contract is that it NEVER throws: every caller is on a path where the refactoring has
 * already landed, so a probe that failed must read as "nothing to undo" rather than turn a
 * successful refactoring into an error. That makes a failure invisible by design, which is
 * why each outcome is logged — a stone answering `available:false` and a probe that threw
 * produce exactly the same notice, and only the log tells them apart.
 */

const session = { id: 1 } as ActiveSession;

const available = JSON.stringify({
  available: true,
  label: 'Rename #total to #sum',
  engine: 'GsRenameMethodRefactoring',
  mechanism: 'changeSet',
  sequence: 4,
  total: 2,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkRefactoringUndoAvailable', () => {
  it('reads the stone answer through, and logs it', () => {
    vi.mocked(queries.refactoringUndoStatus).mockReturnValue(available);

    expect(checkRefactoringUndoAvailable(session)).toMatchObject({
      available: true,
      label: 'Rename #total to #sum',
      sequence: 4,
    });
    expect(vi.mocked(logInfo).mock.calls[0][0]).toContain('"available":true');
  });

  it('reports nothing to undo when the stone says so', () => {
    vi.mocked(queries.refactoringUndoStatus).mockReturnValue('{"available":false}');

    expect(checkRefactoringUndoAvailable(session).available).toBe(false);
  });

  it('reports nothing to undo when the probe throws, and says why in the log', () => {
    // A session that is busy, gone, or has an engine predating undo. The refactoring itself
    // succeeded, so this must not surface as an error to the user.
    vi.mocked(queries.refactoringUndoStatus).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(() => checkRefactoringUndoAvailable(session)).not.toThrow();
    expect(checkRefactoringUndoAvailable(session).available).toBe(false);
    expect(vi.mocked(logInfo).mock.calls[0][0]).toContain('session busy');
  });

  it('reports nothing to undo without asking when there is no session', () => {
    expect(checkRefactoringUndoAvailable(undefined).available).toBe(false);
    expect(queries.refactoringUndoStatus).not.toHaveBeenCalled();
  });
});
