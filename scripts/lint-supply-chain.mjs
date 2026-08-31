#!/usr/bin/env node
//
// Asserts npm's install-script supply-chain controls are actually in effect,
// not just present in .npmrc. Every config assertion reads through `npm config
// get` (one batched call, see getConfigs) rather than parsing the file, which is
// both simpler and strictly
// stronger: it sees the merged, effective value, so it also catches an override
// from a user .npmrc, an npm_config_* env var, or npm's `key[]=` array syntax
// (which a naive `key=` grep of .npmrc misses entirely). And because `npm
// config` is devEngines-gated, it fails outright on an npm too old to honor the
// settings.
//
// Most settings are asserted to equal the committed value exactly; `min-release-age` is
// asserted as a floor, so raising the cooldown is allowed but lowering or disabling it is not
// (see satisfiesFloor below).
//
// Also checks a gap none of `npm ci`, `npm audit signatures`, or lockfile-lint
// cover: a lockfile entry whose `version` disagrees with its own `resolved`
// tarball (see checkLockfileDrift below). Born from a real incident (see
// cd0bff1) rather than a hypothetical.
//
// And checks that the committed `allowScripts` policy in package.json is
// version-pinned (see checkAllowScriptsPinned below) — an unpinned allow
// entry trusts every future version of a package forever.
//
// Last, checks that the `@types` packages stay pinned to the declared runtime
// floor (see checkTypeFloorPinned below) — a range that resolves above
// `engines.vscode`/`engines.node` lets tsc accept APIs the shipped floor lacks.
//
//   node scripts/lint-supply-chain.mjs

import { execSync } from 'node:child_process';
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

// `expected` is an exact match unless `floor` is set — see satisfiesFloor for why
// min-release-age is the one setting where "different from .npmrc" isn't automatically wrong.
const CONFIG_ASSERTIONS = [
  { key: 'strict-allow-scripts', expected: 'true' },
  { key: 'allow-git', expected: 'none' },
  { key: 'allow-remote', expected: 'none' },
  { key: 'allow-scripts', expected: '', hint: ALLOW_SCRIPTS_HINT },
  { key: 'min-release-age', expected: '7', floor: true },
];

const REGISTRY_PREFIX = 'https://registry.npmjs.org/';

// One spawn for every key rather than one per key: npm's cold start dominates this script
// (~0.38s for five sequential gets vs ~0.08s batched), and lintSupplyChain.test.ts runs the
// whole script once per case. Asked for multiple keys npm prints `key=value` lines instead of
// a bare value, but each value is byte-identical to the single-key form — including the
// literal 'null' an unset min-release-age reads back as, and the comma-joined form of an
// array setting. (`npm config list --json` would batch too, but it hands back JSON types —
// true/7/[] instead of 'true'/'7'/'' — which every comparison and message below would have to
// re-stringify.) npm's own warnings go to stderr, so only key=value lines reach here.
function getConfigs(keys) {
  const output = execSync(`npm config get ${keys.join(' ')}`, { encoding: 'utf8' });
  const values = new Map();

  for (const line of output.split('\n')) {
    const separator = line.indexOf('=');
    if (separator !== -1) {
      values.set(line.slice(0, separator), line.slice(separator + 1).trim());
    }
  }

  // A key we asked for going missing means the output shape assumed above has changed. That
  // has to surface as itself: left as undefined it would read as a plain assertion failure and
  // be indistinguishable from the control actually being off, which is the one lie this
  // script must never tell.
  for (const key of keys) {
    if (!values.has(key)) {
      throw new Error(`Unexpected npm config output: no value for '${key}'`);
    }
  }

  return values;
}

// An unset config reads back as the empty string, which `is ''` renders confusingly.
function describe(value) {
  return value === '' ? 'unset' : `'${value}'`;
}

// `min-release-age` is a cooldown length in days, not a switch: raising it is *stricter*, so
// asserting it equals the committed 7 would fail a developer for being more careful than the
// repo asks. Every other setting here is a boolean or an enum, where "stricter" has no
// meaning and exact match is the only sensible comparison — hence the floor is opt-in per
// assertion rather than the default.
//
// Compared numerically, since lexically '10' < '7'. Anything that isn't a number fails,
// which is what rejects an absent setting: `min-release-age` defaults to null, so unsetting
// it reads back as the literal string 'null' rather than the empty string the other keys use
// — and no cooldown at all is exactly the state this assertion exists to catch.
function satisfiesFloor(actual, floor) {
  const value = Number(actual);
  return actual !== '' && Number.isFinite(value) && value >= Number(floor);
}

