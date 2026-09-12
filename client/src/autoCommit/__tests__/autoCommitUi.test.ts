import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  sessionNeedsCommit: vi.fn(() => false),
  transactionConflicts: vi.fn(() => 'Write-Write (1):\n    an Account'),
}));

import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from '../../sessionManager';
import { GemStoneLogin } from '../../loginTypes';
import * as queries from '../../browserQueries';
import {
  _resetAutoCommitStateForTests,
  getAutoCommitStatus,
  registerSessionAutoCommit,
  setAutoCommitStatus,
} from '../autoCommitState';
import {
  autoCommitTransactionSettled,
  offerAutoCommitRecovery,
  toggleAutoCommit,
} from '../autoCommitUi';

const OK = { success: true, err: { number: 0, message: '' } };

function makeSession(id = 1, commit = vi.fn(() => OK)): ActiveSession {
  return {
    id,
    gci: { GciTsCommit: commit } as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
}

function managerFor(session: ActiveSession | undefined): SessionManager {
  return { getSelectedSession: () => session } as unknown as SessionManager;
}

const warn = vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>;
const inform = vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  _resetAutoCommitStateForTests();
  vi.mocked(queries.sessionNeedsCommit).mockReturnValue(false);
  warn.mockReset();
  warn.mockResolvedValue(undefined);
  inform.mockReset();
  inform.mockResolvedValue(undefined);
});

describe('the toggle', () => {
  it('arms a clean session without asking anything', async () => {
    const session = makeSession();
    registerSessionAutoCommit(1, false);

    await toggleAutoCommit(managerFor(session));

    expect(getAutoCommitStatus(1)).toBe('on');
    expect(warn).not.toHaveBeenCalled();
  });

  it('disarms an armed session', async () => {
    const session = makeSession();
    registerSessionAutoCommit(1, true);

    await toggleAutoCommit(managerFor(session));
    expect(getAutoCommitStatus(1)).toBe('off');
  });

  it('acts on the session it was handed, not the selected one', async () => {
    const other = makeSession(2);
    registerSessionAutoCommit(1, false);
    registerSessionAutoCommit(2, false);

    await toggleAutoCommit(managerFor(makeSession(1)), other);

    expect(getAutoCommitStatus(1)).toBe('off');
    expect(getAutoCommitStatus(2)).toBe('on');
  });

  it('says so rather than guessing when no session is selected', async () => {
    await toggleAutoCommit(managerFor(undefined));
    expect(warn).toHaveBeenCalledWith('Select a GemStone session first.');
  });
});

describe('arming over a transaction that already has uncommitted work', () => {
  beforeEach(() => vi.mocked(queries.sessionNeedsCommit).mockReturnValue(true));

  it('asks first, and says the next change would commit all of it', async () => {
    warn.mockResolvedValue(undefined); // dismissed
    const session = makeSession();

    await toggleAutoCommit(managerFor(session));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/already has uncommitted changes/);
    // Dismissed means dismissed: nothing is armed behind the user's back.
    expect(getAutoCommitStatus(1)).toBe('off');
  });

  it('commits the backlog first when asked to, then arms', async () => {
    const commit = vi.fn(() => OK);
    warn.mockResolvedValue('Commit Now, Then Turn On');

    await toggleAutoCommit(managerFor(makeSession(1, commit)));

    expect(commit).toHaveBeenCalledTimes(1);
    expect(getAutoCommitStatus(1)).toBe('on');
  });

  it('arms without committing when the user says to go ahead anyway', async () => {
    const commit = vi.fn(() => OK);
    warn.mockResolvedValue('Turn On Anyway');

    await toggleAutoCommit(managerFor(makeSession(1, commit)));

    expect(commit).not.toHaveBeenCalled();
    expect(getAutoCommitStatus(1)).toBe('on');
  });

  it('asks the same question when the commit state could not be read at all', async () => {
    // A probe that failed leaves the user no better placed to know what is staged than a
    // positive one, so silence would be the one wrong answer.
    vi.mocked(queries.sessionNeedsCommit).mockReturnValue(undefined);
    warn.mockResolvedValue(undefined);

    await toggleAutoCommit(managerFor(makeSession()));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/could not be checked/);
    expect(getAutoCommitStatus(1)).toBe('off');
  });

  it('leaves auto-commit off when the pre-commit it was asked for fails', async () => {
    warn.mockResolvedValue('Commit Now, Then Turn On');
    const failing = vi.fn(() => ({
      success: false,
      err: { number: 2261, message: 'conflicts' },
    }));

    await toggleAutoCommit(managerFor(makeSession(1, failing)));

    expect(getAutoCommitStatus(1)).toBe('off');
  });
});

describe('recovering from a failed commit', () => {
  it('aborts, and picks auto-commit back up once the transaction is settled', async () => {
    const session = makeSession();
    registerSessionAutoCommit(1, true);
    const abort = vi.fn(async () => {});
    warn.mockResolvedValue('Abort and Discard');

    await offerAutoCommitRecovery(session, 'conflicts', abort);

    expect(abort).toHaveBeenCalledWith(session);
    expect(getAutoCommitStatus(1)).toBe('on');
  });

  it('shows the conflict report without changing the state', async () => {
    const session = makeSession();
    registerSessionAutoCommit(1, true);
    // The runner has already flipped it by the time the prompt is shown.
    setAutoCommitStatus(1, 'failed');
    warn.mockResolvedValue('Show Conflicts');

    await offerAutoCommitRecovery(session, 'conflicts', vi.fn());

    expect(queries.transactionConflicts).toHaveBeenCalledWith(session);
    expect(getAutoCommitStatus(1)).toBe('failed');
  });

  it('turns auto-commit off when that is what the user picks', async () => {
    const session = makeSession();
    registerSessionAutoCommit(1, true);
    warn.mockResolvedValue('Turn Auto-Commit Off');

    await offerAutoCommitRecovery(session, 'conflicts', vi.fn());
    expect(getAutoCommitStatus(1)).toBe('off');
  });

  it('leaves the failed state alone when the prompt is dismissed, so the red stays', async () => {
    const session = makeSession();
    registerSessionAutoCommit(1, true);
    setAutoCommitStatus(1, 'failed');
    warn.mockResolvedValue(undefined);

    await offerAutoCommitRecovery(session, 'conflicts', vi.fn());
    expect(getAutoCommitStatus(1)).toBe('failed');
  });

  it('opens the recovery choices, rather than flipping, when the red indicator is clicked', async () => {
    const session = makeSession();
    registerSessionAutoCommit(1, true);
    setAutoCommitStatus(1, 'failed');
    warn.mockResolvedValue(undefined);

    await toggleAutoCommit(managerFor(session));

    expect(warn.mock.calls[0][0]).toMatch(/could not commit/);
    expect(getAutoCommitStatus(1)).toBe('failed');
  });
});

describe('a manual commit or abort settling the transaction', () => {
  it('picks auto-commit back up', () => {
    registerSessionAutoCommit(1, true);
    setAutoCommitStatus(1, 'failed');

    autoCommitTransactionSettled(1);
    expect(getAutoCommitStatus(1)).toBe('on');
  });

  it('leaves a session that never armed it alone', () => {
    autoCommitTransactionSettled(9);
    expect(getAutoCommitStatus(9)).toBe('off');
  });
});
