import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Tests for scripts/lint-supply-chain.mjs — the guard that asserts npm's install-script
// supply-chain controls are actually in effect and that the lockfile / allowScripts policy
// have not drifted. It is itself a security control, so a silent regression in it (a check
// that stops detecting what it claims to detect) is invisible: the script keeps printing
// green ✓ lines and CI keeps passing.
//
// These are black-box tests: each case builds a throwaway repo (package.json,
// package-lock.json, .npmrc) in a temp dir and runs the real script against it as a
// subprocess, asserting on exit code and output. That is deliberately the level the script's
// contract lives at — it has no exports, reads its inputs from the cwd, and communicates
// purely through exit status and console lines. Testing it in-process would mean exporting
// its internals AND importing a file outside client/tsconfig.json's rootDir (which tsc
// rejects), for no gain in coverage.
//
// Each case costs one `node` + five `npm config get` spawns, roughly half a second.
//
// __dirname is client/src/__tests__, so the repo root is three levels up.
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'lint-supply-chain.mjs');

// The .npmrc contents that satisfy every assertion in CONFIG_ASSERTIONS, so a case that is
// about the lockfile or allowScripts isn't also failing on config noise. `allow-scripts` is
// absent on purpose — the script requires it unset.
const COMPLIANT_NPMRC = [
  'strict-allow-scripts=true',
  'allow-git=none',
  'allow-remote=none',
  'min-release-age=7',
  '',
].join('\n');

interface Fixture {
  npmrc?: string;
  packageJson?: Record<string, unknown>;
  lockfile?: Record<string, unknown>;
  // Extra environment for the child, e.g. an npm_config_* override.
  env?: Record<string, string>;
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Runs the script against a synthetic repo. The child's environment is scrubbed of every
// npm_config_* variable, because `npm test` exports this repo's own npm config that way and
// it would otherwise leak past the fixture's .npmrc and decide the config assertions for us.
// User- and global-level npm config are likewise redirected at empty files (two distinct
// paths — npm refuses to load one file at two levels), so a developer's ~/.npmrc can neither
// rescue nor break a case.
function runLint({ npmrc = COMPLIANT_NPMRC, packageJson = {}, lockfile = {}, env = {} }: Fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-supply-chain-'));
  tempDirs.push(dir);

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', ...packageJson }),
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify({ packages: {}, ...lockfile }),
  );
  fs.writeFileSync(path.join(dir, '.npmrc'), npmrc);
  fs.writeFileSync(path.join(dir, 'user.npmrc'), '');
  fs.writeFileSync(path.join(dir, 'global.npmrc'), '');

  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_')),
  );

  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...inherited,
      npm_config_userconfig: path.join(dir, 'user.npmrc'),
      npm_config_globalconfig: path.join(dir, 'global.npmrc'),
      ...env,
    },
  });

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// A lockfile entry as npm writes one for a registry package that is internally consistent.
function entry(name: string, version: string) {
  const unscoped = name.split('/').pop();
  return {
    version,
    resolved: `https://registry.npmjs.org/${name}/-/${unscoped}-${version}.tgz`,
    integrity: 'sha512-fixture',
  };
}

describe('lint-supply-chain: npm config assertions', () => {
  it('passes when every install-script control is in effect', () => {
    const { status, stdout } = runLint({});

    expect(status).toBe(0);
    expect(stdout).toContain("✓ npm config 'strict-allow-scripts' is 'true'");
    expect(stdout).toContain("✓ npm config 'allow-git' is 'none'");
    expect(stdout).toContain("✓ npm config 'allow-remote' is 'none'");
    expect(stdout).toContain("✓ npm config 'allow-scripts' is unset");
    expect(stdout).toContain("✓ npm config 'min-release-age' is '7'");
  });

  it('fails when a control is turned off', () => {
    const { status, stderr } = runLint({
      npmrc: COMPLIANT_NPMRC.replace('strict-allow-scripts=true', 'strict-allow-scripts=false'),
    });

    expect(status).toBe(1);
    expect(stderr).toContain("✗ npm config 'strict-allow-scripts' is 'false', expected 'true'");
  });

  // The whole reason the script reads through `npm config get` instead of parsing .npmrc:
  // an npm_config_* env var silently overrides a perfectly compliant file, and a grep of
  // .npmrc would report everything is fine.
  it('catches an env-var override of a compliant .npmrc', () => {
    const { status, stderr } = runLint({
      npmrc: COMPLIANT_NPMRC,
      env: { npm_config_strict_allow_scripts: 'false' },
    });

    expect(status).toBe(1);
    expect(stderr).toContain("✗ npm config 'strict-allow-scripts' is 'false', expected 'true'");
  });

  // The other form a naive `key=` grep misses: npm's array syntax. `allow-scripts` must stay
  // unset because package.json's allowScripts is the single source of truth, and a set (but
  // inert) .npmrc allowlist turns live the moment allowScripts is emptied.
  it("catches allow-scripts set with npm's key[]= array syntax, and explains why it must go", () => {
    const { status, stderr } = runLint({
      npmrc: `${COMPLIANT_NPMRC}allow-scripts[]=some-package\n`,
    });

    expect(status).toBe(1);
    expect(stderr).toContain("✗ npm config 'allow-scripts' is 'some-package', expected unset");
    expect(stderr).toContain('npm approve-scripts');
  });
});

