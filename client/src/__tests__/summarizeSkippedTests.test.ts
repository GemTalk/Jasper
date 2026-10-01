import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withTemporaryFolderDo } from './support/file';

// Tests for scripts/summarize-skipped-tests.mjs — the aggregator that intersects the
// per-matrix-leg Vitest JSON reports to find tests skipped in every suite run. It is
// report-only and never fails the build, so a defect in it is silent by construction:
// it keeps printing a plausible-looking summary while the numbers underneath it are
// wrong. That makes the intersection itself worth pinning down — it is the one claim
// the report makes, and nothing else exercises it.
//
// Black-box tests, following lintSupplyChain.test.ts: each case writes throwaway JSON
// reports into a temp dir and runs the real script against it as a subprocess. That is
// where the script's contract lives — it has no exports, takes a directory argument,
// and communicates through exit status plus the Markdown it emits. GITHUB_STEP_SUMMARY
// is left unset in the child env so that Markdown lands on stdout.
//
// __dirname is client/src/__tests__, so the repo root is three levels up.
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'summarize-skipped-tests.mjs');

// One entry of a Vitest JSON report's testResults[]. `relativePosixPath` is added by
// relativize-skip-report.mjs on the producing runner, and health-check.yml only runs
// the aggregation when every leg succeeded — so every report reaching the script has
// been through that step.
interface ReportFile {
  relativePosixPath: string;
  assertionResults: { fullName: string; status: string }[];
}

// Runs the summarizer over a directory holding one numbered .json report per element.
function runSummarizer(reports: ReportFile[][]) {
  return withTemporaryFolderDo((dir) => {
    reports.forEach((testResults, index) => {
      fs.writeFileSync(path.join(dir, `report-${index}.json`), JSON.stringify({ testResults }));
    });

    const result = spawnSync(process.execPath, [SCRIPT, dir], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: undefined },
    });

    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  });
}

function file(relativePosixPath: string, assertions: [string, string][]): ReportFile {
  return {
    relativePosixPath,
    assertionResults: assertions.map(([fullName, status]) => ({ fullName, status })),
  };
}

describe('summarize-skipped-tests.mjs', () => {
  it('reports a test skipped in every report and not one skipped in only some', () => {
    const { status, stdout } = runSummarizer([
      [
        file('client/src/__tests__/a.test.ts', [
          ['always skipped', 'skipped'],
          ['sometimes skipped', 'skipped'],
        ]),
      ],
      [
        file('client/src/__tests__/a.test.ts', [
          ['always skipped', 'todo'],
          ['sometimes skipped', 'passed'],
        ]),
      ],
    ]);

    expect(status).toBe(0);
    expect(stdout).toContain('**1 test skipped in every suite run (never executed anywhere).**');
    expect(stdout).toContain('| always skipped | client/src/__tests__/a.test.ts |');
    expect(stdout).not.toContain('| sometimes skipped |');
    expect(stdout).toContain('2 distinct tests across suite runs; 2 skipped in at least one.');
  });
});
