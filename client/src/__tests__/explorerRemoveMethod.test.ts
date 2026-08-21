import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// Stub the query layer: removeMethod scans for senders and calls deleteMethod, and its
// refresh (reloadCurrentClassMethods) calls getClassEnvironments. None should reach a
// real GCI session in a unit test.
vi.mock('../browserQueries', () => ({
  canClassBeWritten: vi.fn(() => true),
  deleteMethod: vi.fn(() => 'Deleted: Array >> at:'),
  getClassEnvironments: vi.fn(() => []),
  sendersOf: vi.fn(() => []),
  hierarchyImplementorsOf: vi.fn(() => []),
}));
// The reference picker navigates a System Browser; the decision is covered in
// safeDelete.test.ts, so here it only has to not reach live wiring.
vi.mock('../methodResultsPicker', () => ({
  showMethodResults: vi.fn(),
  describeMethodResult: (r: { className: string; isMeta: boolean; selector: string }) =>
    `${r.className}${r.isMeta ? ' class' : ''} >> #${r.selector}`,
}));

import { ExplorerController, MethodItem } from '../gemstoneExplorer';
import * as queries from '../browserQueries';
import { window, __resetConfig, __setConfig } from '../__mocks__/vscode';
import type { SessionManager, ActiveSession } from '../sessionManager';
import type { MethodSearchResult } from '../queries/methodSearch';

/**
 * The Explorer's Remove Method action. Removal is guarded by a sender scan: a selector
 * nothing sends goes without a question (and says so afterwards), while one that still
 * has senders asks first and can show them. The query layer is stubbed; the live
 * counterpart is explorerRemoveMethod.integration.test.ts.
 */

type SelectorInfo = {
  selector: string;
  category: string;
  overrideBits: number;
  sessionBit: number;
};

const SESSION = { id: 1 } as ActiveSession;

function controllerFor(session: ActiveSession | undefined): ExplorerController {
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  ctl.state.className = 'Array';
  return ctl;
}

function makeController(): ExplorerController {
  return controllerFor(SESSION);
}

function methodItem(over: Partial<SelectorInfo> = {}, isMeta = false): MethodItem {
  const info: SelectorInfo = {
    selector: 'at:',
    category: 'accessing',
    overrideBits: 0,
    sessionBit: 0,
    ...over,
  };
  return new MethodItem(isMeta, info, info.category);
}

const sender = (over: Partial<MethodSearchResult> = {}): MethodSearchResult => ({
  dictName: 'UserGlobals',
  className: 'Caller',
  isMeta: false,
  selector: 'usesIt',
  category: 'accessing',
  environmentId: 0,
  ...over,
});

const deleteMethod = queries.deleteMethod as ReturnType<typeof vi.fn>;
const canClassBeWritten = queries.canClassBeWritten as ReturnType<typeof vi.fn>;
const sendersOf = queries.sendersOf as ReturnType<typeof vi.fn>;
const hierarchyImplementorsOf = queries.hierarchyImplementorsOf as ReturnType<typeof vi.fn>;
const showWarningMessage = window.showWarningMessage as ReturnType<typeof vi.fn>;
const showInformationMessage = window.showInformationMessage as ReturnType<typeof vi.fn>;
const showErrorMessage = window.showErrorMessage as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
  window.tabGroups.all = [];
  // clearAllMocks resets call history but not implementations; restore the query
  // defaults so a failure-path test's override can't leak into a shuffled neighbour.
  canClassBeWritten.mockReturnValue(true);
  deleteMethod.mockReturnValue('Deleted: Array >> at:');
  sendersOf.mockReturnValue([]);
  hierarchyImplementorsOf.mockReturnValue([]);
});