// `min-release-age` is the one assertion compared as a floor rather than an exact value:
// it is a cooldown length in days, so a bigger number is a *stricter* setting and a developer
// who raises it should not be told they are out of compliance. Everything below 7 — and
// anything that isn't a number at all, which is how an absent cooldown shows up — must fail.
describe('lint-supply-chain: min-release-age floor', () => {
  function minReleaseAge(value: string | null) {
    const npmrc = COMPLIANT_NPMRC.replace(
      'min-release-age=7\n',
      value === null ? '' : `min-release-age=${value}\n`,
    );
    return runLint({ npmrc });
  }

  it('accepts the committed value', () => {
    const { status, stdout } = minReleaseAge('7');

    expect(status).toBe(0);
    expect(stdout).toContain("✓ npm config 'min-release-age' is '7'");
  });

  // Compared numerically, not lexically — a string comparison would put '10' below '7'.
  it.each(['8', '10', '30', '365'])('accepts the stricter cooldown %s', (value) => {
    const { status, stdout } = minReleaseAge(value);

    expect(status).toBe(0);
    expect(stdout).toContain(`✓ npm config 'min-release-age' is '${value}'`);
  });

  it.each(['6', '1'])('rejects the looser cooldown %s', (value) => {
    const { status, stderr } = minReleaseAge(value);

    expect(status).toBe(1);
    expect(stderr).toContain(`✗ npm config 'min-release-age' is '${value}', expected at least '7'`);
  });

  it('rejects a disabled cooldown', () => {
    const { status, stderr } = minReleaseAge('0');

    expect(status).toBe(1);
    expect(stderr).toContain("✗ npm config 'min-release-age' is '0', expected at least '7'");
  });

  // No cooldown at all has to fail. Note the reported value: this key's npm default is
  // `null`, so an absent setting reads back as the literal string 'null', not as the empty
  // string every other key in CONFIG_ASSERTIONS uses for "unset".
  it('rejects an absent cooldown', () => {
    const { status, stderr } = minReleaseAge(null);

    expect(status).toBe(1);
    expect(stderr).toContain("✗ npm config 'min-release-age' is 'null', expected at least '7'");
  });

  // Guards the numeric read itself: a garbage value is not a cooldown, and must not sneak
  // past as NaN >= 7 or via some lexical comparison.
  it('rejects a non-numeric cooldown', () => {
    const { status, stderr } = minReleaseAge('soon');

    expect(status).toBe(1);
    expect(stderr).toContain("✗ npm config 'min-release-age' is 'soon', expected at least '7'");
  });
});

