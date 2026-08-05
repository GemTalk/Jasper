import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { runLogicalRestore, LogicalRestoreDeps, RestoreSession } from '../restoreManager';
import { RESTORE_NO_LOGOUT_MARKER } from '../queries/restore';

// `showQuickPick` is overloaded; production passes a `string[]`, but `vi.mocked`
// types the mock via the (last) `QuickPickItem` overload. Narrow to the string
// overload once so impls/return values type-check without `any`.
const mockShowQuickPick = vi.mocked(vscode.window.showQuickPick) as unknown as Mock<
  (items: readonly string[]) => Promise<string | undefined>
>;

// A fake restore session. By default the restoreFromBackup: call raises the 4046
// auto-logout (the full-logging success path); commitRestore answers 'OK'.
function makeSession(opts?: { restoreReturnsNormally?: boolean }) {
  const logout = vi.fn();
  const run = vi.fn(async (_label: string, code: string) => {
    if (code.includes('restoreFromBackup')) {
      if (opts?.restoreReturnsNormally) return RESTORE_NO_LOGOUT_MARKER;
      const err = new Error('RestoreBackupSuccess') as Error & { gciErrorNumber: number };
      err.gciErrorNumber = 4046;
      throw err;
    }
    if (code.includes('commitRestore')) return 'OK';
    return '';
  });
  return { run, logout } as RestoreSession & {
    run: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };
}

function makeDeps(overrides?: Partial<LogicalRestoreDeps>) {
  const session = makeSession();
  const deps: LogicalRestoreDeps = {
    stoneName: 'gs64stone',
    dbPath: '/root/db-1',
    backupFile: '/root/db-1/backups/backup.dbf',
    hasFileControl: vi.fn(() => true),
    closeCurrentSession: vi.fn(async () => {}),
    stopStone: vi.fn(async () => {}),
    startStone: vi.fn(async () => {}),
    copyCurrentExtentAside: vi.fn(async () => {}),
    swapInFreshExtent: vi.fn(async () => {}),
    loginAsDefaultAdmin: vi.fn(async () => session),
    loginAsSessionUser: vi.fn(async () => session),
    ...overrides,
  };
  return { deps, session };
}

