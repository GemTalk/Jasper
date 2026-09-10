#!/usr/bin/env node
//
// Downloads the GemStone/S 64 Bit manuals (PDF) that GemTalk publishes at
// downloads.gemtalksystems.com into a local, gitignored cache, so an agent
// working in this repo can grep them for authoritative GemStone behavior.
//
// Entirely opt-in: nothing here runs as part of install, test, or build, and
// no other tooling invokes it. A human runs `npm run docs:fetch`. When the
// cache is absent, the `gemstone-docs` skill simply reports the manuals as
// unavailable rather than fetching them itself.
//
// The manuals are copyrighted by GemTalk and are NOT redistributed: they are
// fetched from the vendor on demand into a cache outside the working tree,
// which `gs-docs/` links to.
//
// The cache lives outside the repo on purpose — this project is developed
// across several git worktrees, and a per-worktree copy would re-download
// ~22 MB for each one.
//
//   node scripts/fetch-gs-docs.mjs [--where] [--list] [--force] [--versions 3.6.x,3.7.x]
//
//     --where     print the resolved cache directory and exit (no network)
//     --list      show what would be fetched, then exit without downloading
//     --force     re-download even when the cached copy is current
//     --versions  comma-separated doc version directories (default 3.6.x,3.7.x)

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://downloads.gemtalksystems.com/docs/GemStone64/';
const DEFAULT_VERSIONS = ['3.6.x', '3.7.x'];

// The manuals worth having locally. Deliberately excludes InstallGuide-* and
// WindowsClient-*: they document operator procedures for a given platform
// rather than GemStone semantics, and add files without adding answers.
//
// ReleaseNotes is per-patch (one PDF per 3.7.4, 3.7.5, …) while the four
// reference manuals are published per *minor* only — there is one
// GS64-ProgGuide-3.7.pdf covering every 3.7.x. That asymmetry is the reason
// ReleaseNotes is included at all: it is the only patch-level source here.
//
// Anchored at *both* ends over a class that contains no path separator: the
// matched name is used as a path segment in `join(dir, entry.name)`, so a
// tampered listing row offering `GS64-ProgGuide/../../../tmp/evil.pdf` must be
// skipped rather than trusted to stay inside the cache directory.
const KEEP = /^GS64-(ProgGuide|SysAdminGuide|Topaz|GemBuilderforC|ReleaseNotes)[\w.-]*\.pdf$/;

const MAX_CONCURRENCY = 6;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { where: false, list: false, force: false, versions: DEFAULT_VERSIONS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--where') args.where = true;
    else if (arg === '--list') args.list = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--versions') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--'))
        fail('--versions needs a comma-separated value, e.g. --versions 3.7.x');
      i++;
      args.versions = value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      // A non-empty string can still be all separators and whitespace
      // (`--versions ","`), which would otherwise leave the version loop in
      // `main()` with nothing to iterate and print "Up to date — 0 manuals".
      if (args.versions.length === 0)
        fail('--versions needs at least one version, e.g. --versions 3.7.x');
    } else fail(`unknown argument: ${arg}`);
  }
  return args;
}

function fail(message) {
  console.error(`fetch-gs-docs: ${message}`);
  process.exit(1);
}

// Where the PDFs actually live. Honors GS_DOCS_DIR so a dev can point several
// checkouts at one directory, or relocate it off a small system volume.
function cacheDir() {
  if (process.env.GS_DOCS_DIR) return resolve(process.env.GS_DOCS_DIR);
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'gemstone-docs');
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'gemstone-docs');
  }
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'gemstone-docs');
}

