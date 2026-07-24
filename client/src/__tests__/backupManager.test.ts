import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('../wslFs');

import * as vscode from 'vscode';
import { wslExistsSync } from '../wslFs';
import { runLogicalBackup, LogicalBackupDeps } from '../backupManager';

function makeDeps(overrides?: Partial<LogicalBackupDeps>): LogicalBackupDeps {
  return {
    execute: vi.fn((code: string) => {
      if (code.includes('FileControl')) return 'true';
      if (code.includes('needsCommit')) return 'false';
      return 'aborted';
    }),
    runBackup: vi.fn(async () => 'OK'),
    stoneName: 'gs64stone',
    dbPath: '/root/db-1',
    ...overrides,
  };
}

describe('runLogicalBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(wslExistsSync).mockReturnValue(true);
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(
      vscode.Uri.file('/root/db-1/backups/gs64stone.dbf'),
    );
    // Default: user dismisses the success toast without clicking an action.
    // (clearAllMocks resets call history but not mockResolvedValue, so set it here.)
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
  });

  it('backs up to the chosen destination and reports success', async () => {
    const deps = makeDeps();

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(true);
    expect(deps.runBackup).toHaveBeenCalledOnce();
    const backupCode = vi.mocked(deps.runBackup).mock.calls[0][0];
    expect(backupCode).toContain("fullBackupTo: '/root/db-1/backups/gs64stone.dbf'");
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('ends on a green success status-bar item so a fast backup is still noticed', async () => {
    const deps = makeDeps();

    await runLogicalBackup(deps);

    const item = vi.mocked(vscode.window.createStatusBarItem).mock.results.at(-1)?.value;
    expect(item.text).toContain('Full logical backup');
    expect(item.color).toEqual(new vscode.ThemeColor('charts.green'));
  });

  it('offers to reveal a locally-managed backup and opens the file manager on request', async () => {
    const deps = makeDeps();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
      'Reveal in File Explorer' as unknown as vscode.MessageItem,
    );

    await runLogicalBackup(deps);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'revealFileInOS',
      expect.anything(),
    );
  });

  it('omits the reveal action for a stone that is not locally managed', async () => {
    const deps = makeDeps({ dbPath: undefined });

    await runLogicalBackup(deps);

    const infoArgs = vi.mocked(vscode.window.showInformationMessage).mock.calls[0];
    expect(infoArgs).toHaveLength(1);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'revealFileInOS',
      expect.anything(),
    );
  });

  it('reports a pre-flight failure when the privilege check itself errors', async () => {
    const deps = makeDeps({
      execute: vi.fn(() => {
        throw new Error('gci down');
      }),
    });

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('privileges'),
    );
    expect(deps.runBackup).not.toHaveBeenCalled();
  });

  it('reports a pre-flight failure when the uncommitted-changes check errors', async () => {
    const execute = vi.fn((code: string) => {
      if (code.includes('FileControl')) return 'true';
      throw new Error('gci down');
    });
    const deps = makeDeps({ execute });

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('session state'),
    );
    expect(deps.runBackup).not.toHaveBeenCalled();
  });

  it('reports a failure when aborting the uncommitted changes errors', async () => {
    const execute = vi.fn((code: string) => {
      if (code.includes('FileControl')) return 'true';
      if (code.includes('needsCommit')) return 'true';
      throw new Error('abort failed');
    });
    const deps = makeDeps({ execute });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Discard changes and back up' as unknown as vscode.MessageItem,
    );

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('abort'));
    expect(deps.runBackup).not.toHaveBeenCalled();
  });

  it('stops with an explanatory error when the user lacks FileControl', async () => {
    const deps = makeDeps({ execute: vi.fn(() => 'false') });

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('FileControl'),
    );
    expect(deps.runBackup).not.toHaveBeenCalled();
  });

  it('does not back up when the user declines to discard uncommitted changes', async () => {
    const deps = makeDeps({
      execute: vi.fn((code: string) => (code.includes('needsCommit') ? 'true' : 'true')),
    });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(false);
    expect(deps.runBackup).not.toHaveBeenCalled();
  });

  it('aborts the session then backs up when the user agrees to discard changes', async () => {
    const execute = vi.fn((code: string) => {
      if (code.includes('FileControl')) return 'true';
      if (code.includes('needsCommit')) return 'true';
      return 'aborted';
    });
    const deps = makeDeps({ execute });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Discard changes and back up' as unknown as vscode.MessageItem,
    );

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(true);
    expect(execute.mock.calls.some(([code]) => code.includes('System abortTransaction'))).toBe(
      true,
    );
    expect(deps.runBackup).toHaveBeenCalledOnce();
  });

  it('is cancelled without backing up when the save dialog is dismissed', async () => {
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);
    const deps = makeDeps();

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(false);
    expect(deps.runBackup).not.toHaveBeenCalled();
  });

  it('surfaces a GCI failure from the backup as an error', async () => {
    const deps = makeDeps({
      runBackup: vi.fn(async () => {
        throw new Error('device full');
      }),
    });

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('device full'),
    );
  });

  it('reports a non-OK result from the stone as a failure', async () => {
    const deps = makeDeps({ runBackup: vi.fn(async () => 'fullBackupTo: returned false') });

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});
