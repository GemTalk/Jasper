import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', async (orig) => ({
  ...(await orig()),
  getAllClassNames: vi.fn(() => []),
}));

import * as vscode from 'vscode';
import { ExplorerController } from '../../gemstoneExplorer';
import { getAllClassNames } from '../../browserQueries';
import type { SessionManager, ActiveSession } from '../../sessionManager';

// The same class name in two dictionaries — the case a bare name cannot resolve.
const SHADOWED = [
  { className: 'Account', dictName: 'UserGlobals', dictIndex: 1 },
  { className: 'Account', dictName: 'Legacy', dictIndex: 4 },
];

function makeController(): ExplorerController {
  const session = { id: 7 } as ActiveSession;
  const sessionManager = {
    getSelectedSession: () => session,
    getSession: (id: number) => (id === session.id ? session : undefined),
    resolveSession: () => Promise.resolve(session),
  } as unknown as SessionManager;
  return new ExplorerController(sessionManager);
}

// Stub the cascade itself (it queries a stone), recording what it was asked for
// and leaving the controller where a successful reveal would leave it.
function stubRevealClass(ctl: ExplorerController): ReturnType<typeof vi.fn> {
  const revealClass = vi.fn((dictName: string, dictIndex: number, className: string) => {
    ctl.state.dictName = dictName;
    ctl.state.dictIndex = dictIndex;
    ctl.state.className = className;
    return Promise.resolve();
  });
  (ctl as unknown as { revealClass: unknown }).revealClass = revealClass;
  return revealClass;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findClass with a dictionary and a method', () => {
  it('resolves a shadowed class name in the dictionary it was given', async () => {
    vi.mocked(getAllClassNames).mockReturnValue(SHADOWED);
    const ctl = makeController();
    const revealClass = stubRevealClass(ctl);

    await ctl.findClass('Account', 7, 'Legacy');

    expect(revealClass).toHaveBeenCalledWith('Legacy', 4, 'Account', { revealMethod: undefined });
  });

  it('falls back to the first entry of that name when the dictionary matches nothing', async () => {
    // A stale hint should still land on a class rather than on nothing.
    vi.mocked(getAllClassNames).mockReturnValue(SHADOWED);
    const ctl = makeController();
    const revealClass = stubRevealClass(ctl);

    await ctl.findClass('Account', 7, 'DictionaryThatIsGone');

    expect(revealClass).toHaveBeenCalledWith('UserGlobals', 1, 'Account', {
      revealMethod: undefined,
    });
  });

  it('reveals the named method row and opens its source', async () => {
    vi.mocked(getAllClassNames).mockReturnValue(SHADOWED);
    const ctl = makeController();
    const revealClass = stubRevealClass(ctl);
    (ctl as unknown as { envLines: unknown }).envLines = [
      { isMeta: false, envId: 0, category: 'accessing', selectors: ['balance'] },
    ];
    const openMethod = vi.spyOn(ctl, 'openMethod').mockResolvedValue(undefined);

    await ctl.findClass('Account', 7, 'Legacy', { selector: 'balance', isMeta: false });

    expect(revealClass).toHaveBeenCalledWith('Legacy', 4, 'Account', {
      revealMethod: { selector: 'balance', isMeta: false },
    });
    const opened = openMethod.mock.calls[0][0];
    expect(opened.info.selector).toBe('balance');
    expect(opened.isMeta).toBe(false);
  });

  it('warns instead of opening when the class does not implement the method', async () => {
    vi.mocked(getAllClassNames).mockReturnValue(SHADOWED);
    const ctl = makeController();
    stubRevealClass(ctl);
    (ctl as unknown as { envLines: unknown }).envLines = [];
    const openMethod = vi.spyOn(ctl, 'openMethod').mockResolvedValue(undefined);

    await ctl.findClass('Account', 7, 'Legacy', { selector: 'balance', isMeta: false });

    expect(openMethod).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('#balance'),
    );
  });

  it('opens nothing when the cascade could not reach the class', async () => {
    // revealClass warns and leaves state untouched on a failed query; reading the
    // method list then would read the PREVIOUS class's selectors.
    vi.mocked(getAllClassNames).mockReturnValue(SHADOWED);
    const ctl = makeController();
    (ctl as unknown as { revealClass: unknown }).revealClass = vi.fn(() => Promise.resolve());
    (ctl as unknown as { envLines: unknown }).envLines = [
      { isMeta: false, envId: 0, category: 'accessing', selectors: ['balance'] },
    ];
    const openMethod = vi.spyOn(ctl, 'openMethod').mockResolvedValue(undefined);

    await ctl.findClass('Account', 7, 'Legacy', { selector: 'balance', isMeta: false });

    expect(openMethod).not.toHaveBeenCalled();
  });
});
