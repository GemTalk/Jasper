import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';

import { GemStoneSessionItem } from '../loginTreeProvider';
import { ActiveSession } from '../sessionManager';
import { sessionTransactionCommand, SessionTransactionDeps } from '../sessionTransactionCommand';

// The dispatch https://github.com/GemTalk/Jasper/issues/455 was about: where the
// session comes from, and whether the user is asked which one. The type-level
// guard in extensionCommandGuards only pins the signature — `item!.activeSession`
// would satisfy it and reintroduce the original crash — so the behaviour is
// pinned here, against fakes.

const session = (id: number): ActiveSession =>
  ({ id, login: { label: `login-${id}` } }) as unknown as ActiveSession;

function deps(overrides?: {
  sessions?: Map<number, ActiveSession>;
  /** The current session, or `undefined` for a window with none logged in. */
  selected?: ActiveSession | undefined;
}): SessionTransactionDeps & {
  commit: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
} {
  const sessions = overrides?.sessions ?? new Map([[3, session(3)]]);
  const selected = 'selected' in (overrides ?? {}) ? overrides?.selected : session(3);
  const commit = vi.fn().mockResolvedValue(undefined);
  const abort = vi.fn().mockResolvedValue(undefined);
  return {
    sessionManager: {
      getSession: (id: number) => sessions.get(id),
      getSelectedSession: () => selected,
    },
    commit,
    abort,
  };
}

const rowFor = (s: ActiveSession) => ({ activeSession: s }) as unknown as GemStoneSessionItem;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sessionTransactionCommand, invoked from a session row', () => {
  it.each(['Commit', 'Abort'] as const)('%ss the row’s session without asking', async (action) => {
    const d = deps();
    await sessionTransactionCommand(d, action, rowFor(session(3)));

    const ran = action === 'Commit' ? d.commit : d.abort;
    const other = action === 'Commit' ? d.abort : d.commit;
    expect(ran).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }), { ask: false });
    expect(other).not.toHaveBeenCalled();
  });

  // A tree item outlives the session it was built from.
  it.each(['Commit', 'Abort'] as const)(
    'refuses a %s from a row whose session has gone, rather than acting on a dead handle',
    async (action) => {
      const d = deps({ sessions: new Map() });
      await sessionTransactionCommand(d, action, rowFor(session(7)));

      expect(d.commit).not.toHaveBeenCalled();
      expect(d.abort).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Session 7 is no longer logged in'),
      );
    },
  );

  // The session it acts in is the live one of that id, not the row's copy.
  it('re-reads the session by id instead of using the row’s own object', async () => {
    const live = session(3);
    const d = deps({ sessions: new Map([[3, live]]) });
    await sessionTransactionCommand(d, 'Commit', rowFor(session(3)));

    expect(d.commit.mock.calls[0][0]).toBe(live);
  });
});

describe('sessionTransactionCommand, invoked from the Command Palette', () => {
  it.each(['Commit', 'Abort'] as const)(
    'acts in the current session and names it in a modal (%s)',
    async (action) => {
      const d = deps({ selected: session(3) });
      await sessionTransactionCommand(d, action, undefined);

      const ran = action === 'Commit' ? d.commit : d.abort;
      expect(ran).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }), { ask: true });
    },
  );

  // A window with any session logged in always has a current one, so there is
  // nothing left for a session picker to decide — asking would be a QuickPick in
  // the middle of a Commit for a question already answered.
  it('never puts up a session picker', async () => {
    const d = deps({ selected: session(3) });
    await sessionTransactionCommand(d, 'Commit', undefined);

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it.each(['Commit', 'Abort'] as const)(
    'says so rather than acting when nothing is logged in (%s)',
    async (action) => {
      const d = deps({ selected: undefined });
      await sessionTransactionCommand(d, action, undefined);

      expect(d.commit).not.toHaveBeenCalled();
      expect(d.abort).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        `No active GemStone session to ${action.toLowerCase()}.`,
      );
    },
  );
});
