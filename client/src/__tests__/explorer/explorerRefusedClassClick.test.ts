import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', async (orig) => ({
  ...(await orig()),
  getClassEnvironments: vi.fn(),
  getClassHierarchy: vi.fn(),
  getClassEnvironmentsAsync: vi.fn(),
  getClassHierarchyAsync: vi.fn(),
}));
vi.mock('../../gciLog', async (orig) => ({
  ...(await orig()),
  logWarning: vi.fn(),
}));

import { ExplorerController, ClassItem } from '../../gemstoneExplorer';
import {
  BrowserQueryError,
  getClassEnvironments,
  getClassEnvironmentsAsync,
  getClassHierarchy,
  getClassHierarchyAsync,
} from '../../browserQueries';
import { logWarning } from '../../gciLog';
import { GCI_ERR_OP_IN_PROGRESS } from '../../gciConstants';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import { fakeViews } from '../helpers/explorerContainerFocus';

const methodsOf = (className: string) => [
  { isMeta: false, envId: 0, category: `${className} methods`, selectors: ['foo'] },
];
const hierarchyOf = (className: string) => [
  { className, dictName: 'UserGlobals', kind: 'self' as const, binding: 'bound' as const },
];
const busy = () => new BrowserQueryError('busy', GCI_ERR_OP_IN_PROGRESS);

let sessionBusy = false;

