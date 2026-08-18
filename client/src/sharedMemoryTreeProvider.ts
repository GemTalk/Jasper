import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import {
  needsWsl,
  getWslInfo,
  invalidateWslCache,
  wslExecSync,
  refreshWslNetworkInfo,
  invalidateWslNetworkCache,
  updateWslConfigMirrored,
  WslNetworkInfo,
} from './wslBridge';
import { toWslPath } from './wslFs';

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export type OsConfigNode =
  | { kind: 'loading' }
  | { kind: 'sharedMemoryStatus'; configured: boolean; gbLabel: string }
  | { kind: 'removeIpcStatus'; configured: boolean }
  | { kind: 'wslStatus'; distro: string; wslVersion: number | undefined }
  | { kind: 'wslNetworkingStatus'; info: WslNetworkInfo }
  | { kind: 'wslServicesStatus'; windowsHas: boolean; wslHas: boolean }
  | { kind: 'action'; text: string; command: string };

/** Does `/etc/services` inside the default WSL distro have a
 *  `gs64ldi <port>/tcp` entry? Routed through wslExecSync so the check
 *  inspects the Linux distro, not any Windows file of the same name. */
/** Does the WSL distro's /etc/services carry the gs64ldi entry? */
export function wslServicesHasGs64ldi(): boolean {
  try {
    wslExecSync(
      'grep -qE "^[[:space:]]*gs64ldi[[:space:]]+[0-9]+/tcp([[:space:]]|$)" /etc/services',
    );
    return true;
  } catch {
    return false;
  }
}

/** Does the Windows services file (drivers\etc\services) have a
 *  `gs64ldi <port>/tcp` entry? */
/** The same question for the Windows services file. */
export function windowsServicesHasGs64ldi(): boolean {
  try {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const servicesPath = path.join(systemRoot, 'System32', 'drivers', 'etc', 'services');
    const content = fs.readFileSync(servicesPath, 'utf-8');
    return /^[ \t]*gs64ldi[ \t]+\d+\/tcp\b/m.test(content);
  } catch {
    return false;
  }
}

/** Read the current sysctl shared memory values. */
export function getSharedMemory(): Promise<{ shmmax: number; shmall: number } | undefined> {
  return new Promise((resolve) => {
    // On Windows the sysctl lives inside WSL; the parse format matches Linux.
    const linuxLike = process.platform === 'linux' || needsWsl();
    const cmd = linuxLike
      ? needsWsl()
        ? 'wsl.exe -e sysctl kernel.shmmax kernel.shmall'
        : 'sysctl kernel.shmmax kernel.shmall'
      : 'sysctl kern.sysv.shmmax kern.sysv.shmall';
    exec(cmd, { encoding: 'utf-8' }, (error, output) => {
      if (error) {
        resolve(undefined);
        return;
      }
      const maxMatch = linuxLike
        ? output.match(/kernel\.shmmax\s*=\s*(\d+)/)
        : output.match(/kern\.sysv\.shmmax:\s*(\d+)/);
      const allMatch = linuxLike
        ? output.match(/kernel\.shmall\s*=\s*(\d+)/)
        : output.match(/kern\.sysv\.shmall:\s*(\d+)/);
      if (!maxMatch || !allMatch) {
        resolve(undefined);
        return;
      }
      resolve({
        shmmax: parseInt(maxMatch[1], 10),
        shmall: parseInt(allMatch[1], 10),
      });
    });
  });
}

/**
 * Bytes of shared memory already allocated on this machine, or undefined when it
 * cannot be read. The limit alone does not predict whether a stone will start:
 * segments other stones hold count against the same shmall, so a machine can
 * clear the 1 GB threshold and still have no room for another cache.
 */
export function getSharedMemoryInUse(): Promise<number | undefined> {
  // macOS prints SEGSZ last (ipcs -mb); Linux prints bytes as the fifth column.
  const darwin = process.platform === 'darwin';
  const cmd = darwin ? 'ipcs -mb' : 'ipcs -m';
  const column = darwin ? -1 : 4;
  // Which lines are segments, rather than the title, the header or a blank: a
  // macOS row opens with the type letter, a Linux row with the hex key. Taking
  // any line with enough columns instead would count macOS's title line, whose
  // last field is the year.
  const isSegment = darwin
    ? (parts: string[]) => parts[0] === 'm'
    : (parts: string[]) => /^0x[0-9a-f]+$/i.test(parts[0]);
  const run = needsWsl() ? `wsl.exe -e sh -lc "${cmd}"` : cmd;
  return new Promise((resolve) => {
    exec(run, { encoding: 'utf-8' }, (error, output) => {
      if (error) return resolve(undefined);
      let total = 0;
      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5 || !isSegment(parts)) continue;
        const size = Number(parts.at(column));
        if (!Number.isFinite(size) || size <= 0) continue;
        total += size;
      }
      resolve(total);
    });
  });
}

