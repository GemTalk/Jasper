import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

vi.mock('../../wslBridge', () => ({
  needsWsl: vi.fn(() => false),
  refreshWslNetworkInfo: vi.fn(async () => ({
    mirrored: false,
    ip: undefined,
    netldiHost: undefined,
  })),
}));

import { ProcessWatcher } from '../processWatcher';
import { ProcessManager } from '../processManager';
import { GemStoneProcess } from '../../sysadminTypes';
import * as wslBridge from '../../wslBridge';

function netldiProcess(overrides: Partial<GemStoneProcess> = {}): GemStoneProcess {
  return {
    type: 'netldi',
    name: 'gs64ldi',
    version: '3.7.4',
    pid: 2000,
    port: 50377,
    startTime: 'Apr 22 10:00:05',
    status: 'OK',
    responding: true,
    ...overrides,
  };
}

function makeManager(processes: GemStoneProcess[]) {
  return {
    getProcesses: vi.fn(() => processes),
    refreshProcesses: vi.fn(),
  } as unknown as ProcessManager;
}

describe('watching the running servers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks gslist again and says so', () => {
    vi.mocked(wslBridge.needsWsl).mockReturnValue(false);
    const manager = makeManager([netldiProcess()]);
    const watcher = new ProcessWatcher(manager);
    const listener = vi.fn();
    watcher.onDidChange(listener);

    watcher.refresh();

    expect(manager.refreshProcesses).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('leaves the WSL network alone on a machine that does not need it', () => {
    vi.mocked(wslBridge.needsWsl).mockReturnValue(false);
    new ProcessWatcher(makeManager([netldiProcess()])).refresh();
    expect(wslBridge.refreshWslNetworkInfo).not.toHaveBeenCalled();
  });

  it('re-probes the WSL network alongside the process list', () => {
    vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
    vi.mocked(wslBridge.refreshWslNetworkInfo).mockResolvedValue({
      mirrored: false,
      ip: '10.0.0.5',
      netldiHost: '10.0.0.5',
      wslCoreVersion: '2.0.9.0',
      supportsMirrored: true,
    });
    const manager = makeManager([netldiProcess()]);

    new ProcessWatcher(manager).refresh();

    expect(manager.refreshProcesses).toHaveBeenCalledOnce();
    expect(wslBridge.refreshWslNetworkInfo).toHaveBeenCalledOnce();
  });

  // The probe is fire-and-forget, so the first event carries whatever was
  // cached. Saying so again when the answer lands is what gets the new WSL
  // address onto the panel without the user pressing Refresh.
  it('says so a second time once the probe lands', async () => {
    vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
    let landed!: (v: wslBridge.WslNetworkInfo) => void;
    vi.mocked(wslBridge.refreshWslNetworkInfo).mockReturnValue(
      new Promise<wslBridge.WslNetworkInfo>((resolve) => {
        landed = resolve;
      }),
    );
    const watcher = new ProcessWatcher(makeManager([netldiProcess()]));
    const listener = vi.fn();
    watcher.onDidChange(listener);

    watcher.refresh();
    expect(listener).toHaveBeenCalledOnce();

    landed({
      mirrored: true,
      ip: undefined,
      netldiHost: 'localhost',
      wslCoreVersion: '2.0.9.0',
      supportsMirrored: true,
    });
    // Flush the microtask chain: refresh → finally → then → event fire
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not start a second probe while one is in flight', () => {
    vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
    vi.mocked(wslBridge.refreshWslNetworkInfo).mockReturnValue(
      new Promise<wslBridge.WslNetworkInfo>(() => {
        /* never resolves */
      }),
    );
    const watcher = new ProcessWatcher(makeManager([netldiProcess()]));

    watcher.refresh();
    watcher.refresh();

    expect(wslBridge.refreshWslNetworkInfo).toHaveBeenCalledOnce();
  });
});