beforeEach(() => {
  vi.clearAllMocks();
  sessionBusy = false;
  vi.mocked(getClassEnvironments).mockImplementation((_s, _d, className) => methodsOf(className));
  vi.mocked(getClassHierarchy).mockImplementation((_s, className) => hierarchyOf(className));
  vi.mocked(getClassEnvironmentsAsync).mockImplementation(async (_s, _d, className) => {
    if (sessionBusy) throw busy();
    return methodsOf(className);
  });
  vi.mocked(getClassHierarchyAsync).mockImplementation(async (_s, className) => {
    if (sessionBusy) throw busy();
    return hierarchyOf(className);
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

// Holds back the methods of `className` until the test answers them.
function methodsHeldBack(className: string) {
  let answer!: (lines: ReturnType<typeof methodsOf>) => void;
  let refuse!: (e: unknown) => void;
  const held = new Promise<ReturnType<typeof methodsOf>>((resolve, reject) => {
    answer = resolve;
    refuse = reject;
  });
  const others = vi.mocked(getClassEnvironmentsAsync).getMockImplementation()!;
  vi.mocked(getClassEnvironmentsAsync).mockImplementation((s, d, name, max) =>
    name === className ? held : others(s, d, name, max),
  );
  return { answer: () => answer(methodsOf(className)), refuse: () => refuse(busy()) };
}

// Lets clicks the test didn't await (the row command's) finish.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const methodsReadFor = () => vi.mocked(getClassEnvironmentsAsync).mock.calls.map((c) => c[2]);
const hierarchyReadFor = () => vi.mocked(getClassHierarchyAsync).mock.calls.map((c) => c[1]);

function controllerOnClass(className: string) {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const views = fakeViews();
  const { klass } = views;
  ctl.setViews(views as never);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  ctl.selectClass(new ClassItem(className), false);
  klass.reveal.mockClear();
  return { ctl, klass };
}

describe('a class click', () => {
  it('selects the class once its reads answer', async () => {
    const { ctl } = controllerOnClass('Alpha');

    await ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(ctl.state.className).toBe('Beta');
    expect(ctl.methodCategories(false).map((c) => c.label)).toContain('Beta methods');
  });

  it('reads the class without a call that blocks VS Code', async () => {
    const { ctl } = controllerOnClass('Alpha');
    vi.mocked(getClassEnvironments).mockClear();
    vi.mocked(getClassHierarchy).mockClear();

    await ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(getClassEnvironments).not.toHaveBeenCalled();
    expect(getClassHierarchy).not.toHaveBeenCalled();
  });

  it('reads the class once when VS Code reports the click twice', async () => {
    const { ctl } = controllerOnClass('Alpha');

    ctl.handleClassClick('Beta');
    await ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(methodsReadFor()).toEqual(['Beta']);
  });
});

describe('a class click while the session is busy', () => {
  it('leaves the previous class and its methods selected', async () => {
    const { ctl } = controllerOnClass('Alpha');
    sessionBusy = true;

    await ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(ctl.state.className).toBe('Alpha');
    expect(ctl.methodCategories(false).map((c) => c.label)).toContain('Alpha methods');
  });

  it('moves the highlight back to the previous class', async () => {
    const { ctl, klass } = controllerOnClass('Alpha');
    sessionBusy = true;

    await ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(klass.reveal).toHaveBeenCalledTimes(1);
    expect(klass.reveal.mock.calls[0][0]).toMatchObject({ className: 'Alpha' });
  });

  it('lets the same class be clicked again once the session is free', async () => {
    const { ctl } = controllerOnClass('Alpha');
    sessionBusy = true;
    ctl.handleClassClick('Beta');
    await settle();
    sessionBusy = false;

    ctl.handleClassClick('Beta');
    await settle();

    expect(ctl.state.className).toBe('Beta');
    expect(ctl.methodCategories(false).map((c) => c.label)).toContain('Beta methods');
  });

  it("keeps the previous class when only the hierarchy can't be read", async () => {
    const { ctl } = controllerOnClass('Alpha');
    vi.mocked(getClassHierarchyAsync).mockRejectedValue(busy());

    await ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(ctl.state.className).toBe('Alpha');
  });

  it('does not log the refusal again', async () => {
    const { ctl } = controllerOnClass('Alpha');
    sessionBusy = true;

    await ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(logWarning).not.toHaveBeenCalled();
  });
});

describe('clicks made before the previous one answers', () => {
  it('select only the last class clicked', async () => {
    const { ctl } = controllerOnClass('Alpha');
    const beta = methodsHeldBack('Beta');
    const first = ctl.selectClassFromTree(new ClassItem('Beta'));
    await settle();
    const second = ctl.selectClassFromTree(new ClassItem('Gamma'));

    beta.answer();
    await Promise.all([first, second]);

    expect(ctl.state.className).toBe('Gamma');
    expect(ctl.methodCategories(false).map((c) => c.label)).toContain('Gamma methods');
  });

  it('skip the reads a replaced click has not started', async () => {
    const { ctl } = controllerOnClass('Alpha');
    const beta = methodsHeldBack('Beta');
    const first = ctl.selectClassFromTree(new ClassItem('Beta'));
    await settle();
    const later = [
      ctl.selectClassFromTree(new ClassItem('Gamma')),
      ctl.selectClassFromTree(new ClassItem('Delta')),
    ];

    beta.answer();
    await Promise.all([first, ...later]);

    expect(methodsReadFor()).toEqual(['Beta', 'Delta']);
    expect(hierarchyReadFor()).toEqual(['Delta']);
  });

  it('keep a jump made while a click waits', async () => {
    const { ctl } = controllerOnClass('Alpha');
    const beta = methodsHeldBack('Beta');
    const click = ctl.selectClassFromTree(new ClassItem('Beta'));
    await settle();
    ctl.selectClass(new ClassItem('Gamma'), false);

    beta.answer();
    await click;

    expect(ctl.state.className).toBe('Gamma');
  });

  it('are dropped when the Explorer resets for another session', async () => {
    const { ctl } = controllerOnClass('Alpha');
    const beta = methodsHeldBack('Beta');
    const click = ctl.selectClassFromTree(new ClassItem('Beta'));
    await settle();
    vi.spyOn(ctl, 'session').mockReturnValue(undefined);
    ctl.reset();

    beta.answer();
    await click;

    expect(ctl.state.className).toBeUndefined();
  });

  it('keep the selected class when the user clicks back to it', async () => {
    const { ctl } = controllerOnClass('Alpha');
    const beta = methodsHeldBack('Beta');
    const click = ctl.selectClassFromTree(new ClassItem('Beta'));
    await settle();
    await ctl.selectClassFromTree(new ClassItem('Alpha'));

    beta.answer();
    await click;

    expect(ctl.state.className).toBe('Alpha');
  });

  it('leave the highlight to the later click when the replaced one is refused', async () => {
    const { ctl, klass } = controllerOnClass('Alpha');
    const beta = methodsHeldBack('Beta');
    const first = ctl.selectClassFromTree(new ClassItem('Beta'));
    await settle();
    const second = ctl.selectClassFromTree(new ClassItem('Gamma'));

    beta.refuse();
    await Promise.all([first, second]);

    expect(ctl.state.className).toBe('Gamma');
    expect(klass.reveal).not.toHaveBeenCalled();
  });
});

describe('a class click that fails once the class is selected', () => {
  it('logs the failure instead of hiding it', async () => {
    const { ctl, klass } = controllerOnClass('Alpha');
    failTitleUpdates(klass);

    await ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(logWarning).toHaveBeenCalledWith(expect.stringContaining('title update failed'));
  });

  it('leaves the highlight on the clicked class', async () => {
    const { ctl, klass } = controllerOnClass('Alpha');
    failTitleUpdates(klass);

    await ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(klass.reveal).not.toHaveBeenCalled();
  });
});

describe('a class click whose methods fail to parse', () => {
  it('keeps the previous class and logs the failure', async () => {
    const { ctl } = controllerOnClass('Alpha');
    vi.mocked(getClassEnvironmentsAsync).mockRejectedValue(new TypeError('unexpected reply'));

    await ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(ctl.state.className).toBe('Alpha');
    expect(logWarning).toHaveBeenCalledWith(expect.stringContaining('unexpected reply'));
  });
});

describe('a class click whose hierarchy fails for another reason', () => {
  it('selects the class with an empty hierarchy', async () => {
    const { ctl } = controllerOnClass('Alpha');
    vi.mocked(getClassHierarchyAsync).mockRejectedValue(new BrowserQueryError('no such class'));

    await ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(ctl.state.className).toBe('Beta');
    expect(ctl.hierarchyChildren()).toEqual([]);
  });
});
