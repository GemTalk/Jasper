#!/usr/bin/env node
//
// Asserts npm's install-script supply-chain controls are actually in effect,
// not just present in .npmrc. Every config assertion reads through `npm config
// get` rather than parsing the file, which is both simpler and strictly
// stronger: it sees the merged, effective value, so it also catches an override
// from a user .npmrc, an npm_config_* env var, or npm's `key[]=` array syntax
// (which a naive `key=` grep of .npmrc misses entirely). And because `npm
// config` is devEngines-gated, it fails outright on an npm too old to honor the
// settings.
//
// Also checks a gap none of `npm ci`, `npm audit signatures`, or lockfile-lint
// cover: a lockfile entry whose `version` disagrees with its own `resolved`
// tarball (see checkLockfileDrift below). Born from a real incident (see
// cd0bff1) rather than a hypothetical.
//
//   node scripts/lint-supply-chain.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// package.json's `allowScripts` is the single source of truth for the install-script
// allowlist, so `allow-scripts` must be unset everywhere. It is dead weight, not a
// backup: while allowScripts is non-empty, npm's precedence contest discards the
// entire .npmrc layer (only a log.warn), so the setting is policy that does nothing.
// It turns live and dangerous the moment allowScripts is emptied — `{}` counts as
// absent, so npm gives no warning when it switches over — and even then it can only
// express allows, never a deny like the fsevents entry this repo relies on.
const ALLOW_SCRIPTS_HINT = `
This project keeps its install-script allowlist in package.json's "allowScripts" — the single
source of truth. npm never merges the two: while allowScripts is non-empty it wins the
precedence contest and the entire .npmrc layer is discarded (only a log.warn), so this setting is
policy that does nothing. It also cannot express denials — every entry is forced to true — so it
could not carry the fsevents deny even if it were live.

  allow:  npm approve-scripts <pkg>   (writes a version-pinned entry)
  deny:   npm deny-scripts <pkg>
  one-off npx / npm i -g: pass --allow-scripts on that command instead
`;

const CONFIG_ASSERTIONS = [
  ['strict-allow-scripts', 'true'],
  ['allow-git', 'none'],
  ['allow-remote', 'none'],
  ['allow-scripts', '', ALLOW_SCRIPTS_HINT],
  ['min-release-age', '7'],
];

const REGISTRY_PREFIX = 'https://registry.npmjs.org/';

function getConfig(key) {
  return execFileSync('npm', ['config', 'get', key], { encoding: 'utf8' }).trim();
}

// An unset config reads back as the empty string, which `is ''` renders confusingly.
function describe(value) {
  return value === '' ? 'unset' : `'${value}'`;
}

function checkConfig() {
  let failed = false;

  for (const [key, expected, hint] of CONFIG_ASSERTIONS) {
    const actual = getConfig(key);
    if (actual !== expected) {
      console.error(`✗ npm config '${key}' is ${describe(actual)}, expected ${describe(expected)}`);
      if (hint) {
        console.error(hint);
      }
      failed = true;
    } else {
      console.log(`✓ npm config '${key}' is ${describe(expected)}`);
    }
  }

  return failed;
}

// Extracts the version embedded in the tarball filename itself (e.g. `mime-1.6.0.tgz`
// -> `1.6.0`), so it can be checked against the lockfile's separate `version` field —
// see checkLockfileDrift for why the two can disagree.
function tgzVersion(resolved, packageName) {
  const match = resolved.match(/\/-\/([^/]+)\.tgz$/);
  if (!match) {
    return null;
  }
  const unscopedName = packageName.split('/').pop();
  const prefix = `${unscopedName}-`;
  // Deliberate: an npm alias (e.g. "foo": "npm:bar@1.0.0") can make the tarball name
  // disagree with the package name; lockfile-lint --validate-package-names owns
  // catching a genuine mismatch, so this just skips rather than false-positiving on
  // legitimate aliases.
  if (!match[1].startsWith(prefix)) {
    return null;
  }
  return match[1].slice(prefix.length);
}

// Lockfile keys are node_modules paths ("node_modules/a/node_modules/b"), so the name
// is whatever follows the last separator. A key without one is a workspace path rather
// than an installed package; callers filter those out by `resolved`, but return the key
// unchanged rather than silently slicing it to garbage if one ever reaches here.
function packageNameFromKey(key) {
  const index = key.lastIndexOf('node_modules/');
  return index === -1 ? key : key.slice(index + 'node_modules/'.length);
}

// `version` and `resolved` are independent, hand/tool-editable fields that nothing
// else in the toolchain cross-checks: `npm ci` trusts `resolved` as a literal URL and
// only verifies `integrity`, `npm audit signatures` looks up the registry by the
// declared `version` (so it 404s only if that version was never published — it passed
// clean in our sax@1.6.1 repro, where 1.6.1 does exist upstream), and lockfile-lint
// never inspects `version` at all. Worse, an in-range `version` can mask an
// out-of-range tarball, e.g. `version: "1.6.0"` (satisfies `^1.3.4`) pointing at
// `resolved: ".../mime-2.0.0.tgz"` — every other check sails past it; only this
// catches it.
function checkLockfileDrift() {
  const lockfile = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  let failed = false;

  for (const [key, entry] of Object.entries(lockfile.packages)) {
    if (key === '' || !entry.resolved?.startsWith(REGISTRY_PREFIX) || !entry.version) {
      continue;
    }
    const packageName = packageNameFromKey(key);
    const resolvedVersion = tgzVersion(entry.resolved, packageName);
    if (resolvedVersion !== null && resolvedVersion !== entry.version) {
      console.error(
        `✗ ${key}: version '${entry.version}' disagrees with resolved tarball '${entry.resolved}' (${resolvedVersion})`,
      );
      failed = true;
    }
  }

  if (!failed) {
    console.log("✓ every lockfile entry's version matches its resolved tarball");
  }

  return failed;
}

function main() {
  const configFailed = checkConfig();
  const driftFailed = checkLockfileDrift();

  if (configFailed || driftFailed) {
    process.exit(1);
  }
}

main();
