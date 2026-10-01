import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RowanRepoRegistry, TrackedRepo } from './rowanRepos';
import { isRowanProjectRoot } from './rowanProject';
import { findRowanLoadSpecs } from './rowanLoad';
import { ActiveSession } from './sessionManager';
import {
  listRowanProjects,
  diffRowanProject,
  getGemCacheKB,
  RowanProject,
  RowanDiff,
  RowanDiffOp,
} from './browserQueries';
import { loadedProjectUri, changeUri } from './rowanDecorations';

// The "Rowan" sidebar view. Rowan is a package manager, so the view is about
// state and operations, not code navigation (that's the System Browser's job).
// Sections, in the spirit of VS Code's own package UIs:
//   REPOSITORIES     — tracked on-disk repos (Remote-Explorer-style registry);
//   LOADED PROJECTS  — what the connected stone actually has (image lens);
//   CHANGES          — image↔disk drift per project, SCM-style. Diffing isn't
//                      free, so the section starts collapsed and each project's
//                      diff runs only when its node is expanded (or refreshed).

/** How the provider reaches the current session; narrow for testability. */
export interface RowanSessionSource {
  getSession(): ActiveSession | null;
}

export type RowanSection = 'repositories' | 'loaded' | 'changes';

const SECTION_LABELS: Record<RowanSection, string> = {
  repositories: 'Repositories',
  loaded: 'Loaded Projects',
  changes: 'Changes',
};
const SECTION_ICONS: Record<RowanSection, string> = {
  repositories: 'repo',
  loaded: 'database',
  changes: 'diff',
};

/** A section header row. */
export class RowanSectionItem extends vscode.TreeItem {
  constructor(public readonly section: RowanSection) {
    super(
      SECTION_LABELS[section],
      // Changes starts collapsed: expanding is what triggers the (non-free)
      // per-project diffs.
      section === 'changes'
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded,
    );
    this.id = `rowan-section-${section}`;
    this.contextValue = 'rowanSection';
    this.iconPath = new vscode.ThemeIcon(SECTION_ICONS[section]);
  }
}