describe('ExplorerController.removeMethod — nothing sends the selector', () => {
  it('removes the method without asking', async () => {
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(deleteMethod).toHaveBeenCalledWith(SESSION, 'Array', false, 'at:', 1);
  });

  it('announces the removal so it is not silent', async () => {
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Removed method #at: from Array'),
    );
  });

  it('does not count the method itself as a surviving sender', async () => {
    // A recursive method sends its own selector; deleting it takes that send with it.
    sendersOf.mockReturnValue([sender({ className: 'Array', selector: 'at:' })]);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(deleteMethod).toHaveBeenCalled();
  });

  it('still tells the class side apart when discounting the method itself', async () => {
    // Same class and selector, but the instance side — deleting the class-side method
    // leaves this sender behind, so it must still count.
    sendersOf.mockReturnValue([sender({ className: 'Array', selector: 'new' })]);
    const ctl = makeController();

    await ctl.removeMethod(methodItem({ selector: 'new' }, true));

    expect(showWarningMessage).toHaveBeenCalled();
  });

  it('refreshes the method pane afterwards', async () => {
    const ctl = makeController();
    const refresh = vi.spyOn(ctl.methodProvider, 'refresh');

    await ctl.removeMethod(methodItem());

    expect(refresh).toHaveBeenCalled();
  });
});

describe('ExplorerController.removeMethod — the selector still has senders', () => {
  beforeEach(() => {
    sendersOf.mockReturnValue([sender()]);
  });

  it('asks the user to confirm before removing anything', async () => {
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Remove method #at: from Array'),
      expect.objectContaining({ modal: true }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('names the senders in the confirmation', async () => {
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage.mock.calls[0][1].detail).toContain('Caller >> #usesIt');
  });

  it('does not remove the method when the user dismisses the dialog', async () => {
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(deleteMethod).not.toHaveBeenCalled();
  });

  it('removes the method when the user chooses to remove it anyway', async () => {
    showWarningMessage.mockResolvedValue('Remove Anyway');
    const ctl = makeController();

    await ctl.removeMethod(methodItem({ selector: 'at:put:' }));

    expect(deleteMethod).toHaveBeenCalledWith(SESSION, 'Array', false, 'at:put:', 1);
  });

  it('does not announce a removal the user just confirmed', async () => {
    showWarningMessage.mockResolvedValue('Remove Anyway');
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showInformationMessage).not.toHaveBeenCalled();
  });

  it('names the class side in the prompt and removal for a class-side method', async () => {
    showWarningMessage.mockResolvedValue('Remove Anyway');
    const ctl = makeController();

    await ctl.removeMethod(methodItem({ selector: 'new' }, true));

    expect(showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Array class'),
      expect.objectContaining({ modal: true }),
      expect.anything(),
      expect.anything(),
    );
    expect(deleteMethod).toHaveBeenCalledWith(SESSION, 'Array', true, 'new', 1);
  });
});

describe('ExplorerController.removeMethod — the sender scan could not answer', () => {
  it('asks for confirmation rather than removing the method unasked', async () => {
    sendersOf.mockImplementation(() => {
      throw new Error('a SecurityError occurred');
    });
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).toHaveBeenCalled();
    expect(deleteMethod).not.toHaveBeenCalled();
  });
});

describe('ExplorerController.removeMethod — guards and failures', () => {
  it('does nothing without a selected session', async () => {
    const ctl = controllerFor(undefined);

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(deleteMethod).not.toHaveBeenCalled();
  });

  it('does nothing without a selected class', async () => {
    const ctl = makeController();
    ctl.state.className = undefined;

    await ctl.removeMethod(methodItem());

    expect(deleteMethod).not.toHaveBeenCalled();
  });

  it('warns and does not scan or remove when the class cannot be modified', async () => {
    canClassBeWritten.mockReturnValue(false);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('cannot be modified'));
    expect(sendersOf).not.toHaveBeenCalled();
    expect(deleteMethod).not.toHaveBeenCalled();
  });

  it('surfaces an error and does not refresh when the removal reports a failure status', async () => {
    deleteMethod.mockReturnValue('Selector not found: Array >> at:');
    const ctl = makeController();
    const refresh = vi.spyOn(ctl.methodProvider, 'refresh');

    await ctl.removeMethod(methodItem());

    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Selector not found'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not announce a removal that failed', async () => {
    deleteMethod.mockReturnValue('Selector not found: Array >> at:');
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showInformationMessage).not.toHaveBeenCalled();
  });

  it('surfaces an error and does not refresh when the removal query raises', async () => {
    deleteMethod.mockImplementation(() => {
      throw new Error('a SecurityError occurred');
    });
    const ctl = makeController();
    const refresh = vi.spyOn(ctl.methodProvider, 'refresh');

    await ctl.removeMethod(methodItem());

    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('a SecurityError'));
    expect(refresh).not.toHaveBeenCalled();
  });
});

