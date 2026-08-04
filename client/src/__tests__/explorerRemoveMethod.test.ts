import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// Stub the query layer: removeMethod calls deleteMethod, and its refresh
// (reloadCurrentClassMethods) calls getClassEnvironments. Neither should reach
// a real GCI session in a unit test.
vi.mock('../browserQueries', () => ({
  canClassBeWritten: vi.fn(() => true),
  deleteMethod: vi.fn(() => 'Deleted: Array >> at:'),
  getClassEnvironments: vi.fn(() => []),
}));

import { ExplorerController, MethodItem } from '../gemstoneExplorer';
import * as queries from '../browserQueries';
import { window } from '../__mocks__/vscode';
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
