import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { __setWorkspaceFolders } from '../__mocks__/vscode';
import {
  RowanProjectTreeProvider,
  RowanProjectPackageItem,
  RowanProjectMessageItem,
  RowanDependencyGroupItem,
} from '../rowanProjectView';
import { addProjectDependency } from '../rowanDependency';
import { uriFsPath } from './support/uri';

const dirs: string[] = [];

// A real directory that IS a Rowan project: rowan/project.ston + src/<pkg> dirs,
// and optionally a load spec (which supplies the display name).
function makeProjectDir(packages: string[] = [], specName?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowan-exproj-'));
  dirs.push(dir);
  const rowanDir = path.join(dir, 'rowan');
  fs.mkdirSync(rowanDir, { recursive: true });
  fs.writeFileSync(
    path.join(rowanDir, 'project.ston'),
    `RwProjectSpecificationV2 {\n\t#specName : 'project',\n\t#packagesPath : 'src',\n\t#specsPath : 'rowan/specs' }\n`,
  );
  // Every real project has a component; dependencies are listed in it.
  fs.mkdirSync(path.join(rowanDir, 'components'), { recursive: true });
  fs.writeFileSync(
    path.join(rowanDir, 'components', 'Core.ston'),
    `RwComponentV2 {\n\t#name : 'Core',\n\t#projectNames : [ ]\n}\n`,
  );
  if (specName) {
    const specsDir = path.join(rowanDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, `${specName}.ston`),
      `RwLoadSpecificationV2 {\n\t#specName : '${specName}'\n}\n`,
    );
  }
  for (const p of packages) fs.mkdirSync(path.join(dir, 'src', p), { recursive: true });
  return dir;
}

function dependencyGroup(provider: RowanProjectTreeProvider): RowanDependencyGroupItem {
  const group = provider.getChildren().find((r) => r instanceof RowanDependencyGroupItem);
  if (!group) throw new Error('the project declares no dependencies');
  return group;
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  __setWorkspaceFolders(undefined);
});

