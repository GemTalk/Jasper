import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withTemporaryFolderDo } from './support/file';

// Black-box tests for scripts/verify-ci-complete.mjs, the verdict behind the one
// check the merge queue requires. A wrong pass merges a broken or untested PR.
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'verify-ci-complete.mjs');

type Result = 'success' | 'failure' | 'skipped' | 'cancelled';

// prepare's already-tested output.
const NOT_A_QUEUE_RUN = '';
const NO_RECORD = 'false';
const RECORD_FOUND = 'true';

function needs(prepare: Result, alreadyTested: string, others: Record<string, Result>) {
  return {
    prepare: {
      result: prepare,
      outputs: { 'already-tested': alreadyTested, tree: 'f'.repeat(40) },
    },
    ...Object.fromEntries(
      Object.entries(others).map(([name, result]) => [name, { result, outputs: {} }]),
    ),
  };
}

function verify(needsJson: string | undefined) {
  return withTemporaryFolderDo((dir) => {
    const summaryFile = path.join(dir, 'summary');
    fs.writeFileSync(summaryFile, '');
    const result = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, NEEDS_JSON: needsJson, GITHUB_STEP_SUMMARY: summaryFile },
    });
    return {
      status: result.status,
      stdout: result.stdout,
      summary: fs.readFileSync(summaryFile, 'utf8'),
    };
  });
}

const ALL_PASSED = {
  lint: 'success',
  'health-check': 'success',
  'package-check': 'success',
} as const;
const ALL_SKIPPED = {
  lint: 'skipped',
  'health-check': 'skipped',
  'package-check': 'skipped',
} as const;

describe('verify-ci-complete.mjs', () => {
  it.each([
    ['every job passed', needs('success', NOT_A_QUEUE_RUN, ALL_PASSED)],
    ['a queue run found no record and every job passed', needs('success', NO_RECORD, ALL_PASSED)],
    [
      'a queue run found a record and every job was skipped',
      needs('success', RECORD_FOUND, ALL_SKIPPED),
    ],
    [
      'a queue run found a record and a job ran anyway and passed',
      needs('success', RECORD_FOUND, { ...ALL_SKIPPED, lint: 'success' }),
    ],
  ])('passes when %s', (_case, input) => {
    expect(verify(JSON.stringify(input)).status).toBe(0);
  });

  it.each([
    [
      'a job failed',
      needs('success', NOT_A_QUEUE_RUN, { ...ALL_PASSED, 'health-check': 'failure' }),
    ],
    [
      'a job was cancelled',
      needs('success', NOT_A_QUEUE_RUN, { ...ALL_PASSED, 'health-check': 'cancelled' }),
    ],
    [
      'a job was skipped without a record',
      needs('success', NOT_A_QUEUE_RUN, { ...ALL_PASSED, lint: 'skipped' }),
    ],
    [
      'a job was skipped and no record matched',
      needs('success', NO_RECORD, { ...ALL_PASSED, lint: 'skipped' }),
    ],
    [
      'a record matched but a job ran anyway and failed',
      needs('success', RECORD_FOUND, { ...ALL_SKIPPED, lint: 'failure' }),
    ],
    [
      'a record matched but a job was cancelled',
      needs('success', RECORD_FOUND, { ...ALL_SKIPPED, 'health-check': 'cancelled' }),
    ],
    ['prepare failed', needs('failure', NOT_A_QUEUE_RUN, ALL_SKIPPED)],
    ['prepare was skipped, even with a record', needs('skipped', RECORD_FOUND, ALL_SKIPPED)],
  ])('fails when %s', (_case, input) => {
    const { status, stdout } = verify(JSON.stringify(input));

    expect(status).toBe(1);
    expect(stdout).toContain('Not green:');
  });

  it('fails when prepare is missing from the jobs it waits on', () => {
    const { status, stdout } = verify(JSON.stringify({ lint: { result: 'success' } }));

    expect(status).toBe(1);
    expect(stdout).toContain('prepare is not among the jobs ci-complete waits on.');
  });

  it.each([
    ['missing', undefined],
    ['not JSON', 'not json'],
  ])('fails when NEEDS_JSON is %s', (_case, needsJson) => {
    expect(verify(needsJson).status).toBe(1);
  });

  it('says so when it passes because a PR run already passed the tree', () => {
    const { stdout } = verify(JSON.stringify(needs('success', RECORD_FOUND, ALL_SKIPPED)));

    expect(stdout).toContain(
      `A PR run already passed tree ${'f'.repeat(40)}, so this merge-queue run skipped the tests.`,
    );
  });

  it('puts the skip in the job summary, so the green check is not mistaken for a full run', () => {
    const { summary } = verify(JSON.stringify(needs('success', RECORD_FOUND, ALL_SKIPPED)));

    expect(summary).toContain('**Passed without running the tests.**');
  });

  it('writes no summary for an ordinary pass', () => {
    const { summary } = verify(JSON.stringify(needs('success', NOT_A_QUEUE_RUN, ALL_PASSED)));

    expect(summary).toBe('');
  });
});
