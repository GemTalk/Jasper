import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../wslBridge', () => ({
  needsWsl: vi.fn(() => false),
  getWslNetworkInfoCached: vi.fn(() => undefined),
  refreshWslNetworkInfo: vi.fn(async () => ({
    mirrored: false,
    ip: undefined,
    netldiHost: undefined,
  })),
}));

import { ProcessItem, ProcessTreeProvider } from '../processTreeProvider';
import { ProcessManager } from '../processManager';
import { GemStoneProcess } from '../sysadminTypes';
import * as wslBridge from '../wslBridge';

function stoneProcess(overrides: Partial<GemStoneProcess> = {}): GemStoneProcess {
  return {
    type: 'stone',
    name: 'gs64stone',
    version: '3.7.4',
    pid: 1000,
    startTime: 'Apr 22 10:00:00',
    status: 'OK',
    responding: true,
    ...overrides,
  };
}

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

describe('ProcessItem tooltip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stone tooltip never includes a Host line, even when WSL info is supplied', () => {
    const item = new ProcessItem(stoneProcess(), {
      mirrored: true,
      ip: undefined,
      netldiHost: 'localhost',
      wslCoreVersion: '2.0.9.0',
      supportsMirrored: true,
    });
    expect(String(item.tooltip)).toContain('Stone: gs64stone');
    expect(String(item.tooltip)).not.toContain('Host:');
  });

  it('netldi tooltip has no Host line when no WSL info is supplied', () => {
    const item = new ProcessItem(netldiProcess());
    expect(String(item.tooltip)).toContain('NetLDI: gs64ldi');
    expect(String(item.tooltip)).toContain('Port: 50377');
    expect(String(item.tooltip)).not.toContain('Host:');
  });

  it('netldi tooltip shows "Host: localhost" under mirrored WSL networking', () => {
    const item = new ProcessItem(netldiProcess(), {
      mirrored: true,
      ip: undefined,
      netldiHost: 'localhost',
      wslCoreVersion: '2.0.9.0',
      supportsMirrored: true,
    });
    expect(String(item.tooltip)).toMatch(/Host: localhost \(WSL mirrored networking\)/);
  });

  it('netldi tooltip shows "Host: <ip>" when not mirrored and IP is known', () => {
    const item = new ProcessItem(netldiProcess(), {
      mirrored: false,
      ip: '172.29.240.2',
      netldiHost: '172.29.240.2',
      wslCoreVersion: '2.0.9.0',
      supportsMirrored: true,
    });
    expect(String(item.tooltip)).toMatch(/Host: 172\.29\.240\.2 \(WSL — may change on reboot\)/);
  });

  it('netldi tooltip omits the Host line when neither mirrored nor an IP is known', () => {
    const item = new ProcessItem(netldiProcess(), {
      mirrored: false,
      ip: undefined,
      netldiHost: undefined,
      wslCoreVersion: undefined,
      supportsMirrored: false,
    });
    expect(String(item.tooltip)).not.toContain('Host:');
  });

  it('responding process tooltip shows Status: OK without the stale warning', () => {
    const item = new ProcessItem(stoneProcess());
    expect(String(item.tooltip)).toContain('Status: OK');
    expect(String(item.tooltip)).not.toContain('stale lock');
  });

  it('stale stone tooltip flags the not-responding state and surfaces the gslist status', () => {
    const item = new ProcessItem(stoneProcess({ status: 'frozen', responding: false }));
    expect(String(item.tooltip)).toContain('Status: frozen (not responding — stale lock)');
  });

  it('stale stone description leads with the gslist status', () => {
    const item = new ProcessItem(stoneProcess({ status: 'frozen', responding: false, pid: 4106 }));
    expect(item.description).toBe('frozen | 3.7.4 | PID 4106');
  });

  it('responding stone description omits the status prefix', () => {
    const item = new ProcessItem(stoneProcess({ pid: 4106 }));
    expect(item.description).toBe('3.7.4 | PID 4106');
  });

  it('stale process uses a distinct contextValue suffix so menus can target it', () => {
    const responding = new ProcessItem(stoneProcess());
    const stale = new ProcessItem(stoneProcess({ status: 'frozen', responding: false }));
    expect(responding.contextValue).toBe('gemstoneProcessStone');
    expect(stale.contextValue).toBe('gemstoneProcessStoneStale');
  });
});

