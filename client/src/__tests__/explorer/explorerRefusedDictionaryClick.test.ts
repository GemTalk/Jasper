import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', async (orig) => ({
  ...(await orig()),
  getClassesWithCategory: vi.fn(),
  getDefinedInstVarCounts: vi.fn(),
  getDefinedClassVarCounts: vi.fn(),
  getClassVersions: vi.fn(),
  getClassesWithCategoryAsync: vi.fn(),
  getDefinedInstVarCountsAsync: vi.fn(),
  getDefinedClassVarCountsAsync: vi.fn(),
  getClassVersionsAsync: vi.fn(),
  getClassEnvironments: vi.fn(() => []),
  getClassHierarchy: vi.fn(() => []),
  getClassEnvironmentsAsync: vi.fn(),
  getClassHierarchyAsync: vi.fn(),
  getDictionaryNames: vi.fn(),
}));
vi.mock('../../gciLog', async (orig) => ({
  ...(await orig()),
  logWarning: vi.fn(),
}));

import { window } from '../../__mocks__/vscode';
import { ExplorerController, ClassItem, ClassCategoryItem } from '../../gemstoneExplorer';
import {
  BrowserQueryError,
  getClassesWithCategory,
  getDefinedInstVarCounts,
  getDefinedClassVarCounts,
  getClassVersions,
  getClassesWithCategoryAsync,
  getDefinedInstVarCountsAsync,
  getDefinedClassVarCountsAsync,
  getClassVersionsAsync,
  getClassEnvironmentsAsync,
  getClassHierarchyAsync,
  getDictionaryNames,
} from '../../browserQueries';
import { logWarning } from '../../gciLog';
import { GCI_ERR_OP_IN_PROGRESS } from '../../gciConstants';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import { fakeViews } from '../helpers/explorerContainerFocus';
import { settle } from '../helpers/explorerClicks';

type DictRow = Parameters<ExplorerController['selectDict']>[0];
const dictRow = (dictName: string, dictIndex: number) => ({ dictName, dictIndex }) as DictRow;
const ALPHA = dictRow('AlphaDict', 1);
const BETA = dictRow('BetaDict', 2);
const GAMMA = dictRow('GammaDict', 3);
const DELTA = dictRow('DeltaDict', 4);
const classesOf = (dictIndex: number) => [
  { className: `Class${dictIndex}`, category: `Category${dictIndex}`, hasComment: false },
];
const ivarCountsOf = (dictIndex: number) => new Map([[`Class${dictIndex}`, 1]]);
const busy = () => new BrowserQueryError('busy', GCI_ERR_OP_IN_PROGRESS);

let sessionBusy = false;

