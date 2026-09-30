import { describe, it, expect, vi, beforeEach } from 'vitest';

// End to end, short of a stone: a real SessionManager logs sessions in through a
// fake GCI library, Switch Session picks one through the real session picker,
// and a notebook cell runs through the real kernel — which must hand the cell to
// the session the user picked (or the one the notebook is pinned to), not to
// the one that happened to be active before.

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logInfo: vi.fn(), logError: vi.fn() }));

const ok = { success: true, err: { number: 0, message: '' } };
vi.mock('../gciLibrary', () => ({
  GciLibrary: class {
    // A fresh handle per login, so each session is a different connection.
    GciTsLogin() {
      return { session: {}, err: { number: 0, message: '' } };
    }
    GciTsVersion() {
      return { version: '3.7.2' };
    }
    GciTsFetchSize() {
      return { result: 0n, err: { number: 0, message: '' } };
    }
    executeAndFetchString(_session: unknown, code: string) {
      return code.includes('System transactionMode asString,') ? 'autoBegin true' : 'installed';
    }
    GciTsFetchUtf8() {
      return { data: '7', err: { number: 0, message: '' } };
    }
    GciTsCallInProgress() {
      return { result: 0, err: { number: 0, message: '' } };
    }
    GciTsAbort() {
      return ok;
    }
    GciTsBegin() {
      return ok;
    }
    GciTsCommit() {
      return ok;
    }
    GciTsLogout() {}
    supportsNonBlockingLogin() {
      return false;
    }
    close() {}
  },
}));

// The seam short of a stone: no fake GCI can answer the non-blocking execute
// and its polling, so record the session a cell was sent to and hand back a result.
const { sentTo } = vi.hoisted(() => ({ sentTo: [] as unknown[] }));
vi.mock('../nbRunner', () => ({
  runNbCall: vi.fn(async (session: unknown) => {
    sentTo.push(session);
    return 1n;
  }),
}));

import { window, notebooks, __setConfig, __resetConfig } from '../__mocks__/vscode';
import { SessionManager, ActiveSession } from '../sessionManager';
import { DEFAULT_LOGIN } from '../loginTypes';
import { chooseActiveSession } from '../activeSessionDisplay';
import { GemStoneNotebookKernel } from '../gemstoneNotebookKernel';
import { SessionKernels, sessionKernelId } from '../sessionKernels';
import { smalltalkSessionKernel, SMALLTALK_CONTROLLER_ID } from '../smalltalkNotebookController';

type QuickPickItem = { label: string; description: string; session: ActiveSession };

function controller(id: string) {
  return notebooks.createNotebookController.mock.results
    .map((r) => r.value)
    .find((c) => c.id === id)!;
}

describe('Switch Session in a notebook, with sessions logged in along the way', () => {
  let manager: SessionManager;
  // Which session each cell ran in, in order.
  let ranIn: ActiveSession[];

  beforeEach(() => {
    vi.clearAllMocks();
    // Tests run shuffled: drop any picker answer an earlier test queued but
    // never used, or it answers this test's picker instead.
    vi.mocked(window.showQuickPick).mockReset();
    __resetConfig();
    __setConfig('gemstone', 'sessionMode', 'multiple');
    manager = new SessionManager();
    ranIn = [];
  });

  async function login(user: string): Promise<ActiveSession> {
    return await manager.login({ ...DEFAULT_LOGIN, gs_user: user, label: user }, '/mock/lib');
  }

  // The default kernel — the one Open Notebook selects — built the way the real
  // Smalltalk kernel is, with the cell's evaluation recorded instead of sent.
  function openNotebookKernel() {
    new GemStoneNotebookKernel(manager, {
      id: SMALLTALK_CONTROLLER_ID,
      label: 'GemStone Smalltalk',
      description: '',
      supportedLanguages: ['gemstone-smalltalk'],
      evaluate: (session) => {
        ranIn.push(session);
        return '7';
      },
    });
    return controller(SMALLTALK_CONTROLLER_ID);
  }

  async function runCell(kernel: ReturnType<typeof controller>) {
    await kernel.executeHandler([
      { document: { getText: () => '3 + 4' }, notebook: { uri: { toString: () => 'nb' } } },
    ]);
  }

  // Switch Session: the picker lists what the manager has now; pick `target`.
  async function switchSessionTo(target: ActiveSession): Promise<QuickPickItem[]> {
    let offered: QuickPickItem[] = [];
    vi.mocked(window.showQuickPick).mockImplementationOnce((async (items: QuickPickItem[]) => {
      offered = items;
      return items.find((i) => i.session === target);
    }) as never);
    await chooseActiveSession(manager);
    return offered;
  }

  it('offers the sessions logged in after the notebook opened, and runs the cell in the one picked', async () => {
    const first = await login('DataCurator');
    const kernel = openNotebookKernel();
    await runCell(kernel);
    expect(ranIn.at(-1)).toBe(first);

    const second = await login('SystemUser');
    const third = await login('Carl');

    const offered = await switchSessionTo(second);
    expect(offered.map((i) => i.session)).toEqual(expect.arrayContaining([first, second, third]));
    expect(manager.getSelectedSession()).toBe(second);
    expect(kernel.label).toContain(`active Session ${second.id}`);

    await runCell(kernel);
    expect(ranIn.at(-1)).toBe(second);
    expect(ranIn.at(-1)!.handle).toBe(second.handle);

    await switchSessionTo(third);
    await runCell(kernel);
    expect(ranIn.at(-1)).toBe(third);
    expect(kernel.label).toContain(`active Session ${third.id}`);
  });

  it('switches back to an earlier session and runs there', async () => {
    const first = await login('DataCurator');
    const second = await login('SystemUser');
    const kernel = openNotebookKernel();

    await switchSessionTo(first);
    await runCell(kernel);
    expect(ranIn.at(-1)).toBe(first);

    await switchSessionTo(second);
    await runCell(kernel);
    expect(ranIn.at(-1)).toBe(second);
  });

  it('stops offering a session once it logs out', async () => {
    const first = await login('DataCurator');
    const second = await login('SystemUser');
    const third = await login('Carl');
    manager.logout(second.id);

    const offered = await switchSessionTo(third);

    expect(offered.map((i) => i.session)).toEqual(expect.arrayContaining([first, third]));
    expect(offered.map((i) => i.session)).not.toContain(second);
  });

  it('with only one session left, keeps it without asking', async () => {
    const first = await login('DataCurator');
    const second = await login('SystemUser');
    manager.logout(second.id);

    await chooseActiveSession(manager);

    expect(window.showQuickPick).not.toHaveBeenCalled();
    expect(manager.getSelectedSession()).toBe(first);
    // Says so, rather than a click that visibly does nothing.
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining(`Only one session is logged in (Session ${first.id}`),
    );
  });

  it('leaves a notebook pinned to one session where it is when the active session switches', async () => {
    const first = await login('DataCurator');
    new SessionKernels(manager, [smalltalkSessionKernel]);
    const second = await login('SystemUser');
    sentTo.length = 0;

    await switchSessionTo(second);
    await runCell(controller(sessionKernelId(SMALLTALK_CONTROLLER_ID, first.id)));

    expect(sentTo).toEqual([first]);
  });
});
