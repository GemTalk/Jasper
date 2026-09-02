import * as path from 'path';
import * as vscode from 'vscode';
import { SysadminStorage } from '../sysadminStorage';
import { ProcessManager, versionsMatch } from './processManager';
import { GemStoneDatabase } from '../sysadminTypes';
import { wslExistsSync, wslReaddirSync, wslIsFile } from '../wslFs';
import {
  ServerStatus,
  DatabaseAction,
  databaseAction,
  databaseStatus,
  inspectDatabaseProcesses,
} from '../databaseServerStatus';
import { ExternalServer, ExternalServerFinding } from '../externalServerScan';

export type DatabaseNode =
  | { kind: 'database'; db: GemStoneDatabase }
  | { kind: 'stone'; db: GemStoneDatabase; status: ServerStatus; external?: ExternalServer }
  | { kind: 'netldi'; db: GemStoneDatabase; status: ServerStatus; external?: ExternalServer }
  | { kind: 'logs'; db: GemStoneDatabase }
  | { kind: 'config'; db: GemStoneDatabase }
  | { kind: 'file'; filePath: string };

/** How each status renders: the row's text, its icon, and the suffix that
 *  picks the row's context value (and so its inline buttons).
 *
 *  Only `running` gets the healthy green play icon. That is the point of having
 *  the other states at all — the tree used to say plain *Running* for anything
 *  gslist listed, so a stone whose NetLDI was unreachable, or one registered
 *  outside Jasper, looked healthy right up until the login failed. */
const STATUS_PRESENTATION: Record<
  ServerStatus,
  { label: string; icon: string; color: string; context: string }
> = {
  stopped: {
    label: 'Stopped',
    icon: 'debug-stop',
    color: 'testing.iconFailed',
    context: 'Stopped',
  },
  running: { label: 'Running', icon: 'play', color: 'testing.iconPassed', context: 'Running' },
  'not-responding': {
    label: 'Running — not responding',
    icon: 'warning',
    color: 'testing.iconErrored',
    context: 'Running',
  },
  unreachable: {
    label: 'Running — not connectable',
    icon: 'warning',
    color: 'testing.iconErrored',
    context: 'Running',
  },
  external: {
    label: 'Running outside Jasper',
    icon: 'warning',
    color: 'testing.iconErrored',
    context: 'External',
  },
};

/** The two rows whose appearance is driven by a server's status. */
type ServerNode = Extract<DatabaseNode, { kind: 'stone' | 'netldi' }>;

