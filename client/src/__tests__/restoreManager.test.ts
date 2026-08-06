import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { runLogicalRestore, LogicalRestoreDeps, RestoreSession } from '../restoreManager';
import { RESTORE_NO_LOGOUT_MARKER } from '../queries/restore';

// `showQuickPick` is overloaded; the fresh-extent-vs-in-place choice passes a
// `string[]`, but `vi.mocked` types the mock via the (last) `QuickPickItem`
// overload. Narrow to the string overload once so impls/return values
// type-check without `any` — fine even for tests exercising the backup-file
// quick pick (an object-item call), since picking `items[0]`/`items[1]` or
// resolving `undefined` doesn't depend on the item shape.
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
    hasFileControl: vi.fn(() => true),
    listBackupFiles: vi.fn(() => ['/root/db-1/backups/backup.dbf']),
    closeCurrentSession: vi.fn(async () => {}),
    stopStone: vi.fn(async () => {}),
    startStone: vi.fn(async () => {}),
    copyCurrentExtentAside: vi.fn(
      async () => '/root/db-1/backups/backupExtents/extent0_preRestore_gs64stone.dbf',
    ),
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
      return '/root/db-1/backups/backupExtents/extent0_preRestore_gs64stone.dbf';
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

  it('names the safety copy after the stone, with a sortable timestamp', async () => {
    const { deps } = makeDeps();

    await runLogicalRestore(deps);

    const fileName = vi.mocked(deps.copyCurrentExtentAside).mock.calls[0][0];
    expect(fileName).toContain('extent0_preRestore_gs64stone');
    expect(fileName.endsWith('.dbf')).toBe(true);
  });

  it('authenticates as the default admin when restoring into a fresh extent', async () => {
    const { deps } = makeDeps();

    await runLogicalRestore(deps);

    expect(deps.loginAsDefaultAdmin).toHaveBeenCalled();
    expect(deps.loginAsSessionUser).not.toHaveBeenCalled();
  });

  it('restores onto the current extent without a fresh extent when that option is chosen', async () => {
    const { deps } = makeDeps();
    // First quick pick is the backup-file picker (only one item); second is
    // the fresh-extent-vs-in-place choice, where items[1] is "in place".
    mockShowQuickPick.mockImplementationOnce(async (items) => items[0]);
    mockShowQuickPick.mockImplementationOnce(async (items) => items[1]);

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

  it('prompts for a backup file to restore from', async () => {
    const { deps } = makeDeps({
      listBackupFiles: vi.fn(() => ['/data/backups/b.dbf']),
    });

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(true);
    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
      [{ label: 'b.dbf', filePath: '/data/backups/b.dbf' }],
      expect.objectContaining({ placeHolder: expect.any(String) }),
    );
    expect(deps.copyCurrentExtentAside).toHaveBeenCalled();
  });

  it('is cancelled without teardown when the backup quick pick is dismissed', async () => {
    const { deps } = makeDeps();
    mockShowQuickPick.mockResolvedValueOnce(undefined);

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(false);
    expect(deps.stopStone).not.toHaveBeenCalled();
  });

  it('stops with an explanatory error when the stone reports no backups', async () => {
    const { deps } = makeDeps({ listBackupFiles: vi.fn(() => []) });

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('No backup files found'),
    );
    expect(deps.stopStone).not.toHaveBeenCalled();
  });

  it('stops with an explanatory error when listing backups fails', async () => {
    const { deps } = makeDeps({
      listBackupFiles: vi.fn(() => {
        throw new Error('gci down');
      }),
    });

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Could not list backup files'),
    );
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

  it('does not claim the extent was saved when the failure happens before the safety copy', async () => {
    const { deps } = makeDeps({
      stopStone: vi.fn(async () => {
        throw new Error('stopstone failed');
      }),
    });

    const ok = await runLogicalRestore(deps);

    expect(ok).toBe(false);
    expect(deps.copyCurrentExtentAside).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.not.stringContaining('saved under'),
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
