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
  updateWslConfigMirrored: vi.fn((c: string) => c + '[wsl2]\nnetworkingMode=mirrored\n'),
}));

import { exec } from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  OsConfigTreeProvider,
  isSharedMemoryConfigured,
  getRemoveIpcConfigured,
  type OsConfigNode,
} from '../sharedMemoryTreeProvider';
import * as wslBridge from '../wslBridge';
import { type WslNetworkInfo } from '../wslBridge';

// ── Helpers ────────────────────────────────────────────────

const LINUX_SHMMAX_4GB = 4294967296;
const LINUX_SHMALL_4GB = 1048576;
const LINUX_SYSCTL_4GB = `kernel.shmmax = ${LINUX_SHMMAX_4GB}\nkernel.shmall = ${LINUX_SHMALL_4GB}\n`;
const LINUX_SYSCTL_UNLIMITED =
  'kernel.shmmax = 18446744073692774399\nkernel.shmall = 18446744073692774399\n';
const LINUX_SYSCTL_1GB = 'kernel.shmmax = 1073741824\nkernel.shmall = 262144\n';

const MACOS_SYSCTL_4GB = `kern.sysv.shmmax: ${LINUX_SHMMAX_4GB}\nkern.sysv.shmall: ${LINUX_SHMALL_4GB}\n`;
const MACOS_SYSCTL_SMALL = 'kern.sysv.shmmax: 4194304\nkern.sysv.shmall: 1024\n'; // 4 MB / 4 MB

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function makeContext(extensionPath = '/ext') {
  return {
    extensionPath,
    subscriptions: { push: vi.fn() },
  } as unknown as vscode.ExtensionContext;
}

/** A vscode.Terminal test double — only `show`/`sendText` are spied on; the rest of the interface is stubbed. */
function fakeTerminal(): vscode.Terminal {
  return { show: vi.fn(), sendText: vi.fn(), dispose: vi.fn() } as unknown as vscode.Terminal;
}

/** Retrieve the callback registered for a command by name. */
function getCommand(commandId: string): (() => unknown) | undefined {
  const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
  const call = calls.find(([id]) => id === commandId);
  return call?.[1] as (() => unknown) | undefined;
}

/** Make exec call its callback immediately with the given stdout output. */
function mockExec(output: string): void {
  vi.mocked(exec).mockImplementation((_cmd, _opts, cb) => {
    cb?.(null, output, '');
    return {} as ReturnType<typeof exec>;
  });
}

/** Make exec call its callback with an error (simulates sysctl not found). */
function mockExecError(): void {
  vi.mocked(exec).mockImplementation((_cmd, _opts, cb) => {
    cb?.(new Error('command not found'), '', '');
    return {} as ReturnType<typeof exec>;
  });
}

/** Call getChildren(), wait for async load to complete, then return cached nodes. */
async function getRootNodes(provider: OsConfigTreeProvider): Promise<OsConfigNode[]> {
  const initial = provider.getChildren();
  if (Array.isArray(initial) && initial.length === 1 && initial[0].kind === 'loading') {
    // Wait for the async _loadConfig to fire onDidChangeTreeData
    await new Promise<void>((resolve) => {
      const disposable = provider.onDidChangeTreeData(() => {
        disposable.dispose();
        resolve();
      });
    });
    return provider.getChildren();
  }
  return Array.isArray(initial) ? initial : await initial;
}

/** Find the (at most one) node of a given kind, narrowed to that variant. */
function findByKind<K extends OsConfigNode['kind']>(
  nodes: OsConfigNode[],
  kind: K,
): Extract<OsConfigNode, { kind: K }> | undefined {
  return nodes.find((n): n is Extract<OsConfigNode, { kind: K }> => n.kind === kind);
}

/** The `command` id of each action node, in order (non-action nodes → undefined). */
function actionCommands(nodes: OsConfigNode[]): (string | undefined)[] {
  return nodes.map((n) => (n.kind === 'action' ? n.command : undefined));
}

/** The codicon id of a tree item's icon — every node in this provider uses a ThemeIcon. */
function themeIconId(item: vscode.TreeItem): string {
  const icon = item.iconPath;
  if (!(icon instanceof vscode.ThemeIcon)) {
    throw new Error(`expected a ThemeIcon, got ${String(icon)}`);
  }
  return icon.id;
}

// ── Suite ──────────────────────────────────────────────────

