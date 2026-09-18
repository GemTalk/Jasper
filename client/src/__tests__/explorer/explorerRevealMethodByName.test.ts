import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', async (orig) => ({
  ...(await orig()),
  getAllClassNames: vi.fn(() => []),
}));

import { ExplorerController } from '../../gemstoneExplorer';
import { getAllClassNames } from '../../browserQueries';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * Landing on a method an undo restored, when its class name is bound more than once.
 *
 * A class name is NOT unique in a session: a symbol list can hold `Account` in two
 * dictionaries. Taking the first one anywhere on the list shows the user the class where
 * nothing happened, while the method that actually came back sits elsewhere — the same hazard
 * the removed-method editor sweep guards against by matching on the dictionary. Reveal is
 * best-effort, so an unresolvable dictionary falls back to first match rather than doing
 * nothing.
 */

const ACCOUNTS = [
  { dictIndex: 1, dictName: 'Globals', className: 'Account' },
  { dictIndex: 4, dictName: 'Accounting', className: 'Account' },
];

function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  return new ExplorerController(sessionManager);
}

const allClasses = getAllClassNames as ReturnType<typeof vi.fn>;

function spyOnReveal(ctl: ExplorerController) {
  return vi
    .spyOn(ctl as unknown as { revealClass: () => Promise<void> }, 'revealClass')
    .mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  allClasses.mockReturnValue(ACCOUNTS);
});

describe('revealing a method by class and selector', () => {
  it('prefers the dictionary the change was recorded in, given its position', async () => {
    const ctl = makeController();
    const reveal = spyOnReveal(ctl);

    await ctl.revealMethodByName('Account', 'balance', false, 4);

    expect(reveal).toHaveBeenCalledWith('Accounting', 4, 'Account', {
      revealMethod: { selector: 'balance', isMeta: false },
    });
  });

  it('prefers it by name too, for a recording site that knew no position', async () => {
    const ctl = makeController();
    const reveal = spyOnReveal(ctl);

    await ctl.revealMethodByName('Account', 'balance', false, 'Accounting');

    expect(reveal).toHaveBeenCalledWith('Accounting', 4, 'Account', {
      revealMethod: { selector: 'balance', isMeta: false },
    });
  });

  it('falls back to the first binding when no dictionary was recorded', async () => {
    const ctl = makeController();
    const reveal = spyOnReveal(ctl);

    await ctl.revealMethodByName('Account', 'balance', true);

    expect(reveal).toHaveBeenCalledWith('Globals', 1, 'Account', {
      revealMethod: { selector: 'balance', isMeta: true },
    });
  });

  it('falls back to the first binding when the recorded dictionary is no longer there', async () => {
    const ctl = makeController();
    const reveal = spyOnReveal(ctl);

    await ctl.revealMethodByName('Account', 'balance', false, 'Archive');

    expect(reveal).toHaveBeenCalledWith('Globals', 1, 'Account', {
      revealMethod: { selector: 'balance', isMeta: false },
    });
  });

  it('leaves the panes alone for a class that is not bound anywhere', async () => {
    const ctl = makeController();
    const reveal = spyOnReveal(ctl);
    allClasses.mockReturnValue([]);

    await ctl.revealMethodByName('Account', 'balance', false, 4);

    expect(reveal).not.toHaveBeenCalled();
  });

  it('leaves the panes alone when the symbol list cannot be read', async () => {
    const ctl = makeController();
    const reveal = spyOnReveal(ctl);
    allClasses.mockImplementation(() => {
      throw new Error('session busy');
    });

    await expect(ctl.revealMethodByName('Account', 'balance', false)).resolves.toBeUndefined();

    expect(reveal).not.toHaveBeenCalled();
  });
});
