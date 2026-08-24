import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// Stub the query layer: removeMethod calls deleteMethod, and its refresh
// (reloadCurrentClassMethods) calls getClassEnvironments. Neither should reach
// a real GCI session in a unit test.
vi.mock('../browserQueries', () => ({
  canClassBeWritten: vi.fn(() => true),
  deleteMethod: vi.fn(() => 'Deleted: Array >> at:'),
  getClassEnvironments: vi.fn(() => []),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
}));
// The undo recorder's one round trip, stubbed so the snapshot is data this test controls
// rather than a live doit (#434).
vi.mock('../undo/queries/methodSlotQueries', () => ({
  captureMethodSlots: vi.fn(),
  applyMethodSlotOps: vi.fn(),
}));

import { ExplorerController, MethodItem } from '../gemstoneExplorer';
import * as queries from '../browserQueries';
import { window } from '../__mocks__/vscode';
import { captureMethodSlots } from '../undo/queries/methodSlotQueries';
import { peekUndoEntry, resetUndoStacks } from '../undo/undoStack';
import type { SessionManager, ActiveSession } from '../sessionManager';

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

const deleteMethod = queries.deleteMethod as ReturnType<typeof vi.fn>;
const canClassBeWritten = queries.canClassBeWritten as ReturnType<typeof vi.fn>;
const showWarningMessage = window.showWarningMessage as ReturnType<typeof vi.fn>;
const showErrorMessage = window.showErrorMessage as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  window.tabGroups.all = [];
  // clearAllMocks resets call history but not implementations; restore the query
  // defaults so a failure-path test's override can't leak into a shuffled neighbour.
  canClassBeWritten.mockReturnValue(true);
  deleteMethod.mockReturnValue('Deleted: Array >> at:');
});

describe('ExplorerController.removeMethod', () => {
  it('asks the user to confirm before removing anything', async () => {
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Remove method #at: from Array'),
      { modal: true },
      'Remove',
    );
  });

  it('does not remove the method when the user dismisses the dialog', async () => {
    showWarningMessage.mockResolvedValue(undefined);
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(deleteMethod).not.toHaveBeenCalled();
  });

  it('removes the confirmed method from its class in the current dictionary', async () => {
    showWarningMessage.mockResolvedValue('Remove');
    const ctl = makeController();

    await ctl.removeMethod(methodItem({ selector: 'at:put:' }));

    expect(deleteMethod).toHaveBeenCalledWith(SESSION, 'Array', false, 'at:put:', 1);
  });

  it('names the class side in the prompt and removal for a class-side method', async () => {
    showWarningMessage.mockResolvedValue('Remove');
    const ctl = makeController();

    await ctl.removeMethod(methodItem({ selector: 'new' }, true));

    expect(showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Array class'),
      { modal: true },
      'Remove',
    );
    expect(deleteMethod).toHaveBeenCalledWith(SESSION, 'Array', true, 'new', 1);
  });

  it('refreshes the method pane after a successful removal', async () => {
    showWarningMessage.mockResolvedValue('Remove');
    const ctl = makeController();
    const refresh = vi.spyOn(ctl.methodProvider, 'refresh');

    await ctl.removeMethod(methodItem());

    expect(refresh).toHaveBeenCalled();
  });

  it('does nothing without a selected session', async () => {
    showWarningMessage.mockResolvedValue('Remove');
    const ctl = controllerFor(undefined);

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(deleteMethod).not.toHaveBeenCalled();
  });

  it('does nothing without a selected class', async () => {
    showWarningMessage.mockResolvedValue('Remove');
    const ctl = makeController();
    ctl.state.className = undefined;

    await ctl.removeMethod(methodItem());

    expect(deleteMethod).not.toHaveBeenCalled();
  });

  it('warns and does not prompt when the class cannot be modified', async () => {
    canClassBeWritten.mockReturnValue(false);
    showWarningMessage.mockResolvedValue('Remove');
    const ctl = makeController();

    await ctl.removeMethod(methodItem());

    expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('cannot be modified'));
    expect(showWarningMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('Remove method'),
      expect.anything(),
      expect.anything(),
    );
    expect(deleteMethod).not.toHaveBeenCalled();
  });

  it('surfaces an error and does not refresh when the removal reports a failure status', async () => {
    showWarningMessage.mockResolvedValue('Remove');
    deleteMethod.mockReturnValue('Selector not found: Array >> at:');
    const ctl = makeController();
    const refresh = vi.spyOn(ctl.methodProvider, 'refresh');

    await ctl.removeMethod(methodItem());

    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Selector not found'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('surfaces an error and does not refresh when the removal query raises', async () => {
    showWarningMessage.mockResolvedValue('Remove');
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
    (window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await makeController().removeMethod(methodItem());

    expect(captureMethodSlots).not.toHaveBeenCalled();
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