/**
 * Whether a shared-memory reading clears the 1 GB a stone needs, and how to say
 * how much there is. The one place that knows the divisors and the threshold:
 * the Start Stone preflight gates on it, Quick Setup warns on it, and the OS
 * view and the manager both display it, so a reading they disagree about is a
 * machine one calls ready and another refuses.
 */
export function sharedMemoryStatus(mem: { shmmax: number; shmall: number } | undefined): {
  configured: boolean;
  gbLabel: string;
} {
  if (!mem) return { configured: false, gbLabel: '0' };
  const shmmaxGb = mem.shmmax / Math.pow(2, 30);
  const shmallGb = mem.shmall / Math.pow(2, 18);
  const minGb = Math.min(shmmaxGb, shmallGb);
  return {
    configured: shmmaxGb >= 1 && shmallGb >= 1,
    gbLabel: minGb > 1024 ? '≥ 1' : String(Math.round(minGb * 10) / 10),
  };
}

export async function isSharedMemoryConfigured(): Promise<boolean> {
  return sharedMemoryStatus(await getSharedMemory()).configured;
}

/** Does the systemd logind config set `RemoveIPC=no`? Without it, systemd
 *  destroys GemStone shared memory (killing the Stone) when the session that
 *  started it logs out.
 *
 *  Routes through WSL on Windows so we inspect the WSL distro's systemd config
 *  rather than nonexistent Windows paths. systemd applies drop-ins in
 *  alphabetical order after the main file; last RemoveIPC= wins. */
export function getRemoveIpcConfigured(): boolean {
  const wsl = needsWsl();
  const readText = wsl
    ? (p: string): string | undefined => {
        try {
          return wslExecSync(`cat ${shQuote(p)} 2>/dev/null`);
        } catch {
          return undefined;
        }
      }
    : (p: string): string | undefined => {
        try {
          return fs.readFileSync(p, 'utf-8');
        } catch {
          return undefined;
        }
      };
  const listConfs = wsl
    ? (dir: string): string[] => {
        try {
          return wslExecSync(`ls -A1 ${shQuote(dir)} 2>/dev/null`)
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
        } catch {
          return [];
        }
      }
    : (dir: string): string[] => {
        try {
          return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
        } catch {
          return [];
        }
      };

  const dropInDir = '/etc/systemd/logind.conf.d';
  const files = [
    '/etc/systemd/logind.conf',
    ...listConfs(dropInDir)
      .filter((f) => f.endsWith('.conf'))
      .sort()
      .map((f) => `${dropInDir}/${f}`),
  ];

  let removeIpc: boolean | undefined;
  for (const file of files) {
    const content = readText(file);
    if (content === undefined) continue;
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*RemoveIPC\s*=\s*(\w+)\s*$/i);
      if (match) removeIpc = match[1].toLowerCase() === 'no';
    }
  }
  return removeIpc === true;
}