/** A tracked repository row. */
export class RowanRepoItem extends vscode.TreeItem {
  constructor(
    public readonly repo: TrackedRepo,
    /** Names of the load specs found in the checkout ([] when dir is gone). */
    public readonly specNames: string[],
    public readonly missing: boolean,
    /** True when a loaded project in the connected stone matches a spec name. */
    loaded: boolean,
    /**
     * Set when the project declares (in its gemstone.ston) a gem temp-object cache
     * larger than the connected gem actually has — a load would overflow. Holds
     * the declared minimum in KB; undefined when the gem is adequate, unknown,
     * or no minimum is declared.
     */
    public readonly underProvisionedMinKB?: number,
    /** The open workspace-root project. Gets a distinct icon/marker. */
    public readonly isWorkspace = false,
    /** False for a workspace repo that isn't explicitly tracked (no untrack). */
    public readonly isTracked = true,
  ) {
    super(repo.name, vscode.TreeItemCollapsibleState.None);
    this.id = `rowan-repo-${repo.path}`;
    const detail = missing
      ? 'missing on disk'
      : specNames.length === 0
        ? 'no load spec found'
        : specNames.join(', ') + (loaded ? ' · loaded' : '');
    this.description = isWorkspace && !missing ? `${detail} · workspace` : detail;
    this.tooltip = [
      repo.path,
      isWorkspace ? 'The open workspace project.' : undefined,
      repo.gitUrl ? `from ${repo.gitUrl}` : undefined,
      missing ? 'The tracked directory no longer exists.' : undefined,
      underProvisionedMinKB
        ? `This stone's gem cache is too small to load this project — it needs about ${Math.round(underProvisionedMinKB / 1000)} MB. Raise GEM_TEMPOBJ_CACHE_SIZE and restart the stone.`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n');
    // A too-small gem cache gets the warning triangle even on a valid repo —
    // loading would overflow, so it's flagged before you try. The workspace
    // project gets a root-folder icon so it reads as "this project".
    this.iconPath = new vscode.ThemeIcon(
      missing || underProvisionedMinKB ? 'warning' : isWorkspace ? 'root-folder' : 'repo',
    );
    // Loadable only when the checkout exists and holds at least one spec.
    // A `Git` suffix marks a clone Jasper can update from its remote — the
    // package.json menus key the Load / Update / Stop-Tracking actions off
    // these (`=~ /^rowanRepo/` matches them all; `=~ Git` the updatable ones).
    // An untracked workspace repo gets a `Workspace` variant so it offers Load
    // but not Stop-Tracking (there's nothing tracked to stop).
    if (missing) {
      this.contextValue = 'rowanRepoMissing';
    } else if (isWorkspace && !isTracked) {
      this.contextValue = specNames.length > 0 ? 'rowanRepoWorkspace' : 'rowanRepoWorkspaceNoSpec';
    } else {
      const base = specNames.length > 0 ? 'rowanRepo' : 'rowanRepoNoSpec';
      this.contextValue = repo.gitUrl ? `${base}Git` : base;
    }
  }
}

/**
 * A project loaded in the connected stone. Dirty projects decorate exactly
 * like a modified file in the git view: tinted label plus a right-aligned M
 * badge, via the resourceUri and RowanDecorationProvider.
 */
export class RowanLoadedProjectItem extends vscode.TreeItem {
  constructor(public readonly project: RowanProject) {
    super(project.name, vscode.TreeItemCollapsibleState.None);
    this.id = `rowan-loaded-${project.name}`;
    this.resourceUri = loadedProjectUri(project.name, project.isDirty);
    this.tooltip = project.isDirty
      ? `${project.name} — has unsaved changes relative to its disk repository`
      : project.isBuiltin
        ? `${project.name} — shipped with the GemStone image`
        : project.name;
    this.iconPath = new vscode.ThemeIcon(project.isBuiltin ? 'library' : 'package');
    this.contextValue = project.isBuiltin ? 'rowanLoadedProjectBuiltin' : 'rowanLoadedProject';
  }
}

/** The collapsed group holding the projects GemStone ships in the image. */
export class RowanBuiltinGroupItem extends vscode.TreeItem {
  constructor(count: number) {
    super('Built-in', vscode.TreeItemCollapsibleState.Collapsed);
    this.id = 'rowan-builtin-group';
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon('library');
    this.contextValue = 'rowanBuiltinGroup';
    this.tooltip = 'Projects shipped with the GemStone image';
  }
}

/**
 * A single-message row (placeholder / status / error) inside a section.
 * `kind` doubles as the contextValue so menus and tests can key off it:
 *   rowanEmpty          — no repos tracked (click adds one)
 *   rowanNoSession      — no connected session
 *   rowanNoRowan        — connected image has no Rowan (install action later)
 *   rowanSectionError   — query failed
 *   rowanClean          — a project has no image↔disk differences
 */
export class RowanMessageItem extends vscode.TreeItem {
  constructor(
    public readonly kind:
      'rowanEmpty' | 'rowanNoSession' | 'rowanNoRowan' | 'rowanSectionError' | 'rowanClean',
    label: string,
    icon: string,
    command?: vscode.Command,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `rowan-message-${kind}`;
    if (icon !== '') this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = kind;
    this.command = command;
  }
}

/** A project under Changes; expanding it computes the image↔disk diff. */
export class RowanChangesProjectItem extends vscode.TreeItem {
  constructor(public readonly projectName: string) {
    super(projectName, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `rowan-changes-${projectName}`;
    this.iconPath = new vscode.ThemeIcon('package');
    this.contextValue = 'rowanChangesProject';
  }
}

/**
 * One image↔disk difference (a class or method) within a project, decorated
 * like a git changes row: tinted label plus a right-aligned M / A / D badge.
 * Image-only ≈ added (not yet on disk), disk-only ≈ deleted (missing from the
 * image), changed ≈ modified.
 */
export class RowanChangeItem extends vscode.TreeItem {
  constructor(
    public readonly projectName: string,
    public readonly op: RowanDiffOp,
  ) {
    super(op.target, vscode.TreeItemCollapsibleState.None);
    this.id = `rowan-change-${projectName}-${op.package}-${op.target}`;
    this.description = op.package;
    const state = op.location === 'image' ? 'A' : op.location === 'disk' ? 'D' : 'M';
    this.resourceUri = changeUri(projectName, op.target, state);
    this.iconPath = new vscode.ThemeIcon(
      op.target.includes('>>') ? 'symbol-method' : 'symbol-class',
    );
    this.tooltip =
      op.location === 'image'
        ? `${op.target} exists only in the image (not on disk)`
        : op.location === 'disk'
          ? `${op.target} exists only on disk (not in the image)`
          : `${op.target} differs between image and disk`;
    this.contextValue = 'rowanChange';
  }
}

export type RowanTreeNode =
  | RowanSectionItem
  | RowanRepoItem
  | RowanLoadedProjectItem
  | RowanBuiltinGroupItem
  | RowanChangesProjectItem
  | RowanChangeItem
  | RowanMessageItem;

export class RowanTreeProvider implements vscode.TreeDataProvider<RowanTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RowanTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // One image query per refresh cycle: both sections need the loaded-project
  // list (rows for one, the "· loaded" repo marker for the other).
  private loadedQuery:
    | { state: 'ok'; available: boolean; projects: RowanProject[] }
    | { state: 'nosession' }
    | { state: 'error'; message: string }
    | null = null;

