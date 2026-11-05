import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', async (orig) => ({
  ...(await orig()),
  getClassEnvironments: vi.fn(),
  getClassHierarchy: vi.fn(),
}));

import { ExplorerController, ClassItem } from '../../gemstoneExplorer';
import { BrowserQueryError, getClassEnvironments, getClassHierarchy } from '../../browserQueries';
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
  vi.mocked(getClassEnvironments).mockImplementation((_s, _d, className) => {
    if (sessionBusy) throw busy();
    return methodsOf(className);
  });
  vi.mocked(getClassHierarchy).mockImplementation((_s, className) => {
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

describe('a class click while the session is busy', () => {
  it('leaves the previous class and its methods selected', () => {
    const { ctl } = controllerOnClass('Alpha');
    sessionBusy = true;

    ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(ctl.state.className).toBe('Alpha');
    expect(ctl.methodCategories(false).map((c) => c.label)).toContain('Alpha methods');
  });

  it('moves the highlight back to the previous class', () => {
    const { ctl, klass } = controllerOnClass('Alpha');
    sessionBusy = true;

    ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(klass.reveal).toHaveBeenCalledTimes(1);
    expect(klass.reveal.mock.calls[0][0]).toMatchObject({ className: 'Alpha' });
  });

  it('lets the same class be clicked again once the session is free', () => {
    const { ctl } = controllerOnClass('Alpha');
    sessionBusy = true;
    ctl.handleClassClick('Beta');
    sessionBusy = false;

    ctl.handleClassClick('Beta');

    expect(ctl.state.className).toBe('Beta');
    expect(ctl.methodCategories(false).map((c) => c.label)).toContain('Beta methods');
  });

  it("keeps the previous class when only the hierarchy can't be read", () => {
    const { ctl } = controllerOnClass('Alpha');
    vi.mocked(getClassHierarchy).mockImplementation(() => {
      throw busy();
    });

    ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(ctl.state.className).toBe('Alpha');
  });
});

describe('a class click that fails once the class is selected', () => {
  it('reports the failure instead of hiding it', () => {
    const { ctl, klass } = controllerOnClass('Alpha');
    failTitleUpdates(klass);

    expect(() => ctl.selectClassFromTree(new ClassItem('Beta'))).toThrow('title update failed');
  });

  it('leaves the highlight on the clicked class', () => {
    const { ctl, klass } = controllerOnClass('Alpha');
    failTitleUpdates(klass);

    expect(() => ctl.selectClassFromTree(new ClassItem('Beta'))).toThrow();

    expect(klass.reveal).not.toHaveBeenCalled();
  });
});

describe('a class click whose methods fail to parse', () => {
  it('keeps the previous class and reports the failure', () => {
    const { ctl } = controllerOnClass('Alpha');
    vi.mocked(getClassEnvironments).mockImplementation(() => {
      throw new TypeError('unexpected reply');
    });

    expect(() => ctl.selectClassFromTree(new ClassItem('Beta'))).toThrow('unexpected reply');

    expect(ctl.state.className).toBe('Alpha');
  });
});

describe('a class click whose hierarchy fails for another reason', () => {
  it('selects the class with an empty hierarchy', () => {
    const { ctl } = controllerOnClass('Alpha');
    vi.mocked(getClassHierarchy).mockImplementation(() => {
      throw new BrowserQueryError('no such class');
    });

    ctl.selectClassFromTree(new ClassItem('Beta'));

    expect(ctl.state.className).toBe('Beta');
    expect(ctl.hierarchyChildren()).toEqual([]);
  });
});
