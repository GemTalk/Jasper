import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', async (orig) => ({
  ...(await orig()),
  getClassesWithCategory: vi.fn(),
  getDefinedInstVarCounts: vi.fn(),
  getDefinedClassVarCounts: vi.fn(),
  getClassVersions: vi.fn(),
}));

import { window } from '../../__mocks__/vscode';
import { ExplorerController } from '../../gemstoneExplorer';
import {
  BrowserQueryError,
  getClassesWithCategory,
  getDefinedInstVarCounts,
  getDefinedClassVarCounts,
  getClassVersions,
} from '../../browserQueries';
import { GCI_ERR_OP_IN_PROGRESS } from '../../gciConstants';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import { fakeViews } from '../helpers/explorerContainerFocus';

type DictRow = Parameters<ExplorerController['selectDict']>[0];
const dictRow = (dictName: string, dictIndex: number) => ({ dictName, dictIndex }) as DictRow;
const ALPHA = dictRow('AlphaDict', 1);
const BETA = dictRow('BetaDict', 2);
const classesOf = (dictIndex: number) => [
  { className: `Class${dictIndex}`, category: `Category${dictIndex}`, hasComment: false },
];
const busy = () => new BrowserQueryError('busy', GCI_ERR_OP_IN_PROGRESS);

let sessionBusy = false;

beforeEach(() => {
  vi.clearAllMocks();
  sessionBusy = false;
  vi.mocked(getClassesWithCategory).mockImplementation((_s, dictIndex) => {
    if (sessionBusy) throw busy();
    return classesOf(dictIndex as number);
  });
  vi.mocked(getDefinedInstVarCounts).mockImplementation((_s, dictIndex) => {
    if (sessionBusy) throw busy();
    return new Map([[`Class${String(dictIndex)}`, 1]]);
  });
  vi.mocked(getDefinedClassVarCounts).mockImplementation(() => {
    if (sessionBusy) throw busy();
    return new Map();
  });
  vi.mocked(getClassVersions).mockImplementation(() => {
    if (sessionBusy) throw busy();
    return new Map();
  });
});

// Makes the panes' header update throw, the last step of a click once the new selection
// is in place.
function failTitleUpdates(view: { description: string }) {
  Object.defineProperty(view, 'description', {
    set() {
      throw new Error('title update failed');
    },
  });
}

function controllerOnAlpha() {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const views = fakeViews();
  const { dict } = views;
  ctl.setViews(views as never);
  ctl.selectDict(ALPHA);
  dict.reveal.mockClear();
  return { ctl, dict };
}

describe('a dictionary click while the session is busy', () => {
  it('leaves the previous dictionary and its classes selected', () => {
    const { ctl } = controllerOnAlpha();
    sessionBusy = true;

    ctl.selectDictFromTree(BETA);

    expect(ctl.state.dictName).toBe('AlphaDict');
    expect(ctl.filteredCategoryPaths()).toEqual(['Category1']);
    expect(ctl.classHasDefinedVars('Class1')).toBe(true);
  });

  it('keeps a class category the user created but has not filed a class into', async () => {
    const { ctl } = controllerOnAlpha();
    vi.mocked(window.showInputBox).mockResolvedValue('Drafts');
    await ctl.newClassCategory();
    sessionBusy = true;

    ctl.selectDictFromTree(BETA);

    expect(ctl.filteredCategoryPaths()).toContain('Drafts');
  });

  it("keeps the Classes pane's filter", () => {
    const { ctl } = controllerOnAlpha();
    (ctl as unknown as { setFilterState: (view: string, p: string) => void }).setFilterState(
      'gemstoneExplorerClasses',
      'Cla',
    );
    sessionBusy = true;

    ctl.selectDictFromTree(BETA);

    expect(ctl.getFilter('gemstoneExplorerClasses')).toBe('Cla');
  });

  it('moves the highlight back to the previous dictionary', () => {
    const { ctl, dict } = controllerOnAlpha();
    sessionBusy = true;

    ctl.selectDictFromTree(BETA);

    expect(dict.reveal).toHaveBeenCalledTimes(1);
    expect(dict.reveal.mock.calls[0][0]).toMatchObject({ dictName: 'AlphaDict', dictIndex: 1 });
  });

  it("keeps the previous dictionary when only the class rows' details are refused", () => {
    const { ctl } = controllerOnAlpha();
    vi.mocked(getClassVersions).mockImplementation(() => {
      throw busy();
    });

    ctl.selectDictFromTree(BETA);

    expect(ctl.state.dictName).toBe('AlphaDict');
  });
});

describe('a dictionary click whose class row details fail for another reason', () => {
  it('selects the dictionary with plain class rows', () => {
    const { ctl } = controllerOnAlpha();
    vi.mocked(getDefinedInstVarCounts).mockImplementation(() => {
      throw new BrowserQueryError('no such dictionary');
    });

    ctl.selectDictFromTree(BETA);

    expect(ctl.state.dictName).toBe('BetaDict');
    expect(ctl.classHasDefinedVars('Class2')).toBe(false);
  });
});

describe('a dictionary click that fails once the dictionary is selected', () => {
  it('reports the failure and leaves the highlight on the clicked dictionary', () => {
    const { ctl, dict } = controllerOnAlpha();
    failTitleUpdates(dict);

    expect(() => ctl.selectDictFromTree(BETA)).toThrow('title update failed');

    expect(dict.reveal).not.toHaveBeenCalled();
  });
});

describe('highlighting the dictionary already selected', () => {
  it('keeps the category chosen under it', () => {
    const { ctl } = controllerOnAlpha();
    ctl.state.classCategory = 'Category1';

    ctl.selectDictFromTree(ALPHA);

    expect(ctl.state.classCategory).toBe('Category1');
  });
});