describe('lint-supply-chain: lockfile version/tarball drift', () => {
  it('passes when every entry agrees with its own tarball', () => {
    const { status, stdout } = runLint({
      lockfile: {
        packages: {
          'node_modules/mime': entry('mime', '1.6.0'),
          'node_modules/@vscode/vsce-sign': entry('@vscode/vsce-sign', '2.0.9'),
        },
      },
    });

    expect(status).toBe(0);
    expect(stdout).toContain("✓ every lockfile entry's version matches its resolved tarball");
  });

  // The incident this check was born from: an in-range `version` masking an out-of-range
  // tarball. `npm ci` fetches `resolved` and only verifies `integrity`; `npm audit
  // signatures` looks the package up by the declared `version`; lockfile-lint never reads
  // `version` at all. Nothing else in the toolchain notices.
  it('fails when version disagrees with the resolved tarball', () => {
    const { status, stderr } = runLint({
      lockfile: {
        packages: {
          'node_modules/mime': {
            version: '1.6.0',
            resolved: 'https://registry.npmjs.org/mime/-/mime-2.0.0.tgz',
            integrity: 'sha512-fixture',
          },
        },
      },
    });

    expect(status).toBe(1);
    expect(stderr).toContain(
      "✗ node_modules/mime: version '1.6.0' disagrees with resolved tarball " +
        "'https://registry.npmjs.org/mime/-/mime-2.0.0.tgz' (2.0.0)",
    );
  });

  // Lockfile keys are node_modules paths, so the package name is whatever follows the LAST
  // separator. If that were taken from the first segment instead, the tarball prefix check
  // would not match and this drift would be skipped as "an alias".
  it('detects drift in a nested node_modules path', () => {
    const { status, stderr } = runLint({
      lockfile: {
        packages: {
          'node_modules/a/node_modules/mime': {
            version: '1.6.0',
            resolved: 'https://registry.npmjs.org/mime/-/mime-2.0.0.tgz',
            integrity: 'sha512-fixture',
          },
        },
      },
    });

    expect(status).toBe(1);
    expect(stderr).toContain("✗ node_modules/a/node_modules/mime: version '1.6.0'");
  });

  it('detects drift on a scoped package', () => {
    const { status, stderr } = runLint({
      lockfile: {
        packages: {
          'node_modules/@vscode/vsce-sign': {
            version: '2.0.9',
            resolved: 'https://registry.npmjs.org/@vscode/vsce-sign/-/vsce-sign-3.0.0.tgz',
            integrity: 'sha512-fixture',
          },
        },
      },
    });

    expect(status).toBe(1);
    expect(stderr).toContain("✗ node_modules/@vscode/vsce-sign: version '2.0.9'");
  });

  // Everything the check deliberately declines to judge. Each of these entries would look
  // like a name/version mismatch to a stricter comparison, and each is legitimate — so a
  // regression that made any of them fail would be a false positive blocking every install.
  it('ignores entries it cannot judge', () => {
    const { status, stdout, stderr } = runLint({
      lockfile: {
        packages: {
          // The root project itself: no resolved, no version to compare.
          '': { name: 'fixture', version: '0.0.0' },
          // A workspace link — resolved points at a directory, not the registry.
          'node_modules/client': { resolved: 'client', link: true },
          // Not the public registry: out of scope for a tarball-name comparison.
          'node_modules/from-git': {
            version: '1.0.0',
            resolved: 'git+ssh://git@github.com/example/from-git.git#abc1234',
          },
          // An npm alias ("legacy-name": "npm:real-name@1.0.0") makes the tarball name
          // legitimately disagree with the key; lockfile-lint's --validate-package-names
          // owns catching a genuine mismatch here.
          'node_modules/legacy-name': {
            version: '1.0.0',
            resolved: 'https://registry.npmjs.org/real-name/-/real-name-1.0.0.tgz',
            integrity: 'sha512-fixture',
          },
          // A registry entry with no version field to compare against.
          'node_modules/no-version': {
            resolved: 'https://registry.npmjs.org/no-version/-/no-version-1.0.0.tgz',
          },
        },
      },
    });

    expect(stderr).toBe('');
    expect(stdout).toContain("✓ every lockfile entry's version matches its resolved tarball");
    expect(status).toBe(0);
  });
});

describe('lint-supply-chain: allowScripts pinning', () => {
  it('passes when every allow entry is pinned to a version', () => {
    const { status, stdout } = runLint({
      packageJson: {
        allowScripts: {
          'esbuild@0.28.1': true,
          '@vscode/vsce-sign@2.0.9': true,
        },
      },
    });

    expect(status).toBe(0);
    expect(stdout).toContain('✓ every allowScripts allow entry is pinned to a version');
  });

  it('fails on an unpinned allow entry, which would trust every future version', () => {
    const { status, stderr } = runLint({
      packageJson: { allowScripts: { esbuild: true } },
    });

    expect(status).toBe(1);
    expect(stderr).toContain(
      "✗ allowScripts['esbuild'] allows every version — re-run npm approve-scripts to pin it",
    );
  });

  // A scoped name starts with '@', so the version separator has to be searched for after
  // that leading character — reading '@vscode/vsce-sign' as already-pinned is the obvious
  // off-by-one here, and it would wave through the exact case it is meant to catch.
  it('fails on an unpinned scoped allow entry', () => {
    const { status, stderr } = runLint({
      packageJson: { allowScripts: { '@vscode/vsce-sign': true } },
    });

    expect(status).toBe(1);
    expect(stderr).toContain("✗ allowScripts['@vscode/vsce-sign'] allows every version");
  });

  // Deny entries are always written unpinned, because denying every version is the point.
  it('accepts unpinned deny entries', () => {
    const { status, stdout } = runLint({
      packageJson: { allowScripts: { fsevents: false } },
    });

    expect(status).toBe(0);
    expect(stdout).toContain('✓ every allowScripts allow entry is pinned to a version');
  });

  it('passes when package.json declares no allowScripts at all', () => {
    const { status, stdout } = runLint({});

    expect(status).toBe(0);
    expect(stdout).toContain('✓ every allowScripts allow entry is pinned to a version');
  });
});

describe('lint-supply-chain: exit status', () => {
  it('reports every failing check in one run, not just the first', () => {
    const { status, stderr } = runLint({
      npmrc: COMPLIANT_NPMRC.replace('allow-git=none', 'allow-git=all'),
      packageJson: { allowScripts: { esbuild: true } },
      lockfile: {
        packages: {
          'node_modules/mime': {
            version: '1.6.0',
            resolved: 'https://registry.npmjs.org/mime/-/mime-2.0.0.tgz',
          },
        },
      },
    });

    expect(status).toBe(1);
    expect(stderr).toContain("✗ npm config 'allow-git' is 'all', expected 'none'");
    expect(stderr).toContain('✗ node_modules/mime: version');
    expect(stderr).toContain("✗ allowScripts['esbuild'] allows every version");
  });
});
