#!/usr/bin/env node
//
// Lists the tests in one Vitest JSON report that failed and then passed on
// their retry: flakes the merge queue forgave. Each one gets a warning
// annotation on the run page and a row in the job summary, so a retry never
// hides a flake. Report-only: never fails the build.
//
// A test that passed on retry has status "passed" and a non-empty
// failureMessages, because Vitest keeps the errors of failed attempts.
//
//   node scripts/report-retried-tests.mjs <path-to-json-report>
//
// Writes Markdown to $GITHUB_STEP_SUMMARY (falls back to stdout when unset,
// for local runs).

import { appendFileSync, existsSync, readFileSync } from 'node:fs';

function findRetriedTests(report) {
  const retried = [];
  for (const testResult of report.testResults ?? []) {
    // relativePosixPath is missing when the test step failed, because
    // relativize-skip-report.mjs only runs after a passing one.
    const file = testResult.relativePosixPath ?? testResult.name;
    for (const assertion of testResult.assertionResults ?? []) {
      if (assertion.status === 'passed' && assertion.failureMessages?.length > 0) {
        retried.push({
          file,
          fullName: assertion.fullName,
          firstFailure: assertion.failureMessages[0].split('\n')[0],
        });
      }
    }
  }
  return retried;
}

// GitHub reads %, CR and LF in a workflow command's message as escapes.
function escapeAnnotation(text) {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeTableCell(text) {
  return text.replaceAll('|', '\\|');
}

function main() {
  const [reportPath] = process.argv.slice(2);
  if (!reportPath) {
    console.error('Usage: node report-retried-tests.mjs <path-to-json-report>');
    process.exit(1);
  }
  // The test step may have failed before vitest wrote a report at all.
  if (!existsSync(reportPath)) {
    return;
  }

  let retried;
  try {
    retried = findRetriedTests(JSON.parse(readFileSync(reportPath, 'utf8')));
  } catch (error) {
    // A broken report must not fail a leg whose tests passed.
    console.log(`::warning title=Retry report unreadable::${escapeAnnotation(String(error))}`);
    return;
  }
  if (retried.length === 0) {
    return;
  }

  for (const test of retried) {
    console.log(
      `::warning title=Passed only on retry::${escapeAnnotation(`${test.file} › ${test.fullName}`)}`,
    );
  }

  const rows = retried.map(
    (test) =>
      `| \`${test.file}\` | ${escapeTableCell(test.fullName)} | ${escapeTableCell(test.firstFailure)} |`,
  );
  const markdown = [
    '### Tests that passed only on retry',
    '',
    'Each of these failed once and passed when run again. They are flaky: they did not block the merge, but they still need fixing.',
    '',
    '| File | Test | First failure |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n');

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, `${markdown}\n`);
  } else {
    console.log(markdown);
  }
}

main();
