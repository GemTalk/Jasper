import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withTemporaryFolderDo } from './support/file';
import { onSupportedPosixDescribe, onSupportedPosixIt } from './platformGates';

// Tests for scripts/publish-to-registry.sh — specifically its classification of what the
// publish CLI said, which is the whole reason the script exists. Both registries are
// immutable per (publisher, name, version), so the difference between "this failed" and
// "this was already up" decides whether a re-run is possible or the version number is spent.
// `--skip-duplicate` gets that distinction wrong (it matches only one of the two spellings),
// and the messages have moved before: the `=` form broke 1.7.6 and the `:` form broke 1.8.3.
//
// Without these, the greps and their ordering only ever run during a real release, which is
// the one place a stale pattern cannot be discovered cheaply — the first signal would be a
// red publish job on a version number that can never be reused.
//
// Black-box, like lintSupplyChain.test.ts: a stub `npx` on PATH plays back a canned message
// and exit status, and each case asserts on the script's exit code, stdout and stderr. That
// is the level the script's contract lives at — it has no exports and communicates purely
// through those three.
//
// POSIX-only: the release workflow runs these on ubuntu-latest, and the stub relies on a
// shebang and a `:`-separated PATH.
//
// __dirname is client/src/__tests__, so the repo root is three levels up.
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'publish-to-registry.sh');

// The messages as the registries actually spell them. The first two differ only in their
// tail, and the inactive one *contains* the other — which is exactly why the script tests
// the specific case first, and why that ordering is worth pinning.
const OVSX_INACTIVE =
  "gemtalksystems.gemstone-ide 1.9.0 is already published, but currently isn't active and therefore not visible.";
const OVSX_ALREADY = 'gemtalksystems.gemstone-ide 1.9.0 is already published.';
const VSCE_ALREADY = 'Error: gemstone-ide v1.9.0 already exists on the Marketplace.';

interface Stub {
  // What the fake CLI writes, and the status it exits with.
  stdout?: string;
  stderr?: string;
  status?: number;
  // Seconds to sleep after writing, to model a CLI that hangs and is killed.
  sleepSeconds?: number;
}

interface RunOptions extends Stub {
  registry?: string;
  // Omit to have the case run against a .vsix that exists.
  vsix?: string;
  // Milliseconds after which to kill the script, for the hang case.
  timeout?: number;
}

function run({
  registry = 'openvsx',
  vsix,
  stdout = '',
  stderr = '',
  status = 0,
  sleepSeconds = 0,
  timeout,
}: RunOptions) {
  return withTemporaryFolderDo((dir) => {
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir);

    // `npx` is resolved off PATH by the script, so a stub here is enough to stand in for
    // both CLIs. It records its own arguments so a case can assert which one was invoked.
    const argvFile = path.join(dir, 'argv');
    fs.writeFileSync(
      path.join(binDir, 'npx'),
      [
        '#!/usr/bin/env bash',
        `printf '%s\\n' "$@" > ${JSON.stringify(argvFile)}`,
        'if [ -n "${STUB_STDOUT:-}" ]; then printf \'%s\\n\' "$STUB_STDOUT"; fi',
        'if [ -n "${STUB_STDERR:-}" ]; then printf \'%s\\n\' "$STUB_STDERR" >&2; fi',
        'if [ "${STUB_SLEEP:-0}" != "0" ]; then sleep "$STUB_SLEEP"; fi',
        'exit "${STUB_STATUS:-0}"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    const vsixPath = path.join(dir, 'gemstone-ide-1.9.0.vsix');
    fs.writeFileSync(vsixPath, 'not really a zip');

    const result = spawnSync('bash', [SCRIPT, registry, vsix ?? vsixPath], {
      cwd: dir,
      encoding: 'utf8',
      timeout,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        STUB_STDOUT: stdout,
        STUB_STDERR: stderr,
        STUB_STATUS: String(status),
        STUB_SLEEP: String(sleepSeconds),
      },
    });

    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      argv: fs.existsSync(argvFile) ? fs.readFileSync(argvFile, 'utf8').trimEnd().split('\n') : [],
    };
  });
}

