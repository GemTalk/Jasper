import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findRowanLoadSpecs, deriveRepoName, normalizeGitUrl, updateGitRepo } from '../rowanLoad';

const LOAD_SPEC = (name: string) => `RwLoadSpecificationV2 {
\t#specName : '${name}',
\t#projectName : '${name}',
\t#componentNames : [ 'Core' ]
}`;

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-rowan-load-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('findRowanLoadSpecs', () => {
  it('finds a load spec by its content signature, in any layout', () => {
    write('rowan/specs/LoadMe.ston', LOAD_SPEC('LoadMe'));
    write('rowan/project.ston', "RwProjectSpecificationV2 { #specName : 'project' }");

    const specs = findRowanLoadSpecs(root);

    expect(specs).toHaveLength(1);
    expect(specs[0].name).toBe('LoadMe');
    expect(specs[0].path.endsWith('rowan/specs/LoadMe.ston')).toBe(true);
  });

  it('ignores .ston files that are not load specs', () => {
    write('specsV2/Real.ston', LOAD_SPEC('Real'));
    write('componentsV2/Core.ston', "RwSimpleProjectLoadComponentV2 { #name : 'Core' }");

    const specs = findRowanLoadSpecs(root);

    expect(specs.map((s) => s.name)).toEqual(['Real']);
  });

  it('returns all load specs sorted, for the caller to disambiguate', () => {
    write('specsV2/Zeta.ston', LOAD_SPEC('Zeta'));
    write('specsV2/Alpha.ston', LOAD_SPEC('Alpha'));

    const specs = findRowanLoadSpecs(root);

    expect(specs.map((s) => s.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('returns nothing for a directory with no load specs', () => {
    write('src/readme.txt', 'hello');

    expect(findRowanLoadSpecs(root)).toEqual([]);
  });
});

describe('normalizeGitUrl', () => {
  it('adds .git and drops browser cruft from an https URL', () => {
    expect(normalizeGitUrl('https://github.com/o/repo')).toBe('https://github.com/o/repo.git');
    expect(normalizeGitUrl('https://github.com/o/repo.git')).toBe('https://github.com/o/repo.git');
    expect(normalizeGitUrl('https://github.com/o/repo/')).toBe('https://github.com/o/repo.git');
    expect(normalizeGitUrl('https://github.com/o/repo/tree/main')).toBe(
      'https://github.com/o/repo.git',
    );
    expect(normalizeGitUrl('https://github.com/o/repo?tab=readme')).toBe(
      'https://github.com/o/repo.git',
    );
    expect(normalizeGitUrl('  https://github.com/o/repo  ')).toBe('https://github.com/o/repo.git');
  });

  it('normalizes scp-style ssh URLs the same way', () => {
    expect(normalizeGitUrl('git@github.com:o/repo')).toBe('git@github.com:o/repo.git');
    expect(normalizeGitUrl('git@github.com:o/repo.git')).toBe('git@github.com:o/repo.git');
  });

  it('leaves local paths and other schemes alone (just trimmed)', () => {
    expect(normalizeGitUrl('/tmp/repos/MyProject/')).toBe('/tmp/repos/MyProject');
    expect(normalizeGitUrl('file:///tmp/repos/MyProject')).toBe('file:///tmp/repos/MyProject');
  });
});

describe('deriveRepoName', () => {
  it('takes the repo name from scp-style, https, and file URLs, dropping .git', () => {
    expect(deriveRepoName('git@github.com:GemTalk/Rowan.git')).toBe('Rowan');
    expect(deriveRepoName('https://github.com/GemTalk/Rowan.git')).toBe('Rowan');
    expect(deriveRepoName('https://example.com/foo/Bar/')).toBe('Bar');
    expect(deriveRepoName('file:///tmp/repos/MyProject')).toBe('MyProject');
  });

  it('derives the right name from a browser URL (no .git, extra path)', () => {
    expect(deriveRepoName('https://github.com/o/seaside-rowan')).toBe('seaside-rowan');
    expect(deriveRepoName('https://github.com/o/seaside-rowan/tree/master')).toBe('seaside-rowan');
    expect(deriveRepoName('https://github.com/o/seaside-rowan?tab=readme')).toBe('seaside-rowan');
  });

  it('applies the gemstone.ston cache minimum to every spec in the project', () => {
    write('rowan/specs/Big.ston', LOAD_SPEC('Big'));
    write('rowan/specs/Also.ston', LOAD_SPEC('Also'));
    write('rowan/gemstone.ston', '{ #minTempObjCacheKB : 500000 }');

    const specs = findRowanLoadSpecs(root);

    expect(specs.map((s) => s.minTempObjCacheKB)).toEqual([500000, 500000]);
  });

  it('reads the minimum even when gemstone.ston is walked after the spec', () => {
    // `specs/` sorts before a sibling `gemstone.ston`, so the metadata file is
    // visited only after the spec — the value must still be applied.
    write('rowan/specs/Late.ston', LOAD_SPEC('Late'));
    write('rowan/gemstone.ston', '{\n\t#minTempObjCacheKB : 750000\n}');

    const [spec] = findRowanLoadSpecs(root);

    expect(spec.minTempObjCacheKB).toBe(750000);
  });

  it('leaves the minimum undefined when there is no gemstone.ston', () => {
    write('rowan/specs/Plain.ston', LOAD_SPEC('Plain'));

    const [spec] = findRowanLoadSpecs(root);

    expect(spec.minTempObjCacheKB).toBeUndefined();
  });

  it('ignores a gemstone.ston without the cache key rather than failing', () => {
    write('rowan/specs/Ok.ston', LOAD_SPEC('Ok'));
    write('rowan/gemstone.ston', '{ #somethingElse : 1 }');

    const [spec] = findRowanLoadSpecs(root);

    expect(spec.name).toBe('Ok');
    expect(spec.minTempObjCacheKB).toBeUndefined();
  });
});

describe('updateGitRepo', () => {
  // Strip GIT_* from the env so the test's own git commands operate on its temp
  // repos, not on whatever repo the ambient environment points at — critical when
  // this suite runs inside a git hook (e.g. the pre-push hook exports GIT_DIR).
  const gitEnv = (): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
    return env;
  };
  const g = (args: string[], cwd: string) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', env: gitEnv() });

  // A bare remote, plus a clone of it. Advancing the remote is done through a
  // throwaway second clone so the first clone genuinely lags behind.
  function setup(): { remote: string; clone: string; bump: () => void } {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rowan-git-'));
    const seed = path.join(base, 'seed');
    const remote = path.join(base, 'remote.git');
    fs.mkdirSync(seed);
    g(['init', '-q', '-b', 'main'], seed);
    g(['config', 'user.email', 't@t'], seed);
    g(['config', 'user.name', 'T'], seed);
    fs.writeFileSync(path.join(seed, 'a.txt'), 'one\n');
    g(['add', '-A'], seed);
    g(['commit', '-qm', 'one'], seed);
    g(['clone', '-q', '--bare', seed, remote], base);

    const clone = path.join(base, 'clone');
    g(['clone', '-q', remote, clone], base);

    let n = 1;
    const bump = () => {
      const pusher = path.join(base, `pusher-${n}`);
      g(['clone', '-q', remote, pusher], base);
      g(['config', 'user.email', 't@t'], pusher);
      g(['config', 'user.name', 'T'], pusher);
      fs.writeFileSync(path.join(pusher, 'a.txt'), `rev-${n}\n`);
      g(['commit', '-aqm', `rev-${n}`], pusher);
      g(['push', '-q', 'origin', 'main'], pusher);
      n += 1;
    };
    return { remote, clone, bump };
  }

  it('reports no change when the clone is already current', async () => {
    const { clone } = setup();

    expect(await updateGitRepo(clone)).toEqual({ updated: false });
  });

  it('fast-forwards and reports the change when the remote has advanced', async () => {
    const { clone, bump } = setup();
    bump();

    const result = await updateGitRepo(clone);

    expect(result.updated).toBe(true);
    expect(fs.readFileSync(path.join(clone, 'a.txt'), 'utf8')).toBe('rev-1\n');
  });
});
