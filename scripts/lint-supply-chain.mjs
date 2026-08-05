#!/usr/bin/env node
//
// Asserts npm's install-script supply-chain controls are actually in effect,
// not just present in .npmrc. Every assertion reads through `npm config get`
// rather than parsing the file, which is both simpler and strictly stronger:
// it sees the merged, effective value, so it also catches an override from a
// user .npmrc, an npm_config_* env var, or npm's `key[]=` array syntax (which
// a naive `key=` grep of .npmrc misses entirely). And because `npm config` is
// devEngines-gated, it fails outright on an npm too old to honor the settings.
//
//   node scripts/lint-supply-chain.mjs

import { execFileSync } from 'node:child_process';

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
];

function getConfig(key) {
  return execFileSync('npm', ['config', 'get', key], { encoding: 'utf8' }).trim();
}

// An unset config reads back as the empty string, which `is ''` renders confusingly.
function describe(value) {
  return value === '' ? 'unset' : `'${value}'`;
}

function main() {
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

  if (failed) {
    process.exit(1);
  }
}

main();
