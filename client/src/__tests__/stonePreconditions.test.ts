import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('child_process');
vi.mock('fs');
vi.mock('../wslBridge', () => ({
  needsWsl: vi.fn(() => false),
  getWslInfo: vi.fn(() => ({
    available: false,
    defaultDistro: undefined,
    homeDir: undefined,
    arch: undefined,
    wslVersion: undefined,
  })),
  invalidateWslCache: vi.fn(),
  wslExecSync: vi.fn(() => ''),
  refreshWslNetworkInfo: vi.fn(async () => ({
    mirrored: false,
    ip: undefined,
    netldiHost: undefined,
    wslCoreVersion: undefined,
    supportsMirrored: false,
  })),
  invalidateWslNetworkCache: vi.fn(),
  updateWslConfigMirrored: vi.fn((c: string) => c),
}));

import { exec } from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ensureStonePreconditions } from '../stonePreconditions';

// ── Helpers ────────────────────────────────────────────────

const SHMMAX_1GB = 1073741824;
const SHMALL_1GB = 262144;
const SHMMAX_SMALL = 4194304; // 4 MB
const SHMALL_SMALL = 1024;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function shmOutput(shmmax: number, shmall: number): string {
  return process.platform === 'linux'
    ? `kernel.shmmax = ${shmmax}\nkernel.shmall = ${shmall}\n`
    : `kern.sysv.shmmax: ${shmmax}\nkern.sysv.shmall: ${shmall}\n`;
}

/** Have `sysctl` (via exec) report the given [shmmax, shmall] pairs on
 *  successive reads, repeating the last pair once exhausted. */
function mockSharedMemory(pairs: Array<[number, number]>): void {
  let call = 0;
  vi.mocked(exec).mockImplementation((_cmd, _opts, cb) => {
    const [max, all] = pairs[Math.min(call, pairs.length - 1)];
    call++;
    cb?.(null, shmOutput(max, all), '');
    return {} as ReturnType<typeof exec>;
  });
}

/** Have the logind config report a fixed RemoveIPC state (Linux only). */
function mockRemoveIpc(configured: boolean): void {
  vi.mocked(fs.existsSync).mockReturnValue(false);
  vi.mocked(fs.readdirSync).mockReturnValue([]);
  vi.mocked(fs.readFileSync).mockImplementation(() => {
    if (configured) return '[Login]\nRemoveIPC=no\n';
    throw new Error('ENOENT');
  });
}

/** Resolve every `waitForTerminalClose` by firing both setup-terminal names,
 *  so each waiter matches whichever name it is listening for. */
function autoCloseTerminals(): void {
  vi.mocked(vscode.window.onDidCloseTerminal).mockImplementation((handler) => {
    setTimeout(() => {
      handler({ name: 'GemStone: Shared Memory Setup' } as unknown as vscode.Terminal);
      handler({ name: 'GemStone: RemoveIPC Setup' } as unknown as vscode.Terminal);
    }, 0);
    return { dispose: vi.fn() };
  });
}

function clickContinue(): void {
  vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
    'Continue' as unknown as vscode.MessageItem,
  );
}

function clickCancel(): void {
  vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
}

// ── Suite ──────────────────────────────────────────────────

describe('ensureStonePreconditions', () => {
  let originalPlatform: NodeJS.Platform;

  beforeEach(() => {
    vi.clearAllMocks();
    originalPlatform = process.platform;
    mockSharedMemory([[SHMMAX_1GB, SHMALL_1GB]]);
    mockRemoveIpc(true);
    autoCloseTerminals();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('is a no-op on Windows, where the Configure OS view handles setup', async () => {
    setPlatform('win32');

    const proceed = await ensureStonePreconditions();

    expect(proceed).toBe(true);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('proceeds without prompting when shared memory is already configured (macOS)', async () => {
    setPlatform('darwin');

    const proceed = await ensureStonePreconditions();

    expect(proceed).toBe(true);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('proceeds without prompting when both prerequisites are met (Linux)', async () => {
    setPlatform('linux');
    mockRemoveIpc(true);

    const proceed = await ensureStonePreconditions();

    expect(proceed).toBe(true);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('cancels the start when the user declines the setup prompt (macOS)', async () => {
    setPlatform('darwin');
    mockSharedMemory([[SHMMAX_SMALL, SHMALL_SMALL]]);
    clickCancel();

    const proceed = await ensureStonePreconditions();

    expect(proceed).toBe(false);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('warns about a terminal and password before opening one (macOS)', async () => {
    setPlatform('darwin');
    mockSharedMemory([[SHMMAX_SMALL, SHMALL_SMALL]]);
    clickCancel();

    await ensureStonePreconditions();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('password'),
      { modal: true },
      'Continue',
    );
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('shared memory'),
      { modal: true },
      'Continue',
    );
  });

  it('runs the macOS setup script and proceeds once memory is configured', async () => {
    setPlatform('darwin');
    mockSharedMemory([
      [SHMMAX_SMALL, SHMALL_SMALL],
      [SHMMAX_1GB, SHMALL_1GB],
    ]);
    clickContinue();

    const proceed = await ensureStonePreconditions();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.runSetSharedMemory');
    expect(proceed).toBe(true);
  });

  it('runs the Linux setup script (not the macOS one) on Linux', async () => {
    setPlatform('linux');
    mockSharedMemory([
      [SHMMAX_SMALL, SHMALL_SMALL],
      [SHMMAX_1GB, SHMALL_1GB],
    ]);
    mockRemoveIpc(true);
    clickContinue();

    await ensureStonePreconditions();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.runSetSharedMemoryLinux');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('gemstone.runSetSharedMemory');
  });

  it('cancels the start when shared memory is still too small after setup', async () => {
    setPlatform('darwin');
    mockSharedMemory([[SHMMAX_SMALL, SHMALL_SMALL]]); // never becomes large enough
    clickContinue();

    const proceed = await ensureStonePreconditions();

    expect(proceed).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('still below 1 GB'),
    );
  });

  it('also offers RemoveIPC setup on Linux and configures both when accepted', async () => {
    setPlatform('linux');
    mockSharedMemory([
      [SHMMAX_SMALL, SHMALL_SMALL],
      [SHMMAX_1GB, SHMALL_1GB],
    ]);
    mockRemoveIpc(false);
    clickContinue();

    const proceed = await ensureStonePreconditions();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('RemoveIPC=no'),
      { modal: true },
      'Continue',
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.runSetSharedMemoryLinux');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.runSetRemoveIPC');
    expect(proceed).toBe(true);
  });

  it('prompts for RemoveIPC alone when only that is missing, and does not block the start', async () => {
    setPlatform('linux');
    mockSharedMemory([[SHMMAX_1GB, SHMALL_1GB]]);
    mockRemoveIpc(false);
    clickContinue();

    const proceed = await ensureStonePreconditions();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.runSetRemoveIPC');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'gemstone.runSetSharedMemoryLinux',
    );
    expect(proceed).toBe(true);
  });
});