describe('RowanProjectTreeProvider', () => {
  it('lists the project packages, sorted', () => {
    __setWorkspaceFolders([makeProjectDir(['Zeta-Core', 'Alpha-Core'])]);
    const provider = new RowanProjectTreeProvider();

    const rows = provider.getChildren();

    expect(rows.every((r) => r instanceof RowanProjectPackageItem)).toBe(true);
    expect(rows.map((r) => r.label)).toEqual(['Alpha-Core', 'Zeta-Core']);
  });

  it('shows a placeholder when the project has no packages', () => {
    __setWorkspaceFolders([makeProjectDir([])]);
    const provider = new RowanProjectTreeProvider();

    const rows = provider.getChildren();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBeInstanceOf(RowanProjectMessageItem);
    expect((rows[0] as RowanProjectMessageItem).kind).toBe('rowanProjectEmpty');
  });

  it('shows nothing when the open folder is not a Rowan project', () => {
    __setWorkspaceFolders([os.tmpdir()]);
    const provider = new RowanProjectTreeProvider();

    expect(provider.getChildren()).toEqual([]);
  });

  it('shows nothing when no folder is open', () => {
    __setWorkspaceFolders(undefined);
    const provider = new RowanProjectTreeProvider();

    expect(provider.getChildren()).toEqual([]);
  });

  it('exposes the project name for the section description', () => {
    __setWorkspaceFolders([makeProjectDir([], 'Seaside')]);
    const provider = new RowanProjectTreeProvider();

    expect(provider.projectName()).toBe('Seaside');
  });

  it('groups the dependencies below the packages', () => {
    const dir = makeProjectDir(['One-Core']);
    addProjectDependency(dir, { kind: 'disk', name: 'SharedKit', diskUrl: '/work/SharedKit' });
    __setWorkspaceFolders([dir]);
    const provider = new RowanProjectTreeProvider();

    const rows = provider.getChildren();

    expect(rows.map((r) => r.label)).toEqual(['One-Core', 'Dependencies']);
  });

  it('offers no dependency group when the project depends on nothing', () => {
    __setWorkspaceFolders([makeProjectDir(['One-Core'])]);
    const provider = new RowanProjectTreeProvider();

    expect(provider.getChildren().map((r) => r.label)).toEqual(['One-Core']);
  });

  it('lists each dependency under the group', () => {
    const dir = makeProjectDir([]);
    addProjectDependency(dir, { kind: 'disk', name: 'Zebra', diskUrl: '/work/Zebra' });
    addProjectDependency(dir, { kind: 'disk', name: 'Alpha', diskUrl: '/work/Alpha' });
    __setWorkspaceFolders([dir]);
    const provider = new RowanProjectTreeProvider();

    const rows = provider.getChildren(dependencyGroup(provider));

    expect(rows.map((r) => r.label)).toEqual(['Alpha', 'Zebra']);
  });

  it('points a dependency row at its reference spec', () => {
    const dir = makeProjectDir([]);
    addProjectDependency(dir, { kind: 'disk', name: 'SharedKit', diskUrl: '/work/SharedKit' });
    __setWorkspaceFolders([dir]);
    const provider = new RowanProjectTreeProvider();

    const [row] = provider.getChildren(dependencyGroup(provider));

    expect(row.resourceUri?.fsPath).toBe(
      uriFsPath(path.join(dir, 'rowan', 'projects', 'SharedKit.ston')),
    );
  });

  it('shows the revision a git dependency is pinned to', () => {
    const dir = makeProjectDir([]);
    addProjectDependency(dir, {
      kind: 'git',
      name: 'Toolkit',
      gitUrl: 'https://github.com/owner/Toolkit.git',
      revision: 'v1.0.0',
    });
    __setWorkspaceFolders([dir]);
    const provider = new RowanProjectTreeProvider();

    const [row] = provider.getChildren(dependencyGroup(provider));

    expect(row.description).toBe('v1.0.0');
  });

  it('says nothing about the image when no database is connected', () => {
    const dir = makeProjectDir([]);
    addProjectDependency(dir, { kind: 'disk', name: 'SharedKit', diskUrl: '/work/SharedKit' });
    __setWorkspaceFolders([dir]);
    const provider = new RowanProjectTreeProvider({ loadedProjectNames: () => undefined });

    const [row] = provider.getChildren(dependencyGroup(provider));

    expect(row.description).toBe('/work/SharedKit');
  });

  it('marks a dependency the connected database does not have', () => {
    const dir = makeProjectDir([]);
    addProjectDependency(dir, { kind: 'disk', name: 'SharedKit', diskUrl: '/work/SharedKit' });
    __setWorkspaceFolders([dir]);
    const provider = new RowanProjectTreeProvider({ loadedProjectNames: () => new Set<string>() });

    const [row] = provider.getChildren(dependencyGroup(provider));

    expect(row.description).toBe('/work/SharedKit · not loaded');
  });

  it('marks a dependency the connected database has', () => {
    const dir = makeProjectDir([]);
    addProjectDependency(dir, { kind: 'disk', name: 'SharedKit', diskUrl: '/work/SharedKit' });
    __setWorkspaceFolders([dir]);
    const provider = new RowanProjectTreeProvider({
      loadedProjectNames: () => new Set(['SharedKit']),
    });

    const [row] = provider.getChildren(dependencyGroup(provider));

    expect(row.description).toBe('/work/SharedKit · loaded');
  });

  it('re-reads packages after refresh', () => {
    const dir = makeProjectDir(['One']);
    __setWorkspaceFolders([dir]);
    const provider = new RowanProjectTreeProvider();
    expect(provider.getChildren().map((r) => r.label)).toEqual(['One']);

    fs.mkdirSync(path.join(dir, 'src', 'Two'));
    provider.refresh();

    expect(provider.getChildren().map((r) => r.label)).toEqual(['One', 'Two']);
  });
});
