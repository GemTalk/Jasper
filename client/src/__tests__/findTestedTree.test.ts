import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withTemporaryFolderDo } from './support/file';

// Black-box tests for scripts/find-tested-tree.sh. A fake `gh` on PATH answers from
// canned JSON but runs the script's own --jq filters through real jq, so the filters
// are tested too. Not on Windows: no bash or jq there, and the script runs on ubuntu.
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'find-tested-tree.sh');
const TREE = 'a'.repeat(40);
const REPO_ID = 192375374;

interface Fixture {
  artifacts?: object[];
  artifactsFail?: boolean;
  runs?: Record<number, Run>;
}

interface Run {
  path: string;
  event: string;
  conclusion: string | null;
  pull_requests?: { number: number }[];
}

const QUEUED_PR = 870;
const QUEUE_REF = `refs/heads/gh-readonly-queue/main/pr-${QUEUED_PR}-${'c'.repeat(40)}`;

function artifact(
  runId: number,
  overrides: { expired?: boolean; headRepositoryId?: number; name?: string } = {},
) {
  return {
    name: overrides.name ?? `tested-tree-${TREE}`,
    expired: overrides.expired ?? false,
    workflow_run: { id: runId, head_repository_id: overrides.headRepositoryId ?? REPO_ID },
  };
}

const HEALTH_CHECK_PR: Run = {
  path: '.github/workflows/health-check.yml',
  event: 'pull_request',
  conclusion: 'success',
  pull_requests: [{ number: QUEUED_PR }],
};

