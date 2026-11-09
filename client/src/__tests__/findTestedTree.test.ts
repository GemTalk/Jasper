import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withTemporaryFolderDo } from './support/file';

// Black-box tests for scripts/find-tested-tree.sh, which lets a merge-queue run skip
// its tests. A wrong "true" merges untested code, so each way a record can fail to
// count gets a case. A fake `gh` on PATH serves canned API responses and applies the
// script's own --jq filter with real jq, so the filters are tested, not bypassed.
//
// Bash and jq aren't on the Windows runners' default path, and the script only ever
// runs on ubuntu-latest.
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'find-tested-tree.sh');
const TREE = 'a'.repeat(40);
const REPO_ID = 192375374;

interface Fixture {
  artifacts?: object[];
  artifactsFail?: boolean;
  runs?: Record<number, { path: string; event: string }>;
}

function artifact(runId: number, overrides: { expired?: boolean; headRepositoryId?: number } = {}) {
  return {
    name: `tested-tree-${TREE}`,
    expired: overrides.expired ?? false,
    workflow_run: { id: runId, head_repository_id: overrides.headRepositoryId ?? REPO_ID },
  };
}

const HEALTH_CHECK_PR = { path: '.github/workflows/health-check.yml', event: 'pull_request' };

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
        runs: { 7: { path: '.github/workflows/other.yml', event: 'pull_request' } },
      },
    ],
    [
      'the record came from a run that was not a PR run',
      { artifacts: [artifact(7)], runs: { 7: { path: HEALTH_CHECK_PR.path, event: 'push' } } },
    ],
    ['the run behind the record cannot be read', { artifacts: [artifact(7)] }],
    ['the artifact lookup fails', { artifactsFail: true }],
  ] satisfies [string, Fixture][])('runs the tests when %s', (_case, fixture) => {
    const { status, output } = runFinder(fixture);

    expect(status).toBe(0);
    expect(output).toBe('already-tested=false');
  });

  it('runs the tests when the tree hash is malformed', () => {
    const { status, output } = runFinder(
      { artifacts: [artifact(7)], runs: { 7: HEALTH_CHECK_PR } },
      'not-a-hash',
    );

    expect(status).toBe(0);
    expect(output).toBe('already-tested=false');
  });

  it('runs the tests, without failing the job, when Actions did not set the repository id', () => {
    const { status, output } = runFinder(
      { artifacts: [artifact(7)], runs: { 7: HEALTH_CHECK_PR } },
      TREE,
      { GITHUB_REPOSITORY_ID: undefined },
    );

    expect(status).toBe(0);
    expect(output).toBe('already-tested=false');
  });

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
});