describe('runLogicalRestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user picks the fresh-extent option, confirms the destructive modal.
    mockShowQuickPick.mockImplementation(async (items) => items[0]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Restore' as unknown as vscode.MessageItem,
    );
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([
      vscode.Uri.file('/root/db-1/backups/backup.dbf'),
    ]);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
  });

  it('runs the stop, safety-copy, swap, start, restore, and commit steps in order for a fresh extent', async () => {
    const { deps, session } = makeDeps();
    const order: string[] = [];
    vi.mocked(deps.closeCurrentSession).mockImplementation(async () => {
      order.push('close');
    });
    vi.mocked(deps.stopStone).mockImplementation(async () => {
      order.push('stop');
    });
    vi.mocked(deps.copyCurrentExtentAside).mockImplementation(async () => {
      order.push('copy');
    });
    vi.mocked(deps.swapInFreshExtent).mockImplementation(async () => {
      order.push('swap');
    });
    vi.mocked(deps.startStone).mockImplementation(async () => {
      order.push('start');
    });

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(true);
    expect(order).toEqual(['close', 'stop', 'copy', 'swap', 'start']);
    expect(session.run.mock.calls.some(([, code]) => code.includes('restoreFromBackup'))).toBe(
      true,
    );
    expect(session.run.mock.calls.some(([, code]) => code.includes('commitRestore'))).toBe(true);
  });

  it('preserves the current extent under backups/backupExtents with a stone-stamped name', async () => {
    const { deps } = makeDeps();

    await runLogicalRestore(deps);

    const destPath = vi.mocked(deps.copyCurrentExtentAside).mock.calls[0][0];
    expect(destPath).toContain('/root/db-1/backups/backupExtents/');
    expect(destPath).toContain('extent0_preRestore_gs64stone');
    expect(destPath.endsWith('.dbf')).toBe(true);
  });

  it('authenticates as the default admin when restoring into a fresh extent', async () => {
    const { deps } = makeDeps();

    await runLogicalRestore(deps);

    expect(deps.loginAsDefaultAdmin).toHaveBeenCalled();
    expect(deps.loginAsSessionUser).not.toHaveBeenCalled();
  });

  it('restores onto the current extent without a fresh extent when that option is chosen', async () => {
    const { deps } = makeDeps();
    mockShowQuickPick.mockImplementation(async (items) => items[1]);

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(true);
    expect(deps.swapInFreshExtent).not.toHaveBeenCalled();
    expect(deps.loginAsSessionUser).toHaveBeenCalled();
    expect(deps.loginAsDefaultAdmin).not.toHaveBeenCalled();
  });

  it('reuses the same login for the restore and the commit', async () => {
    const { deps } = makeDeps();

    await runLogicalRestore(deps);

    expect(deps.loginAsDefaultAdmin).toHaveBeenCalledTimes(2);
  });

  it('skips the commit step when the stone restores in a single call (partial logging)', async () => {
    const session = makeSession({ restoreReturnsNormally: true });
    const { deps } = makeDeps({
      loginAsDefaultAdmin: vi.fn(async () => session),
    });

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(true);
    expect(session.run.mock.calls.some(([, code]) => code.includes('commitRestore'))).toBe(false);
  });

  it('stops with an explanatory error and no teardown when the user lacks FileControl', async () => {
    const { deps } = makeDeps({ hasFileControl: vi.fn(() => false) });

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('FileControl'),
    );
    expect(deps.stopStone).not.toHaveBeenCalled();
  });

  it('reports a failure when the privilege check itself errors', async () => {
    const { deps } = makeDeps({
      hasFileControl: vi.fn(() => {
        throw new Error('gci down');
      }),
    });

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('privileges'),
    );
    expect(deps.stopStone).not.toHaveBeenCalled();
  });

  it('prompts for a backup file when none was pre-selected', async () => {
    const { deps } = makeDeps({ backupFile: undefined });

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(true);
    expect(vscode.window.showOpenDialog).toHaveBeenCalled();
  });

  it('is cancelled without teardown when the backup-file dialog is dismissed', async () => {
    const { deps } = makeDeps({ backupFile: undefined });
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined);

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(false);
    expect(deps.stopStone).not.toHaveBeenCalled();
  });

  it('is cancelled without teardown when the fresh-extent choice is dismissed', async () => {
    const { deps } = makeDeps();
    mockShowQuickPick.mockResolvedValue(undefined);

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(false);
    expect(deps.stopStone).not.toHaveBeenCalled();
  });

  it('does not touch the stone when the destructive confirmation is declined', async () => {
    const { deps } = makeDeps();
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(false);
    expect(deps.stopStone).not.toHaveBeenCalled();
    expect(deps.loginAsDefaultAdmin).not.toHaveBeenCalled();
  });

  it('surfaces a mid-restore failure and points the user at the saved-aside extent', async () => {
    const { deps } = makeDeps({
      startStone: vi.fn(async () => {
        throw new Error('startstone failed');
      }),
    });

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('backupExtents'),
    );
  });

  it('treats the no-roll-forward commitRestore warning as success', async () => {
    const session = makeSession();
    session.run.mockImplementation(async (_label: string, code: string) => {
      if (code.includes('restoreFromBackup')) {
        const err = new Error('RestoreBackupSuccess') as Error & { gciErrorNumber: number };
        err.gciErrorNumber = 4046;
        throw err;
      }
      if (code.includes('commitRestore')) {
        throw new Error(
          'commitRestore not immediately preceeded by restoreFromCurrentLogs. ' +
            'WARNING: Some transactions may not be restored.',
        );
      }
      return '';
    });
    const { deps } = makeDeps({ loginAsDefaultAdmin: vi.fn(async () => session) });

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(true);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('treats a genuine restore error (not 4046) as a failure', async () => {
    const session = makeSession();
    session.run.mockImplementation(async (_label: string, code: string) => {
      if (code.includes('restoreFromBackup')) {
        const err = new Error('file not found') as Error & { gciErrorNumber: number };
        err.gciErrorNumber = 2318;
        throw err;
      }
      return '';
    });
    const { deps } = makeDeps({ loginAsDefaultAdmin: vi.fn(async () => session) });

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('file not found'),
    );
  });

  it('ends on a green success status-bar item', async () => {
    const { deps } = makeDeps();

    await runLogicalRestore(deps);

    const item = vi.mocked(vscode.window.createStatusBarItem).mock.results.at(-1)?.value;
    expect(item.color).toEqual(new vscode.ThemeColor('charts.green'));
  });
});
