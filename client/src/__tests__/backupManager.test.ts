import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../wslFs');
// Deterministic, and keeps the real one from shelling out to wsl.exe on Windows.
vi.mock('../wslBridge', () => ({
  isWindows: vi.fn(() => false),
  needsWsl: () => false,
  windowsPathToWsl: (p: string) => p,
  wslExecSync: vi.fn(),
  wslPathToWindows: (p: string) => `\\\\wsl$\\Ubuntu${p.replace(/\//g, '\\')}`,
}));

import * as vscode from 'vscode';
import { isWindows } from '../wslBridge';
import { wslExistsSync } from '../wslFs';
import { runLogicalBackup, LogicalBackupDeps } from '../backupManager';

// The extent path the stone reports by default, and the backups directory
// (its data/ sibling) that runLogicalBackup derives from it.
const EXTENT = '/root/db-1/data/extent0.dbf';
const BACKUP_DIR = '/root/db-1/backups';

function makeDeps(overrides?: Partial<LogicalBackupDeps>): LogicalBackupDeps {
  return {
    execute: vi.fn((code: string) => {
      if (code.includes('FileControl')) return 'true';
      if (code.includes('needsCommit')) return 'false';
      if (code.includes('SystemRepository fileNames')) return `${EXTENT}\n`;
      if (code.includes('existsOnServer')) return 'false';
      return 'aborted';
    }),
    runBackup: vi.fn(async () => 'OK'),
    stoneName: 'gs64stone',
    ...overrides,
  };
}

// The bare file name the user accepts, and the resulting destination once
// joined onto BACKUP_DIR.
const PROVIDED_FILENAME = 'gs64stone.dbf';
const DESTINATION = `${BACKUP_DIR}/${PROVIDED_FILENAME}`;

// The options object handed to the last showInputBox call.
function inputBoxOptions(): vscode.InputBoxOptions {
  return vi.mocked(vscode.window.showInputBox).mock.calls.at(-1)![0]!;
}

