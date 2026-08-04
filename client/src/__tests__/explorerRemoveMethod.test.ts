import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// Stub the query layer: removeMethod calls deleteMethod, and its refresh
// (reloadCurrentClassMethods) calls getClassEnvironments. Neither should reach
// a real GCI session in a unit test.
vi.mock('../browserQueries', () => ({
  deleteMethod: vi.fn(() => 'Deleted'),
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
const showWarningMessage = window.showWarningMessage as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  window.tabGroups.all = [];
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
});
