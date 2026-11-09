import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withTemporaryFolderDo } from './support/file';

// Black-box tests for scripts/report-retried-tests.mjs, run as a subprocess the way
// summarizeSkippedTests.test.ts runs its script. The report is the only trace a
// merge-queue retry leaves, so a test it misses is a flake nobody hears about.
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'report-retried-tests.mjs');
const VITEST_CLI = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'node_modules',
  'vitest',
  'vitest.mjs',
);

interface Assertion {
  fullName: string;
  status: string;
  failureMessages: string[];
}

function runReporter(testResults: object[] | undefined) {
  return runReporterOn(testResults && JSON.stringify({ testResults }));
}

function runReporterOn(reportContents: string | undefined) {
  return withTemporaryFolderDo((dir) => {
    const reportPath = path.join(dir, 'report.json');
    if (reportContents !== undefined) {
      fs.writeFileSync(reportPath, reportContents);
    }
    const result = spawnSync(process.execPath, [SCRIPT, reportPath], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: undefined },
    });
    return { status: result.status, stdout: result.stdout };
  });
}

function assertion(fullName: string, status: string, failureMessages: string[] = []): Assertion {
  return { fullName, status, failureMessages };
}

describe('report-retried-tests.mjs', () => {
  it('reports a test that passed after failing, and not one that passed first time or failed for good', () => {
    const { status, stdout } = runReporter([
      {
        name: '/runner/work/client/src/__tests__/a.test.ts',
        relativePosixPath: 'client/src/__tests__/a.test.ts',
        assertionResults: [
          assertion('logs out | twice', 'passed', [
            'AssertionError: expected 1 to be 2\n    at a.test.ts:3',
          ]),
          assertion('steady', 'passed'),
          assertion('broken', 'failed', ['Error: first', 'Error: second']),
        ],
      },
    ]);

    expect(status).toBe(0);
    expect(stdout).toContain(
      '::warning title=Passed only on retry::client/src/__tests__/a.test.ts › logs out | twice',
    );
    expect(stdout).toContain(
      '| `client/src/__tests__/a.test.ts` | logs out \\| twice | AssertionError: expected 1 to be 2 |',
    );
    expect(stdout).not.toContain('steady');
    expect(stdout).not.toContain('broken');
  });

  it('names the file by its absolute path when the report was never relativized', () => {
    const { stdout } = runReporter([
      {
        name: '/runner/work/client/src/__tests__/b.test.ts',
        assertionResults: [assertion('times out', 'passed', ['Error: Test timed out in 20000ms.'])],
      },
    ]);

    expect(stdout).toContain('| `/runner/work/client/src/__tests__/b.test.ts` | times out |');
  });

  it('prints nothing when no test needed a retry', () => {
    const { status, stdout } = runReporter([
      {
        relativePosixPath: 'client/src/__tests__/a.test.ts',
        assertionResults: [assertion('steady', 'passed')],
      },
    ]);

    expect(status).toBe(0);
    expect(stdout).toBe('');
  });

  it('prints nothing and succeeds when the test run wrote no report', () => {
    const { status, stdout } = runReporter(undefined);

    expect(status).toBe(0);
    expect(stdout).toBe('');
  });

  it('escapes a percent sign in the warning, which GitHub would read as an escape', () => {
    const { stdout } = runReporter([
      {
        relativePosixPath: 'client/src/__tests__/a.test.ts',
        assertionResults: [assertion('reaches 100%', 'passed', ['Error: no'])],
      },
    ]);

    expect(stdout).toContain('› reaches 100%25\n');
  });

  it('warns and succeeds when the report is not JSON, so a passing leg stays green', () => {
    const { status, stdout } = runReporterOn('{ not json');

    expect(status).toBe(0);
    expect(stdout).toContain('::warning title=Retry report unreadable::');
  });

  // The report relies on Vitest keeping a failed attempt's error on a test that then
  // passed. Running the installed Vitest on a test that fails once catches an upgrade
  // that stops doing so, which would hide every forgiven flake.
  it('finds a test that real Vitest retried after it failed once', () => {
    withTemporaryFolderDo((dir) => {
      fs.writeFileSync(
        path.join(dir, 'vitest.config.mjs'),
        "export default { test: { globals: true, include: ['*.test.mjs'], retry: 1 } };\n",
      );
      fs.writeFileSync(
        path.join(dir, 'flaky.test.mjs'),
        "let attempts = 0;\nit('fails once', () => { attempts += 1; expect(attempts).toBe(2); });\n",
      );
      const reportPath = path.join(dir, 'report.json');
      const vitest = spawnSync(
        process.execPath,
        [VITEST_CLI, 'run', '--root', dir, '--reporter=json', `--outputFile=${reportPath}`],
        { encoding: 'utf8', cwd: dir },
      );
      expect(vitest.status, vitest.stderr).toBe(0);

      const result = spawnSync(process.execPath, [SCRIPT, reportPath], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_STEP_SUMMARY: undefined },
      });

      expect(result.stdout).toContain('::warning title=Passed only on retry::');
      expect(result.stdout).toContain('fails once');
    });
  });
});