describe('runLogicalBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isWindows).mockReturnValue(false);
    vi.mocked(wslExistsSync).mockReturnValue(true);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(PROVIDED_FILENAME);
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
    expect(backupCode).toContain(`fullBackupTo: '${DESTINATION}'`);
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('stops with an explanatory error when the stone cannot report its backups directory', async () => {
    const deps = makeDeps({
      execute: vi.fn((code: string) => {
        if (code.includes('FileControl')) return 'true';
        if (code.includes('needsCommit')) return 'false';
        if (code.includes('SystemRepository fileNames')) return '';
        return 'aborted';
      }),
    });

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('backups directory'),
    );
    // Never even asked for a file name — there was nowhere to put it.
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(deps.runBackup).not.toHaveBeenCalled();
  });

  it('stops with an explanatory error when asking the stone for its backups directory fails', async () => {
    const deps = makeDeps({
      execute: vi.fn((code: string) => {
        if (code.includes('FileControl')) return 'true';
        if (code.includes('needsCommit')) return 'false';
        if (code.includes('SystemRepository fileNames')) throw new Error('gci down');
        return 'aborted';
      }),
    });

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('backups directory'),
    );
    expect(deps.runBackup).not.toHaveBeenCalled();
  });

  it('suggests a timestamped file name with no directory', async () => {
    const deps = makeDeps();

    await runLogicalBackup(deps);

    expect(inputBoxOptions().value).toMatch(/^gs64stone_[\d_-]+\.dbf$/);
  });

  it('pre-selects the name but leaves the .dbf extension untouched', async () => {
    const deps = makeDeps();

    await runLogicalBackup(deps);

    const { value, valueSelection } = inputBoxOptions();
    expect(value!.slice(valueSelection![0], valueSelection![1])).toMatch(/^gs64stone_[\d_-]+$/);
    expect(value!.slice(valueSelection![1])).toBe('.dbf');
  });

  it('rejects a destination that includes a path, accepting only a bare file name', async () => {
    const deps = makeDeps();

    await runLogicalBackup(deps);

    const { validateInput } = inputBoxOptions();
    expect(validateInput!('/srv/backups/backup.dbf')).toEqual(expect.stringContaining('.dbf'));
    expect(validateInput!('C:\\Users\\me\\backup.dbf')).toEqual(expect.stringContaining('.dbf'));
    expect(validateInput!('backup.dbf')).toBeNull();
  });

  it('rejects a destination that does not name a .dbf file', async () => {
    const deps = makeDeps();

    await runLogicalBackup(deps);

    const { validateInput } = inputBoxOptions();
    expect(validateInput!('/srv/backups')).toEqual(expect.stringContaining('.dbf'));
    expect(validateInput!('/srv/backups/')).toEqual(expect.stringContaining('.dbf'));
  });

  it('rejects a destination whose extension is not lowercase .dbf', async () => {
    const deps = makeDeps();

    await runLogicalBackup(deps);

    const { validateInput } = inputBoxOptions();
    expect(validateInput!('/srv/backups/backup.DBF')).toEqual(expect.stringContaining('.dbf'));
  });

  it('rejects a bare .dbf with no file name', async () => {
    const deps = makeDeps();

    await runLogicalBackup(deps);

    const { validateInput } = inputBoxOptions();
    expect(validateInput!('.dbf')).toEqual(expect.stringContaining('.dbf'));
  });

  it('proceeds straight to the backup when nothing exists yet at the destination', async () => {
    const deps = makeDeps();

    await runLogicalBackup(deps);

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(deps.runBackup).toHaveBeenCalledOnce();
  });

  it('warns before overwriting a backup that already exists at the destination', async () => {
    const execute = vi.fn((code: string) => {
      if (code.includes('FileControl')) return 'true';
      if (code.includes('needsCommit')) return 'false';
      if (code.includes('SystemRepository fileNames')) return `${EXTENT}\n`;
      if (code.includes('existsOnServer')) return 'true';
      return 'aborted';
    });
    const deps = makeDeps({ execute });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Overwrite' as unknown as vscode.MessageItem,
    );

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(true);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining(DESTINATION),
      expect.anything(),
      'Overwrite',
    );
    expect(deps.runBackup).toHaveBeenCalledOnce();
  });

  it('does not back up when the user declines to overwrite an existing backup', async () => {
    const execute = vi.fn((code: string) => {
      if (code.includes('FileControl')) return 'true';
      if (code.includes('needsCommit')) return 'false';
      if (code.includes('SystemRepository fileNames')) return `${EXTENT}\n`;
      if (code.includes('existsOnServer')) return 'true';
      return 'aborted';
    });
    const deps = makeDeps({ execute });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(false);
    expect(deps.runBackup).not.toHaveBeenCalled();
  });

  it('reports a pre-flight failure when checking for an existing backup errors', async () => {
    const execute = vi.fn((code: string) => {
      if (code.includes('FileControl')) return 'true';
      if (code.includes('needsCommit')) return 'false';
      if (code.includes('SystemRepository fileNames')) return `${EXTENT}\n`;
      if (code.includes('existsOnServer')) throw new Error('gci down');
      return 'aborted';
    });
    const deps = makeDeps({ execute });

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('whether a backup already exists'),
    );
    expect(deps.runBackup).not.toHaveBeenCalled();
  });

  it('ends on a green success status-bar item so a fast backup is still noticed', async () => {
    const deps = makeDeps();

    await runLogicalBackup(deps);

    const item = vi.mocked(vscode.window.createStatusBarItem).mock.results.at(-1)?.value;
    expect(item.text).toContain('Full logical backup');
    expect(item.color).toEqual(new vscode.ThemeColor('charts.green'));
  });

  it('reveals the backup at the server path when the client shares that filesystem', async () => {
    const deps = makeDeps();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
      'Reveal in File Explorer' as unknown as vscode.MessageItem,
    );

    await runLogicalBackup(deps);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'revealFileInOS',
      vscode.Uri.file(DESTINATION),
    );
  });

  it('reveals the backup through the WSL share when the server path is not one the client can see', async () => {
    // What Windows looks like: the gem's /root/... is reachable only as \\wsl$\...
    vi.mocked(isWindows).mockReturnValue(true);
    vi.mocked(wslExistsSync).mockImplementation((p) => p.startsWith('\\\\wsl$'));
    const deps = makeDeps();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
      'Reveal in File Explorer' as unknown as vscode.MessageItem,
    );

    await runLogicalBackup(deps);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'revealFileInOS',
      vscode.Uri.file('\\\\wsl$\\Ubuntu\\root\\db-1\\backups\\gs64stone.dbf'),
    );
  });

  it('omits the reveal action when the backup is on a filesystem the client cannot reach', async () => {
    vi.mocked(wslExistsSync).mockReturnValue(false);
    const deps = makeDeps();

    await runLogicalBackup(deps);

    const infoArgs = vi.mocked(vscode.window.showInformationMessage).mock.calls[0];
    expect(infoArgs).toHaveLength(1);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'revealFileInOS',
      expect.anything(),
    );
  });

  it('omits the reveal action on Windows when the WSL share cannot reach the backup either', async () => {
    vi.mocked(isWindows).mockReturnValue(true);
    vi.mocked(wslExistsSync).mockReturnValue(false);
    const deps = makeDeps();

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
      if (code.includes('SystemRepository fileNames')) return `${EXTENT}\n`;
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
      if (code.includes('SystemRepository fileNames')) return `${EXTENT}\n`;
      if (code.includes('needsCommit')) return 'true';
      throw new Error('abort failed');
    });
    const deps = makeDeps({ execute });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Discard changes and back up' as unknown as vscode.MessageItem,
    );

    const ok = await runLogicalBackup(deps);

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Could not abort the session: abort failed',
    );
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
      if (code.includes('SystemRepository fileNames')) return `${EXTENT}\n`;
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

  it('is cancelled without backing up when the destination prompt is dismissed', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
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
