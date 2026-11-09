#!/usr/bin/env node
//
// ci-complete's verdict over the jobs it waits on. Exits 0 when the run may
// count as green, 1 otherwise.
//
//   NEEDS_JSON='${{ toJSON(needs) }}' node scripts/verify-ci-complete.mjs
//
// Reads every job from `needs`, so a job added to ci-complete's needs is
// checked without touching this script. prepare must have passed. Every other
// job must have passed, or, when prepare found that a PR run already passed
// this tree (outputs.already-tested), have been skipped. A job that ran
// anyway and failed always fails the run.

import { appendFileSync } from 'node:fs';

function verdict(needs) {
  const prepare = needs.prepare;
  const alreadyTested = prepare?.outputs?.['already-tested'] === 'true';
  const acceptable = (name, result) =>
    result === 'success' || (name !== 'prepare' && alreadyTested && result === 'skipped');

  const failed = Object.entries(needs).filter(([name, job]) => !acceptable(name, job.result));
  return { ok: prepare !== undefined && failed.length === 0, alreadyTested, failed };
}

function main() {
  let needs;
  try {
    needs = JSON.parse(process.env.NEEDS_JSON ?? '');
  } catch {
    console.log('NEEDS_JSON is missing or not JSON, so the run cannot count as green.');
    process.exit(1);
  }

  const { ok, alreadyTested, failed } = verdict(needs);
  for (const [name, job] of Object.entries(needs)) {
    console.log(`${name}=${job.result}`);
  }
  if (!ok) {
    if (needs.prepare === undefined) {
      console.log('prepare is not among the jobs ci-complete waits on.');
    }
    for (const [name, job] of failed) {
      console.log(`Not green: ${name} (${job.result})`);
    }
    process.exit(1);
  }
  if (alreadyTested) {
    const message = `A PR run already passed tree ${needs.prepare.outputs.tree}, so this merge-queue run skipped the tests.`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `**Passed without running the tests.** ${message}\n`,
      );
    }
  }
}

main();
