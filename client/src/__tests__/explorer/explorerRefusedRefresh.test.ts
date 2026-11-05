import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', async (orig) => ({
  ...(await orig()),
  getDictionaryNames: vi.fn(),
  getClassesWithCategory: vi.fn(),
  getClassEnvironments: vi.fn(),
  getClassHierarchy: vi.fn(),
  getDefinedInstVarCounts: vi.fn(),
  getDefinedClassVarCounts: vi.fn(),
  getClassVersions: vi.fn(),
  classRowContents: vi.fn(),
}));

import { ExplorerController, ClassItem } from '../../gemstoneExplorer';
import {
  BrowserQueryError,
  getDictionaryNames,
  getClassesWithCategory,
  getClassEnvironments,
  getClassHierarchy,
  getDefinedInstVarCounts,
  getDefinedClassVarCounts,
  getClassVersions,
  classRowContents,
} from '../../browserQueries';
import { GCI_ERR_OP_IN_PROGRESS } from '../../gciConstants';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const busy = () => new BrowserQueryError('busy', GCI_ERR_OP_IN_PROGRESS);
let sessionBusy = false;
const unlessBusy =
  <T>(answer: () => T) =>
  () => {
    if (sessionBusy) throw busy();
    return answer();
  };

beforeEach(() => {
  vi.clearAllMocks();
  sessionBusy = false;
  vi.mocked(getDictionaryNames).mockImplementation(unlessBusy(() => ['UserGlobals']));
  vi.mocked(getClassesWithCategory).mockImplementation(
    unlessBusy(() => [{ className: 'Alpha', category: 'Kernel', hasComment: false }]),
  );
  vi.mocked(getClassEnvironments).mockImplementation(unlessBusy(() => []));
  vi.mocked(getClassHierarchy).mockImplementation(
    unlessBusy(() => [
      {
        className: 'Alpha',
        dictName: 'UserGlobals',
        kind: 'self' as const,
        binding: 'bound' as const,
      },
    ]),
  );
  vi.mocked(getDefinedInstVarCounts).mockImplementation(unlessBusy(() => new Map([['Alpha', 1]])));
  vi.mocked(getDefinedClassVarCounts).mockImplementation(unlessBusy(() => new Map()));
  vi.mocked(getClassVersions).mockImplementation(unlessBusy(() => new Map()));
  vi.mocked(classRowContents).mockResolvedValue({
    instVarNames: ['a'],
    classVarNames: [],
    ivarsCanMoveDown: false,
  });
});

function controllerOnAlpha(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.selectDict({ dictName: 'UserGlobals', dictIndex: 1 });
  ctl.selectClass(new ClassItem('Alpha'), false);
  return ctl;
}

describe('refreshing while the session is busy', () => {
  it('keeps the Hierarchy pane', async () => {
    const ctl = controllerOnAlpha();
    sessionBusy = true;

    await ctl.refreshRetainingSelection({ reveal: false });

    expect(ctl.hierarchyChildren()).toHaveLength(1);
  });

  it("keeps the class rows' expand arrows", async () => {
    const ctl = controllerOnAlpha();
    sessionBusy = true;

    await ctl.refreshRetainingSelection({ reveal: false });

    expect(ctl.classHasDefinedVars('Alpha')).toBe(true);
  });

  it("keeps the class rows' expand arrows when only their details are refused", async () => {
    const ctl = controllerOnAlpha();
    vi.mocked(getDefinedInstVarCounts).mockImplementation(() => {
      throw busy();
    });

    await ctl.refreshRetainingSelection({ reveal: false });

    expect(ctl.classHasDefinedVars('Alpha')).toBe(true);
  });

  it("reads an expanded class's variables again the next time it is expanded", async () => {
    const ctl = controllerOnAlpha();
    await ctl.classRow('Alpha');
    sessionBusy = true;
    await ctl.refreshRetainingSelection({ reveal: false });
    sessionBusy = false;

    await ctl.classRow('Alpha');

    expect(classRowContents).toHaveBeenCalledTimes(2);
  });
});

describe('refreshing when the hierarchy fails for another reason', () => {
  it('empties the Hierarchy pane', async () => {
    const ctl = controllerOnAlpha();
    vi.mocked(getClassHierarchy).mockImplementation(() => {
      throw new BrowserQueryError('no such class');
    });

    await ctl.refreshRetainingSelection({ reveal: false });

    expect(ctl.hierarchyChildren()).toEqual([]);
  });
});
