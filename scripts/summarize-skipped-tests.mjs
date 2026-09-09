#!/usr/bin/env node
//
// Aggregates the per-suite-run Vitest JSON reports produced by health-check.yml's
// matrix (client/vitest.config.ts, gated by VITEST_JSON_OUTPUT) to find tests
// that are skipped/pending/todo in EVERY suite run they appear in — i.e. never
// actually executed anywhere. Report-only: this never fails the build — and
// that holds for degraded input too. When the matrix is cancelled (fail-fast
// after one leg fails), the legs that were killed upload no report, or upload
// one that `vitest run` never finished and relativize-skip-report.mjs never
// annotated. This script reports on whatever it did get and says so, rather
// than crashing and adding a second red check unrelated to the real failure.
// A future gate can reuse the same intersection and flip the exit condition.
//
//   node scripts/summarize-skipped-tests.mjs <dir-of-json-reports>
//
// Writes Markdown to $GITHUB_STEP_SUMMARY (falls back to stdout when unset,
// for local runs).

import { readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const SKIPPED_STATUSES = new Set(['skipped', 'pending', 'todo']);

// A cancelled matrix can leave nothing to download, in which case
// download-artifact never creates the directory at all.
function findReportFiles(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => name.endsWith('.json')).map((name) => join(dir, name));
}

const UNKNOWN_FILE = '(unknown file)';
const UNNAMED_TEST = '(unnamed test)';

function collectTestStats(reportFiles) {
  const stats = new Map();
  const unreadable = [];

  for (const reportFile of reportFiles) {
    let report;
    try {
      report = JSON.parse(readFileSync(reportFile, 'utf8'));
    } catch {
      // A report from a leg killed mid-run can be truncated, or absent past
      // the point the artifact upload captured.
      unreadable.push(basename(reportFile));
      continue;
    }

    for (const testResult of report.testResults ?? []) {
      // relativePosixPath (added by relativize-skip-report.mjs, right after
      // `vitest run`) is repo-relative and OS-independent, so the same test
      // collapses onto one key regardless of which health-check matrix leg
      // produced the report. A cancelled leg's report never reaches that
      // step, so fall back to the absolute path vitest wrote: it won't
      // collapse with the same test from another leg, but it still names the
      // file instead of crashing the sort below on undefined.
      const file = testResult.relativePosixPath ?? testResult.name ?? UNKNOWN_FILE;
      for (const assertion of testResult.assertionResults ?? []) {
        const fullName = assertion.fullName ?? assertion.title ?? UNNAMED_TEST;
        const key = `${file} ${fullName}`;
        const entry = stats.get(key) ?? {
          file,
          fullName,
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

  return { stats, unreadable };
}

function renderSummary(stats, { reportFileCount, unreadable }) {
  const entries = [...stats.values()];
  const alwaysSkipped = entries
    .filter((entry) => entry.seen > 0 && entry.skipped === entry.seen)
    .sort((a, b) => a.file.localeCompare(b.file) || a.fullName.localeCompare(b.fullName));
  const skippedSomewhere = entries.filter((entry) => entry.skipped > 0);

  const lines = ['## Skipped tests report', ''];

  // Nothing downloaded at all: a ✅ here would read as "no test is skipped",
  // which is not what an empty input says.
  if (reportFileCount === 0) {
    lines.push(
      '⚠️ No suite-run reports were available — the matrix probably did not finish. Nothing to report on.',
      '',
    );
    return lines.join('\n');
  }

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
      lines.push(`| ${entry.fullName} | ${entry.file} |`);
    }
    lines.push('');
  }

  lines.push(
    `<sub>${entries.length} distinct tests across suite runs; ${skippedSomewhere.length} skipped in at least one.</sub>`,
    '',
  );

  // Say when the input was partial, so a green report on two of eight legs
  // isn't read as "nothing is skipped anywhere".
  if (unreadable.length > 0) {
    lines.push(
      `<sub>⚠️ ${unreadable.length} of ${reportFileCount} report${reportFileCount === 1 ? '' : 's'} could not be read and were left out: ${unreadable.join(', ')}.</sub>`,
      '',
    );
  }

  return lines.join('\n');
}

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node summarize-skipped-tests.mjs <dir-of-json-reports>');
    return;
  }

  const reportFiles = findReportFiles(dir);
  const { stats, unreadable } = collectTestStats(reportFiles);
  const summary = renderSummary(stats, { reportFileCount: reportFiles.length, unreadable });

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(summaryFile, summary);
  } else {
    console.log(summary);
  }
}

// Report-only, as the header says: nothing this script can hit is worth a red
// check on top of whatever actually failed.
try {
  main();
} catch (error) {
  console.error(`Skipped-tests summary unavailable: ${error?.stack ?? error}`);
}
process.exit(0);