// A method can live in more than one environment, so the sender scan sweeps 0..maxEnvironment
// the way the Senders and Implementors commands do. A scan that looked only at environment 0
// would report "nothing sends this" for a method whose only sender lives higher up, and delete
// it without asking — the one outcome safe delete exists to prevent.
describe('ExplorerController.removeMethod — scanning every environment', () => {
  it('looks only in environment 0 by default', async () => {
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(sendersOf).toHaveBeenCalledTimes(1);
    expect(sendersOf).toHaveBeenCalledWith(SESSION, 'at:', 0);
  });

  it('sweeps every environment the user has asked to see', async () => {
    __setConfig('gemstone', 'maxEnvironment', 2);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(sendersOf.mock.calls.map((c) => c[2])).toEqual([0, 1, 2]);
  });

  it('asks about a sender that exists only in a higher environment', async () => {
    __setConfig('gemstone', 'maxEnvironment', 1);
    sendersOf.mockImplementation((_s: unknown, _sel: string, env: number) =>
      env === 1 ? [sender()] : [],
    );
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).toHaveBeenCalled();
    expect(deleteMethod).not.toHaveBeenCalled();
  });

  it('counts a method found in several environments once', async () => {
    __setConfig('gemstone', 'maxEnvironment', 2);
    sendersOf.mockReturnValue([sender()]);
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage.mock.calls[0][1].detail).toContain('1 method still references it');
  });
});

// Removing an override is the common case and it breaks nothing: every send that resolved
// here resolves to the inherited implementation instead. Asking the image for senders of the
// selector would list every unrelated sender of a name like #printOn: -- hundreds of methods
// that were never at risk -- and cost a whole-image walk to do it.
describe('ExplorerController.removeMethod — the selector is still implemented above', () => {
  const inherited = (className: string) => [
    {
      dictName: 'Globals',
      className,
      isMeta: false,
      selector: 'at:',
      category: 'accessing',
      environmentId: 0,
    },
  ];

  it('removes the override without asking', async () => {
    hierarchyImplementorsOf.mockReturnValue(inherited('Object'));
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(deleteMethod).toHaveBeenCalled();
  });

  it('does not walk the image looking for senders', async () => {
    hierarchyImplementorsOf.mockReturnValue(inherited('Object'));
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(sendersOf).not.toHaveBeenCalled();
  });

  it('says where the senders now resolve rather than that nothing referenced it', async () => {
    hierarchyImplementorsOf.mockReturnValue(inherited('Object'));
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('senders now resolve to Object >> #at:'),
    );
  });

  it('names the nearest ancestor when several implement it', async () => {
    // hierarchyImplementorsOf answers immediate-superclass first.
    hierarchyImplementorsOf.mockReturnValue([...inherited('Collection'), ...inherited('Object')]);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('resolve to Collection >> #at:'),
    );
  });

  it('asks about senders when nothing above implements it', async () => {
    hierarchyImplementorsOf.mockReturnValue([]);
    sendersOf.mockReturnValue([sender()]);
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(sendersOf).toHaveBeenCalled();
    expect(showWarningMessage).toHaveBeenCalled();
  });

  it('falls back to the sender scan when the hierarchy probe fails', async () => {
    // Failing to find an implementor above only costs a question; it can never turn into a
    // wrong silent delete.
    hierarchyImplementorsOf.mockImplementation(() => {
      throw new Error('boom');
    });
    sendersOf.mockReturnValue([sender()]);
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(sendersOf).toHaveBeenCalled();
    expect(showWarningMessage).toHaveBeenCalled();
  });

  it('asks the hierarchy about the same side the method is on', async () => {
    hierarchyImplementorsOf.mockReturnValue([]);
    const ctl = makeController();

    await ctl.removeMethod(methodItem({ selector: 'new' }, true));

    expect(hierarchyImplementorsOf).toHaveBeenCalledWith(SESSION, 1, 'Array', 'new', true, 'up');
  });
});
