import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// Stub the query layer: removeMethod scans for senders and calls deleteMethod, and its
// refresh (reloadCurrentClassMethods) calls getClassEnvironments. None should reach a
// real GCI session in a unit test.
vi.mock('../../browserQueries', () => ({
  canClassBeWritten: vi.fn(() => true),
  deleteMethod: vi.fn(() => 'Deleted: Array >> at:'),
  getClassEnvironments: vi.fn(() => []),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
  sendersOf: vi.fn(() => []),
  hierarchyImplementorsOf: vi.fn(() => []),
}));
// The undo recorder's one round trip, stubbed so the snapshot is data this test controls
// rather than a live doit (#434).
vi.mock('../../undo/queries/methodSlotQueries', () => ({
  captureMethodSlots: vi.fn(),
  applyMethodSlotOps: vi.fn(),
}));
// The reference picker navigates a System Browser; the decision is covered in
// safeDelete.test.ts, so here it only has to not reach live wiring.
vi.mock('../../methodResultsPicker', () => ({
  showMethodResults: vi.fn(),
  describeMethodResult: (r: { className: string; isMeta: boolean; selector: string }) =>
    `${r.className}${r.isMeta ? ' class' : ''} >> #${r.selector}`,
}));

import { ExplorerController, MethodItem } from '../../gemstoneExplorer';
import * as queries from '../../browserQueries';
import { window, __resetConfig, __setConfig } from '../../__mocks__/vscode';
import { captureMethodSlots } from '../../undo/queries/methodSlotQueries';
import { peekUndoEntry, resetUndoStacks } from '../../undo/undoStack';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import type { MethodSearchResult } from '../../queries/methodSearch';

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
const getClassEnvironments = queries.getClassEnvironments as ReturnType<typeof vi.fn>;
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
  getClassEnvironments.mockReturnValue([]);
  // clearAllMocks keeps implementations, so an undo capture stubbed by one describe would
  // otherwise leak into another and put a button on a notice that test asserts is plain.
  vi.mocked(captureMethodSlots).mockReset();
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

