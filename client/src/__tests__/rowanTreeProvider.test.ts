import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

const listRowanProjectsMock = vi.fn();
const diffRowanProjectMock = vi.fn();
const getGemCacheKBMock = vi.fn();
vi.mock('../browserQueries', () => ({
  listRowanProjects: (...args: unknown[]) => listRowanProjectsMock(...args),
  diffRowanProject: (...args: unknown[]) => diffRowanProjectMock(...args),
  getGemCacheKB: (...args: unknown[]) => getGemCacheKBMock(...args),
}));

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolders } from '../__mocks__/vscode';
import {
  RowanTreeProvider,
  RowanSectionItem,
  RowanRepoItem,
  RowanLoadedProjectItem,
  RowanBuiltinGroupItem,
  RowanChangesProjectItem,
  RowanChangeItem,
  RowanMessageItem,
} from '../rowanTreeProvider';
import { RowanRepoRegistry } from '../rowanRepos';
import type { ActiveSession } from '../sessionManager';
import type * as vscode from 'vscode';

function fakeMemento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, defaultValue?: T) =>
      (store.has(key) ? store.get(key) : defaultValue) as T,
    update: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    keys: () => [...store.keys()],
  };
}

// A real directory on disk, holding a Rowan load spec when asked — the
// provider inspects the filesystem to describe each tracked repo.
function makeRepoDir(withSpec: boolean, specName = 'MyProject', minCacheKB?: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowan-repo-'));
  if (withSpec) {
    const specsDir = path.join(dir, 'rowan', 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, `${specName}.ston`),
      `RwLoadSpecificationV2 {\n\t#specName : '${specName}'\n}\n`,
    );
    if (minCacheKB !== undefined) {
      fs.writeFileSync(
        path.join(dir, 'rowan', 'gemstone.ston'),
        `{ #minTempObjCacheKB : ${minCacheKB} }`,
      );
    }
  }
  return dir;
}

const fakeSession = { id: 1 } as unknown as ActiveSession;

function makeProvider(registry: RowanRepoRegistry, session: ActiveSession | null) {
  return new RowanTreeProvider(registry, { getSession: () => session });
}

function sectionChildren(
  provider: RowanTreeProvider,
  section: 'repositories' | 'loaded' | 'changes',
) {
  const roots = provider.getChildren() as RowanSectionItem[];
  const target = roots.find((r) => r.section === section)!;
  return provider.getChildren(target);
}