describe('ProcessTreeProvider.getChildren', () => {
  function makeManager(processes: GemStoneProcess[]) {
    return {
      getProcesses: vi.fn(() => processes),
      refreshProcesses: vi.fn(),
    } as unknown as ProcessManager;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not consult WSL network info on non-Windows', () => {
    vi.mocked(wslBridge.needsWsl).mockReturnValue(false);
    const provider = new ProcessTreeProvider(makeManager([netldiProcess()]));
    const items = provider.getChildren();
    expect(items).toHaveLength(1);
    expect(String(items[0].tooltip)).not.toContain('Host:');
    expect(wslBridge.getWslNetworkInfoCached).not.toHaveBeenCalled();
    expect(wslBridge.refreshWslNetworkInfo).not.toHaveBeenCalled();
  });

  it('on Windows+WSL with cached info, passes that info into items', () => {
    vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
    vi.mocked(wslBridge.getWslNetworkInfoCached).mockReturnValue({
      mirrored: true,
      ip: undefined,
      netldiHost: 'localhost',
      wslCoreVersion: '2.0.9.0',
      supportsMirrored: true,
    });
    const provider = new ProcessTreeProvider(makeManager([netldiProcess()]));
    const items = provider.getChildren();
    expect(String(items[0].tooltip)).toContain('Host: localhost');
    // Cache was warm — no fresh refresh kicked off on this getChildren.
    expect(wslBridge.refreshWslNetworkInfo).not.toHaveBeenCalled();
  });

  it('on Windows+WSL with cold cache, kicks off a refresh and fires re-render when it lands', async () => {
    vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
    vi.mocked(wslBridge.getWslNetworkInfoCached).mockReturnValue(undefined);
    let resolveRefresh!: (v: wslBridge.WslNetworkInfo) => void;
    vi.mocked(wslBridge.refreshWslNetworkInfo).mockReturnValue(
      new Promise<wslBridge.WslNetworkInfo>((r) => {
        resolveRefresh = r;
      }),
    );
    const provider = new ProcessTreeProvider(makeManager([netldiProcess()]));
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);
    provider.getChildren();
    expect(wslBridge.refreshWslNetworkInfo).toHaveBeenCalledOnce();
    resolveRefresh({
      mirrored: true,
      ip: undefined,
      netldiHost: 'localhost',
      wslCoreVersion: '2.0.9.0',
      supportsMirrored: true,
    });
    // Flush the microtask chain: refresh → finally → then → event fire
    await new Promise((r) => setTimeout(r, 0));
    expect(listener).toHaveBeenCalled();
  });

  it('refresh() triggers both process refresh and WSL network refresh', () => {
    vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
    vi.mocked(wslBridge.getWslNetworkInfoCached).mockReturnValue(undefined);
    vi.mocked(wslBridge.refreshWslNetworkInfo).mockResolvedValue({
      mirrored: false,
      ip: '10.0.0.5',
      netldiHost: '10.0.0.5',
      wslCoreVersion: '2.0.9.0',
      supportsMirrored: true,
    });
    const manager = makeManager([netldiProcess()]);
    const provider = new ProcessTreeProvider(manager);
    provider.refresh();
    expect(manager.refreshProcesses).toHaveBeenCalledOnce();
    expect(wslBridge.refreshWslNetworkInfo).toHaveBeenCalledOnce();
  });

  it('does not kick off a second refresh while one is in flight', () => {
    vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
    vi.mocked(wslBridge.getWslNetworkInfoCached).mockReturnValue(undefined);
    vi.mocked(wslBridge.refreshWslNetworkInfo).mockReturnValue(
      new Promise<wslBridge.WslNetworkInfo>(() => {
        /* never resolves */
      }),
    );
    const provider = new ProcessTreeProvider(makeManager([netldiProcess()]));
    provider.getChildren();
    provider.getChildren();
    expect(wslBridge.refreshWslNetworkInfo).toHaveBeenCalledOnce();
  });
});