describe('removeMethod records an undo (#434)', () => {
  /**
   * The source only exists until the removal lands, so the capture has to straddle it. What
   * is pinned here is that ordering, that the entry is only recorded once GemStone has
   * actually confirmed the removal, and that a failed capture still leaves a working delete.
   */
  const present = (source: string, category: string) => ({ exists: true, source, category });

  beforeEach(() => {
    vi.clearAllMocks();
    resetUndoStacks();
    vi.mocked(captureMethodSlots).mockReset();
    (queries.deleteMethod as ReturnType<typeof vi.fn>).mockReturnValue('Deleted: Array >> at:');
    (window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Remove');
  });

  it('captures the source before the method is removed', () => {
    const order: string[] = [];
    vi.mocked(captureMethodSlots).mockImplementation(() => {
      order.push('capture');
      return [present('at: i\n  ^1', 'accessing')];
    });
    (queries.deleteMethod as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('delete');
      return 'Deleted: Array >> at:';
    });

    return makeController()
      .removeMethod(methodItem())
      .then(() => expect(order).toEqual(['capture', 'delete']));
  });

  it('records an entry naming the method', async () => {
    vi.mocked(captureMethodSlots).mockReturnValue([present('at: i\n  ^1', 'accessing')]);

    await makeController().removeMethod(methodItem());

    expect(peekUndoEntry(1)).toMatchObject({
      kind: 'methodEdit',
      label: 'Delete Array>>#at:',
    });
  });

  it('records nothing when GemStone refused the removal', async () => {
    // The method is still there; offering to restore it would be a lie.
    vi.mocked(captureMethodSlots).mockReturnValue([present('at: i\n  ^1', 'accessing')]);
    (queries.deleteMethod as ReturnType<typeof vi.fn>).mockReturnValue('Selector not found');

    await makeController().removeMethod(methodItem());

    expect(peekUndoEntry(1)).toBeUndefined();
  });

  it('records nothing when the removal was refused at the prompt', async () => {
    // Safe delete only PROMPTS when something references the method; with nothing referencing
    // it the removal goes through silently and there is no prompt to refuse.
    sendersOf.mockReturnValue([sender({ className: 'Other', selector: 'usesIt' })]);
    (window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await makeController().removeMethod(methodItem());

    expect(queries.deleteMethod).not.toHaveBeenCalled();
    expect(captureMethodSlots).not.toHaveBeenCalled();
  });

  it('puts Undo on the silent-delete notice, rather than a second notice beside it', async () => {
    // Safe delete's own sentence is the ONE notice for a deletion nothing referenced, so it is
    // the one that has to carry the button — two messages for one deletion would be noise.
    vi.mocked(captureMethodSlots).mockReturnValue([
      { exists: true, source: 'at: i\n\t^1', category: 'accessing' },
    ]);

    await makeController().removeMethod(methodItem());

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('nothing referenced it'),
      'Undo',
    );
  });

  it('stays quiet about a removal the user just confirmed, but still records it', async () => {
    // main's rule: do not tell the user what they just approved through a modal. The entry is
    // still on the stack, reachable from the status bar and Ctrl+K U.
    sendersOf.mockReturnValue([sender({ className: 'Other', selector: 'usesIt' })]);
    (window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Remove Anyway');
    vi.mocked(captureMethodSlots).mockReturnValue([
      { exists: true, source: 'at: i\n\t^1', category: 'accessing' },
    ]);

    await makeController().removeMethod(methodItem());

    expect(window.showInformationMessage).not.toHaveBeenCalled();
    expect(peekUndoEntry(1)).toMatchObject({ kind: 'methodEdit' });
  });

  it('removes the method normally when the capture fails', async () => {
    vi.mocked(captureMethodSlots).mockImplementation(() => {
      throw new Error('session busy');
    });

    await expect(makeController().removeMethod(methodItem())).resolves.toBeUndefined();
    expect(queries.deleteMethod).toHaveBeenCalled();
    expect(peekUndoEntry(1)).toBeUndefined();
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

  // A class can implement the same selector on the same side in two environments, and those
  // are two different methods. The Methods pane removes the environment-0 one, so only its
  // own send goes away with it. Discounting on class/side/selector alone crossed off the
  // OTHER environment's method too, hiding a sender that really does survive.
  it('counts a same-selector method in another environment as a surviving sender', async () => {
    __setConfig('gemstone', 'maxEnvironment', 1);
    sendersOf.mockImplementation((_s: unknown, _sel: string, env: number) =>
      // Array >> #at: sends #at: in BOTH environments. Only the environment-0 method is
      // being removed; the environment-1 one stays, and its send with it.
      [sender({ className: 'Array', selector: 'at:', environmentId: env })],
    );
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).toHaveBeenCalled();
    expect(showWarningMessage.mock.calls[0][1].detail).toContain('1 method still references it');
    expect(deleteMethod).not.toHaveBeenCalled();
  });

  // The other half of the same rule: the environment-0 self-send IS still discounted, so the
  // fix must not turn every recursive method back into a question.
  it('still discounts the removed method’s own send in environment 0', async () => {
    __setConfig('gemstone', 'maxEnvironment', 1);
    sendersOf.mockImplementation((_s: unknown, _sel: string, env: number) =>
      env === 0 ? [sender({ className: 'Array', selector: 'at:', environmentId: 0 })] : [],
    );
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(deleteMethod).toHaveBeenCalled();
  });
});

// The scan is capped per query, server-side. Whether it came back full has to be observed on
// the RAW rows, because the exclusions that run afterwards hide it: a capped scan of 500 that
// loses its self-send arrives at the dialog as 499 and no longer looks capped. Re-deriving the
// hedge from the surviving count dropped it in exactly that case, stating a number as fact when
// the truth may be thousands.
describe('ExplorerController.removeMethod — reporting a scan that came back full', () => {
  const CAP = 500;
  const fullPage = (over: Partial<MethodSearchResult> = {}) =>
    Array.from({ length: CAP }, (_, i) =>
      sender({ className: `C${i}`, selector: 'usesIt', ...over }),
    );

  it('hedges the count when the scan came back full', async () => {
    sendersOf.mockReturnValue(fullPage());
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    const detail = showWarningMessage.mock.calls[0][1].detail as string;
    expect(detail).toContain(`At least ${CAP} methods still reference it`);
    expect(detail).toContain('not complete');
  });

  it('still hedges when discounting the self-send took the count under the cap', async () => {
    // A recursive method whose scan came back full: 499 other senders plus its own send.
    // The self-send is excluded, so the dialog shows 499 — but the list was still cut off.
    sendersOf.mockReturnValue([
      ...fullPage().slice(0, CAP - 1),
      sender({ className: 'Array', selector: 'at:', environmentId: 0 }),
    ]);
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    const detail = showWarningMessage.mock.calls[0][1].detail as string;
    expect(detail).toContain(`At least ${CAP - 1} methods still reference it`);
    expect(detail).toContain('not complete');
  });

  // The mirror: two environments can sum past the cap without either query reaching it, and
  // that combined list IS complete. Hedging there would invent a doubt that is not real.
  it('does not hedge when several environments sum past the cap but none came back full', async () => {
    __setConfig('gemstone', 'maxEnvironment', 1);
    sendersOf.mockImplementation((_s: unknown, _sel: string, env: number) =>
      Array.from({ length: 300 }, (_, i) =>
        sender({ className: `C${env}_${i}`, selector: 'usesIt', environmentId: env }),
      ),
    );
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    const detail = showWarningMessage.mock.calls[0][1].detail as string;
    expect(detail).toContain('600 methods still reference it:');
    expect(detail).not.toContain('At least');
    expect(detail).not.toContain('not complete');
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

// The Methods pane shows ONE row per selector however many environments implement it, and a
// removal takes the environment-0 method only. So a row can stand for more methods than the one
// about to go, and saying nothing would leave "removed, nothing referenced it" reading as though
// the selector were gone from the class when an implementation is still standing.
describe('ExplorerController.removeMethod — the selector also lives in another environment', () => {
  // envLines is what the Methods pane is built from; reloadCurrentClassMethods fills it the same
  // way selecting the class in the tree does.
  const seedEnvironments = (
    ctl: ExplorerController,
    lines: { isMeta: boolean; envId: number; category: string; selectors: string[] }[],
  ) => {
    getClassEnvironments.mockReturnValue(lines);
    ctl.reloadCurrentClassMethods();
    getClassEnvironments.mockReturnValue(lines);
  };

  const bothEnvironments = [
    { isMeta: false, envId: 0, category: 'accessing', selectors: ['at:'] },
    { isMeta: false, envId: 1, category: 'accessing', selectors: ['at:'] },
  ];

  it('names the surviving environment in the notification when nothing else is in the way', async () => {
    const ctl = makeController();
    seedEnvironments(ctl, bothEnvironments);

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Array still implements it in environment 1'),
    );
  });

  it('says only the environment 0 method goes when it has to ask anyway', async () => {
    const ctl = makeController();
    seedEnvironments(ctl, bothEnvironments);
    sendersOf.mockReturnValue([sender()]);
    showWarningMessage.mockResolvedValue(undefined);

    await ctl.removeMethod(methodItem());

    const detail = showWarningMessage.mock.calls[0][1].detail as string;
    expect(detail).toContain('also implements #at: in environment 1');
    expect(detail).toContain('only the environment 0 method is removed');
  });

  it('says nothing extra when the selector lives in environment 0 alone', async () => {
    const ctl = makeController();
    seedEnvironments(ctl, [{ isMeta: false, envId: 0, category: 'accessing', selectors: ['at:'] }]);

    await ctl.removeMethod(methodItem());

    expect(showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('nothing referenced it'),
    );
    expect(showInformationMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('still implements'),
    );
  });

  it('does not confuse the class side with the instance side', async () => {
    const ctl = makeController();
    // Only the CLASS side has an environment-1 twin; removing the instance-side method
    // must not claim one survives.
    seedEnvironments(ctl, [
      { isMeta: false, envId: 0, category: 'accessing', selectors: ['at:'] },
      { isMeta: true, envId: 1, category: 'accessing', selectors: ['at:'] },
    ]);

    await ctl.removeMethod(methodItem());

    expect(showInformationMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('still implements'),
    );
  });
});