export class DatabaseTreeProvider implements vscode.TreeDataProvider<DatabaseNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DatabaseNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private storage: SysadminStorage,
    private processManager: ProcessManager,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: DatabaseNode): vscode.TreeItem {
    switch (node.kind) {
      case 'database': {
        const item = new vscode.TreeItem(
          node.db.dirName,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.description = `${node.db.config.stoneName} (${node.db.config.version})`;
        item.contextValue = `gemstoneDb${this.databaseContext(node.db)}`;
        item.iconPath = new vscode.ThemeIcon('database');
        item.tooltip = `Path: ${node.db.path}\nStone: ${node.db.config.stoneName}\nNetLDI: ${node.db.config.ldiName}\nVersion: ${node.db.config.version}\nBase extent: ${node.db.config.baseExtent}`;
        return item;
      }
      case 'stone': {
        const item = new vscode.TreeItem(`Stone: ${node.db.config.stoneName}`);
        this.presentServer(item, node, 'Stone');
        return item;
      }
      case 'netldi': {
        const proc = this.processManager
          .getProcesses()
          .find(
            (p) =>
              p.type === 'netldi' &&
              p.name === node.db.config.ldiName &&
              versionsMatch(p.version, node.db.config.version),
          );
        const item = new vscode.TreeItem(`NetLDI: ${node.db.config.ldiName}`);
        this.presentServer(item, node, 'Netldi');
        if (node.status === 'running' && proc?.port) {
          item.description = `Running (port ${proc.port})`;
        }
        return item;
      }
      case 'logs': {
        const item = new vscode.TreeItem('Logs', vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = 'gemstoneDbLogs';
        item.iconPath = new vscode.ThemeIcon('output');
        return item;
      }
      case 'config': {
        const item = new vscode.TreeItem('Config', vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = 'gemstoneDbConfig';
        item.iconPath = new vscode.ThemeIcon('settings-gear');
        return item;
      }
      case 'file': {
        const fileName = path.basename(node.filePath);
        const item = new vscode.TreeItem(fileName, vscode.TreeItemCollapsibleState.None);
        item.contextValue = 'gemstoneDbFile';
        item.iconPath = new vscode.ThemeIcon('file');
        item.tooltip = node.filePath;
        item.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.file(node.filePath)],
        };
        return item;
      }
    }
  }

  /** Which whole-database action the row offers, as a context-value suffix.
   *
   *  The reading itself is `databaseAction`, shared with the Command Palette's
   *  picker so the two cannot disagree. External gets neither action here; the
   *  child rows offer the restart-under-Jasper action for that case. */
  private databaseContext(db: GemStoneDatabase): DatabaseAction {
    return databaseAction(this.inspect(db).status);
  }

  /** One reading of a database's two servers. The database row's context value
   *  and the child rows beneath it both come from this, so a row cannot offer
   *  Stop while the stone under it reads Stopped.
   *
   *  It is the same inspection the login-failure recovery uses, so the tree
   *  cannot contradict what a connect will actually do either. */
  private inspect(db: GemStoneDatabase) {
    const external: ExternalServerFinding = this.processManager.getExternalServers(db);
    return {
      external,
      status: databaseStatus(
        inspectDatabaseProcesses(db, this.processManager.getProcesses(), external),
      ),
    };
  }

  /** Apply a status's text, icon, and context value to a stone or NetLDI row,
   *  and explain in the tooltip anything the one-line description cannot. */
  private presentServer(
    item: vscode.TreeItem,
    node: ServerNode,
    contextKind: 'Stone' | 'Netldi',
  ): void {
    const look = STATUS_PRESENTATION[node.status];
    item.description = look.label;
    item.contextValue = `gemstoneDb${contextKind}${look.context}`;
    item.iconPath = new vscode.ThemeIcon(look.icon, new vscode.ThemeColor(look.color));
    item.tooltip = this.statusTooltip(node);
  }

  /** The "why" behind a status that is not plainly Running or Stopped. A user
   *  who sees "not connectable" or "Running outside Jasper" has no way to guess
   *  what it means from three words, and the states exist precisely because the
   *  short answer was misleading. */
  private statusTooltip(node: ServerNode): string | undefined {
    const what = node.kind === 'stone' ? node.db.config.stoneName : node.db.config.ldiName;
    switch (node.status) {
      case 'external': {
        // The row carries the server getChildren found, so the tooltip states
        // one reading of the scan rather than taking a second one that could
        // describe a different moment.
        const proc = node.external?.process;
        const where = proc?.globalDir
          ? `registered in ${proc.globalDir}`
          : 'registered in a directory Jasper could not determine';
        const pid = proc ? ` (PID ${proc.pid})` : '';
        return (
          `"${what}" is running on this host${pid} but was started outside Jasper's ` +
          `environment, so it is ${where} rather than under ${this.storage.getRootPath()}, ` +
          `where Jasper's own gslist looks. It will not appear in the Processes view either — ` +
          `that view shows the same gslist, so its stale-lock tooling cannot reach this ` +
          `server's lock.\n\n` +
          `Connecting will offer to restart it under Jasper's environment.`
        );
      }
      case 'unreachable':
        return (
          `"${what}" is running and responding, but a login has to reach it through NetLDI ` +
          `"${node.db.config.ldiName}", which is not usable — so a connect will fail.`
        );
      case 'not-responding':
        return (
          `"${what}" appears in gslist but is not responding. It may be holding a stale lock; ` +
          `see the Processes view.`
        );
      default:
        return undefined;
    }
  }

  getChildren(node?: DatabaseNode): DatabaseNode[] {
    if (!node) {
      return this.storage.getDatabases().map((db) => ({ kind: 'database' as const, db }));
    }
    if (node.kind === 'database') {
      const { external, status } = this.inspect(node.db);
      return [
        { kind: 'stone', db: node.db, status: status.stone, external: external.stone },
        { kind: 'netldi', db: node.db, status: status.netldi, external: external.netldi },
        { kind: 'logs', db: node.db },
        { kind: 'config', db: node.db },
      ];
    }
    if (node.kind === 'logs') {
      return this.listFiles(path.join(node.db.path, 'log'));
    }
    if (node.kind === 'config') {
      return this.listFiles(path.join(node.db.path, 'conf'));
    }
    return [];
  }

  private listFiles(dirPath: string): DatabaseNode[] {
    if (!wslExistsSync(dirPath)) return [];
    return wslReaddirSync(dirPath)
      .sort()
      .filter((e) => wslIsFile(path.join(dirPath, e)))
      .map((e) => ({ kind: 'file' as const, filePath: path.join(dirPath, e) }));
  }
}
