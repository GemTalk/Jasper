import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

export interface RowanLoadSpec {
  // Absolute path to the load-spec .ston file.
  path: string;
  // The spec's #specName (its project name), or the file basename as a fallback.
  name: string;
  // The gem temp-object cache (KB) the project needs to load, from the project's
  // `gemstone.ston` GemStone-platform metadata. Undefined when not declared.
  // Rowan's own specs are closed schemas, so this platform hint lives in a
  // separate STON file that Rowan ignores; it's project-level, so every spec in
  // the same project carries the same value.
  minTempObjCacheKB?: number;
}

// A load spec's on-disk marker: RwLoadSpecificationV2 STON files start with this.
const LOAD_SPEC_SIGNATURE = 'RwLoadSpecificationV2';
// GemStone-platform metadata for a Rowan project, read by Jasper (not Rowan).
const GEMSTONE_METADATA_FILE = 'gemstone.ston';
const MAX_DEPTH = 5;

// Extract the declared minimum gem cache (KB) from a `gemstone.ston` file's
// contents. Read by pattern rather than a full STON parse, matching how the
// load spec's #specName is pulled out above — the file is a small flat
// dictionary of platform hints.
function parseMinTempObjCacheKB(gemstoneSton: string): number | undefined {
  const m = gemstoneSton.match(/#minTempObjCacheKB\s*:\s*(\d+)/);
  if (!m) return undefined;
  const kb = Number(m[1]);
  return kb > 0 ? kb : undefined;
}

// Find every Rowan load specification under `root`, identified by content
// signature rather than a fixed path — the specs directory varies by layout
// (`specsV2/` for a shipped project, `rowan/specs/` for a freshly created one).
// Lets the loader accept a project's root folder and locate its load spec(s).
// A project-level `gemstone.ston`, if present, contributes its GemStone
// platform hints (e.g. minTempObjCacheKB) to every spec found.
export function findRowanLoadSpecs(root: string): RowanLoadSpec[] {
  const specs: RowanLoadSpec[] = [];
  let minTempObjCacheKB: number | undefined;

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name === GEMSTONE_METADATA_FILE) {
        try {
          minTempObjCacheKB =
            parseMinTempObjCacheKB(fs.readFileSync(full, 'utf8')) ?? minTempObjCacheKB;
        } catch {
          /* unreadable metadata — leave the hint unset */
        }
      } else if (entry.isFile() && entry.name.endsWith('.ston')) {
        let content: string;
        try {
          content = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        if (content.trimStart().startsWith(LOAD_SPEC_SIGNATURE)) {
          const m = content.match(/#specName\s*:\s*'([^']*)'/);
          specs.push({
            path: full,
            name: m ? m[1] : path.basename(entry.name, '.ston'),
          });
        }
      }
    }
  };

  walk(root, 0);
  // gemstone.ston may be visited after some specs, so apply the project-level
  // hint once the whole tree has been walked.
  if (minTempObjCacheKB !== undefined) {
    for (const spec of specs) spec.minTempObjCacheKB = minTempObjCacheKB;
  }
  specs.sort((a, b) => a.name.localeCompare(b.name));
  return specs;
}

// The default local directory name `git clone <url>` would produce: the last
// path segment of the URL with a trailing `.git` removed. Handles scp-style
// (git@host:owner/repo.git), https, and file URLs.
export function deriveRepoName(url: string): string {
  const trimmed = normalizeGitUrl(url);
  const segment = trimmed.replace(/\/+$/, '').split(/[/:]/).pop() || '';
  return segment.replace(/\.git$/i, '') || 'project';
}

// Turn whatever the user pasted into a clonable git URL. Handles the common
// case of a *browser* URL (`https://host/owner/repo/tree/main`, `…?tab=readme`,
// a trailing slash, or no `.git`) by reducing it to `host/owner/repo.git`. SSH
// scp-style URLs (`git@host:owner/repo`) are normalized the same way. Anything
// that isn't an https/ssh repo URL (local paths, `git://`, `ssh://…`) is left
// as-is aside from trimming — git already accepts those.
export function normalizeGitUrl(raw: string): string {
  const url = raw.trim();
  const https = url.match(/^(https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s?#]+)/);
  if (https) return https[1].replace(/\.git$/i, '') + '.git';
  const ssh = url.match(/^([^@\s]+@[^:\s]+:[^/\s]+\/[^/\s?#]+)/);
  if (ssh) return ssh[1].replace(/\.git$/i, '') + '.git';
  return url.replace(/\/+$/, '');
}

// Clone a git repository to `dest` using the user's own git (so their SSH keys /
// credential helper apply — a gem-side clone wouldn't have them). Submodules are
// cloned too: a Rowan project may vendor its package sources that way (e.g.
// seaside-rowan), and without them the checkout is unloadable. Rejects with
// git's stderr on failure.
// A git subprocess operating on an UNRELATED working copy must not inherit this
// process's ambient git environment (GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE, …).
// Those get set when we run inside a git hook (e.g. the pre-push test hook), and
// would make these commands target the WRONG repository — potentially corrupting
// it. Strip every GIT_* variable so `-C cwd` / the clone dest is authoritative.
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}

export function cloneGitRepo(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['clone', '--recurse-submodules', url, dest],
      { timeout: 300_000, env: gitEnv() },
      (err, _stdout, stderr) => {
        if (err) reject(new Error((stderr && stderr.trim()) || err.message));
        else resolve();
      },
    );
  });
}

function git(args: string[], cwd: string, timeoutMs = 300_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { timeout: timeoutMs, env: gitEnv() },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr && stderr.trim()) || err.message));
        else resolve(stdout);
      },
    );
  });
}

// Pull the latest for a tracked clone and update its submodules. Fast-forward
// only, so a diverged (locally-committed) checkout fails loudly rather than
// producing a merge — a tracked repo is meant to mirror its remote. Returns
// whether the checkout actually moved, by comparing HEAD before and after.
export async function updateGitRepo(dest: string): Promise<{ updated: boolean }> {
  const before = (await git(['rev-parse', 'HEAD'], dest)).trim();
  await git(['pull', '--recurse-submodules', '--ff-only'], dest);
  await git(['submodule', 'update', '--init', '--recursive'], dest);
  const after = (await git(['rev-parse', 'HEAD'], dest)).trim();
  return { updated: before !== after };
}