function checkConfig() {
  const values = getConfigs(CONFIG_ASSERTIONS.map(({ key }) => key));
  let failed = false;

  for (const { key, expected, hint, floor } of CONFIG_ASSERTIONS) {
    const actual = values.get(key);
    const satisfied = floor ? satisfiesFloor(actual, expected) : actual === expected;
    if (satisfied) {
      // Prints the actual value, which for an exact assertion is the expected one anyway but
      // for a floor is the whole point (a raised cooldown should show the value in effect).
      console.log(`✓ npm config '${key}' is ${describe(actual)}`);
    } else {
      const requirement = floor ? `at least ${describe(expected)}` : describe(expected);
      console.error(`✗ npm config '${key}' is ${describe(actual)}, expected ${requirement}`);
      if (hint) {
        console.error(hint);
      }
      failed = true;
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

// `npm approve-scripts` writes allowScripts keys as either `name` (unpinned) or
// `name@version` (pinned) — deny entries are always written unpinned, since
// denying every version of a package is the point. An unpinned *allow*, though,
// means npm will run that package's install script on any future version we
// bump to, no re-review required — silently defeating the re-review-on-bump
// behavior the rest of this file's checks assume is in place. Scoped packages
// (e.g. `@vscode/vsce-sign@2.0.9`) start with `@`, so the version separator is
// searched for after that leading scope character, not from index 0.
function checkAllowScriptsPinned() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  let failed = false;

  for (const [key, verdict] of Object.entries(pkg.allowScripts ?? {})) {
    if (verdict === true && !key.slice(1).includes('@')) {
      console.error(
        `✗ allowScripts['${key}'] allows every version — re-run npm approve-scripts to pin it`,
      );
      failed = true;
    }
  }

  if (!failed) {
    console.log('✓ every allowScripts allow entry is pinned to a version');
  }

  return failed;
}

// The two `@types` packages describe the API surface tsc checks against, so a range that
// resolves above the runtime floor lets the compiler accept APIs the shipped floor does not
// have — silently, with no Dependabot PR and nothing else in CI to notice. That is not
// hypothetical: `@types/vscode` had drifted to 1.120.0 against an `engines.vscode` of ^1.101.0.
// The floor itself is a coordinated set of ~7 edits (see
// docs/how-to/raising-the-version-floor.md), so the two failure modes this guards are a
// re-widened range and a partial floor raise that moves `engines` but misses a `@types` bump.
//
// Both are DefinitelyTyped releases, whose patch digit is DT's own revision counter rather
// than the upstream project's — a single minor picks up several corrections all describing the
// same API surface. So the assertion is on the *minor*, not the exact version: the declared
// range must be a tilde on the floor's minor, and the installed version must still sit on it.
// `@types/vscode` is a client-workspace dependency and npm keeps it under `client/node_modules`
// today, but a future hoist would move it to the root key, so both are accepted.
const TYPE_FLOORS = [
  {
    types: '@types/vscode',
    manifest: 'client/package.json',
    engine: 'vscode',
    lockKeys: ['client/node_modules/@types/vscode', 'node_modules/@types/vscode'],
  },
  {
    types: '@types/node',
    manifest: 'package.json',
    engine: 'node',
    lockKeys: ['node_modules/@types/node'],
  },
];

// Reads the leading `major.minor` out of anything version-shaped, so the same helper handles a
// range operator (`~22.15`, `^1.101.0`, `>=22.15.1`) and a bare lockfile version alike. The
// operator is checked separately — see checkTypeFloorPinned — because the shape matters on the
// declared side but is meaningless on the resolved side.
function minorOf(version) {
  const match = /(\d+)\.(\d+)/.exec(version ?? '');
  return match === null ? null : `${match[1]}.${match[2]}`;
}

function checkTypeFloorPinned() {
  const engines = JSON.parse(readFileSync('package.json', 'utf8')).engines ?? {};
  const lockfile = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  let failed = false;

  for (const { types, manifest, engine, lockKeys } of TYPE_FLOORS) {
    const floor = minorOf(engines[engine]);
    const declared = JSON.parse(readFileSync(manifest, 'utf8')).devDependencies?.[types] ?? '';
    const installedKey = lockKeys.find((key) => lockfile.packages?.[key] !== undefined);
    const installed = lockfile.packages?.[installedKey]?.version;

    if (floor === null) {
      // Without a floor there is nothing to compare against, and the range is unconstrained by
      // anything at all — a strictly worse state than the drift this check exists to catch.
      console.error(`✗ engines.${engine} is missing or unparseable — nothing pins ${types}`);
      failed = true;
    } else if (!declared.startsWith('~') || minorOf(declared) !== floor) {
      console.error(
        `✗ ${manifest}'s ${types} is ${describe(declared)} — expected a tilde on engines.${engine}'s floor (~${floor})`,
      );
      failed = true;
    } else if (minorOf(installed) !== floor) {
      // The range can be right while the lockfile is not: a hand-edited or stale entry resolves
      // off-floor, and it is the resolved version tsc actually compiles against.
      console.error(
        `✗ ${types} resolves to ${describe(installed ?? '')} in the lockfile — expected ${floor}.x`,
      );
      failed = true;
    }
  }

  if (!failed) {
    console.log('✓ every @types range is a tilde on its engines floor, and resolves there');
  }

  return failed;
}

function main() {
  const configFailed = checkConfig();
  const driftFailed = checkLockfileDrift();
  const allowScriptsFailed = checkAllowScriptsPinned();
  const typeFloorFailed = checkTypeFloorPinned();

  if (configFailed || driftFailed || allowScriptsFailed || typeFloorFailed) {
    process.exit(1);
  }
}

main();