  constructor(
    private readonly registry: RowanRepoRegistry,
    private readonly sessions: RowanSessionSource,
  ) {}

  // Diffs computed this refresh cycle, keyed by project name.
  private diffCache = new Map<string, RowanDiff>();

  refresh(): void {
    this.loadedQuery = null;
    this.diffCache.clear();
    this.gemCacheKB = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: RowanTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RowanTreeNode): Promise<RowanTreeNode[]> {
    if (!element) {
      // A bare start (nothing tracked, no workspace project, no session) renders
      // as viewsWelcome content instead of three empty sections — that's where
      // the real "Add Rowan Repository" button lives (package.json viewsWelcome).
      if (
        this.workspaceRepos().length === 0 &&
        !this.hasWorkspaceProject() &&
        !this.sessions.getSession()
      ) {
        return [];
      }
      return [
        new RowanSectionItem('repositories'),
        new RowanSectionItem('loaded'),
        new RowanSectionItem('changes'),
      ];
    }
    if (element instanceof RowanSectionItem) {
      switch (element.section) {
        case 'repositories':
          return await this.repositoryChildren();
        case 'loaded':
          return await this.loadedChildren();
        case 'changes':
          return await this.changesChildren();
      }
    }
    if (element instanceof RowanChangesProjectItem) {
      return await this.changesFor(element.projectName);
    }
    if (element instanceof RowanBuiltinGroupItem) {
      const q = await this.queryLoaded();
      if (q.state !== 'ok' || !q.available) return [];
      return q.projects
        .filter((p) => p.isBuiltin)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => new RowanLoadedProjectItem(p));
    }
    return [];
  }

  private async changesChildren(): Promise<RowanTreeNode[]> {
    const q = await this.queryLoaded();
    if (q.state === 'nosession') {
      return [
        new RowanMessageItem('rowanNoSession', 'Not connected — log in to see changes', 'plug'),
      ];
    }
    if (q.state === 'error') {
      return [
        new RowanMessageItem('rowanSectionError', `Could not list projects: ${q.message}`, 'error'),
      ];
    }
    if (!q.available) {
      return [
        new RowanMessageItem('rowanNoRowan', 'Rowan is not installed in this image', 'warning'),
      ];
    }
    // Built-ins live in the read-only $GEMSTONE tree; drift management is
    // about the user's own repositories.
    return q.projects.filter((p) => !p.isBuiltin).map((p) => new RowanChangesProjectItem(p.name));
  }

  /** The diff rows for one project; runs the diff on first expansion. */
  private async changesFor(projectName: string): Promise<RowanTreeNode[]> {
    const session = this.sessions.getSession();
    if (!session) return [];
    let diff = this.diffCache.get(projectName);
    if (!diff) {
      try {
        diff = await diffRowanProject(session, projectName);
      } catch (e: unknown) {
        diff = { ok: false, error: e instanceof Error ? e.message : String(e), operations: [] };
      }
      this.diffCache.set(projectName, diff);
    }
    if (!diff.ok) {
      return [new RowanMessageItem('rowanSectionError', `Diff failed: ${diff.error}`, 'error')];
    }
    if (diff.operations.length === 0) {
      return [new RowanMessageItem('rowanClean', 'No differences with disk', 'check')];
    }
    return diff.operations
      .slice()
      .sort((a, b) => (a.package + a.target).localeCompare(b.package + b.target))
      .map((op) => new RowanChangeItem(projectName, op));
  }

  // The registry persists globally, but FOR NOW the sidebar shows only repos
  // checked out inside the open workspace (matching where clones now land).
  // TODO: make the clone/track location configurable — see rowanCloneDest.
  private workspaceRepos(): TrackedRepo[] {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    if (roots.length === 0) return [];
    return this.registry
      .list()
      .filter((r) => roots.some((root) => r.path === root || r.path.startsWith(root + path.sep)));
  }

  /** True when an open workspace folder is itself a Rowan project. */
  private hasWorkspaceProject(): boolean {
    return (vscode.workspace.workspaceFolders ?? []).some((f) => isRowanProjectRoot(f.uri.fsPath));
  }

