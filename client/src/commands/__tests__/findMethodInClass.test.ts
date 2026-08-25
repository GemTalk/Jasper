import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from '../../sessionManager';
import { GemStoneLogin } from '../../loginTypes';
import { GciError } from '../../gciLibrary';
import { ClassPickItem } from '../classPicker';
import { SystemBrowser } from '../../systemBrowser';
import { findMethodInClass } from '../findMethodInClass';

const noErr: GciError = {
  number: 0,
  message: '',
  reason: '',
  context: 0n,
  category: 0n,
  exceptionObj: 0n,
  args: [],
  argCount: 0,
  fatal: 0,
};

// The class picker the command drives is a `createQuickPick` instance; the mock
// adds `__accept`/`__hide` (see `__mocks__/vscode.ts`) to fire its handlers.
type QuickPickHandle = vscode.QuickPick<ClassPickItem> & {
  __accept(): Promise<void>;
  __hide(): void;
};

const classListPayload = '1\tUserGlobals\tArray\n2\tGlobals\tString\n';
const methodListPayload = '0\tprinting\tfoo\n1\taccessing\tbar\n';

function createMockSession(): ActiveSession {
  const mockGci = {
    GciTsPerform: vi.fn(() => ({ result: 2000n, err: { ...noErr } })),
    GciTsNewString: vi.fn(() => ({ result: 3000n, err: { ...noErr } })),
    GciTsNewSymbol: vi.fn(() => ({ result: 4000n, err: { ...noErr } })),
    GciTsCompileMethod: vi.fn(() => ({ result: 5000n, err: { ...noErr } })),
    GciTsExecuteFetchBytes: vi.fn(() => ({ data: '', err: { ...noErr } })),
    GciTsPerformFetchBytes: vi.fn(() => ({ data: '', err: { ...noErr } })),
    executeAndFetchString: vi.fn(() => ''),
    GciTsCallInProgress: vi.fn(() => ({ result: 0 })),
    GciTsClearStack: vi.fn(),
  };

  return {
    id: 1,
    gci: mockGci as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
}

// The command loads the class list (via getAllClassNames), then the method
// list (via getMethodList) — both now go through executeAndFetchString, so
// the fake GCI answers the first call with the class payload and the second
// with the method payload.
function createSequencedSession(methodPayload = methodListPayload): ActiveSession {
  const session = createMockSession();
  vi.mocked(session.gci.executeAndFetchString)
    .mockReturnValueOnce(classListPayload)
    .mockReturnValueOnce(methodPayload);
  return session;
}

function lastQuickPick(): QuickPickHandle {
  const results = vi.mocked(vscode.window.createQuickPick).mock.results;
  return results[results.length - 1].value;
}

// Kicks off the command, waits for the class picker to appear, and hands back
// everything a test needs to drive and assert on it. The command can't simply be
// awaited here (that would deadlock: the test waiting on the command, the command
// parked on the class-pick promise waiting for an onDidAccept/onDidHide the test
// hasn't fired yet). So it's kicked off unawaited; vi.waitFor then polls until the
// command has advanced through its earlier awaits (resolveSession, getAllClassNames)
// and reached createQuickPick().show(). Polling — rather than a fixed flush tick —
// tolerates that chain spanning however many ticks. The test then inspects/fires
// the picker and finally awaits `done`.
async function openClassPicker(methodPayload = methodListPayload) {
  const session = createSequencedSession(methodPayload);
  const sessionManager = {
    resolveSession: vi.fn().mockResolvedValue(session),
  } as unknown as SessionManager;
  const done = findMethodInClass(sessionManager);
  await vi.waitFor(() => expect(vscode.window.createQuickPick).toHaveBeenCalled());
  return { session, qp: lastQuickPick(), done };
}

// Resolves the class picker by accepting a class, then lets the command finish.
// With no className, accepts whatever is pre-highlighted (the default); with
// one, selects that class from the list instead.
async function acceptClass(
  qp: QuickPickHandle,
  done: Promise<void>,
  className?: string,
): Promise<void> {
  qp.selectedItems = className
    ? qp.items.filter((i) => i.entry.className === className)
    : qp.activeItems;
  await qp.__accept();
  await done;
}

// Dismisses the class picker (Escape/cancel), then lets the command finish.
async function dismissPicker(qp: QuickPickHandle, done: Promise<void>): Promise<void> {
  qp.__hide();
  await done;
}

function expectNavigatedTo(sessionId: number, dictName: string, className: string): void {
  expect(SystemBrowser.navigateTo).toHaveBeenCalledWith(sessionId, {
    dictName,
    className,
    isMeta: false,
    selector: 'foo',
    category: 'printing',
    environmentId: 0,
  });
}

describe('findMethodInClass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(SystemBrowser, 'navigateTo').mockReturnValue(true);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({
      label: 'foo',
      description: 'printing',
      method: { isMeta: false, category: 'printing', selector: 'foo' },
    } as unknown as vscode.QuickPickItem);
  });

  describe('when a class is selected in the System Browser', () => {
    beforeEach(() => {
      vi.spyOn(SystemBrowser, 'getSelectedClassName').mockReturnValue({
        dictName: 'UserGlobals',
        className: 'Array',
        dictIndex: 1,
      });
    });

    it('still shows the class picker, with the selected class pre-highlighted', async () => {
      const { qp, done } = await openClassPicker();

      expect(vscode.window.createQuickPick).toHaveBeenCalled();
      expect(qp.activeItems).toHaveLength(1);
      expect(qp.activeItems[0].entry).toEqual({
        dictIndex: 1,
        dictName: 'UserGlobals',
        className: 'Array',
      });

      await dismissPicker(qp, done);
    });

    it('navigates using the pre-highlighted class when the default is accepted', async () => {
      const { session, qp, done } = await openClassPicker();

      await acceptClass(qp, done);

      expectNavigatedTo(session.id, 'UserGlobals', 'Array');
    });

    it('navigates using a different class when the user picks another item', async () => {
      const { session, qp, done } = await openClassPicker();

      await acceptClass(qp, done, 'String');

      expectNavigatedTo(session.id, 'Globals', 'String');
    });

    it('does not navigate when the class picker is dismissed', async () => {
      const { qp, done } = await openClassPicker();

      await dismissPicker(qp, done);

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      expect(SystemBrowser.navigateTo).not.toHaveBeenCalled();
    });

    it('does not navigate when the method pick is cancelled', async () => {
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
      const { qp, done } = await openClassPicker();

      await acceptClass(qp, done);

      expect(SystemBrowser.navigateTo).not.toHaveBeenCalled();
    });

    it('shows an informational message when the class has no methods', async () => {
      const { qp, done } = await openClassPicker('');

      await acceptClass(qp, done);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'No methods found for Array.',
      );
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });
  });

  describe('when no class is selected in the System Browser', () => {
    beforeEach(() => {
      vi.spyOn(SystemBrowser, 'getSelectedClassName').mockReturnValue(null);
    });

    it('shows the class picker with nothing pre-highlighted', async () => {
      const { qp, done } = await openClassPicker();

      expect(qp.activeItems).toHaveLength(0);

      await dismissPicker(qp, done);
    });

    it('navigates to the picked method using the class picked from the list', async () => {
      const { session, qp, done } = await openClassPicker();

      await acceptClass(qp, done, 'Array');

      expectNavigatedTo(session.id, 'UserGlobals', 'Array');
    });

    it('opens the method directly when no System Browser is open for the session', async () => {
      vi.mocked(SystemBrowser.navigateTo).mockReturnValue(false);
      const { qp, done } = await openClassPicker();

      await acceptClass(qp, done, 'Array');

      expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
      const [command, uri] = vi.mocked(vscode.commands.executeCommand).mock.calls[0];
      expect(command).toBe('gemstone.openDocument');
      expect(String(uri)).toContain('UserGlobals');
      expect(String(uri)).toContain('Array');
    });

    it('does not load methods when the class pick is cancelled', async () => {
      const { qp, done } = await openClassPicker();

      await dismissPicker(qp, done);

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      expect(SystemBrowser.navigateTo).not.toHaveBeenCalled();
    });
  });
});