describe('OsConfigTreeProvider', () => {
  let provider: OsConfigTreeProvider;
  let originalPlatform: NodeJS.Platform;

  beforeEach(() => {
    vi.clearAllMocks();
    originalPlatform = process.platform;
    provider = new OsConfigTreeProvider();

    // Default: not Windows, so wslBridge is not used
    vi.mocked(wslBridge.needsWsl).mockReturnValue(false);

    // Default: sysctl succeeds with empty output, no logind files
    mockExec('');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    vi.mocked(vscode.commands.registerCommand).mockClear();
    vi.mocked(vscode.window.createTerminal).mockReturnValue(fakeTerminal());
    vi.mocked(vscode.window.showInformationMessage).mockClear();
    vi.mocked(vscode.window.onDidCloseTerminal).mockClear();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  // ── refresh ──────────────────────────────────────────────

  describe('refresh', () => {
    it('fires onDidChangeTreeData', () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);
      provider.refresh();
      expect(listener).toHaveBeenCalledWith(undefined);
    });

    it('clears the cache so getChildren re-fetches', async () => {
      setPlatform('darwin');
      mockExec(MACOS_SYSCTL_4GB);
      await getRootNodes(provider); // populate cache

      // Change mock — without refresh, cache would still return old data
      mockExec(MACOS_SYSCTL_SMALL);
      provider.refresh();
      const nodes = await getRootNodes(provider);
      expect(findByKind(nodes, 'sharedMemoryStatus')?.configured).toBe(false);
    });
  });

  // ── getChildren — top-level ───────────────────────────────

  describe('getChildren (top-level)', () => {
    it('returns a loading node before async data is ready', () => {
      setPlatform('darwin');
      mockExec(MACOS_SYSCTL_4GB);
      const nodes = provider.getChildren() as OsConfigNode[];
      expect(nodes).toHaveLength(1);
      expect(nodes[0].kind).toBe('loading');
    });

    it('on macOS returns only a sharedMemoryStatus node', async () => {
      setPlatform('darwin');
      mockExec(MACOS_SYSCTL_4GB);
      const nodes = await getRootNodes(provider);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].kind).toBe('sharedMemoryStatus');
    });

    it('on Linux returns sharedMemoryStatus and removeIpcStatus', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      const nodes = await getRootNodes(provider);
      expect(nodes).toHaveLength(2);
      expect(nodes[0].kind).toBe('sharedMemoryStatus');
      expect(nodes[1].kind).toBe('removeIpcStatus');
    });

    it('returns sharedMemoryStatus configured=true when shmmax and shmall >= 1 GB (Linux)', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_1GB);
      const [node] = await getRootNodes(provider);
      expect(node).toMatchObject({ kind: 'sharedMemoryStatus', configured: true });
    });

    it('returns sharedMemoryStatus configured=false when shmmax < 1 GB (macOS)', async () => {
      setPlatform('darwin');
      mockExec(MACOS_SYSCTL_SMALL);
      const [node] = await getRootNodes(provider);
      expect(node).toMatchObject({ kind: 'sharedMemoryStatus', configured: false });
    });

    it('returns sharedMemoryStatus configured=false when exec errors', async () => {
      setPlatform('darwin');
      mockExecError();
      const [node] = await getRootNodes(provider);
      expect(node).toMatchObject({ kind: 'sharedMemoryStatus', configured: false, gbLabel: '0' });
    });

    it('labels large Linux default shmmax as "≥ 1"', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_UNLIMITED);
      const nodes = await getRootNodes(provider);
      expect(findByKind(nodes, 'sharedMemoryStatus')?.gbLabel).toBe('≥ 1');
    });

    it('labels exact 1 GB shmmax as "1"', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_1GB);
      const nodes = await getRootNodes(provider);
      expect(findByKind(nodes, 'sharedMemoryStatus')?.gbLabel).toBe('1');
    });

    it('removeIpcStatus configured=false when no logind.conf', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const nodes = await getRootNodes(provider);
      const removeIpc = findByKind(nodes, 'removeIpcStatus');
      expect(removeIpc?.configured).toBe(false);
    });

    it('removeIpcStatus configured=true when logind.conf has RemoveIPC=no', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(fs.readFileSync).mockReturnValue('[Login]\nRemoveIPC=no\n');
      const nodes = await getRootNodes(provider);
      const removeIpc = findByKind(nodes, 'removeIpcStatus');
      expect(removeIpc?.configured).toBe(true);
    });

    it('removeIpcStatus configured=false when logind.conf has RemoveIPC=yes', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(fs.readFileSync).mockReturnValue('[Login]\nRemoveIPC=yes\n');
      const nodes = await getRootNodes(provider);
      const removeIpc = findByKind(nodes, 'removeIpcStatus');
      expect(removeIpc?.configured).toBe(false);
    });

    it('ignores commented-out RemoveIPC lines', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(fs.readFileSync).mockReturnValue('# RemoveIPC=no\n');
      const nodes = await getRootNodes(provider);
      const removeIpc = findByKind(nodes, 'removeIpcStatus');
      expect(removeIpc?.configured).toBe(false);
    });

    it('drop-in file overrides main logind.conf (last wins)', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['gemstone.conf'] as unknown as ReturnType<
        typeof fs.readdirSync
      >);
      vi.mocked(fs.readFileSync).mockImplementation((filepath: fs.PathOrFileDescriptor) => {
        if (String(filepath).endsWith('logind.conf') && !String(filepath).includes('.d/')) {
          return 'RemoveIPC=yes\n'; // main file says yes
        }
        return '[Login]\nRemoveIPC=no\n'; // drop-in overrides to no
      });
      const nodes = await getRootNodes(provider);
      const removeIpc = findByKind(nodes, 'removeIpcStatus');
      expect(removeIpc?.configured).toBe(true);
    });

    it('main logind.conf wins when drop-in sets it back to yes', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['zz-override.conf'] as unknown as ReturnType<
        typeof fs.readdirSync
      >);
      vi.mocked(fs.readFileSync).mockImplementation((filepath: fs.PathOrFileDescriptor) => {
        if (String(filepath).includes('logind.conf.d')) {
          return 'RemoveIPC=yes\n';
        }
        return 'RemoveIPC=no\n';
      });
      const nodes = await getRootNodes(provider);
      const removeIpc = findByKind(nodes, 'removeIpcStatus');
      expect(removeIpc?.configured).toBe(false);
    });

    it('returns cached nodes on second call without re-running exec', async () => {
      setPlatform('darwin');
      mockExec(MACOS_SYSCTL_4GB);
      await getRootNodes(provider);
      mockExec(''); // change mock — cache should prevent this from being used
      const nodes = provider.getChildren() as OsConfigNode[];
      expect(findByKind(nodes, 'sharedMemoryStatus')?.configured).toBe(true);
    });
  });

  // ── getChildren — action nodes ────────────────────────────

  describe('getChildren (action nodes)', () => {
    it('sharedMemoryStatus not configured on Linux returns one action', async () => {
      setPlatform('linux');
      const parent = { kind: 'sharedMemoryStatus' as const, configured: false, gbLabel: '1' };
      const children = await provider.getChildren(parent);
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({
        kind: 'action',
        command: 'gemstone.runSetSharedMemoryLinux',
      });
    });

    it('sharedMemoryStatus not configured on macOS returns one action', async () => {
      setPlatform('darwin');
      const parent = { kind: 'sharedMemoryStatus' as const, configured: false, gbLabel: '0' };
      const children = await provider.getChildren(parent);
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({ kind: 'action', command: 'gemstone.runSetSharedMemory' });
    });

    it('sharedMemoryStatus configured returns no children', async () => {
      const parent = { kind: 'sharedMemoryStatus' as const, configured: true, gbLabel: '4' };
      expect(await provider.getChildren(parent)).toHaveLength(0);
    });

    it('removeIpcStatus not configured returns two actions', async () => {
      const parent = { kind: 'removeIpcStatus' as const, configured: false };
      const children = await provider.getChildren(parent);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({ kind: 'action', command: 'gemstone.runSetRemoveIPC' });
      expect(children[1]).toMatchObject({ kind: 'action', command: 'gemstone.removeIpcInfo' });
    });

    it('removeIpcStatus configured returns no children', async () => {
      const parent = { kind: 'removeIpcStatus' as const, configured: true };
      expect(await provider.getChildren(parent)).toHaveLength(0);
    });
  });

  // ── getTreeItem ───────────────────────────────────────────

  describe('getTreeItem', () => {
    describe('loading', () => {
      it('shows a spinning loading icon', () => {
        const item = provider.getTreeItem({ kind: 'loading' });
        expect(item.label).toContain('Checking');
        expect(themeIconId(item)).toBe('loading~spin');
        expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
      });
    });

    describe('sharedMemoryStatus', () => {
      it('configured: check icon, None collapsible state, label includes gbLabel', () => {
        const item = provider.getTreeItem({
          kind: 'sharedMemoryStatus',
          configured: true,
          gbLabel: '4',
        });
        expect(item.label).toContain('4');
        expect(item.label).toContain('configured');
        expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
        expect(themeIconId(item)).toBe('check');
      });

      it('not configured: warning icon, Expanded state, tooltip set', () => {
        const item = provider.getTreeItem({
          kind: 'sharedMemoryStatus',
          configured: false,
          gbLabel: '1',
        });
        expect(item.label).toContain('not configured');
        expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
        expect(themeIconId(item)).toBe('warning');
        expect(item.tooltip).toBeTruthy();
      });

      it('uses "≥ 1" gbLabel in label', () => {
        const item = provider.getTreeItem({
          kind: 'sharedMemoryStatus',
          configured: true,
          gbLabel: '≥ 1',
        });
        expect(item.label).toContain('≥ 1');
      });
    });

    describe('removeIpcStatus', () => {
      it('configured: check icon, None state, no tooltip', () => {
        const item = provider.getTreeItem({ kind: 'removeIpcStatus', configured: true });
        expect(item.label).toContain('configured');
        expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
        expect(themeIconId(item)).toBe('check');
        expect(item.tooltip).toBeUndefined();
      });

      it('not configured: warning icon, Expanded state, tooltip explains risk', () => {
        const item = provider.getTreeItem({ kind: 'removeIpcStatus', configured: false });
        expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
        expect(themeIconId(item)).toBe('warning');
        expect(String(item.tooltip)).toMatch(/shared memory|IPC/i);
      });
    });

    describe('action nodes', () => {
      it('runSetSharedMemory: terminal icon', () => {
        const item = provider.getTreeItem({
          kind: 'action',
          text: 'Run',
          command: 'gemstone.runSetSharedMemory',
        });
        expect(themeIconId(item)).toBe('terminal');
      });

      it('runSetSharedMemoryLinux: terminal icon, mentions no restart in tooltip', () => {
        const item = provider.getTreeItem({
          kind: 'action',
          text: 'Run',
          command: 'gemstone.runSetSharedMemoryLinux',
        });
        expect(themeIconId(item)).toBe('terminal');
        expect(String(item.tooltip)).toMatch(/no restart/i);
      });

      it('runSetSharedMemory: terminal icon, mentions no restart in tooltip', () => {
        const item = provider.getTreeItem({
          kind: 'action',
          text: 'Run',
          command: 'gemstone.runSetSharedMemory',
        });
        expect(themeIconId(item)).toBe('terminal');
        expect(String(item.tooltip)).toMatch(/no restart/i);
      });

      it('runSetRemoveIPC: terminal icon', () => {
        const item = provider.getTreeItem({
          kind: 'action',
          text: 'Run',
          command: 'gemstone.runSetRemoveIPC',
        });
        expect(themeIconId(item)).toBe('terminal');
      });

      it('sharedMemoryInfo: info icon', () => {
        const item = provider.getTreeItem({
          kind: 'action',
          text: 'Info',
          command: 'gemstone.sharedMemoryInfo',
        });
        expect(themeIconId(item)).toBe('info');
      });

      it('removeIpcInfo: info icon, tooltip mentions systemd-logind', () => {
        const item = provider.getTreeItem({
          kind: 'action',
          text: 'Info',
          command: 'gemstone.removeIpcInfo',
        });
        expect(themeIconId(item)).toBe('info');
        expect(String(item.tooltip)).toMatch(/systemd-logind/);
      });

      it('sets item.command with command id and title', () => {
        const item = provider.getTreeItem({
          kind: 'action',
          text: 'My Label',
          command: 'gemstone.runSetRemoveIPC',
        });
        expect(item.command).toEqual({ command: 'gemstone.runSetRemoveIPC', title: 'My Label' });
      });
    });
  });

  // ── registerCommands ─────────────────────────────────────

  describe('registerCommands', () => {
    it('registers all five commands', () => {
      provider.registerCommands(makeContext());
      const registeredIds = vi.mocked(vscode.commands.registerCommand).mock.calls.map(([id]) => id);
      expect(registeredIds).toContain('gemstone.runSetSharedMemory');
      expect(registeredIds).toContain('gemstone.runSetSharedMemoryLinux');
      expect(registeredIds).toContain('gemstone.runSetRemoveIPC');
      expect(registeredIds).toContain('gemstone.sharedMemoryInfo');
      expect(registeredIds).toContain('gemstone.removeIpcInfo');
    });

    it('runSetSharedMemory opens a terminal and sends the macOS script path', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);

      getCommand('gemstone.runSetSharedMemory')?.();

      expect(vscode.window.createTerminal).toHaveBeenCalledWith('GemStone: Shared Memory Setup');
      expect(mockTerminal.show).toHaveBeenCalled();
      expect(mockTerminal.sendText).toHaveBeenCalledWith(
        expect.stringContaining('setSharedMemory.sh'),
      );
      expect(mockTerminal.sendText).toHaveBeenCalledWith(expect.stringMatching(/&& exit$/));
    });

    it('runSetSharedMemoryLinux opens a terminal and sends the Linux script path', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);

      getCommand('gemstone.runSetSharedMemoryLinux')?.();

      expect(mockTerminal.sendText).toHaveBeenCalledWith(
        expect.stringContaining('setSharedMemoryLinux.sh'),
      );
    });

    it('runSetRemoveIPC opens a terminal and sends the RemoveIPC script path', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);

      getCommand('gemstone.runSetRemoveIPC')?.();

      expect(vscode.window.createTerminal).toHaveBeenCalledWith('GemStone: RemoveIPC Setup');
      expect(mockTerminal.sendText).toHaveBeenCalledWith(
        expect.stringContaining('setRemoveIPC.sh'),
      );
    });

    it('sharedMemoryInfo shows an information message', () => {
      provider.registerCommands(makeContext());
      getCommand('gemstone.sharedMemoryInfo')?.();
      expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    });

    it('removeIpcInfo shows an information message mentioning systemd-logind', () => {
      provider.registerCommands(makeContext());
      getCommand('gemstone.removeIpcInfo')?.();
      const msg = vi.mocked(vscode.window.showInformationMessage).mock.calls[0][0];
      expect(msg).toMatch(/systemd-logind/);
    });

    it('runSetSharedMemory refreshes the panel when the terminal closes', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);
      const refreshSpy = vi.spyOn(provider, 'refresh');

      getCommand('gemstone.runSetSharedMemory')?.();
      const closeListener = vi.mocked(vscode.window.onDidCloseTerminal).mock.calls[0][0] as (
        t: unknown,
      ) => void;

      closeListener(mockTerminal);
      expect(refreshSpy).toHaveBeenCalledOnce();
    });

    it('runSetSharedMemoryLinux refreshes the panel when the terminal closes', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);
      const refreshSpy = vi.spyOn(provider, 'refresh');

      getCommand('gemstone.runSetSharedMemoryLinux')?.();
      const closeListener = vi.mocked(vscode.window.onDidCloseTerminal).mock.calls[0][0] as (
        t: unknown,
      ) => void;

      closeListener(mockTerminal);
      expect(refreshSpy).toHaveBeenCalledOnce();
    });

    it('runSetRemoveIPC refreshes the panel when the terminal closes', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);
      const refreshSpy = vi.spyOn(provider, 'refresh');

      getCommand('gemstone.runSetRemoveIPC')?.();
      const closeListener = vi.mocked(vscode.window.onDidCloseTerminal).mock.calls[0][0] as (
        t: unknown,
      ) => void;

      closeListener(mockTerminal);
      expect(refreshSpy).toHaveBeenCalledOnce();
    });

    it('does not refresh when a different terminal closes', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);
      const refreshSpy = vi.spyOn(provider, 'refresh');

      getCommand('gemstone.runSetSharedMemory')?.();
      const closeListener = vi.mocked(vscode.window.onDidCloseTerminal).mock.calls[0][0] as (
        t: unknown,
      ) => void;

      closeListener({ show: vi.fn(), sendText: vi.fn() }); // different terminal
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('runSetSharedMemoryLinux script path does not match macOS script', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);

      getCommand('gemstone.runSetSharedMemoryLinux')?.();
      const [linuxCmd] = vi.mocked(mockTerminal.sendText).mock.calls[0];

      vi.mocked(mockTerminal.sendText).mockClear();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);
      getCommand('gemstone.runSetSharedMemory')?.();
      const [macCmd] = vi.mocked(mockTerminal.sendText).mock.calls[0];

      expect(linuxCmd).not.toBe(macCmd);
    });
  });

  // ── Windows / WSL ─────────────────────────────────────────

  describe('Windows WSL status', () => {
    beforeEach(() => {
      setPlatform('win32');
      vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
    });

    it('shows wslStatus + wslNetworking + wslServices + shared memory + removeIpc when version is 2', async () => {
      vi.mocked(wslBridge.getWslInfo).mockReturnValue({
        available: true,
        defaultDistro: 'Ubuntu',
        homeDir: '/home/user',
        arch: 'x86_64',
        wslVersion: 2,
      });
      mockExec(LINUX_SYSCTL_4GB);
      const nodes = await getRootNodes(provider);
      expect(nodes).toHaveLength(5);
      expect(nodes[0]).toMatchObject({ kind: 'wslStatus', distro: 'Ubuntu', wslVersion: 2 });
      expect(nodes[1].kind).toBe('wslNetworkingStatus');
      expect(nodes[2].kind).toBe('wslServicesStatus');
      expect(nodes[3].kind).toBe('sharedMemoryStatus');
      expect(nodes[4].kind).toBe('removeIpcStatus');
    });

    it('shows only wslStatus when version is not 2 (avoids noise before upgrade)', async () => {
      vi.mocked(wslBridge.getWslInfo).mockReturnValue({
        available: true,
        defaultDistro: 'Ubuntu',
        homeDir: '/home/user',
        arch: 'x86_64',
        wslVersion: 1,
      });
      const nodes = await getRootNodes(provider);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({ kind: 'wslStatus', wslVersion: 1 });
    });

    it('shared memory on WSL: runs sysctl via wsl.exe and parses Linux format', async () => {
      vi.mocked(wslBridge.getWslInfo).mockReturnValue({
        available: true,
        defaultDistro: 'Ubuntu',
        homeDir: '/home/user',
        arch: 'x86_64',
        wslVersion: 2,
      });
      mockExec(LINUX_SYSCTL_1GB);
      const nodes = await getRootNodes(provider);
      expect(vi.mocked(exec).mock.calls[0][0]).toBe(
        'wsl.exe -e sysctl kernel.shmmax kernel.shmall',
      );
      const shm = findByKind(nodes, 'sharedMemoryStatus');
      expect(shm?.configured).toBe(true);
    });

    it('removeIpc on WSL: routes logind.conf reads through wslExecSync', async () => {
      vi.mocked(wslBridge.getWslInfo).mockReturnValue({
        available: true,
        defaultDistro: 'Ubuntu',
        homeDir: '/home/user',
        arch: 'x86_64',
        wslVersion: 2,
      });
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(wslBridge.wslExecSync).mockImplementation((cmd: string) => {
        if (cmd.startsWith('ls ')) return ''; // no drop-ins
        if (cmd.startsWith('cat ')) return '[Login]\nRemoveIPC=no\n';
        return '';
      });
      const nodes = await getRootNodes(provider);
      const removeIpc = findByKind(nodes, 'removeIpcStatus');
      expect(removeIpc?.configured).toBe(true);
      // fs was NOT consulted for logind config on the WSL path (other
      // unrelated reads — e.g. Windows services file — are allowed).
      const logindReads = vi
        .mocked(fs.readFileSync)
        .mock.calls.filter((c) => /logind\.conf/.test(String(c[0])));
      expect(logindReads).toHaveLength(0);
    });

    it('removeIpc on WSL: drop-in file overrides main logind.conf', async () => {
      vi.mocked(wslBridge.getWslInfo).mockReturnValue({
        available: true,
        defaultDistro: 'Ubuntu',
        homeDir: '/home/user',
        arch: 'x86_64',
        wslVersion: 2,
      });
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(wslBridge.wslExecSync).mockImplementation((cmd: string) => {
        if (cmd.startsWith('ls ')) return 'zz-gemstone.conf\n';
        if (cmd.includes('logind.conf.d/zz-gemstone.conf')) return 'RemoveIPC=no\n';
        if (cmd.includes('/etc/systemd/logind.conf')) return 'RemoveIPC=yes\n';
        return '';
      });
      const nodes = await getRootNodes(provider);
      const removeIpc = findByKind(nodes, 'removeIpcStatus');
      expect(removeIpc?.configured).toBe(true);
    });

    it('not-configured shared memory on WSL offers the Linux setup script', async () => {
      const parent = { kind: 'sharedMemoryStatus' as const, configured: false, gbLabel: '0' };
      const children = await provider.getChildren(parent);
      expect(children[0]).toMatchObject({
        kind: 'action',
        command: 'gemstone.runSetSharedMemoryLinux',
      });
    });

    it('runSetSharedMemoryLinux on Windows opens a WSL shell with /mnt/<drive> script path', () => {
      provider.registerCommands(makeContext('C:\\ext'));
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);

      getCommand('gemstone.runSetSharedMemoryLinux')?.();

      const createArgs = vi.mocked(vscode.window.createTerminal).mock
        .calls[0][0] as vscode.TerminalOptions;
      expect(createArgs.shellPath).toBe('wsl.exe');
      expect(mockTerminal.sendText).toHaveBeenCalledWith(
        expect.stringContaining('/mnt/c/ext/resources/setSharedMemoryLinux.sh'),
      );
    });

    it('runSetRemoveIPC on Windows opens a WSL shell with /mnt/<drive> script path', () => {
      provider.registerCommands(makeContext('C:\\ext'));
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);

      getCommand('gemstone.runSetRemoveIPC')?.();

      const createArgs = vi.mocked(vscode.window.createTerminal).mock
        .calls[0][0] as vscode.TerminalOptions;
      expect(createArgs.shellPath).toBe('wsl.exe');
      expect(mockTerminal.sendText).toHaveBeenCalledWith(
        expect.stringContaining('/mnt/c/ext/resources/setRemoveIPC.sh'),
      );
    });

    it('wslStatus WSL 2: check icon, None collapsible state', () => {
      const item = provider.getTreeItem({ kind: 'wslStatus', distro: 'Ubuntu', wslVersion: 2 });
      expect(item.label).toContain('WSL 2');
      expect(item.label).toContain('Ubuntu');
      expect(themeIconId(item)).toBe('check');
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
      expect(item.tooltip).toBeUndefined();
    });

    it('wslStatus WSL 1: warning icon, Expanded state, tooltip with upgrade command', () => {
      const item = provider.getTreeItem({ kind: 'wslStatus', distro: 'Ubuntu', wslVersion: 1 });
      expect(item.label).toContain('WSL 1');
      expect(item.label).toContain('upgrade required');
      expect(themeIconId(item)).toBe('warning');
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
      expect(String(item.tooltip)).toContain('wsl --set-version');
    });

    it('wslStatus unknown version: warning icon', () => {
      const item = provider.getTreeItem({
        kind: 'wslStatus',
        distro: 'Debian',
        wslVersion: undefined,
      });
      expect(themeIconId(item)).toBe('warning');
      expect(String(item.tooltip)).toContain('Debian');
    });

    it('wslStatus WSL 1 returns upgrade action child', async () => {
      const parent = { kind: 'wslStatus' as const, distro: 'Ubuntu', wslVersion: 1 };
      const children = await provider.getChildren(parent);
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({ kind: 'action', command: 'gemstone.upgradeWsl2' });
    });

    it('wslStatus WSL 2 returns no children', async () => {
      const parent = { kind: 'wslStatus' as const, distro: 'Ubuntu', wslVersion: 2 };
      expect(await provider.getChildren(parent)).toHaveLength(0);
    });

    it('upgradeWsl2 action: terminal icon', () => {
      const item = provider.getTreeItem({
        kind: 'action',
        text: 'Upgrade',
        command: 'gemstone.upgradeWsl2',
      });
      expect(themeIconId(item)).toBe('terminal');
    });

    it('registers gemstone.upgradeWsl2 command', () => {
      provider.registerCommands(makeContext());
      const registeredIds = vi.mocked(vscode.commands.registerCommand).mock.calls.map(([id]) => id);
      expect(registeredIds).toContain('gemstone.upgradeWsl2');
    });

    it('upgradeWsl2 opens terminal with wsl --set-version command', () => {
      vi.mocked(wslBridge.getWslInfo).mockReturnValue({
        available: true,
        defaultDistro: 'Ubuntu',
        homeDir: '/home/user',
        arch: 'x86_64',
        wslVersion: 1,
      });
      provider.registerCommands(makeContext());
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);

      getCommand('gemstone.upgradeWsl2')?.();

      expect(mockTerminal.sendText).toHaveBeenCalledWith(
        expect.stringContaining('wsl --set-version Ubuntu 2'),
      );
    });

    it('upgradeWsl2 invalidates WSL cache and refreshes when terminal closes', () => {
      vi.mocked(wslBridge.getWslInfo).mockReturnValue({
        available: true,
        defaultDistro: 'Ubuntu',
        homeDir: '/home/user',
        arch: 'x86_64',
        wslVersion: 1,
      });
      provider.registerCommands(makeContext());
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);
      const refreshSpy = vi.spyOn(provider, 'refresh');

      getCommand('gemstone.upgradeWsl2')?.();
      const closeListener = vi.mocked(vscode.window.onDidCloseTerminal).mock.calls[0][0] as (
        t: unknown,
      ) => void;

      closeListener(mockTerminal);
      expect(wslBridge.invalidateWslCache).toHaveBeenCalled();
      expect(refreshSpy).toHaveBeenCalledOnce();
    });
  });

  // ── wslNetworkingStatus ───────────────────────────────────

  describe('wslNetworkingStatus', () => {
    const mirroredInfo: WslNetworkInfo = {
      mirrored: true,
      ip: undefined,
      netldiHost: 'localhost',
      wslCoreVersion: '2.0.9.0',
      supportsMirrored: true,
    };
    const natCapableInfo: WslNetworkInfo = {
      mirrored: false,
      ip: '172.29.240.2',
      netldiHost: '172.29.240.2',
      wslCoreVersion: '2.0.9.0',
      supportsMirrored: true,
    };
    const natLegacyInfo: WslNetworkInfo = {
      mirrored: false,
      ip: '10.0.0.5',
      netldiHost: '10.0.0.5',
      wslCoreVersion: '1.2.5.0',
      supportsMirrored: false,
    };

    beforeEach(() => {
      setPlatform('win32');
      vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
      vi.mocked(wslBridge.getWslInfo).mockReturnValue({
        available: true,
        defaultDistro: 'Ubuntu',
        homeDir: '/home/user',
        arch: 'x86_64',
        wslVersion: 2,
      });
      mockExec(LINUX_SYSCTL_4GB);
    });

    it('mirrored → check icon, None collapsible state, informative tooltip', () => {
      const item = provider.getTreeItem({ kind: 'wslNetworkingStatus', info: mirroredInfo });
      expect(String(item.label)).toContain('mirrored');
      expect(String(item.label)).toContain('localhost');
      expect(themeIconId(item)).toBe('check');
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
      expect(String(item.tooltip)).toMatch(/localhost/);
    });

    it('NAT on WSL 2.0+ → warning icon, Expanded, tooltip mentions the IP', () => {
      const item = provider.getTreeItem({ kind: 'wslNetworkingStatus', info: natCapableInfo });
      expect(String(item.label)).toContain('NAT');
      expect(themeIconId(item)).toBe('warning');
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
      expect(String(item.tooltip)).toContain('172.29.240.2');
    });

    it('NAT on legacy WSL → warning icon, tooltip mentions wsl --update', () => {
      const item = provider.getTreeItem({ kind: 'wslNetworkingStatus', info: natLegacyInfo });
      expect(String(item.label)).toContain('WSL 2.0+');
      expect(themeIconId(item)).toBe('warning');
      expect(String(item.tooltip)).toMatch(/wsl --update/);
    });

    it('NAT on WSL 2.0+ offers Enable-Mirrored (first) plus the hosts-file fallback', async () => {
      const children = await provider.getChildren({
        kind: 'wslNetworkingStatus',
        info: natCapableInfo,
      });
      expect(actionCommands(children)).toEqual([
        'gemstone.enableMirroredNetworking',
        'gemstone.writeWslHostsEntry',
      ]);
    });

    it('NAT on legacy WSL offers wsl --update (first) plus the hosts-file fallback', async () => {
      const children = await provider.getChildren({
        kind: 'wslNetworkingStatus',
        info: natLegacyInfo,
      });
      expect(actionCommands(children)).toEqual([
        'gemstone.updateWslCore',
        'gemstone.writeWslHostsEntry',
      ]);
    });

    it('mirrored state has no children', async () => {
      const children = await provider.getChildren({
        kind: 'wslNetworkingStatus',
        info: mirroredInfo,
      });
      expect(children).toHaveLength(0);
    });

    it('enableMirroredNetworking action node uses the edit icon', () => {
      const item = provider.getTreeItem({
        kind: 'action',
        text: 'Enable',
        command: 'gemstone.enableMirroredNetworking',
      });
      expect(themeIconId(item)).toBe('edit');
      expect(String(item.tooltip)).toMatch(/\.wslconfig/);
    });

    it('updateWslCore action node uses the terminal icon', () => {
      const item = provider.getTreeItem({
        kind: 'action',
        text: 'Update',
        command: 'gemstone.updateWslCore',
      });
      expect(themeIconId(item)).toBe('terminal');
      expect(String(item.tooltip)).toMatch(/wsl --update/);
    });

    it('_loadConfig pushes a wslNetworkingStatus node with the refreshed info', async () => {
      vi.mocked(wslBridge.refreshWslNetworkInfo).mockResolvedValue(natCapableInfo);
      const nodes = await getRootNodes(provider);
      const netNode = findByKind(nodes, 'wslNetworkingStatus');
      expect(netNode).toBeDefined();
      expect(netNode?.info).toEqual(natCapableInfo);
    });

    it('registers enableMirroredNetworking and updateWslCore commands', () => {
      provider.registerCommands(makeContext());
      const ids = vi.mocked(vscode.commands.registerCommand).mock.calls.map(([id]) => id);
      expect(ids).toContain('gemstone.enableMirroredNetworking');
      expect(ids).toContain('gemstone.updateWslCore');
    });
  });

  // ── wslServicesStatus ─────────────────────────────────────

  describe('wslServicesStatus', () => {
    beforeEach(() => {
      setPlatform('win32');
      vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
      vi.mocked(wslBridge.getWslInfo).mockReturnValue({
        available: true,
        defaultDistro: 'Ubuntu',
        homeDir: '/home/user',
        arch: 'x86_64',
        wslVersion: 2,
      });
      mockExec(LINUX_SYSCTL_4GB);
    });

    it('both sides configured → check icon, None state, informative tooltip', () => {
      const item = provider.getTreeItem({
        kind: 'wslServicesStatus',
        windowsHas: true,
        wslHas: true,
      });
      expect(String(item.label)).toMatch(/configured/);
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
      expect(themeIconId(item)).toBe('check');
    });

    it('neither side configured → warning icon, Expanded state', () => {
      const item = provider.getTreeItem({
        kind: 'wslServicesStatus',
        windowsHas: false,
        wslHas: false,
      });
      expect(String(item.label)).toMatch(/Windows and WSL/);
      expect(themeIconId(item)).toBe('warning');
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
    });

    it('only WSL side missing → label specifies WSL', () => {
      const item = provider.getTreeItem({
        kind: 'wslServicesStatus',
        windowsHas: true,
        wslHas: false,
      });
      expect(String(item.label)).toMatch(/not in WSL/);
    });

    it('only Windows side missing → label specifies Windows', () => {
      const item = provider.getTreeItem({
        kind: 'wslServicesStatus',
        windowsHas: false,
        wslHas: true,
      });
      expect(String(item.label)).toMatch(/not in Windows/);
    });

    it('fully configured has no children', async () => {
      const children = await provider.getChildren({
        kind: 'wslServicesStatus',
        windowsHas: true,
        wslHas: true,
      });
      expect(children).toHaveLength(0);
    });

    it('both missing → two action children in the expected order', async () => {
      const children = await provider.getChildren({
        kind: 'wslServicesStatus',
        windowsHas: false,
        wslHas: false,
      });
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({
        kind: 'action',
        command: 'gemstone.writeServicesWindows',
      });
      expect(children[1]).toMatchObject({
        kind: 'action',
        command: 'gemstone.writeServicesWsl',
      });
    });

    it('only WSL missing → just the WSL action', async () => {
      const children = await provider.getChildren({
        kind: 'wslServicesStatus',
        windowsHas: true,
        wslHas: false,
      });
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({ command: 'gemstone.writeServicesWsl' });
    });

    it('action items render with terminal icon and descriptive tooltip', () => {
      const winItem = provider.getTreeItem({
        kind: 'action',
        text: 'Win',
        command: 'gemstone.writeServicesWindows',
      });
      const wslItem = provider.getTreeItem({
        kind: 'action',
        text: 'WSL',
        command: 'gemstone.writeServicesWsl',
      });
      expect(themeIconId(winItem)).toBe('terminal');
      expect(themeIconId(wslItem)).toBe('terminal');
      expect(String(winItem.tooltip)).toMatch(/gs64ldi/);
      expect(String(wslItem.tooltip)).toMatch(/\/etc\/services/);
    });

    it('NAT networking shows a hosts-file action alongside enable-mirrored', async () => {
      const children = await provider.getChildren({
        kind: 'wslNetworkingStatus',
        info: {
          mirrored: false,
          ip: '172.29.240.2',
          netldiHost: '172.29.240.2',
          wslCoreVersion: '2.0.9.0',
          supportsMirrored: true,
        },
      });
      expect(actionCommands(children)).toEqual([
        'gemstone.enableMirroredNetworking',
        'gemstone.writeWslHostsEntry',
      ]);
    });

    it('legacy WSL in NAT offers hosts-file action alongside wsl --update', async () => {
      const children = await provider.getChildren({
        kind: 'wslNetworkingStatus',
        info: {
          mirrored: false,
          ip: '10.0.0.5',
          netldiHost: '10.0.0.5',
          wslCoreVersion: '1.2.5.0',
          supportsMirrored: false,
        },
      });
      expect(actionCommands(children)).toEqual([
        'gemstone.updateWslCore',
        'gemstone.writeWslHostsEntry',
      ]);
    });

    it('registers writeWslHostsEntry / writeServicesWindows / writeServicesWsl commands', () => {
      provider.registerCommands(makeContext());
      const ids = vi.mocked(vscode.commands.registerCommand).mock.calls.map(([id]) => id);
      expect(ids).toContain('gemstone.writeWslHostsEntry');
      expect(ids).toContain('gemstone.writeServicesWindows');
      expect(ids).toContain('gemstone.writeServicesWsl');
    });

    it('writeWslHostsEntry opens a PowerShell terminal with the script path', () => {
      provider.registerCommands(makeContext('C:\\ext'));
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);

      getCommand('gemstone.writeWslHostsEntry')?.();

      const args = vi.mocked(vscode.window.createTerminal).mock
        .calls[0][0] as vscode.TerminalOptions;
      expect(args.shellPath).toBe('powershell.exe');
      expect(mockTerminal.sendText).toHaveBeenCalledWith(
        expect.stringContaining('setWslHostsEntry.ps1'),
      );
    });

    it('writeServicesWsl opens a WSL shell and runs the bash script via sudo', () => {
      provider.registerCommands(makeContext('C:\\ext'));
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);

      getCommand('gemstone.writeServicesWsl')?.();

      const args = vi.mocked(vscode.window.createTerminal).mock
        .calls[0][0] as vscode.TerminalOptions;
      expect(args.shellPath).toBe('wsl.exe');
      expect(mockTerminal.sendText).toHaveBeenCalledWith(
        expect.stringContaining('/mnt/c/ext/resources/setServicesLinux.sh'),
      );
    });
  });

  // ── enableMirroredNetworking command behavior ─────────────

  describe('enableMirroredNetworking command', () => {
    beforeEach(() => {
      setPlatform('win32');
      vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
    });

    it('writes the merged .wslconfig and prompts for a restart', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue('[wsl2]\nmemory=8GB\n');
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      vi.mocked(wslBridge.updateWslConfigMirrored).mockImplementation(
        () => '[wsl2]\nnetworkingMode=mirrored\nmemory=8GB\n',
      );
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

      provider.registerCommands(makeContext());
      await getCommand('gemstone.enableMirroredNetworking')?.();

      expect(wslBridge.updateWslConfigMirrored).toHaveBeenCalledWith('[wsl2]\nmemory=8GB\n');
      expect(fs.writeFileSync).toHaveBeenCalledOnce();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringMatching(/restart/i),
        'Restart WSL now',
        'Later',
      );
    });

    it('on "Restart WSL now" spawns a terminal with wsl --shutdown', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      vi.mocked(wslBridge.updateWslConfigMirrored).mockImplementation(
        () => '[wsl2]\nnetworkingMode=mirrored\n',
      );
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
        'Restart WSL now' as unknown as vscode.MessageItem,
      );
      const mockTerminal = fakeTerminal();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal);

      provider.registerCommands(makeContext());
      await getCommand('gemstone.enableMirroredNetworking')?.();

      expect(mockTerminal.sendText).toHaveBeenCalledWith(expect.stringContaining('wsl --shutdown'));
    });

    it('does nothing destructive when .wslconfig already had mirrored (no write, still prompts)', async () => {
      const already = '[wsl2]\nnetworkingMode=mirrored\n';
      vi.mocked(fs.readFileSync).mockReturnValue(already);
      vi.mocked(wslBridge.updateWslConfigMirrored).mockReturnValue(already);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

      provider.registerCommands(makeContext());
      await getCommand('gemstone.enableMirroredNetworking')?.();

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      // Still surfaces an info message so the user learns the state.
      expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    });
  });
});