export class OsConfigTreeProvider implements vscode.TreeDataProvider<OsConfigNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<OsConfigNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private extensionPath = '';
  private _cache: OsConfigNode[] | undefined;

  refresh(): void {
    this._cache = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: OsConfigNode): vscode.TreeItem {
    if (node.kind === 'loading') {
      const item = new vscode.TreeItem(
        'Checking OS configuration…',
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon('loading~spin');
      return item;
    }

    if (node.kind === 'sharedMemoryStatus') {
      const item = new vscode.TreeItem(
        node.configured
          ? `Shared memory: ${node.gbLabel} GB (configured)`
          : 'Shared memory not configured (< 1 GB)',
        node.configured
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon(
        node.configured ? 'check' : 'warning',
        new vscode.ThemeColor(
          node.configured ? 'testing.iconPassed' : 'problemsWarningIcon.foreground',
        ),
      );
      if (!node.configured) {
        item.tooltip = 'GemStone requires at least 1 GB shared memory.';
      }
      return item;
    }

    if (node.kind === 'wslStatus') {
      const ok = node.wslVersion === 2;
      const label = ok
        ? `WSL 2 (${node.distro})`
        : node.wslVersion === 1
          ? `WSL 1 (${node.distro}) — upgrade required`
          : `WSL (${node.distro}) — version unknown`;
      const item = new vscode.TreeItem(
        label,
        ok ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon(
        ok ? 'check' : 'warning',
        new vscode.ThemeColor(ok ? 'testing.iconPassed' : 'problemsWarningIcon.foreground'),
      );
      if (!ok) {
        item.tooltip =
          node.wslVersion === 1
            ? 'GemStone requires WSL 2. Run: wsl --set-version ' + node.distro + ' 2'
            : 'Could not determine WSL version for ' + node.distro + '.';
      }
      return item;
    }

    if (node.kind === 'wslNetworkingStatus') {
      const { mirrored, supportsMirrored, wslCoreVersion, ip } = node.info;
      const label = mirrored
        ? 'WSL networking: mirrored (localhost works)'
        : supportsMirrored
          ? 'WSL networking: NAT — localhost cannot reach WSL'
          : 'WSL networking: NAT — mirrored mode requires WSL 2.0+';
      const item = new vscode.TreeItem(
        label,
        mirrored ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon(
        mirrored ? 'check' : 'warning',
        new vscode.ThemeColor(mirrored ? 'testing.iconPassed' : 'problemsWarningIcon.foreground'),
      );
      if (mirrored) {
        item.tooltip =
          `GemStone logins can use 'localhost'.` +
          (wslCoreVersion ? `\nWSL core version: ${wslCoreVersion}` : '');
      } else if (supportsMirrored) {
        item.tooltip =
          'Without mirrored networking, GemStone logins must use the WSL IP ' +
          `(currently ${ip ?? 'unknown'}), which changes across WSL restarts.`;
      } else {
        item.tooltip =
          'Upgrade WSL to 2.0+ (`wsl --update` in an elevated shell) to enable mirrored networking.' +
          (wslCoreVersion ? `\nCurrent WSL core version: ${wslCoreVersion}` : '');
      }
      return item;
    }

    if (node.kind === 'wslServicesStatus') {
      const configured = node.windowsHas && node.wslHas;
      const missingLabel =
        !node.windowsHas && !node.wslHas ? 'Windows and WSL' : !node.windowsHas ? 'Windows' : 'WSL';
      const item = new vscode.TreeItem(
        configured
          ? 'Services: gs64ldi 50377/tcp (configured)'
          : `Services: gs64ldi not in ${missingLabel} /etc/services`,
        configured
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon(
        configured ? 'check' : 'warning',
        new vscode.ThemeColor(configured ? 'testing.iconPassed' : 'problemsWarningIcon.foreground'),
      );
      item.tooltip = configured
        ? 'GemStone logins can name the port as "gs64ldi" on both Windows and WSL.'
        : 'Without a services entry, NetLDI binds to a random port and logins must use the numeric port. ' +
          'Writing "gs64ldi 50377/tcp" makes the port stable and addressable by name.';
      return item;
    }

    if (node.kind === 'removeIpcStatus') {
      const item = new vscode.TreeItem(
        node.configured ? 'RemoveIPC=no (configured)' : 'RemoveIPC not configured',
        node.configured
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon(
        node.configured ? 'check' : 'warning',
        new vscode.ThemeColor(
          node.configured ? 'testing.iconPassed' : 'problemsWarningIcon.foreground',
        ),
      );
      if (!node.configured) {
        item.tooltip =
          'Without RemoveIPC=no, systemd will destroy GemStone shared memory (killing the Stone) when the session that started it logs out.';
      }
      return item;
    }

    // action node
    const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
    item.command = { command: node.command, title: node.text };
    const isTerminal = [
      'gemstone.upgradeWsl2',
      'gemstone.runSetSharedMemory',
      'gemstone.runSetSharedMemoryLinux',
      'gemstone.runSetRemoveIPC',
      'gemstone.updateWslCore',
      'gemstone.writeWslHostsEntry',
      'gemstone.writeServicesWindows',
      'gemstone.writeServicesWsl',
    ].includes(node.command);
    if (isTerminal) {
      item.iconPath = new vscode.ThemeIcon('terminal');
      if (node.command === 'gemstone.upgradeWsl2') {
        item.tooltip = 'Open a terminal and run: wsl --set-version <distro> 2';
      } else if (node.command === 'gemstone.runSetRemoveIPC') {
        item.tooltip = 'Open a terminal and run the setup script with sudo.';
      } else if (node.command === 'gemstone.updateWslCore') {
        item.tooltip = 'Open a terminal and run: wsl --update (requires elevation).';
      } else if (node.command === 'gemstone.writeWslHostsEntry') {
        item.tooltip =
          'Write "<wsl-ip> wsl-linux" to C:\\Windows\\System32\\drivers\\etc\\hosts. Re-run after WSL restart.';
      } else if (node.command === 'gemstone.writeServicesWindows') {
        item.tooltip = 'Write "gs64ldi 50377/tcp" to the Windows services file.';
      } else if (node.command === 'gemstone.writeServicesWsl') {
        item.tooltip = 'Write "gs64ldi 50377/tcp" to /etc/services inside WSL.';
      } else {
        item.tooltip =
          'Open a terminal and run the setup script with sudo. Changes take effect immediately; no restart required.';
      }
    } else if (node.command === 'gemstone.enableMirroredNetworking') {
      item.iconPath = new vscode.ThemeIcon('edit');
      item.tooltip = 'Add networkingMode=mirrored to %USERPROFILE%\\.wslconfig, then restart WSL.';
    } else {
      item.iconPath = new vscode.ThemeIcon('info');
      if (node.command === 'gemstone.removeIpcInfo') {
        item.tooltip = 'Restart your computer, or run: sudo systemctl restart systemd-logind';
      } else {
        item.tooltip = 'Changes take effect immediately; no restart required.';
      }
    }
    return item;
  }

  getChildren(node?: OsConfigNode): OsConfigNode[] | Promise<OsConfigNode[]> {
    if (!node) {
      if (this._cache) return this._cache;

      // Return a loading indicator immediately, then fetch async and refresh.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- FIXME: unhandled floating promise; needs investigation to decide await vs. void vs. .catch before this rule is enabled repo-wide
      this._loadConfig();
      return [{ kind: 'loading' }];
    }

    if (node.kind === 'wslStatus' && node.wslVersion !== 2) {
      return [{ kind: 'action', text: 'Upgrade to WSL 2', command: 'gemstone.upgradeWsl2' }];
    }

    if (node.kind === 'wslNetworkingStatus' && !node.info.mirrored) {
      const actions: OsConfigNode[] = [];
      if (node.info.supportsMirrored) {
        actions.push({
          kind: 'action',
          text: 'Enable mirrored networking',
          command: 'gemstone.enableMirroredNetworking',
        });
      } else {
        actions.push({
          kind: 'action',
          text: 'Update WSL (wsl --update)',
          command: 'gemstone.updateWslCore',
        });
      }
      // Hosts-file workaround is useful for anyone stuck on NAT — gives
      // them a stable name (`wsl-linux`) even across WSL restarts.
      actions.push({
        kind: 'action',
        text: 'Write hosts file entry (wsl-linux, requires admin)',
        command: 'gemstone.writeWslHostsEntry',
      });
      return actions;
    }

    if (node.kind === 'wslServicesStatus' && !(node.windowsHas && node.wslHas)) {
      const actions: OsConfigNode[] = [];
      if (!node.windowsHas) {
        actions.push({
          kind: 'action',
          text: 'Write Windows services entry (requires admin)',
          command: 'gemstone.writeServicesWindows',
        });
      }
      if (!node.wslHas) {
        actions.push({
          kind: 'action',
          text: 'Write WSL /etc/services entry (requires sudo)',
          command: 'gemstone.writeServicesWsl',
        });
      }
      return actions;
    }

    if (node.kind === 'sharedMemoryStatus' && !node.configured) {
      // Windows+WSL uses the Linux script (executed inside WSL).
      const command =
        process.platform === 'linux' || needsWsl()
          ? 'gemstone.runSetSharedMemoryLinux'
          : 'gemstone.runSetSharedMemory';
      return [{ kind: 'action', text: 'Run setup script (requires sudo)', command }];
    }

    if (node.kind === 'removeIpcStatus' && !node.configured) {
      return [
        {
          kind: 'action',
          text: 'Run setup script (requires sudo)',
          command: 'gemstone.runSetRemoveIPC',
        },
        {
          kind: 'action',
          text: 'Restart computer or restart systemd-logind',
          command: 'gemstone.removeIpcInfo',
        },
      ];
    }

    return [];
  }

  private async _loadConfig(): Promise<void> {
    // Yield to the event loop so subscribers registered after getChildren()
    // are in place before we fire onDidChangeTreeData (needed when the WSL
    // branch has no awaits and would otherwise fire synchronously).
    await Promise.resolve();
    const nodes: OsConfigNode[] = [];

    let showLinuxChecks = process.platform === 'linux';
    if (needsWsl()) {
      const info = getWslInfo();
      const distro = info.defaultDistro ?? 'Unknown';
      nodes.push({ kind: 'wslStatus', distro, wslVersion: info.wslVersion });
      // Only inspect the WSL distro once it's on WSL 2; earlier versions
      // need to upgrade first, so extra warnings would just be noise.
      showLinuxChecks = info.wslVersion === 2;
      if (showLinuxChecks) {
        // Surface mirrored-networking state so users see why `localhost`
        // does (or does not) reach GemStone services inside WSL.
        const netInfo = await refreshWslNetworkInfo();
        nodes.push({ kind: 'wslNetworkingStatus', info: netInfo });
        // A configured `gs64ldi` services entry lets NetLDI bind to the
        // conventional port 50377 (instead of a random one) and lets
        // logins name the port. We check both sides — Windows and WSL.
        nodes.push({
          kind: 'wslServicesStatus',
          windowsHas: windowsServicesHasGs64ldi(),
          wslHas: wslServicesHasGs64ldi(),
        });
      }
    }

    if (showLinuxChecks || process.platform === 'darwin') {
      const { configured, gbLabel } = sharedMemoryStatus(await getSharedMemory());
      nodes.push({ kind: 'sharedMemoryStatus', configured, gbLabel });
    }

    if (showLinuxChecks) {
      nodes.push({ kind: 'removeIpcStatus', configured: getRemoveIpcConfigured() });
    }

    this._cache = nodes;
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Open a PowerShell terminal and invoke a setup script that self-elevates
   * via UAC. The terminal stays open so the user can read output; we refresh
   * the tree when it closes so the new configuration is reflected.
   */
  private runPowerShellSetup(name: string, scriptPath: string): void {
    const terminal = vscode.window.createTerminal({ name, shellPath: 'powershell.exe' });
    terminal.show();
    // -NoProfile keeps the PS startup deterministic; -ExecutionPolicy Bypass
    // lets the file run without adjusting the user's system-wide policy.
    terminal.sendText(`& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`);
    const disposable = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === terminal) {
        disposable.dispose();
        invalidateWslNetworkCache();
        this.refresh();
      }
    });
  }

  /**
   * Open a terminal ready to run a bash setup script with sudo. On Windows
   * the terminal is a WSL shell so the script (delivered as /mnt/<drive>/...)
   * executes inside the Linux distro GemStone actually runs under.
   */
  private createSetupTerminal(name: string, scriptPath: string): vscode.Terminal {
    if (needsWsl()) {
      const terminal = vscode.window.createTerminal({
        name,
        shellPath: 'wsl.exe',
        shellArgs: ['-e', 'bash'],
      });
      terminal.show();
      terminal.sendText(`sudo ${shQuote(toWslPath(scriptPath))} && exit`);
      return terminal;
    }
    const terminal = vscode.window.createTerminal(name);
    terminal.show();
    terminal.sendText(`sudo "${scriptPath}" && exit`);
    return terminal;
  }

  registerCommands(context: vscode.ExtensionContext): void {
    this.extensionPath = context.extensionPath;
    context.subscriptions.push(
      vscode.commands.registerCommand('gemstone.upgradeWsl2', () => {
        const info = getWslInfo();
        const distro = info.defaultDistro ?? '';
        const terminal = vscode.window.createTerminal('GemStone: WSL Upgrade');
        terminal.show();
        terminal.sendText(`wsl --set-version ${distro} 2 && exit`);
        const disposable = vscode.window.onDidCloseTerminal((closed) => {
          if (closed === terminal) {
            disposable.dispose();
            invalidateWslCache();
            this.refresh();
          }
        });
      }),
      vscode.commands.registerCommand('gemstone.runSetSharedMemory', () => {
        const scriptPath = path.join(this.extensionPath, 'resources', 'setSharedMemory.sh');
        const terminal = vscode.window.createTerminal('GemStone: Shared Memory Setup');
        terminal.show();
        terminal.sendText(`sudo "${scriptPath}" && exit`);
        const disposable = vscode.window.onDidCloseTerminal((closed) => {
          if (closed === terminal) {
            disposable.dispose();
            this.refresh();
          }
        });
      }),
      vscode.commands.registerCommand('gemstone.runSetSharedMemoryLinux', () => {
        const scriptPath = path.join(this.extensionPath, 'resources', 'setSharedMemoryLinux.sh');
        const terminal = this.createSetupTerminal('GemStone: Shared Memory Setup', scriptPath);
        const disposable = vscode.window.onDidCloseTerminal((closed) => {
          if (closed === terminal) {
            disposable.dispose();
            this.refresh();
          }
        });
      }),
      vscode.commands.registerCommand('gemstone.runSetRemoveIPC', () => {
        const scriptPath = path.join(this.extensionPath, 'resources', 'setRemoveIPC.sh');
        const terminal = this.createSetupTerminal('GemStone: RemoveIPC Setup', scriptPath);
        const disposable = vscode.window.onDidCloseTerminal((closed) => {
          if (closed === terminal) {
            disposable.dispose();
            this.refresh();
          }
        });
      }),
      vscode.commands.registerCommand('gemstone.sharedMemoryInfo', () => {
        vscode.window.showInformationMessage(
          'Shared memory changes take effect immediately. No restart required.',
        );
      }),
      vscode.commands.registerCommand('gemstone.removeIpcInfo', () => {
        vscode.window.showInformationMessage(
          'To apply: restart your computer, or run: sudo systemctl restart systemd-logind',
        );
      }),
      vscode.commands.registerCommand('gemstone.enableMirroredNetworking', () =>
        this.enableMirroredNetworking(),
      ),
      vscode.commands.registerCommand('gemstone.writeWslHostsEntry', () => {
        const scriptPath = path.join(this.extensionPath, 'resources', 'setWslHostsEntry.ps1');
        this.runPowerShellSetup('GemStone: Windows Hosts Setup', scriptPath);
      }),
      vscode.commands.registerCommand('gemstone.writeServicesWindows', () => {
        const scriptPath = path.join(this.extensionPath, 'resources', 'setServicesWindows.ps1');
        this.runPowerShellSetup('GemStone: Windows Services Setup', scriptPath);
      }),
      vscode.commands.registerCommand('gemstone.writeServicesWsl', () => {
        const scriptPath = path.join(this.extensionPath, 'resources', 'setServicesLinux.sh');
        const terminal = this.createSetupTerminal('GemStone: WSL Services Setup', scriptPath);
        const disposable = vscode.window.onDidCloseTerminal((closed) => {
          if (closed === terminal) {
            disposable.dispose();
            this.refresh();
          }
        });
      }),
      vscode.commands.registerCommand('gemstone.updateWslCore', () => {
        const terminal = vscode.window.createTerminal('GemStone: WSL Update');
        terminal.show();
        // `wsl --update` needs an elevated shell on newer builds; the
        // command self-elevates, so we just type it in a plain terminal.
        terminal.sendText('wsl --update && exit');
        const disposable = vscode.window.onDidCloseTerminal((closed) => {
          if (closed === terminal) {
            disposable.dispose();
            invalidateWslCache();
            invalidateWslNetworkCache();
            this.refresh();
          }
        });
      }),
    );
  }

  /**
   * Write `networkingMode=mirrored` to %USERPROFILE%\.wslconfig, preserving
   * existing keys/sections, then offer the user a terminal to run
   * `wsl --shutdown` (the restart required for the new mode to take effect).
   * The tree refreshes whether they restart or not.
   */
  private async enableMirroredNetworking(): Promise<void> {
    const configPath = path.join(os.homedir(), '.wslconfig');
    let current = '';
    try {
      current = fs.readFileSync(configPath, 'utf-8');
    } catch {
      /* file may not exist */
    }
    const updated = updateWslConfigMirrored(current);
    if (updated === current) {
      vscode.window.showInformationMessage(
        ".wslconfig already sets networkingMode=mirrored. If localhost still doesn't reach WSL, run: wsl --shutdown",
      );
    } else {
      try {
        fs.writeFileSync(configPath, updated, 'utf-8');
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to write ${configPath}: ${String(err)}`);
        return;
      }
    }
    const choice = await vscode.window.showInformationMessage(
      'Mirrored networking enabled in .wslconfig. WSL must restart for the change to take effect.',
      'Restart WSL now',
      'Later',
    );
    if (choice === 'Restart WSL now') {
      const terminal = vscode.window.createTerminal('GemStone: WSL Shutdown');
      terminal.show();
      terminal.sendText('wsl --shutdown && exit');
      const disposable = vscode.window.onDidCloseTerminal((closed) => {
        if (closed === terminal) {
          disposable.dispose();
          invalidateWslCache();
          invalidateWslNetworkCache();
          this.refresh();
        }
      });
    } else {
      invalidateWslNetworkCache();
      this.refresh();
    }
  }
}
