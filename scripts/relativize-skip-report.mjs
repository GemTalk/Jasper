#!/usr/bin/env node
//
// Adds a relativePosixPath field to each testResult in a Vitest JSON report,
// in place, alongside its existing (untouched) absolute-path name. Vitest's
// JSON reporter always writes the producing runner's absolute path verbatim
// (no config option to change that — see summarize-skipped-tests.mjs's
// aggregation, which relies on these paths being comparable across the
// health-check matrix's Linux and Windows legs). This runs immediately after
// `vitest run`, on the same OS and checkout that produced the report, where
// the real repo root and path separator are known outright rather than
// needing to be guessed later during aggregation.
//
//   node scripts/relativize-skip-report.mjs <path-to-json-report> <repo-root>

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { posix, relative, sep } from 'node:path';

function main() {
  const [reportPath, repoRoot] = process.argv.slice(2);
  if (!reportPath || !repoRoot) {
    console.error('Usage: node relativize-skip-report.mjs <path-to-json-report> <repo-root>');
    process.exit(1);
  }

  // The test step may have failed before vitest wrote a report at all.
  if (!existsSync(reportPath)) {
    process.exit(0);
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));

  for (const testResult of report.testResults ?? []) {
    testResult.relativePosixPath = relative(repoRoot, testResult.name).split(sep).join(posix.sep);
  }

  writeFileSync(reportPath, JSON.stringify(report));
  process.exit(0);
}

main();