// ── Exported prerequisite checks ────────────────────────────

describe('isSharedMemoryConfigured', () => {
  let originalPlatform: NodeJS.Platform;

  beforeEach(() => {
    vi.clearAllMocks();
    originalPlatform = process.platform;
    vi.mocked(wslBridge.needsWsl).mockReturnValue(false);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('is true when both shmmax and shmall reach 1 GB', async () => {
    setPlatform('darwin');
    mockExec(MACOS_SYSCTL_4GB);

    expect(await isSharedMemoryConfigured()).toBe(true);
  });

  it('is false when shared memory is below 1 GB', async () => {
    setPlatform('darwin');
    mockExec(MACOS_SYSCTL_SMALL);

    expect(await isSharedMemoryConfigured()).toBe(false);
  });

  it('treats an unreadable sysctl as not configured', async () => {
    setPlatform('darwin');
    mockExecError();

    expect(await isSharedMemoryConfigured()).toBe(false);
  });
});

describe('getRemoveIpcConfigured', () => {
  let originalPlatform: NodeJS.Platform;

  beforeEach(() => {
    vi.clearAllMocks();
    originalPlatform = process.platform;
    vi.mocked(wslBridge.needsWsl).mockReturnValue(false);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('is true when logind.conf sets RemoveIPC=no', () => {
    setPlatform('linux');
    vi.mocked(fs.readFileSync).mockReturnValue('[Login]\nRemoveIPC=no\n');

    expect(getRemoveIpcConfigured()).toBe(true);
  });

  it('is false when no logind config is present', () => {
    setPlatform('linux');
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(getRemoveIpcConfigured()).toBe(false);
  });
});