  private async repositoryChildren(): Promise<RowanTreeNode[]> {
    const tracked = this.workspaceRepos();
    const trackedPaths = new Set(tracked.map((r) => r.path));
    // The open workspace-root project always appears here, even when it hasn't
    // been explicitly tracked — marked as the workspace repo.
    const workspaceRoots = (vscode.workspace.workspaceFolders ?? [])
      .map((f) => f.uri.fsPath)
      .filter((root) => isRowanProjectRoot(root));
    const workspaceSet = new Set(workspaceRoots);
    const synthesized: TrackedRepo[] = workspaceRoots
      .filter((root) => !trackedPaths.has(root))
      .map((root) => ({ name: path.basename(root), path: root }));
    const repos = [...tracked, ...synthesized];
    if (repos.length === 0) {
      const item = new RowanMessageItem('rowanEmpty', 'No repositories tracked — add one…', '', {
        command: 'gemstone.rowanAddRepo',
        title: 'Add Rowan Repository',
      });
      return [item];
    }
    const loadedNames = await this.loadedProjectNames();
    const items: RowanTreeNode[] = [];
    for (const repo of repos.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      items.push(
        await this.describe(
          repo,
          loadedNames,
          workspaceSet.has(repo.path),
          trackedPaths.has(repo.path),
        ),
      );
    }
    return items;
  }

  private async loadedChildren(): Promise<RowanTreeNode[]> {
    const q = await this.queryLoaded();
    if (q.state === 'nosession') {
      return [
        new RowanMessageItem(
          'rowanNoSession',
          'Not connected — log in to see loaded projects',
          'plug',
        ),
      ];
    }
    if (q.state === 'error') {
      return [
        new RowanMessageItem('rowanSectionError', `Could not list projects: ${q.message}`, 'error'),
      ];
    }
    if (!q.available) {
      // The image has no Rowan at all. Surfacing this is deliberate: the
      // install-Rowan-into-a-bare-image action will hang off this row.
      return [
        new RowanMessageItem('rowanNoRowan', 'Rowan is not installed in this image', 'warning'),
      ];
    }
    const user = q.projects
      .filter((p) => !p.isBuiltin)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => new RowanLoadedProjectItem(p));
    const builtins = q.projects.filter((p) => p.isBuiltin);
    return builtins.length > 0 ? [...user, new RowanBuiltinGroupItem(builtins.length)] : user;
  }

  private async queryLoaded(): Promise<NonNullable<RowanTreeProvider['loadedQuery']>> {
    if (this.loadedQuery) return this.loadedQuery;
    const session = this.sessions.getSession();
    if (!session) {
      this.loadedQuery = { state: 'nosession' };
    } else {
      try {
        const { available, projects } = await listRowanProjects(session);
        this.loadedQuery = { state: 'ok', available, projects };
      } catch (e: unknown) {
        this.loadedQuery = { state: 'error', message: e instanceof Error ? e.message : String(e) };
      }
    }
    return this.loadedQuery;
  }

  /**
   * Loaded project names, or undefined when nothing can answer — disconnected,
   * Rowan unavailable, or the query failed. Undefined is not "nothing loaded":
   * callers that show the distinction to a user must not conflate the two.
   */
  async loadedProjectNames(): Promise<Set<string> | undefined> {
    const q = await this.queryLoaded();
    return q.state === 'ok' && q.available ? new Set(q.projects.map((p) => p.name)) : undefined;
  }

  private async describe(
    repo: TrackedRepo,
    loadedNames: Set<string> | undefined,
    isWorkspace = false,
    isTracked = true,
  ): Promise<RowanRepoItem> {
    if (!fs.existsSync(repo.path)) {
      return new RowanRepoItem(repo, [], true, false, undefined, isWorkspace, isTracked);
    }
    const specs = findRowanLoadSpecs(repo.path);
    const specNames = specs.map((s) => s.name);
    const loaded = specNames.some((name) => loadedNames?.has(name) ?? false);
    // Warn when a spec declares a bigger gem cache than the connected gem has —
    // only meaningful while connected and after the gem-cache probe succeeds.
    const gemKB = await this.queryGemCacheKB();
    const declaredMin = Math.max(0, ...specs.map((s) => s.minTempObjCacheKB ?? 0));
    const underProvisioned = gemKB !== undefined && declaredMin > gemKB ? declaredMin : undefined;
    return new RowanRepoItem(
      repo,
      specNames,
      false,
      loaded,
      underProvisioned,
      isWorkspace,
      isTracked,
    );
  }

  // The connected gem's temp-object cache (KB), probed once per refresh. null
  // once probed-and-failed/absent so we don't re-probe; undefined result means
  // "unknown", which suppresses the warning rather than crying wolf.
  private gemCacheKB: number | null | undefined = undefined;
  private async queryGemCacheKB(): Promise<number | undefined> {
    if (this.gemCacheKB !== undefined) return this.gemCacheKB ?? undefined;
    const session = this.sessions.getSession();
    if (!session) {
      this.gemCacheKB = null;
      return undefined;
    }
    try {
      this.gemCacheKB = (await getGemCacheKB(session)) ?? null;
    } catch {
      this.gemCacheKB = null;
    }
    return this.gemCacheKB ?? undefined;
  }
}
