import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withTemporaryFolderDo } from './support/file';

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
// Each case costs one `node` + one batched `npm config get` spawn.
//
// __dirname is client/src/__tests__, so the repo root is three levels up.
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'lint-supply-chain.mjs');

// An example .npmrc that satisfies every assertion in CONFIG_ASSERTIONS, so a case that is
// about the lockfile or allowScripts isn't also failing on config noise. `allow-scripts` is
// absent on purpose — the script requires it unset.
const EXAMPLE_NPMRC = [
  'strict-allow-scripts=true',
  'allow-git=none',
  'allow-remote=none',
  'min-release-age=7',
  '',
].join('\n');

// The type-floor half of an example compliant repo: an `engines` pair, the two `@types`
// ranges pinned as tildes on those floors, and lockfile entries resolving there. Every case gets these by
// default so a case about config, the lockfile, or allowScripts isn't also failing on type-floor
// noise; the type-floor cases override one piece at a time.
//
// The version numbers are deliberately unlike this repo's real floors: what the check asserts is
// that the four values agree with each other, not what any of them happens to be.
const EXAMPLE_COMPLIANT_ENGINES = { vscode: '^3.7.0', node: '>=9.4.2' };
const EXAMPLE_COMPLIANT_ROOT_TYPES = { '@types/node': '~9.4' };
const EXAMPLE_COMPLIANT_CLIENT_TYPES = { '@types/vscode': '~3.7.0' };
const EXAMPLE_COMPLIANT_TYPE_PACKAGES = {
  'node_modules/@types/node': entry('@types/node', '9.4.11'),
  'client/node_modules/@types/vscode': entry('@types/vscode', '3.7.0'),
};

interface Fixture {
  npmrc?: string;
  packageJson?: Record<string, unknown>;
  clientPackageJson?: Record<string, unknown>;
  lockfile?: Record<string, unknown>;
  typePackages?: Record<string, unknown>;
  // Extra environment for the child, e.g. an npm_config_* override.
  env?: Record<string, string>;
}

function typePackagesFor(overrides: Record<string, unknown>) {
  const packages: Record<string, unknown> = { ...EXAMPLE_COMPLIANT_TYPE_PACKAGES, ...overrides };

  for (const [key, value] of Object.entries(packages)) {
    if (value === null) {
      delete packages[key];
    }
  }

  return packages;
}

// Runs the script against a synthetic repo. The child's environment is scrubbed of every
// npm_config_* variable, because `npm test` exports this repo's own npm config that way and
// it would otherwise leak past the fixture's .npmrc and decide the config assertions for us.
// User- and global-level npm config are likewise redirected at empty files (two distinct
// paths — npm refuses to load one file at two levels), so a developer's ~/.npmrc can neither
// rescue nor break a case.
function runLint({
  npmrc = EXAMPLE_NPMRC,
  packageJson = {},
  clientPackageJson = {},
  lockfile = {},
  typePackages = {},
  env = {},
}: Fixture) {
  return withTemporaryFolderDo((dir) => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        version: '0.0.0',
        engines: EXAMPLE_COMPLIANT_ENGINES,
        devDependencies: EXAMPLE_COMPLIANT_ROOT_TYPES,
        ...packageJson,
      }),
    );
    fs.mkdirSync(path.join(dir, 'client'));
    fs.writeFileSync(
      path.join(dir, 'client', 'package.json'),
      JSON.stringify({
        name: 'fixture-client',
        version: '0.0.0',
        devDependencies: EXAMPLE_COMPLIANT_CLIENT_TYPES,
        ...clientPackageJson,
      }),
    );
    fs.writeFileSync(
      path.join(dir, 'package-lock.json'),
      JSON.stringify({
        ...lockfile,
        packages: {
          ...typePackagesFor(typePackages),
          ...((lockfile.packages as Record<string, unknown> | undefined) ?? {}),
        },
      }),
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
  });
}

// A lockfile entry as npm writes one for a registry package. `resolvedVersion` defaults to
// `version`, giving the internally-consistent entry; passing a different one produces the
// version/tarball drift the script exists to catch.
function entry(name: string, version: string, resolvedVersion: string = version) {
  const unscoped = name.split('/').pop();
  return {
    version,
    resolved: `https://registry.npmjs.org/${name}/-/${unscoped}-${resolvedVersion}.tgz`,
    integrity: 'sha512-fixture',
  };
}

// The three values checkTypeFloorPinned compares for one `@types` package. Omitting a field
// expresses its absence, which is a scenario in its own right: no `engines` floor to compare
// against, no declared range, no lockfile entry.
interface TypeFloorSpec {
  // The `engines` value the range is supposed to track (`engines.vscode` / `engines.node`).
  enginesFloor?: string;
  // The range declared for the `@types` package in its own manifest — client/package.json for
  // `@types/vscode`, the root package.json for `@types/node`.
  manifestRange?: string;
  // The version package-lock.json resolves that package to.
  lockfileVersion?: string;
  // `@types/vscode` only: put the lockfile entry at the root key instead of under client/.
  hoisted?: boolean;
}

