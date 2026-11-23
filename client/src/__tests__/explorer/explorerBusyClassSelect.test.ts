import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', async (orig) => ({
  ...(await orig()),
  getClassEnvironments: vi.fn(),
  getClassHierarchy: vi.fn(() => []),
  getMethodInstVarAccess: vi.fn(),
}));

import { window } from '../../__mocks__/vscode';
import { ExplorerController, ClassItem } from '../../gemstoneExplorer';
import {
  BrowserQueryError,
  getClassEnvironments,
  getMethodInstVarAccess,
} from '../../browserQueries';
import { GCI_ERR_OP_IN_PROGRESS } from '../../gciConstants';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import { fakeViews } from '../helpers/explorerContainerFocus';

const VIEW_METHODS = 'gemstoneExplorerMethods';
const busy = () => new BrowserQueryError('busy', GCI_ERR_OP_IN_PROGRESS);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClassEnvironments).mockReturnValue([]);
  vi.mocked(getMethodInstVarAccess).mockReturnValue([]);
});

// Selected on Alpha; any later class read is refused with `failure`.
function controllerOnAlpha(failure: () => Error) {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const views = fakeViews();
  ctl.setViews(views as never);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  ctl.selectClass(new ClassItem('Alpha'), false);
  const fail = () => {
    throw failure();
  };
  vi.mocked(getClassEnvironments).mockImplementation(fail);
  vi.mocked(getMethodInstVarAccess).mockImplementation(fail);
  return { ctl, views };
}

describe('filtering methods by an instance variable while a run holds the session', () => {
  it.each([
    ['another class', 'Beta'],
    ['the selected class', 'Alpha'],
  ])('stops after the busy notice for a variable of %s, changing nothing', (_, className) => {
    const { ctl } = controllerOnAlpha(busy);
    ctl.setMethodSide(true);
    (ctl as unknown as { filters: Map<string, string> }).filters.set(VIEW_METHODS, 'size');

    expect(() => ctl.filterMethodsByIvar('reads', 'count', className)).not.toThrow();

    expect(ctl.state.className).toBe('Alpha');
    expect(ctl.getFilter(VIEW_METHODS)).toBe('size');
    expect(ctl.showClassMethods).toBe(true);
  });

  it('still fails on a read error that is not a busy refusal', () => {
    const { ctl } = controllerOnAlpha(() => new BrowserQueryError('broken', 2101));

    expect(() => ctl.filterMethodsByIvar('reads', 'count', 'Beta')).toThrow('broken');
  });
});

describe('New Method on a highlighted class while a run holds the session', () => {
  function highlightBeta(ctl: ExplorerController, views: ReturnType<typeof fakeViews>) {
    (ctl as unknown as { classCategoryEntries: { className: string }[] }).classCategoryEntries = [
      { className: 'Beta' },
    ];
    ctl.state.className = undefined;
    views.klass.selection = [new ClassItem('Beta')];
  }

  it('stops after the busy notice, without asking for a class', async () => {
    const { ctl, views } = controllerOnAlpha(busy);
    highlightBeta(ctl, views);

    await expect(ctl.newMethod()).resolves.toBeUndefined();

    expect(ctl.state.className).toBeUndefined();
    expect(window.showWarningMessage).not.toHaveBeenCalledWith('Select a class first.');
  });

  it('still fails on a read error that is not a busy refusal', async () => {
    const { ctl, views } = controllerOnAlpha(() => new BrowserQueryError('broken', 2101));
    highlightBeta(ctl, views);

    await expect(ctl.newMethod()).rejects.toThrow('broken');
  });
});