beforeEach(() => {
  vi.clearAllMocks();
  sessionBusy = false;
  vi.mocked(getClassesWithCategory).mockImplementation((_s, d) => classesOf(d as number));
  vi.mocked(getDefinedInstVarCounts).mockImplementation((_s, d) => ivarCountsOf(d as number));
  vi.mocked(getDefinedClassVarCounts).mockImplementation(() => new Map());
  vi.mocked(getClassVersions).mockImplementation(() => new Map());
  vi.mocked(getDictionaryNames).mockReturnValue(['AlphaDict', 'BetaDict']);
  vi.mocked(getClassesWithCategoryAsync).mockImplementation(async (_s, d) => {
    if (sessionBusy) throw busy();
    return classesOf(d as number);
  });
  vi.mocked(getDefinedInstVarCountsAsync).mockImplementation(async (_s, d) => {
    if (sessionBusy) throw busy();
    return ivarCountsOf(d as number);
  });
  vi.mocked(getDefinedClassVarCountsAsync).mockImplementation(async () => {
    if (sessionBusy) throw busy();
    return new Map();
  });
  vi.mocked(getClassVersionsAsync).mockImplementation(async () => {
    if (sessionBusy) throw busy();
    return new Map();
  });
  vi.mocked(getClassEnvironmentsAsync).mockImplementation(async () => {
    if (sessionBusy) throw busy();
    return [];
  });
  vi.mocked(getClassHierarchyAsync).mockImplementation(async () => {
    if (sessionBusy) throw busy();
    return [];
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

// Holds back the classes of dictionary `dictIndex` until the test answers them.
function classesHeldBack(dictIndex: number) {
  let answer!: (entries: ReturnType<typeof classesOf>) => void;
  let refuse!: (e: unknown) => void;
  const held = new Promise<ReturnType<typeof classesOf>>((resolve, reject) => {
    answer = resolve;
    refuse = reject;
  });
  const others = vi.mocked(getClassesWithCategoryAsync).getMockImplementation()!;
  vi.mocked(getClassesWithCategoryAsync).mockImplementation((s, d) =>
    d === dictIndex ? held : others(s, d),
  );
  return { answer: () => answer(classesOf(dictIndex)), refuse: (e: unknown = busy()) => refuse(e) };
}

// Holds back the methods of `className` until the test answers them.
function methodsHeldBack(className: string) {
  let answer!: () => void;
  const held = new Promise<[]>((resolve) => (answer = () => resolve([])));
  const others = vi.mocked(getClassEnvironmentsAsync).getMockImplementation()!;
  vi.mocked(getClassEnvironmentsAsync).mockImplementation((s, d, name, max) =>
    name === className ? held : others(s, d, name, max),
  );
  return { answer };
}

const classesReadFor = () => vi.mocked(getClassesWithCategoryAsync).mock.calls.map((c) => c[1]);
const versionsReadFor = () => vi.mocked(getClassVersionsAsync).mock.calls.map((c) => c[1]);

function controllerOnAlpha() {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const views = fakeViews();
  const { dict, klass } = views;
  ctl.setViews(views as never);
  ctl.selectDict(ALPHA);
  dict.reveal.mockClear();
  return { ctl, dict, klass };
}

describe('a dictionary click', () => {
  it('selects the dictionary once its reads answer', async () => {
    const { ctl } = controllerOnAlpha();

    await ctl.selectDictFromTree(BETA);

    expect(ctl.state.dictName).toBe('BetaDict');
    expect(ctl.filteredCategoryPaths()).toEqual(['Category2']);
    expect(ctl.classHasDefinedVars('Class2')).toBe(true);
  });

  it('reads the dictionary without a call that blocks VS Code', async () => {
    const { ctl } = controllerOnAlpha();
    vi.mocked(getClassesWithCategory).mockClear();
    vi.mocked(getDefinedInstVarCounts).mockClear();
    vi.mocked(getDefinedClassVarCounts).mockClear();
    vi.mocked(getClassVersions).mockClear();

    await ctl.selectDictFromTree(BETA);

    expect(getClassesWithCategory).not.toHaveBeenCalled();
    expect(getDefinedInstVarCounts).not.toHaveBeenCalled();
    expect(getDefinedClassVarCounts).not.toHaveBeenCalled();
    expect(getClassVersions).not.toHaveBeenCalled();
  });
});

describe('a dictionary click while the session is busy', () => {
  it('leaves the previous dictionary and its classes selected', async () => {
    const { ctl } = controllerOnAlpha();
    sessionBusy = true;

    await ctl.selectDictFromTree(BETA);

    expect(ctl.state.dictName).toBe('AlphaDict');
    expect(ctl.filteredCategoryPaths()).toEqual(['Category1']);
    expect(ctl.classHasDefinedVars('Class1')).toBe(true);
  });

  it('keeps a class category the user created but has not filed a class into', async () => {
    const { ctl } = controllerOnAlpha();
    vi.mocked(window.showInputBox).mockResolvedValue('Drafts');
    await ctl.newClassCategory();
    sessionBusy = true;

    await ctl.selectDictFromTree(BETA);

    expect(ctl.filteredCategoryPaths()).toContain('Drafts');
  });

  it("keeps the Classes pane's filter", async () => {
    const { ctl } = controllerOnAlpha();
    (ctl as unknown as { setFilterState: (view: string, p: string) => void }).setFilterState(
      'gemstoneExplorerClasses',
      'Cla',
    );
    sessionBusy = true;

    await ctl.selectDictFromTree(BETA);

    expect(ctl.getFilter('gemstoneExplorerClasses')).toBe('Cla');
  });

  it('moves the highlight back to the previous dictionary', async () => {
    const { ctl, dict } = controllerOnAlpha();
    sessionBusy = true;

    await ctl.selectDictFromTree(BETA);

    expect(dict.reveal).toHaveBeenCalledTimes(1);
    expect(dict.reveal.mock.calls[0][0]).toMatchObject({ dictName: 'AlphaDict', dictIndex: 1 });
  });

  it("keeps the previous dictionary when only the class rows' details are refused", async () => {
    const { ctl } = controllerOnAlpha();
    vi.mocked(getClassVersionsAsync).mockRejectedValue(busy());

    await ctl.selectDictFromTree(BETA);

    expect(ctl.state.dictName).toBe('AlphaDict');
  });

  it('does not log the refusal again', async () => {
    const { ctl } = controllerOnAlpha();
    sessionBusy = true;

    await ctl.selectDictFromTree(BETA);

    expect(logWarning).not.toHaveBeenCalled();
  });
});

describe('a dictionary click whose class row details fail for another reason', () => {
  it('selects the dictionary with plain class rows', async () => {
    const { ctl } = controllerOnAlpha();
    vi.mocked(getDefinedInstVarCountsAsync).mockRejectedValue(
      new BrowserQueryError('no such dictionary'),
    );

    await ctl.selectDictFromTree(BETA);

    expect(ctl.state.dictName).toBe('BetaDict');
    expect(ctl.classHasDefinedVars('Class2')).toBe(false);
  });
});

describe('a dictionary click that fails once the dictionary is selected', () => {
  it('logs the failure instead of hiding it', async () => {
    const { ctl, dict } = controllerOnAlpha();
    failTitleUpdates(dict);

    await ctl.selectDictFromTree(BETA);

    expect(logWarning).toHaveBeenCalledWith(expect.stringContaining('title update failed'));
  });

  it('leaves the highlight on the clicked dictionary', async () => {
    const { ctl, dict } = controllerOnAlpha();
    failTitleUpdates(dict);

    await ctl.selectDictFromTree(BETA);

    expect(dict.reveal).not.toHaveBeenCalled();
  });
});

describe('highlighting the dictionary already selected', () => {
  it('keeps the category chosen under it', async () => {
    const { ctl } = controllerOnAlpha();
    ctl.state.classCategory = 'Category1';

    await ctl.selectDictFromTree(ALPHA);

    expect(ctl.state.classCategory).toBe('Category1');
  });
});

describe('dictionary clicks made before the previous one answers', () => {
  it('select only the last dictionary clicked', async () => {
    const { ctl } = controllerOnAlpha();
    const beta = classesHeldBack(2);
    const first = ctl.selectDictFromTree(BETA);
    await settle();
    const second = ctl.selectDictFromTree(GAMMA);

    beta.answer();
    await Promise.all([first, second]);

    expect(ctl.state.dictName).toBe('GammaDict');
    expect(ctl.filteredCategoryPaths()).toEqual(['Category3']);
  });

  it('skip the reads a replaced click has not started', async () => {
    const { ctl } = controllerOnAlpha();
    const beta = classesHeldBack(2);
    const first = ctl.selectDictFromTree(BETA);
    await settle();
    const later = [ctl.selectDictFromTree(GAMMA), ctl.selectDictFromTree(DELTA)];

    beta.answer();
    await Promise.all([first, ...later]);

    expect(classesReadFor()).toEqual([2, 4]);
    expect(versionsReadFor()).toEqual([4]);
  });

  it('keep a jump made while a click waits', async () => {
    const { ctl } = controllerOnAlpha();
    const beta = classesHeldBack(2);
    const click = ctl.selectDictFromTree(BETA);
    await settle();
    ctl.selectDict(GAMMA);

    beta.answer();
    await click;

    expect(ctl.state.dictName).toBe('GammaDict');
  });

  it('are dropped when a refresh shifts the dictionaries', async () => {
    const { ctl } = controllerOnAlpha();
    const beta = classesHeldBack(BETA.dictIndex);
    const click = ctl.selectDictFromTree(BETA);
    await settle();
    vi.mocked(getDictionaryNames).mockReturnValue(['Other', 'AlphaDict', 'BetaDict']);
    await ctl.refreshRetainingSelection();

    beta.answer();
    await click;

    expect(ctl.state.dictName).toBe('AlphaDict');
    expect(versionsReadFor()).toEqual([]);
  });

  it('keep a class category chosen while a click waits', async () => {
    const { ctl } = controllerOnAlpha();
    const beta = classesHeldBack(2);
    const click = ctl.selectDictFromTree(BETA);
    await settle();
    ctl.selectClassCategory(new ClassCategoryItem('Kernel', 'Kernel', false));

    beta.answer();
    await click;

    expect(ctl.state.dictName).toBe('AlphaDict');
    expect(ctl.state.classCategory).toBe('Kernel');
  });

  it('leave the highlight to the later click when the replaced one is refused', async () => {
    const { ctl, dict } = controllerOnAlpha();
    const beta = classesHeldBack(2);
    const first = ctl.selectDictFromTree(BETA);
    await settle();
    const second = ctl.selectDictFromTree(GAMMA);

    beta.refuse();
    await Promise.all([first, second]);

    expect(ctl.state.dictName).toBe('GammaDict');
    expect(dict.reveal).not.toHaveBeenCalled();
  });
});

describe('a dictionary click replaced by a class click from the old list', () => {
  it('moves the dictionary highlight back and selects the class under the old dictionary', async () => {
    const { ctl, dict } = controllerOnAlpha();
    const beta = classesHeldBack(2);
    const dictClick = ctl.selectDictFromTree(BETA);
    await settle();
    const classClick = ctl.selectClassFromTree(new ClassItem('Class1'));

    beta.answer();
    await Promise.all([dictClick, classClick]);

    expect(ctl.state.dictName).toBe('AlphaDict');
    expect(ctl.state.className).toBe('Class1');
    expect(dict.reveal).toHaveBeenCalledTimes(1);
    expect(dict.reveal.mock.calls[0][0]).toMatchObject({ dictName: 'AlphaDict', dictIndex: 1 });
  });
});

describe('a class click replaced by a dictionary click', () => {
  it('moves the class highlight back and selects the new dictionary', async () => {
    const { ctl, klass } = controllerOnAlpha();
    ctl.selectClass(new ClassItem('Class1'), false);
    klass.reveal.mockClear();
    const other = methodsHeldBack('Other');
    const classClick = ctl.selectClassFromTree(new ClassItem('Other'));
    await settle();
    const dictClick = ctl.selectDictFromTree(BETA);

    other.answer();
    await Promise.all([classClick, dictClick]);

    expect(ctl.state.dictName).toBe('BetaDict');
    expect(klass.reveal).toHaveBeenCalledTimes(1);
    expect(klass.reveal.mock.calls[0][0]).toMatchObject({ className: 'Class1' });
  });
});

describe('a dictionary click whose session the user leaves before it answers', () => {
  it('does not log its failure', async () => {
    const { ctl } = controllerOnAlpha();
    const beta = classesHeldBack(BETA.dictIndex);
    const click = ctl.selectDictFromTree(BETA);
    await settle();
    vi.spyOn(ctl, 'session').mockReturnValue(undefined);
    ctl.reset();

    beta.refuse(new Error('The GemStone session ended while this call was still running.'));
    await click;

    expect(logWarning).not.toHaveBeenCalled();
  });
});
