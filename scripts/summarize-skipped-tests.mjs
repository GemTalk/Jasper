#!/usr/bin/env node
//
// Aggregates the per-suite-run Vitest JSON reports produced by health-check.yml's
// matrix (client/vitest.config.ts, gated by VITEST_JSON_OUTPUT) to find tests
// that are skipped/pending/todo in EVERY suite run they appear in — i.e. never
// actually executed anywhere. Report-only: this never fails the build. A
// future gate can reuse the same intersection and flip the exit condition.
//
//   node scripts/summarize-skipped-tests.mjs <dir-of-json-reports>
//
// Writes Markdown to $GITHUB_STEP_SUMMARY (falls back to stdout when unset,
// for local runs). When any test is never executed, it also prints a
// `::warning` workflow command: the job summary sits below every leg's test
// report, while warnings show near the top of the run page and in a PR's Checks.

import { readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const SKIPPED_STATUSES = new Set(['skipped', 'pending', 'todo']);

function findReportFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(dir, name));
}

function collectTestStats(reportFiles) {
  const stats = new Map();

  for (const reportFile of reportFiles) {
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));

    for (const testResult of report.testResults ?? []) {
      // relativePosixPath (added by relativize-skip-report.mjs, right after
      // `vitest run`) is repo-relative and OS-independent, so the same test
      // collapses onto one key regardless of which health-check matrix leg
      // produced the report.
      for (const assertion of testResult.assertionResults ?? []) {
        const key = `${testResult.relativePosixPath} ${assertion.fullName}`;
        const entry = stats.get(key) ?? {
          file: testResult.relativePosixPath,
          fullName: assertion.fullName,
          seen: 0,
          skipped: 0,
        };
        entry.seen += 1;
        if (SKIPPED_STATUSES.has(assertion.status)) {
          entry.skipped += 1;
        }
        stats.set(key, entry);
      }
    }
  }

  return stats;
}

function findAlwaysSkipped(entries) {
  return entries
    .filter((entry) => entry.seen > 0 && entry.skipped === entry.seen)
    .sort((a, b) => a.file.localeCompare(b.file) || a.fullName.localeCompare(b.fullName));
}

function renderSummary(entries, alwaysSkipped) {
  const skippedSomewhere = entries.filter((entry) => entry.skipped > 0);

  const lines = ['## Skipped tests report', ''];

  if (alwaysSkipped.length === 0) {
    lines.push('✅ No test is skipped in every suite run.', '');
  } else {
    lines.push(
      `⚠️ **${alwaysSkipped.length} test${alwaysSkipped.length === 1 ? '' : 's'} skipped in every suite run (never executed anywhere).**`,
      '',
      '| Test | File |',
      '| --- | --- |',
    );
    for (const entry of alwaysSkipped) {
      // An unescaped `|` would split the row; a bare path renders `__tests__` as bold.
      lines.push(`| ${entry.fullName.replaceAll('|', '\\|')} | \`${entry.file}\` |`);
    }
    lines.push('');
  }

  lines.push(
    `<sub>${entries.length} distinct tests across suite runs; ${skippedSomewhere.length} skipped in at least one.</sub>`,
    '',
  );
  return lines.join('\n');
}

// GitHub shows the title in bold, so the count goes there. A warning is plain text
// and no URL reaches one job's summary, so the message names the section.
function renderNeverRunWarning(count) {
  const tests = count === 1 ? '1 test' : `${count} tests`;
  return `::warning title=${tests} never run on any leg::See "Skipped tests report summary" at the bottom of this run's Summary page.`;
}

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node summarize-skipped-tests.mjs <dir-of-json-reports>');
    process.exit(0);
    return;
  }

  const reportFiles = findReportFiles(dir);
  const entries = [...collectTestStats(reportFiles).values()];
  const alwaysSkipped = findAlwaysSkipped(entries);
  const summary = renderSummary(entries, alwaysSkipped);

  if (alwaysSkipped.length > 0) {
    console.log(renderNeverRunWarning(alwaysSkipped.length));
  }

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(summaryFile, summary);
  } else {
    console.log(summary);
  }

  process.exit(0);
}

main();