// Builds the type-floor half of a fixture — the manifests and lockfile entries — without running
// anything, so a case states all six values inline and then hands the result to runLint. What the
// check asserts is that the values agree with each other, and that is what the call site shows:
// the passing case has both triples in step, and every failing case is exactly one value out of it.
function typeFloorFixture({
  vscode,
  node,
}: {
  vscode: TypeFloorSpec;
  node: TypeFloorSpec;
}): Fixture {
  const vscodeLockKey = vscode.hoisted
    ? 'node_modules/@types/vscode'
    : 'client/node_modules/@types/vscode';

  return {
    packageJson: {
      engines: {
        ...(vscode.enginesFloor === undefined ? {} : { vscode: vscode.enginesFloor }),
        ...(node.enginesFloor === undefined ? {} : { node: node.enginesFloor }),
      },
      devDependencies:
        node.manifestRange === undefined ? {} : { '@types/node': node.manifestRange },
    },
    clientPackageJson: {
      devDependencies:
        vscode.manifestRange === undefined ? {} : { '@types/vscode': vscode.manifestRange },
    },
    // Both `@types/vscode` keys start deleted so the entry lands only where this case puts it.
    typePackages: {
      'client/node_modules/@types/vscode': null,
      'node_modules/@types/vscode': null,
      'node_modules/@types/node':
        node.lockfileVersion === undefined ? null : entry('@types/node', node.lockfileVersion),
      ...(vscode.lockfileVersion === undefined
        ? {}
        : { [vscodeLockKey]: entry('@types/vscode', vscode.lockfileVersion) }),
    },
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
      npmrc: EXAMPLE_NPMRC.replace('strict-allow-scripts=true', 'strict-allow-scripts=false'),
    });

    expect(status).toBe(1);
    expect(stderr).toContain("✗ npm config 'strict-allow-scripts' is 'false', expected 'true'");
  });

  // The whole reason the script reads through `npm config get` instead of parsing .npmrc:
  // an npm_config_* env var silently overrides a perfectly compliant file, and a grep of
  // .npmrc would report everything is fine.
  it('catches an env-var override of a compliant .npmrc', () => {
    const { status, stderr } = runLint({
      npmrc: EXAMPLE_NPMRC,
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
      npmrc: `${EXAMPLE_NPMRC}allow-scripts[]=some-package\n`,
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
    const npmrc = EXAMPLE_NPMRC.replace(
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
          'node_modules/mime': entry('mime', '1.6.0', '2.0.0'),
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
          'node_modules/a/node_modules/mime': entry('mime', '1.6.0', '2.0.0'),
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
          'node_modules/@vscode/vsce-sign': entry('@vscode/vsce-sign', '2.0.9', '3.0.0'),
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

describe('lint-supply-chain: @types floor pinning', () => {
  it('passes when both type ranges are tildes on the engines floors and resolve there', () => {
    const { status, stdout } = runLint(
      typeFloorFixture({
        vscode: { enginesFloor: '^3.7.0', manifestRange: '~3.7.0', lockfileVersion: '3.7.0' },
        node: { enginesFloor: '>=9.4.2', manifestRange: '~9.4', lockfileVersion: '9.4.11' },
      }),
    );

    expect(status).toBe(0);
    expect(stdout).toContain('✓ every @types range is a tilde on its engines floor');
  });

  // The re-widening case: a merge resolution or a "why is this pinned?" cleanup puts the caret
  // back, and the lockfile is then free to resolve above the floor on the next regeneration.
  it('fails when a type range is widened back to a caret', () => {
    const { status, stderr } = runLint(
      typeFloorFixture({
        vscode: { enginesFloor: '^3.7.0', manifestRange: '^3.7.0', lockfileVersion: '3.7.0' },
        node: { enginesFloor: '>=9.4.2', manifestRange: '~9.4', lockfileVersion: '9.4.11' },
      }),
    );

    expect(status).toBe(1);
    expect(stderr).toContain(
      "✗ client/package.json's @types/vscode is '^3.7.0' — expected a tilde on engines.vscode's floor (~3.7)",
    );
  });

  // The partial floor raise: engines moves, the coordinated @types bump is forgotten. Left
  // alone this is benign-looking, since the types merely lag — but the same omission in the
  // other direction is what shipped APIs the runtime floor lacks.
  it('fails when the vscode floor moves without the matching type bump', () => {
    const { status, stderr } = runLint(
      typeFloorFixture({
        vscode: { enginesFloor: '^3.9.0', manifestRange: '~3.7.0', lockfileVersion: '3.7.0' },
        node: { enginesFloor: '>=9.4.2', manifestRange: '~9.4', lockfileVersion: '9.4.11' },
      }),
    );

    expect(status).toBe(1);
    expect(stderr).toContain(
      "✗ client/package.json's @types/vscode is '~3.7.0' — expected a tilde on engines.vscode's floor (~3.9)",
    );
  });

  it('fails when the node floor moves without the matching type bump', () => {
    const { status, stderr } = runLint(
      typeFloorFixture({
        vscode: { enginesFloor: '^3.7.0', manifestRange: '~3.7.0', lockfileVersion: '3.7.0' },
        node: { enginesFloor: '>=11.2.0', manifestRange: '~9.4', lockfileVersion: '9.4.11' },
      }),
    );

    expect(status).toBe(1);
    expect(stderr).toContain(
      "✗ package.json's @types/node is '~9.4' — expected a tilde on engines.node's floor (~11.2)",
    );
  });

  // The declared range and the installed version are independent: the lockfile is what tsc
  // actually compiles against, so a correct range with a stale or hand-edited entry still
  // type-checks against the wrong API surface.
  it('fails when the range is right but the lockfile resolves off the floor', () => {
    const { status, stderr } = runLint(
      typeFloorFixture({
        vscode: { enginesFloor: '^3.7.0', manifestRange: '~3.7.0', lockfileVersion: '4.2.0' },
        node: { enginesFloor: '>=9.4.2', manifestRange: '~9.4', lockfileVersion: '9.4.11' },
      }),
    );

    expect(status).toBe(1);
    expect(stderr).toContain(
      "✗ @types/vscode resolves to '4.2.0' in the lockfile — expected 3.7.x",
    );
  });

  it('fails when the lockfile has no entry for a type package at all', () => {
    const { status, stderr } = runLint(
      typeFloorFixture({
        vscode: { enginesFloor: '^3.7.0', manifestRange: '~3.7.0', lockfileVersion: '3.7.0' },
        node: { enginesFloor: '>=9.4.2', manifestRange: '~9.4' },
      }),
    );

    expect(status).toBe(1);
    expect(stderr).toContain('✗ @types/node resolves to unset in the lockfile — expected 9.4.x');
  });

  // npm keeps @types/vscode under client/node_modules today because only that workspace
  // declares it, but a future install could hoist it to the root — which must not read as a
  // missing entry.
  it('accepts a type package hoisted to the root node_modules', () => {
    const { status, stdout } = runLint(
      typeFloorFixture({
        vscode: {
          enginesFloor: '^3.7.0',
          manifestRange: '~3.7.0',
          lockfileVersion: '3.7.0',
          hoisted: true,
        },
        node: { enginesFloor: '>=9.4.2', manifestRange: '~9.4', lockfileVersion: '9.4.11' },
      }),
    );

    expect(status).toBe(0);
    expect(stdout).toContain('✓ every @types range is a tilde on its engines floor');
  });

  // No floor at all is strictly worse than a drifted one: the range is then unconstrained by
  // anything, so this has to fail rather than vacuously pass for want of something to compare.
  it('fails when engines declares no floor to compare against', () => {
    const { status, stderr } = runLint(
      typeFloorFixture({
        vscode: { manifestRange: '~3.7.0', lockfileVersion: '3.7.0' },
        node: { manifestRange: '~9.4', lockfileVersion: '9.4.11' },
      }),
    );

    expect(status).toBe(1);
    expect(stderr).toContain(
      '✗ engines.vscode is missing or unparseable — nothing pins @types/vscode',
    );
    expect(stderr).toContain('✗ engines.node is missing or unparseable — nothing pins @types/node');
  });
});

describe('lint-supply-chain: exit status', () => {
  it('reports every failing check in one run, not just the first', () => {
    const { status, stderr } = runLint({
      npmrc: EXAMPLE_NPMRC.replace('allow-git=none', 'allow-git=all'),
      packageJson: { allowScripts: { esbuild: true } },
      clientPackageJson: { devDependencies: { '@types/vscode': '^3.7.0' } },
      lockfile: {
        packages: {
          'node_modules/mime': entry('mime', '1.6.0', '2.0.0'),
        },
      },
    });

    expect(status).toBe(1);
    expect(stderr).toContain("✗ npm config 'allow-git' is 'all', expected 'none'");
    expect(stderr).toContain('✗ node_modules/mime: version');
    expect(stderr).toContain("✗ allowScripts['esbuild'] allows every version");
    expect(stderr).toContain("✗ client/package.json's @types/vscode is '^3.7.0'");
  });
});