function runFinder(
  fixture: Fixture,
  tree = TREE,
  envOverrides: Record<string, string | undefined> = {},
) {
  return withTemporaryFolderDo((dir) => {
    const responses = path.join(dir, 'responses');
    fs.mkdirSync(responses);
    if (!fixture.artifactsFail) {
      fs.writeFileSync(
        path.join(responses, 'artifacts.json'),
        JSON.stringify({ artifacts: fixture.artifacts ?? [] }),
      );
    }
    for (const [id, run] of Object.entries(fixture.runs ?? {})) {
      fs.writeFileSync(path.join(responses, `run-${id}.json`), JSON.stringify(run));
    }
    fs.writeFileSync(
      path.join(dir, 'gh'),
      [
        '#!/usr/bin/env bash',
        '# Fake gh: `gh api <endpoint> --jq <filter>` answered from canned JSON.',
        'endpoint="$2"; filter="$4"',
        '[ -n "${FAKE_GH_SLEEP:-}" ] && sleep "$FAKE_GH_SLEEP"',
        'case "$endpoint" in',
        `  *actions/artifacts*) file="${responses}/artifacts.json" ;;`,
        `  *actions/runs/*) file="${responses}/run-\${endpoint##*/}.json" ;;`,
        '  *) exit 1 ;;',
        'esac',
        '[ -f "$file" ] || { echo "HTTP 404" >&2; exit 1; }',
        'jq -r "$filter" "$file"',
      ].join('\n'),
      { mode: 0o755 },
    );
    const outputFile = path.join(dir, 'output');
    fs.writeFileSync(outputFile, '');
    const summaryFile = path.join(dir, 'summary');
    fs.writeFileSync(summaryFile, '');

    const result = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}${path.delimiter}${process.env.PATH}`,
        TREE: tree,
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
        GITHUB_REF: QUEUE_REF,
        GITHUB_REPOSITORY: 'GemTalk/Jasper',
        GITHUB_REPOSITORY_ID: String(REPO_ID),
        GITHUB_SERVER_URL: 'https://github.com',
        ...envOverrides,
      },
    });
    return {
      status: result.status,
      output: fs.readFileSync(outputFile, 'utf8').trim(),
      stdout: result.stdout,
      summary: fs.readFileSync(summaryFile, 'utf8'),
    };
  });
}

describe.skipIf(process.platform === 'win32')('find-tested-tree.sh', () => {
  it('lets the queue skip when a GemTalk/Jasper PR run of Health Check passed this tree', () => {
    const { status, output } = runFinder({
      artifacts: [artifact(7)],
      runs: { 7: HEALTH_CHECK_PR },
    });

    expect(status).toBe(0);
    expect(output).toBe('already-tested=true');
  });

  it('finds the trusted record among untrusted ones', () => {
    const { output } = runFinder({
      artifacts: [
        artifact(5, { headRepositoryId: 1 }),
        artifact(6, { expired: true }),
        artifact(7),
      ],
      runs: { 5: HEALTH_CHECK_PR, 6: HEALTH_CHECK_PR, 7: HEALTH_CHECK_PR },
    });

    expect(output).toBe('already-tested=true');
  });

  it('skips past a run it cannot read to a trusted one after it', () => {
    const { output } = runFinder({
      artifacts: [artifact(6), artifact(7)],
      runs: { 7: HEALTH_CHECK_PR },
    });

    expect(output).toBe('already-tested=true');
  });

  it.each([
    ['there is no record', { artifacts: [] }],
    [
      'the record came from a fork',
      { artifacts: [artifact(7, { headRepositoryId: 1 })], runs: { 7: HEALTH_CHECK_PR } },
    ],
    [
      'the record has expired',
      { artifacts: [artifact(7, { expired: true })], runs: { 7: HEALTH_CHECK_PR } },
    ],
    [
      'the record came from another workflow',
      {
        artifacts: [artifact(7)],
        runs: { 7: { ...HEALTH_CHECK_PR, path: '.github/workflows/other.yml' } },
      },
    ],
    [
      'the record came from a run that was not a PR run',
      { artifacts: [artifact(7)], runs: { 7: { ...HEALTH_CHECK_PR, event: 'push' } } },
    ],
    [
      "the record came from another PR's run",
      {
        artifacts: [artifact(7)],
        runs: { 7: { ...HEALTH_CHECK_PR, pull_requests: [{ number: QUEUED_PR + 1 }] } },
      },
    ],
    [
      'the run belongs to no PR',
      { artifacts: [artifact(7)], runs: { 7: { ...HEALTH_CHECK_PR, pull_requests: [] } } },
    ],
    [
      'the run was re-run and failed after recording the tree',
      { artifacts: [artifact(7)], runs: { 7: { ...HEALTH_CHECK_PR, conclusion: 'failure' } } },
    ],
    [
      'the run is being re-run and has no conclusion yet',
      { artifacts: [artifact(7)], runs: { 7: { ...HEALTH_CHECK_PR, conclusion: null } } },
    ],
    [
      'the only record is for another tree, as if the query ignored its name filter',
      {
        artifacts: [artifact(7, { name: `tested-tree-${'b'.repeat(40)}` })],
        runs: { 7: HEALTH_CHECK_PR },
      },
    ],
    [
      'the only artifact is some other report from a green PR run',
      {
        artifacts: [artifact(7, { name: 'skips-ubuntu-latest-3.6.2-nvmrc-bare' })],
        runs: { 7: HEALTH_CHECK_PR },
      },
    ],
    ['the run behind the record cannot be read', { artifacts: [artifact(7)] }],
    ['the artifact lookup fails', { artifactsFail: true }],
  ] satisfies [string, Fixture][])('runs the tests when %s', (_case, fixture) => {
    const { status, output } = runFinder(fixture);

    expect(status).toBe(0);
    expect(output).toBe('already-tested=false');
  });

  it.each([
    ['not a hash', 'not-a-hash'],
    ['39 characters', 'a'.repeat(39)],
    ['41 characters', 'a'.repeat(41)],
    ['in uppercase', 'A'.repeat(40)],
    ['followed by jq', `${TREE}" or true or "`],
  ])('runs the tests when the tree hash is %s', (_case, tree) => {
    const { status, output } = runFinder(
      // The record carries the same malformed hash, so only the format check stops it.
      { artifacts: [artifact(7, { name: `tested-tree-${tree}` })], runs: { 7: HEALTH_CHECK_PR } },
      tree,
    );

    expect(status).toBe(0);
    expect(output).toBe('already-tested=false');
  });

  it('still skips when the run belongs to several PRs, the queued one among them', () => {
    const { output } = runFinder({
      artifacts: [artifact(7)],
      runs: { 7: { ...HEALTH_CHECK_PR, pull_requests: [{ number: 12 }, { number: QUEUED_PR }] } },
    });

    expect(output).toBe('already-tested=true');
  });

  it.each([
    ['unset', undefined],
    ['a branch, not a queue ref', 'refs/heads/main'],
    ['a queue ref without a PR number', `refs/heads/gh-readonly-queue/main/pr--${'c'.repeat(40)}`],
    [
      'a queue ref with jq after the number',
      `refs/heads/gh-readonly-queue/main/pr-870 or true-${'c'.repeat(40)}`,
    ],
  ])('runs the tests when GITHUB_REF is %s', (_case, ref) => {
    const { status, output } = runFinder(
      { artifacts: [artifact(7)], runs: { 7: HEALTH_CHECK_PR } },
      TREE,
      { GITHUB_REF: ref },
    );

    expect(status).toBe(0);
    expect(output).toBe('already-tested=false');
  });

  // Both values are spliced into the API path and the jq filter, so a malformed one
  // must not reach them. Each record would pass if the format check were gone.
  it.each([
    ['GITHUB_REPOSITORY_ID', '0 or true', artifact(7, { headRepositoryId: 1 })],
    ['GITHUB_REPOSITORY', 'GemTalk/Jasper extra', artifact(7)],
  ])('runs the tests when %s is malformed (%s)', (variable, value, record) => {
    const { status, output } = runFinder(
      { artifacts: [record], runs: { 7: HEALTH_CHECK_PR } },
      TREE,
      { [variable]: value },
    );

    expect(status).toBe(0);
    expect(output).toBe('already-tested=false');
  });

  it.each(['GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_ID'])(
    'runs the tests when Actions did not set %s',
    (variable) => {
      const { status, output } = runFinder(
        { artifacts: [artifact(7)], runs: { 7: HEALTH_CHECK_PR } },
        TREE,
        { [variable]: undefined },
      );

      expect(status).toBe(0);
      expect(output).toBe('already-tested=false');
    },
  );

  it('still skips, without failing the job, when Actions did not set the server URL', () => {
    const { status, output, stdout } = runFinder(
      { artifacts: [artifact(7)], runs: { 7: HEALTH_CHECK_PR } },
      TREE,
      { GITHUB_SERVER_URL: undefined },
    );

    expect(status).toBe(0);
    expect(output).toBe('already-tested=true');
    expect(stdout).toContain('https://github.com/GemTalk/Jasper/actions/runs/7');
  });

  // macOS has no `timeout`; the script runs only on ubuntu-latest, where it does.
  it.skipIf(spawnSync('bash', ['-c', 'command -v timeout']).status !== 0)(
    'gives up on an API call that hangs and runs the tests',
    () => {
      const started = Date.now();
      const { status, output } = runFinder(
        { artifacts: [artifact(7)], runs: { 7: HEALTH_CHECK_PR } },
        TREE,
        { GH_API_TIMEOUT_SECONDS: '1', FAKE_GH_SLEEP: '10' },
      );

      expect(status).toBe(0);
      expect(output).toBe('already-tested=false');
      expect(Date.now() - started).toBeLessThan(8000);
    },
  );

  it('says on the run page, not only in grey icons, that the tests were skipped and why', () => {
    const { stdout, summary } = runFinder({
      artifacts: [artifact(7)],
      runs: { 7: HEALTH_CHECK_PR },
    });

    expect(stdout).toContain(
      '::notice title=Tests skipped because this exact code already passed::https://github.com/GemTalk/Jasper/actions/runs/7 tested the same files',
    );
    expect(summary).toContain('### Tests skipped: this exact code already passed');
    expect(summary).toContain('[This PR run](https://github.com/GemTalk/Jasper/actions/runs/7)');
  });

  it('announces nothing when it runs the tests', () => {
    const { stdout, summary } = runFinder({ artifacts: [] });

    expect(stdout).not.toContain('::notice');
    expect(summary).toBe('');
  });

  it('stops checking runs once its time budget is spent, and runs the tests', () => {
    // Five unreadable runs come before the good one, and every call takes a second.
    const { status, output } = runFinder(
      { artifacts: [1, 2, 3, 4, 5, 7].map((id) => artifact(id)), runs: { 7: HEALTH_CHECK_PR } },
      TREE,
      { FAKE_GH_SLEEP: '1', FIND_TESTED_TREE_BUDGET_SECONDS: '2' },
    );

    expect(status).toBe(0);
    expect(output).toBe('already-tested=false');
  });
});