describe('RowanTreeProvider', () => {
  let registry: RowanRepoRegistry;

  beforeEach(() => {
    // Repos are shown only when their checkout is inside the open workspace;
    // makeRepoDir() creates them under the temp dir, so open that as the folder.
    __setWorkspaceFolders([os.tmpdir()]);
    registry = new RowanRepoRegistry(fakeMemento());
    listRowanProjectsMock.mockReset();
    listRowanProjectsMock.mockReturnValue({ available: true, projects: [] });
    diffRowanProjectMock.mockReset();
    diffRowanProjectMock.mockReturnValue({ ok: true, error: '', operations: [] });
    getGemCacheKBMock.mockReset();
    getGemCacheKBMock.mockReturnValue(2000000);
  });

  it('shows Repositories, Loaded Projects, and Changes sections at the root', () => {
    const provider = makeProvider(registry, fakeSession);

    const roots = provider.getChildren() as RowanSectionItem[];

    expect(roots.map((r) => r.label)).toEqual(['Repositories', 'Loaded Projects', 'Changes']);
  });

  it('yields no rows on a bare start so the welcome content (with its Add button) shows', () => {
    const provider = makeProvider(registry, null);

    expect(provider.getChildren()).toEqual([]);
  });

  it('keeps the sections once anything exists to show', async () => {
    await registry.add({ name: 'repo', path: path.join(os.tmpdir(), 'rowan-somewhere') });
    const provider = makeProvider(registry, null);

    expect(provider.getChildren()).toHaveLength(3);
  });

  describe('repositories section', () => {
    it('offers a plain add-repository placeholder when connected with nothing tracked', () => {
      const provider = makeProvider(registry, fakeSession);

      const children = sectionChildren(provider, 'repositories');

      expect(children).toHaveLength(1);
      const item = children[0] as RowanMessageItem;
      expect(item.kind).toBe('rowanEmpty');
      expect(item.command?.command).toBe('gemstone.rowanAddRepo');
      expect(item.iconPath).toBeUndefined();
    });

    it('lists a tracked repo with its load spec and marks it loadable', async () => {
      await registry.add({ name: 'my-repo', path: makeRepoDir(true) });
      const provider = makeProvider(registry, null);

      const [item] = sectionChildren(provider, 'repositories') as RowanRepoItem[];

      expect(item).toBeInstanceOf(RowanRepoItem);
      expect(item.label).toBe('my-repo');
      expect(item.description).toBe('MyProject');
      expect(item.contextValue).toBe('rowanRepo');
    });

    it('shows the open workspace project as a workspace repo, even when untracked', () => {
      const root = makeRepoDir(true, 'WsApp');
      fs.writeFileSync(
        path.join(root, 'rowan', 'project.ston'),
        "RwProjectSpecificationV3 { #specName : 'project' }",
      );
      __setWorkspaceFolders([root]);
      const provider = makeProvider(registry, null);

      const [item] = sectionChildren(provider, 'repositories') as RowanRepoItem[];

      expect(item.contextValue).toBe('rowanRepoWorkspace');
      expect(item.description).toContain('workspace');
      expect((item.iconPath as { id?: string }).id).toBe('root-folder');
    });

    it('marks a git-backed repo so it can be updated from its remote', async () => {
      await registry.add({
        name: 'seaside',
        path: makeRepoDir(true, 'Seaside'),
        gitUrl: 'git@github.com:x/seaside-rowan.git',
      });
      const provider = makeProvider(registry, null);

      const [item] = sectionChildren(provider, 'repositories') as RowanRepoItem[];

      expect(item.contextValue).toBe('rowanRepoGit');
    });

    it('marks a git-backed repo with no spec as updatable but not loadable', async () => {
      await registry.add({
        name: 'empty',
        path: makeRepoDir(false),
        gitUrl: 'https://x/empty.git',
      });
      const provider = makeProvider(registry, null);

      const [item] = sectionChildren(provider, 'repositories') as RowanRepoItem[];

      expect(item.contextValue).toBe('rowanRepoNoSpecGit');
    });

    it('marks a repo whose project is loaded in the connected stone', async () => {
      await registry.add({ name: 'my-repo', path: makeRepoDir(true, 'Seaside') });
      listRowanProjectsMock.mockReturnValue({
        available: true,
        projects: [{ name: 'Seaside', isDirty: false, isBuiltin: false }],
      });
      const provider = makeProvider(registry, fakeSession);

      const [item] = sectionChildren(provider, 'repositories') as RowanRepoItem[];

      expect(item.description).toBe('Seaside · loaded');
    });

    it('flags a repo without any load spec as not loadable', async () => {
      await registry.add({ name: 'no-spec', path: makeRepoDir(false) });
      const provider = makeProvider(registry, null);

      const [item] = sectionChildren(provider, 'repositories') as RowanRepoItem[];

      expect(item.description).toBe('no load spec found');
      expect(item.contextValue).toBe('rowanRepoNoSpec');
    });

    it('flags a repo whose directory has disappeared', async () => {
      await registry.add({ name: 'gone', path: path.join(os.tmpdir(), 'rowan-gone-missing') });
      const provider = makeProvider(registry, null);

      const [item] = sectionChildren(provider, 'repositories') as RowanRepoItem[];

      expect(item.description).toBe('missing on disk');
      expect(item.contextValue).toBe('rowanRepoMissing');
    });

    it('flags a repo whose declared cache exceeds the connected gem', async () => {
      await registry.add({ name: 'seaside', path: makeRepoDir(true, 'Seaside', 500000) });
      getGemCacheKBMock.mockReturnValue(50000);
      const provider = makeProvider(registry, fakeSession);

      const [item] = sectionChildren(provider, 'repositories') as RowanRepoItem[];

      expect(item.underProvisionedMinKB).toBe(500000);
      expect((item.iconPath as { id: string }).id).toBe('warning');
      expect(String(item.tooltip)).toContain('500 MB');
    });

    it('does not flag when the gem cache is adequate', async () => {
      await registry.add({ name: 'seaside', path: makeRepoDir(true, 'Seaside', 500000) });
      getGemCacheKBMock.mockReturnValue(2000000);
      const provider = makeProvider(registry, fakeSession);

      const [item] = sectionChildren(provider, 'repositories') as RowanRepoItem[];

      expect(item.underProvisionedMinKB).toBeUndefined();
    });

    it('does not flag when disconnected (gem cache unknown)', async () => {
      await registry.add({ name: 'seaside', path: makeRepoDir(true, 'Seaside', 500000) });
      const provider = makeProvider(registry, null);

      const [item] = sectionChildren(provider, 'repositories') as RowanRepoItem[];

      expect(item.underProvisionedMinKB).toBeUndefined();
      expect(getGemCacheKBMock).not.toHaveBeenCalled();
    });

    it('sorts repos by name', async () => {
      await registry.add({ name: 'zeta', path: makeRepoDir(true) });
      await registry.add({ name: 'alpha', path: makeRepoDir(true) });
      const provider = makeProvider(registry, null);

      const labels = (sectionChildren(provider, 'repositories') as RowanRepoItem[]).map(
        (i) => i.label,
      );

      expect(labels).toEqual(['alpha', 'zeta']);
    });

    it('shows only repos checked out inside the open workspace', async () => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rowan-ws-'));
      __setWorkspaceFolders([ws]);
      const inside = path.join(ws, 'inside');
      fs.mkdirSync(path.join(inside, 'rowan', 'specs'), { recursive: true });
      fs.writeFileSync(
        path.join(inside, 'rowan', 'specs', 'In.ston'),
        `RwLoadSpecificationV2 {\n\t#specName : 'In'\n}\n`,
      );
      await registry.add({ name: 'inside', path: inside });
      await registry.add({ name: 'outside', path: makeRepoDir(true) });
      const provider = makeProvider(registry, null);

      const labels = (sectionChildren(provider, 'repositories') as RowanRepoItem[]).map(
        (i) => i.label,
      );

      expect(labels).toEqual(['inside']);
    });
  });

  describe('loaded projects section', () => {
    it('asks for a connection when no session is selected', async () => {
      await registry.add({ name: 'repo', path: path.join(os.tmpdir(), 'rowan-somewhere') });
      const provider = makeProvider(registry, null);

      const [item] = sectionChildren(provider, 'loaded') as RowanMessageItem[];

      expect(item.kind).toBe('rowanNoSession');
      expect(listRowanProjectsMock).not.toHaveBeenCalled();
    });

    it('reports when the connected image has no Rowan', () => {
      listRowanProjectsMock.mockReturnValue({ available: false, projects: [] });
      const provider = makeProvider(registry, fakeSession);

      const [item] = sectionChildren(provider, 'loaded') as RowanMessageItem[];

      expect(item.kind).toBe('rowanNoRowan');
      expect(item.label).toBe('Rowan is not installed in this image');
    });

    it('decorates modified projects the way the git view does', () => {
      listRowanProjectsMock.mockReturnValue({
        available: true,
        projects: [
          { name: 'Seaside', isDirty: true, isBuiltin: false },
          { name: 'STON', isDirty: false, isBuiltin: false },
        ],
      });
      const provider = makeProvider(registry, fakeSession);

      const items = sectionChildren(provider, 'loaded') as RowanLoadedProjectItem[];

      expect(items.map((i) => i.label)).toEqual(['Seaside', 'STON']);
      expect(items[0].resourceUri?.query).toBe('state=M');
      expect(items[1].resourceUri?.query).toBe('');
      expect(items[0].contextValue).toBe('rowanLoadedProject');
    });

    it('collects built-in projects under a collapsed group after the user projects', () => {
      listRowanProjectsMock.mockReturnValue({
        available: true,
        projects: [
          { name: 'Cypress', isDirty: false, isBuiltin: true },
          { name: 'Rowan', isDirty: false, isBuiltin: true },
          { name: 'Seaside', isDirty: false, isBuiltin: false },
        ],
      });
      const provider = makeProvider(registry, fakeSession);

      const items = sectionChildren(provider, 'loaded');

      expect((items[0] as RowanLoadedProjectItem).label).toBe('Seaside');
      const group = items[1];
      expect(group).toBeInstanceOf(RowanBuiltinGroupItem);
      expect(group.description).toBe('2');
      const builtins = provider.getChildren(group) as RowanLoadedProjectItem[];
      expect(builtins.map((b) => b.label)).toEqual(['Cypress', 'Rowan']);
      expect(builtins[0].contextValue).toBe('rowanLoadedProjectBuiltin');
    });

    it('surfaces a query failure instead of an empty section', () => {
      listRowanProjectsMock.mockImplementation(() => {
        throw new Error('session busy');
      });
      const provider = makeProvider(registry, fakeSession);

      const [item] = sectionChildren(provider, 'loaded') as RowanMessageItem[];

      expect(item.kind).toBe('rowanSectionError');
      expect(item.label).toContain('session busy');
    });

    it('queries the image once per refresh cycle for both sections', async () => {
      await registry.add({ name: 'repo', path: makeRepoDir(true, 'Seaside') });
      listRowanProjectsMock.mockReturnValue({
        available: true,
        projects: [{ name: 'Seaside', isDirty: false, isBuiltin: false }],
      });
      const provider = makeProvider(registry, fakeSession);

      sectionChildren(provider, 'repositories');
      sectionChildren(provider, 'loaded');

      expect(listRowanProjectsMock).toHaveBeenCalledTimes(1);
    });

    it('re-queries after a refresh', () => {
      const provider = makeProvider(registry, fakeSession);
      sectionChildren(provider, 'loaded');

      provider.refresh();
      sectionChildren(provider, 'loaded');

      expect(listRowanProjectsMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('changes section', () => {
    beforeEach(() => {
      listRowanProjectsMock.mockReturnValue({
        available: true,
        projects: [
          { name: 'Seaside', isDirty: true, isBuiltin: false },
          { name: 'Rowan', isDirty: false, isBuiltin: true },
        ],
      });
    });

    it('lists an expandable node per user project — built-ins are not drift targets', () => {
      const provider = makeProvider(registry, fakeSession);

      const items = sectionChildren(provider, 'changes') as RowanChangesProjectItem[];

      expect(items).toHaveLength(1);
      expect(items[0]).toBeInstanceOf(RowanChangesProjectItem);
      expect(items[0].projectName).toBe('Seaside');
      expect(diffRowanProjectMock).not.toHaveBeenCalled();
    });

    it('diffs a project when its node is expanded', () => {
      diffRowanProjectMock.mockReturnValue({
        ok: true,
        error: '',
        operations: [
          {
            location: 'changed',
            package: 'Seaside-Core',
            target: 'WAEncoder class>>initializeTable',
          },
          { location: 'image', package: 'Seaside-Component', target: 'HelloJasper' },
        ],
      });
      const provider = makeProvider(registry, fakeSession);
      const [projectNode] = sectionChildren(provider, 'changes') as RowanChangesProjectItem[];

      const rows = provider.getChildren(projectNode) as RowanChangeItem[];

      expect(rows.map((r) => r.label)).toEqual(['HelloJasper', 'WAEncoder class>>initializeTable']);
      expect(rows.map((r) => r.description)).toEqual(['Seaside-Component', 'Seaside-Core']);
      // Decorated in git vocabulary: image-only = A, changed = M.
      expect(rows.map((r) => r.resourceUri?.query)).toEqual(['state=A', 'state=M']);
    });

    it('reports a clean project instead of showing nothing', () => {
      const provider = makeProvider(registry, fakeSession);
      const [projectNode] = sectionChildren(provider, 'changes') as RowanChangesProjectItem[];

      const [row] = provider.getChildren(projectNode) as RowanMessageItem[];

      expect(row.kind).toBe('rowanClean');
      expect(row.label).toBe('No differences with disk');
    });

    it('surfaces a diff failure on the project node', () => {
      diffRowanProjectMock.mockReturnValue({ ok: false, error: 'no repo root', operations: [] });
      const provider = makeProvider(registry, fakeSession);
      const [projectNode] = sectionChildren(provider, 'changes') as RowanChangesProjectItem[];

      const [row] = provider.getChildren(projectNode) as RowanMessageItem[];

      expect(row.kind).toBe('rowanSectionError');
      expect(row.label).toContain('no repo root');
    });

    it('diffs a project once per refresh cycle', () => {
      const provider = makeProvider(registry, fakeSession);
      const [projectNode] = sectionChildren(provider, 'changes') as RowanChangesProjectItem[];

      provider.getChildren(projectNode);
      provider.getChildren(projectNode);

      expect(diffRowanProjectMock).toHaveBeenCalledTimes(1);
    });

    it('reports when the connected image has no Rowan', () => {
      listRowanProjectsMock.mockReturnValue({ available: false, projects: [] });
      const provider = makeProvider(registry, fakeSession);

      const [item] = sectionChildren(provider, 'changes') as RowanMessageItem[];

      expect(item.kind).toBe('rowanNoRowan');
    });
  });
});