// `gs-docs/` in the working tree points at the cache, so every worktree shares
// one download instead of carrying its own 22 MB.
//
// `existsSync` follows symlinks, so it reports false for a link whose target
// has been deleted or moved — and then `symlinkSync` fails with EEXIST on the
// link that is sitting right there. Both cases are checked through `lstat`,
// which describes the link itself, so a stale link is re-pointed rather than
// becoming a permanent error.
//
// On Windows this creates a directory junction, which (unlike a true symlink)
// needs neither elevation nor Developer Mode. If it fails anyway, the caller
// is told how to reach the manuals rather than being left with a working
// download that nothing can find.
// A link that already points at the cache has to read back as a no-op, but on
// Windows `readlinkSync` describes a junction with an extended-length path
// (`\\?\C:\Users\…\gemstone-docs`) that never compares equal to the plain
// cache path — so an already-correct junction would look stale and be deleted
// and recreated on every run. Strip the prefix before resolving (mapping the
// `\\?\UNC\` form back to `\\`, since a redirected LOCALAPPDATA can be a
// share), and compare case-insensitively on Windows, where paths are.
function samePath(a, b) {
  const clean = (path) =>
    resolve(repoRoot, path.replace(/^\\\\\?\\UNC\\/, '\\\\').replace(/^\\\\\?\\/, ''));
  const left = clean(a);
  const right = clean(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

// Both ways of failing to link leave the manuals reachable only through
// GS_DOCS_DIR, so that guidance is written once here and each call site
// supplies only its own lead-in sentence.
function gsDocsDirGuidance(lead, target) {
  return (
    `\n${lead}\n  ${target}\n\n` +
    'Set GS_DOCS_DIR to that path so tooling can find them:\n' +
    `  export GS_DOCS_DIR="${target}"      # bash/zsh\n` +
    `  setx GS_DOCS_DIR "${target}"        # Windows`
  );
}

function linkIntoWorkingTree(target) {
  const link = join(repoRoot, 'gs-docs');

  let existing;
  try {
    existing = lstatSync(link);
  } catch {
    existing = undefined;
  }

  if (existing?.isSymbolicLink()) {
    let currentTarget;
    try {
      currentTarget = readlinkSync(link);
    } catch {
      currentTarget = undefined;
    }
    if (currentTarget && samePath(currentTarget, target) && existsSync(link))
      return { link, linked: true };
    // Stale: points somewhere else, or at a cache that is gone.
    try {
      unlinkSync(link);
    } catch (error) {
      console.warn(`\nCould not replace the stale gs-docs link (${error.code}).`);
      return { link, linked: false, target };
    }
  } else if (existing) {
    // A real directory or file someone put there deliberately — leave it alone,
    // but do not claim the manuals are in it: they went to the cache.
    console.warn(
      gsDocsDirGuidance(
        `${link} already exists and is not a link to the cache, so it was left\n` +
          'alone. The manuals are in:',
        target,
      ),
    );
    return { link, linked: false, target };
  }

  try {
    symlinkSync(target, link, 'junction');
    return { link, linked: true };
  } catch (error) {
    console.warn(
      gsDocsDirGuidance(
        `Could not create the gs-docs link (${error.code}). The manuals downloaded\n` +
          'fine and are in:',
        target,
      ),
    );
    return { link, linked: false, target };
  }
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`);
  return response.text();
}

// The vendor serves nginx-style autoindex listings, whose rows carry the
// filename, last-modified date, and byte size. Reading sizes and dates from
// the listing means the whole catalog costs one request per version directory
// instead of a HEAD per file.
function parseListing(html, version) {
  const entries = [];
  const row = /href="([^"/]+\.pdf)"[^\n]*?(\d{2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2})\s+(\d+)/g;
  for (const match of html.matchAll(row)) {
    const [, name, modified, size] = match;
    if (!KEEP.test(name)) continue;
    entries.push({
      name,
      version,
      url: `${BASE}${version}/${name}`,
      bytes: Number(size),
      listedAt: modified,
    });
  }
  return entries;
}

// Always returns an object with a `files` map, whatever is on disk: a manifest
// that is missing, truncated, hand-edited to `null`, or written by some other
// version of this script must cost a re-download, not a crash halfway through
// the bookkeeping that follows a successful run.
//
// Arrays are rejected explicitly, not merely by `typeof`: `typeof [] === 'object'`,
// so an array would pass, take `files`/`fetchedAt`/`base` as string-keyed
// properties, and then lose all of them on `JSON.stringify` — which serializes
// only numeric indices. The manifest would stay `[]` forever and every run
// would re-download all 26 manuals without ever reporting a problem.
function readManifest(dir) {
  const path = join(dir, 'manifest.json');
  let parsed;
  if (existsSync(path)) {
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      parsed = undefined;
    }
  }
  const manifest = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files))
    manifest.files = {};
  return manifest;
}

// Skipped when the listing's timestamp matches what we recorded and the file is
// still on disk at the recorded size. That check is free — no request at all —
// which is why re-running is cheap even though it covers 26 manuals.
function isCurrent(entry, manifest, dir) {
  const known = manifest.files?.[entry.name];
  if (!known || known.listedAt !== entry.listedAt || known.bytes !== entry.bytes) return false;
  try {
    // Size, not mere presence: a file left short by a full disk — or written
    // before this check existed — must be re-fetched rather than trusted.
    return statSync(join(dir, entry.name)).size === entry.bytes;
  } catch {
    return false;
  }
}

async function download(entry, dir) {
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`GET ${entry.url} -> HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  // A truncated response, or an HTML error page served with a 200, would
  // otherwise be renamed into place and then look current forever.
  if (body.length !== entry.bytes)
    throw new Error(`GET ${entry.url} -> ${body.length} bytes, listing said ${entry.bytes}`);
  // Write via a temp file so an interrupted run can't leave a truncated PDF
  // that later looks complete enough for pdfgrep to half-read.
  const temp = join(dir, `.${entry.name}.${process.pid}.part`);
  try {
    writeFileSync(temp, body);
    renameSync(temp, join(dir, entry.name));
  } catch (error) {
    // A failed write (ENOSPC) or rename (EXDEV, EACCES) must not leave tens of
    // MB of `.part` behind: `runPool` only records the failure and moves on.
    try {
      unlinkSync(temp);
    } catch {
      // Never created, or not removable — the startup sweep gets it next run.
    }
    throw error;
  }
  return body.length;
}

// A run killed between the write and the rename (Ctrl-C, CI timeout, OOM) can
// still orphan a `.part`, and because the name embeds the pid a retry never
// overwrites it — so orphans would accumulate in a cache nothing prunes.
//
// Age, not liveness of the pid, decides what is stale: the cache is shared
// across worktrees (and may be a network mount), so another fetch could be
// mid-download right now and its pid need not exist on this machine. An hour
// is far longer than a 22 MB download takes and short enough to self-heal.
const ORPHAN_AGE_MS = 60 * 60 * 1000;

function sweepOrphans(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - ORPHAN_AGE_MS;
  for (const name of names) {
    if (!/^\..+\.\d+\.part$/.test(name)) continue;
    const path = join(dir, name);
    try {
      if (statSync(path).mtimeMs > cutoff) continue;
      unlinkSync(path);
    } catch {
      // Raced by another run's sweep, or unlinkable — an orphan left in place
      // is not a reason to fail the fetch.
    }
  }
}

async function runPool(items, worker) {
  const queue = [...items];
  const failures = [];
  const runners = Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        await worker(item);
      } catch (error) {
        failures.push({ item, error });
      }
    }
  });
  await Promise.all(runners);
  return failures;
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = cacheDir();

  // Answers "where would these be?" without touching the network, so the
  // location stays discoverable on a machine where the gs-docs link could not
  // be created.
  if (args.where) {
    console.log(dir);
    return;
  }

  console.log(`Catalog:  ${BASE}`);
  console.log(`Versions: ${args.versions.join(', ')}`);
  console.log(`Cache:    ${dir}\n`);

  const entries = [];
  for (const version of args.versions) {
    const html = await fetchText(`${BASE}${version}/`);
    const found = parseListing(html, version);
    if (found.length === 0)
      fail(`no matching manuals listed under ${version} — is that a real doc version?`);
    entries.push(...found);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);

  if (args.list) {
    for (const entry of entries) console.log(`  ${entry.name.padEnd(34)} ${formatMb(entry.bytes)}`);
    console.log(`\n${entries.length} manuals, ${formatMb(total)}. Nothing downloaded (--list).`);
    return;
  }

  mkdirSync(dir, { recursive: true });
  sweepOrphans(dir);
  const manifest = readManifest(dir);
  const stale = args.force ? entries : entries.filter((entry) => !isCurrent(entry, manifest, dir));

  if (stale.length === 0) {
    console.log(`Up to date — ${entries.length} manuals, ${formatMb(total)}.`);
  } else {
    const pending = stale.reduce((sum, entry) => sum + entry.bytes, 0);
    console.log(
      `Downloading ${stale.length} of ${entries.length} manuals (${formatMb(pending)})…\n`,
    );
    let done = 0;
    // `download()` resolving is the only proof a file landed on disk, so
    // success is recorded here rather than derived as `stale` minus the
    // failures — a later change to `runPool`'s failure semantics (an internal
    // retry, a non-fatal warning that shouldn't count as a failure) cannot
    // desync this set from what is actually in the cache.
    const fetched = new Set();
    const failures = await runPool(stale, async (entry) => {
      await download(entry, dir);
      fetched.add(entry.name);
      console.log(`  [${String(++done).padStart(2)}/${stale.length}] ${entry.name}`);
    });
    for (const { item, error } of failures)
      console.error(`  FAILED ${item.name}: ${error.message}`);
    const attempted = new Set(stale.map((entry) => entry.name));
    for (const entry of entries) {
      // Re-stamping an entry we tried and did not land would record the new
      // listing date against the *old* PDF still on disk, so `isCurrent` would
      // report it current and every later run would skip it silently.
      if (attempted.has(entry.name) && !fetched.has(entry.name)) continue;
      if (fetched.has(entry.name) || manifest.files[entry.name]) {
        manifest.files[entry.name] = {
          url: entry.url,
          version: entry.version,
          bytes: entry.bytes,
          listedAt: entry.listedAt,
        };
      }
    }
    manifest.fetchedAt = new Date().toISOString();
    manifest.base = BASE;
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    if (failures.length > 0) process.exitCode = 1;
  }

  const { link, linked } = linkIntoWorkingTree(dir);
  if (linked) console.log(`\nAvailable at ${link}`);

  // pdfgrep is what makes the PDFs searchable rather than merely present, but
  // it is not required: the Read tool opens a PDF page directly. Recommended,
  // not enforced — a dev without it still gets working (slower) navigation.
  console.log(
    '\nFor searching these, `pdfgrep` is recommended (brew install pdfgrep,\n' +
      'apt install pdfgrep poppler-utils). Without it, PDF pages can still be\n' +
      'read directly — searching is just coarser.',
  );
}

main().catch((error) => fail(error.message));
