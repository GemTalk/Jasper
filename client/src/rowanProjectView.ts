import * as vscode from 'vscode';
import {
  readRowanWorkspaceProject,
  RowanWorkspaceProject,
  RowanProjectPackage,
} from './rowanProject';
import {
  ProjectDependency,
  dependencyReferenceFile,
  readProjectDependencies,
} from './rowanDependency';

/** A package (directory of class source) in the workspace's Rowan project. */
export class RowanProjectPackageItem extends vscode.TreeItem {
  constructor(public readonly pkg: RowanProjectPackage) {
    super(pkg.name, vscode.TreeItemCollapsibleState.None);
    this.id = `rowan-package-${pkg.path}`;
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
    // Point at the real directory so the row reveals/opens it in the Explorer.
    this.resourceUri = vscode.Uri.file(pkg.path);
    this.tooltip = pkg.path;
    this.contextValue = 'rowanProjectPackage';
  }
}

/** A placeholder row (e.g. "No packages yet"). */
export class RowanProjectMessageItem extends vscode.TreeItem {
  constructor(
    public readonly kind: 'rowanProjectEmpty',
    label: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `rowan-project-message-${kind}`;
    this.contextValue = kind;
  }
}

/** The projects this one depends on. Only present when there are any. */
export class RowanDependencyGroupItem extends vscode.TreeItem {
  constructor(public readonly dependencies: ProjectDependency[]) {
    super('Dependencies', vscode.TreeItemCollapsibleState.Expanded);
    this.id = 'rowan-dependencies';
    this.iconPath = new vscode.ThemeIcon('references');
    this.description = `${dependencies.length}`;
    this.contextValue = 'rowanProjectDependencies';
  }
}

/**
 * How the view learns what the connected database has loaded. Returns undefined
 * when there is no answer — disconnected, or Rowan unavailable — which is not
 * the same as "loaded nothing", and must not read as it.
 */
export interface LoadedProjectSource {
  loadedProjectNames(): Promise<Set<string> | undefined>;
}

/** One project this project depends on, by git URL or by directory. */
export class RowanDependencyItem extends vscode.TreeItem {
  constructor(
    public readonly dependency: ProjectDependency,
    referenceFile: string,
    /** Whether the connected database has it; undefined when nothing can say. */
    loaded?: boolean,
  ) {
    super(dependency.name, vscode.TreeItemCollapsibleState.None);
    this.id = `rowan-dependency-${dependency.name}`;
    this.iconPath = new vscode.ThemeIcon('package');
    // Point the row at the reference spec — the dependency's record on disk —
    // so the row reveals and opens that file, the way a package row points at
    // its directory. (It does not pick up git's own badges: git decorates the
    // Explorer and Source Control views, not a contributed tree. Whether Jasper
    // should show an uncommitted marker of its own is still open.)
    this.resourceUri = vscode.Uri.file(referenceFile);
    // The pin is the interesting fact for a git dependency (a project is only
    // reproducible if it says *which* commit); for a directory, where it is.
    // Declaring a dependency does not put it in the image, so say which it is —
    // but only while connected, since disconnected we genuinely don't know.
    const source = dependency.kind === 'git' ? dependency.revision : dependency.diskUrl;
    const inImage = loaded === undefined ? '' : loaded ? ' · loaded' : ' · not loaded';
    this.description = `${source}${inImage}`;
    this.tooltip =
      dependency.kind === 'git'
        ? `${dependency.gitUrl}\nat ${dependency.revision}`
        : dependency.diskUrl;
    this.contextValue = 'rowanProjectDependency';
  }
}

export type RowanProjectNode =
  | RowanProjectPackageItem
  | RowanProjectMessageItem
  | RowanDependencyGroupItem
  | RowanDependencyItem;

/**
 * The Explorer-section view of the Rowan project at the open workspace root:
 * its packages, read from disk (no stone required). Contributed to the Explorer
 * container only when gemstone.workspaceIsRowanProject, so it appears solely for
 * Rowan projects, next to the file tree.
 */
export class RowanProjectTreeProvider implements vscode.TreeDataProvider<RowanProjectNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // The workspace project, read once per refresh. undefined = not yet probed,
  // null = the open folder is not a Rowan project.
  private project: RowanWorkspaceProject | null | undefined = undefined;

  constructor(private readonly loadedProjects?: LoadedProjectSource) {}

  refresh(): void {
    this.project = undefined;
    this._onDidChangeTreeData.fire();
  }

  /** The project's name, for the Explorer section's description; else undefined. */
  projectName(): string | undefined {
    return this.query()?.name;
  }

  getTreeItem(element: RowanProjectNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RowanProjectNode): Promise<RowanProjectNode[]> {
    const proj = this.query();
    if (!proj) return [];

    if (element instanceof RowanDependencyGroupItem) {
      const loaded = await this.loadedProjects?.loadedProjectNames();
      return element.dependencies.map(
        (dep) =>
          new RowanDependencyItem(
            dep,
            dependencyReferenceFile(proj.root, dep.name),
            loaded && loaded.has(dep.name),
          ),
      );
    }
    if (element) return [];

    // The project's own packages come first — they are what it is. What it
    // depends on follows, grouped, and only when it depends on anything.
    const packages: RowanProjectNode[] =
      proj.packages.length === 0
        ? [new RowanProjectMessageItem('rowanProjectEmpty', 'No packages yet')]
        : proj.packages.map((pkg) => new RowanProjectPackageItem(pkg));

    const dependencies = readProjectDependencies(proj.root);
    return dependencies.length === 0
      ? packages
      : [...packages, new RowanDependencyGroupItem(dependencies)];
  }

  private query(): RowanWorkspaceProject | null {
    if (this.project !== undefined) return this.project;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.project = root ? readRowanWorkspaceProject(root) : null;
    return this.project;
  }
}