onSupportedPosixDescribe('publish-to-registry.sh', () => {
  it('reports a clean publish as published', () => {
    const { status, stdout } = run({
      stdout: 'Published gemtalksystems.gemstone-ide v1.9.0',
      status: 0,
    });

    expect(status).toBe(0);
    expect(stdout.trim()).toBe('result: published');
  });

  // The case --skip-duplicate gets wrong: ovsx tests `endsWith('is already published.')`, which
  // this message fails, so ovsx exits non-zero on a version that is in fact up. Treating it as
  // a failure would mean burning the next version number to get out of a half-finished release.
  it('reports an uploaded-but-inactive version as awaiting-activation, not a failure', () => {
    const { status, stdout } = run({ stderr: OVSX_INACTIVE, status: 1 });

    expect(status).toBe(0);
    expect(stdout.trim()).toBe('result: awaiting-activation');
  });

  // Pins the ordering the comment above the greps depends on. The inactive message contains
  // "is already published" verbatim, so a reordering would silently reclassify it — the two
  // outcomes are both successes, which is precisely why such a swap would go unnoticed.
  it('does not let the broader already-published grep swallow the inactive message', () => {
    const { stdout } = run({ stderr: OVSX_INACTIVE, status: 1 });

    expect(stdout).not.toContain('result: already-published');
  });

  it.each([
    ['ovsx', OVSX_ALREADY],
    ['vsce', VSCE_ALREADY],
  ])('reports %s saying the version is already there as already-published', (_cli, message) => {
    const { status, stdout } = run({ stderr: message, status: 1 });

    expect(status).toBe(0);
    expect(stdout.trim()).toBe('result: already-published');
  });

  it('fails, and says the version is spent, when the publish genuinely did not land', () => {
    const { status, stdout, stderr } = run({
      stderr: 'ERROR  Failed Request: Unauthorized (401)',
      status: 3,
    });

    // The CLI's own status is propagated rather than flattened to 1.
    expect(status).toBe(3);
    expect(stdout).not.toContain('result:');
    expect(stderr).toContain('the version is not up');
  });

  // The three outcomes are the script's return value, so all three belong on stdout; the
  // prose explaining them does not. A caller reading `$(...)` must see every outcome, not
  // just the happy one.
  it.each([
    ['published', { status: 0 }],
    ['awaiting-activation', { stderr: OVSX_INACTIVE, status: 1 }],
    ['already-published', { stderr: OVSX_ALREADY, status: 1 }],
  ])('puts the %s outcome on stdout by itself', (outcome, stub: Stub) => {
    const { stdout } = run(stub);

    expect(stdout.trim()).toBe(`result: ${outcome}`);
  });

  it.each([
    ['marketplace', '@vscode/vsce'],
    ['openvsx', 'ovsx'],
  ])('publishes to %s with the %s CLI, skipping duplicates', (registry, cli) => {
    const { argv } = run({ registry });

    expect(argv).toEqual([
      '--no-install',
      cli,
      'publish',
      '--packagePath',
      expect.stringContaining('gemstone-ide-1.9.0.vsix'),
      '--skip-duplicate',
    ]);
  });

  // The CLI's output is the only evidence of whether an upload went out, and the publish
  // steps run under `timeout-minutes: 5` — so a CLI that hangs is killed by the runner
  // mid-run. Capturing the output in a plain `$(...)` would leave the log with nothing at
  // all in exactly that case; teeing it keeps the log live. This case kills the script
  // while the stub is still running and asserts the line survived.
  //
  // The stub's `sleep` inherits the pipe, so spawnSync returns only once it exits rather
  // than at the timeout — hence a short sleep, and the couple of seconds this case costs.
  onSupportedPosixIt('streams the CLI output even when killed mid-publish', () => {
    const { stderr } = run({
      stderr: 'Publishing to Azure DevOps Gallery...',
      sleepSeconds: 3,
      timeout: 750,
    });

    expect(stderr).toContain('Publishing to Azure DevOps Gallery...');
  });

  it('refuses a .vsix that is not there rather than invoking the CLI', () => {
    const { status, stderr, argv } = run({ vsix: '/nonexistent/gemstone-ide-1.9.0.vsix' });

    expect(status).toBe(2);
    expect(stderr).toContain('not found');
    expect(argv).toEqual([]);
  });

  it('refuses an unknown registry rather than invoking the CLI', () => {
    const { status, stderr, argv } = run({ registry: 'npm' });

    expect(status).toBe(2);
    expect(stderr).toContain("unknown registry 'npm'");
    expect(argv).toEqual([]);
  });
});
