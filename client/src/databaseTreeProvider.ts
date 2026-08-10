import * as path from 'path';
import * as vscode from 'vscode';
import { SysadminStorage } from './sysadminStorage';
import { ProcessManager, versionsMatch } from './processManager';
import { GemStoneDatabase } from './sysadminTypes';
import { wslExistsSync, wslReaddirSync, wslIsFile } from './wslFs';

export type DatabaseNode =
  | { kind: 'database'; db: GemStoneDatabase }
  | { kind: 'stone'; db: GemStoneDatabase; running: boolean }
  | { kind: 'netldi'; db: GemStoneDatabase; running: boolean }
  | { kind: 'logs'; db: GemStoneDatabase }
  | { kind: 'config'; db: GemStoneDatabase }
  | { kind: 'file'; filePath: string };

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
        item.contextValue = 'gemstoneDb';
        item.iconPath = new vscode.ThemeIcon('database');
        item.tooltip = `Path: ${node.db.path}\nStone: ${node.db.config.stoneName}\nNetLDI: ${node.db.config.ldiName}\nVersion: ${node.db.config.version}\nBase extent: ${node.db.config.baseExtent}`;
        return item;
      }
      case 'stone': {
        const item = new vscode.TreeItem(`Stone: ${node.db.config.stoneName}`);
        item.description = node.running ? 'Running' : 'Stopped';
        item.contextValue = node.running ? 'gemstoneDbStoneRunning' : 'gemstoneDbStoneStopped';
        item.iconPath = new vscode.ThemeIcon(
          node.running ? 'play' : 'debug-stop',
          new vscode.ThemeColor(node.running ? 'testing.iconPassed' : 'testing.iconFailed'),
        );
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
        item.description = node.running
          ? `Running${proc?.port ? ` (port ${proc.port})` : ''}`
          : 'Stopped';
        item.contextValue = node.running ? 'gemstoneDbNetldiRunning' : 'gemstoneDbNetldiStopped';
        item.iconPath = new vscode.ThemeIcon(
          node.running ? 'play' : 'debug-stop',
          new vscode.ThemeColor(node.running ? 'testing.iconPassed' : 'testing.iconFailed'),
        );
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

  getChildren(node?: DatabaseNode): DatabaseNode[] {
    if (!node) {
      return this.storage.getDatabases().map((db) => ({ kind: 'database' as const, db }));
    }
    if (node.kind === 'database') {
      const stoneRunning = this.processManager.isStoneRunning(
        node.db.config.stoneName,
        node.db.config.version,
      );
      const netldiRunning = this.processManager.isNetldiRunning(
        node.db.config.ldiName,
        node.db.config.version,
      );
      return [
        { kind: 'stone', db: node.db, running: stoneRunning },
        { kind: 'netldi', db: node.db, running: netldiRunning },
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
