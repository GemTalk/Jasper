#!/usr/bin/env node
// Generates ROADMAP.md from the repository's `roadmap`-labeled tracker issues,
// so the tracker issues are the single source of truth and the document never
// drifts from them. Run by .github/workflows/roadmap.yml on tracker changes,
// or by hand: `node scripts/generate-roadmap.mjs`.
//
// Each tracker issue contributes:
//   - its section: from a component label (`ide` / `sysadmin` / `package-management`),
//   - its subsection: from a stage label (`now` / `next` / `later`),
//   - its theme name: the issue title minus the "Roadmap theme: " prefix,
//   - its one-line description: the line after the `<!-- roadmap-summary -->`
//     marker in the issue body,
//   - its tier: parsed from the `**Tier:** Essential|Expected|Differentiating`
//     header in the issue body (omitted from the entry when unparseable),
//   - its progress: the linked milestone's closed/total issue counts.
//
// Closed trackers (except those closed as not-planned) move to "Recently
// shipped". Structural problems (a tracker missing its stage label, component
// label, or summary marker; two trackers claiming the same milestone) are
// reported on stderr and exit nonzero WITHOUT writing the file, so the
// workflow never commits a roadmap with silently missing entries.
//
// Uses only Node built-ins (global fetch); GITHUB_TOKEN is optional and used
// for authentication when present (required in CI, avoids rate limits locally).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = process.env.GITHUB_REPOSITORY ?? 'GemTalk/Jasper';
const OUTPUT_PATH = fileURLToPath(new URL('../ROADMAP.md', import.meta.url));

const COMPONENTS = [
  { label: 'ide', heading: 'IDE' },
  { label: 'sysadmin', heading: 'System Administration' },
  { label: 'package-management', heading: 'Project & Package Management' },
];

const STAGES = [
  { label: 'now', heading: 'Now' },
  { label: 'next', heading: 'Next' },
  { label: 'later', heading: 'Later' },
];

const SUMMARY_MARKER = '<!-- roadmap-summary -->';
const TITLE_PREFIX = /^Roadmap theme:\s*/;
const TIER_RE = /\*\*Tier:\*\*\s*(Essential|Expected|Differentiating)\b/;

/** Fetch every issue (open and closed) carrying the `roadmap` label. */
async function fetchRoadmapIssues() {
  const issues = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${REPO}/issues?labels=roadmap&state=all&per_page=100&page=${page}`;
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'jasper-roadmap-generator',
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
    }
    const batch = await response.json();
    // The issues endpoint also returns pull requests; trackers are issues only.
    issues.push(...batch.filter((issue) => !issue.pull_request));
    if (batch.length < 100) {
      return issues;
    }
  }
}

/** The line following the last summary marker in the body, or undefined. */
function parseSummary(body) {
  const lines = (body ?? '').replaceAll('\r\n', '\n').split('\n');
  const markerIndex = lines.findLastIndex((line) => line.trim() === SUMMARY_MARKER);
  if (markerIndex === -1 || markerIndex + 1 >= lines.length) {
    return undefined;
  }
  const summary = lines[markerIndex + 1].trim();
  return summary === '' ? undefined : summary;
}

function parseTracker(issue) {
  const labels = new Set(issue.labels.map((label) => label.name));
  return {
    number: issue.number,
    url: issue.html_url,
    theme: issue.title.replace(TITLE_PREFIX, ''),
    state: issue.state,
    stateReason: issue.state_reason,
    closedAt: issue.closed_at,
    component: COMPONENTS.find((c) => labels.has(c.label)),
    stage: STAGES.find((s) => labels.has(s.label)),
    summary: parseSummary(issue.body),
    tier: (issue.body ?? '').match(TIER_RE)?.[1],
    milestone: issue.milestone,
  };
}

/** `- **[Theme](url)** — summary *Tier.* (n of m issues done)` */
function renderEntry(tracker, { withProgress = true } = {}) {
  let entry = `- **[${tracker.theme}](${tracker.url})** — ${tracker.summary}`;
  if (tracker.tier) {
    entry += ` *${tracker.tier}.*`;
  }
  if (withProgress && tracker.milestone) {
    const total = tracker.milestone.open_issues + tracker.milestone.closed_issues;
    // Only worth showing once the milestone holds more than the tracker itself.
    if (total > 1) {
      entry += ` (${tracker.milestone.closed_issues} of ${total} issues done)`;
    }
  }
  return entry;
}

function render(trackers) {
  const open = trackers.filter((tracker) => tracker.state === 'open');
  const shipped = trackers
    .filter((tracker) => tracker.state === 'closed' && tracker.stateReason !== 'not_planned')
    .sort(
      (a, b) =>
        Date.parse(b.closedAt) - Date.parse(a.closedAt) ||
        (a.milestone?.number ?? Infinity) - (b.milestone?.number ?? Infinity) ||
        a.number - b.number,
    );

  const parts = [
    `# Jasper Roadmap

<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  This document is produced by scripts/generate-roadmap.mjs from the
  roadmap tracker issues, and regenerated automatically by the
  .github/workflows/roadmap.yml workflow whenever a tracker changes.
  To change an entry, edit its tracker issue (stage label, summary
  marker line, milestone) and this file will follow.
-->

> **This file is generated from the roadmap tracker issues — do not edit it by hand; edit the issues.** It is built by [\`scripts/generate-roadmap.mjs\`](scripts/generate-roadmap.mjs), rerun automatically by the [\`roadmap\` workflow](.github/workflows/roadmap.yml) whenever a tracker issue changes. Each entry's stage comes from its tracker's \`now\` / \`next\` / \`later\` label, its section from the component label, and its one-line description from the line after the \`${SUMMARY_MARKER}\` marker in the tracker body.

This is the public roadmap for Jasper, organized by component (IDE · System Administration · Project & Package Management) and by priority within each component:

- **Now** — actively being worked.
- **Next** — queued behind Now.
- **Later** — intended, but unscheduled.

There are **no dates** — order is priority, and Jasper's near-weekly release cadence carries the schedule. Each entry names a **theme** (the unit of communication), links its **tracking issue** (the unit of work — with a checklist of concrete sub-items and links to related issues), states the user-visible outcome, and notes the tier of gap it closes (**Essential** / **Expected** / **Differentiating**). Discussion belongs on the linked issues; corrections and reprioritizations are welcome there too — this document follows the tracker issues, so propose changes on them rather than as edits to this file. Each theme also has a matching [milestone](https://github.com/${REPO}/milestones) for tracking execution.`,
  ];

  for (const component of COMPONENTS) {
    parts.push(`## ${component.heading}`);
    for (const stage of STAGES) {
      const entries = open
        .filter((tracker) => tracker.component === component && tracker.stage === stage)
        .sort(
          (a, b) =>
            (a.milestone?.number ?? Infinity) - (b.milestone?.number ?? Infinity) ||
            a.number - b.number,
        );
      if (entries.length === 0) {
        console.error(`note: ${component.heading} has no "${stage.heading}" entries; omitting`);
        continue;
      }
      parts.push(`### ${stage.heading}`, entries.map((entry) => renderEntry(entry)).join('\n'));
    }
  }

  parts.push(
    `## Cross-cutting

As each theme ships, its operations should also land on the **MCP/AI surface** (session-admin tools, Rowan-audit tools, …) — AI-first GemStone workflows ([#229](https://github.com/${REPO}/issues/229)) are Jasper's ongoing differentiator.`,
    `## Recently shipped

See [CHANGELOG.md](CHANGELOG.md) — Jasper releases near-weekly. Highlights land there first; when a roadmap theme above ships, it moves into this section with a link to its CHANGELOG entry.`,
  );

  if (shipped.length > 0) {
    parts.push(
      shipped
        .map(
          (tracker) =>
            `${renderEntry(tracker, { withProgress: false })} *Shipped ${tracker.closedAt.slice(0, 10)} — see [CHANGELOG.md](CHANGELOG.md).*`,
        )
        .join('\n'),
    );
  }

  return parts.join('\n\n') + '\n';
}

function findStructuralProblems(trackers) {
  const problems = [];
  for (const tracker of trackers) {
    const id = `#${tracker.number} (${tracker.theme})`;
    if (tracker.state === 'open') {
      if (!tracker.stage) {
        problems.push(`${id} has no stage label (expected one of: now, next, later)`);
      }
      if (!tracker.component) {
        problems.push(
          `${id} has no component label (expected one of: ide, sysadmin, package-management)`,
        );
      }
    }
    if (tracker.stateReason !== 'not_planned' && !tracker.summary) {
      problems.push(`${id} has no "${SUMMARY_MARKER}" summary line in its body`);
    }
  }
  const byMilestone = new Map();
  for (const tracker of trackers) {
    if (!tracker.milestone) {
      continue;
    }
    const claimant = byMilestone.get(tracker.milestone.number);
    if (claimant) {
      problems.push(
        `#${tracker.number} and #${claimant.number} both claim milestone ` +
          `${tracker.milestone.number} ("${tracker.milestone.title}")`,
      );
    } else {
      byMilestone.set(tracker.milestone.number, tracker);
    }
  }
  return problems;
}

const trackers = (await fetchRoadmapIssues()).map(parseTracker);
if (trackers.length === 0) {
  console.error('error: no issues with the "roadmap" label were found — refusing to write');
  process.exit(1);
}

const problems = findStructuralProblems(trackers);
if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`error: ${problem}`);
  }
  console.error('Structural problems found — ROADMAP.md was NOT regenerated.');
  process.exit(1);
}

for (const tracker of trackers) {
  if (tracker.state === 'open' && !tracker.tier) {
    console.error(`note: #${tracker.number} has no parseable tier header; omitting its tier`);
  }
}

const output = render(trackers);
let previous;
try {
  previous = readFileSync(OUTPUT_PATH, 'utf8');
} catch {
  // First generation: no existing file to compare against.
}
if (previous === output) {
  console.log(`ROADMAP.md is up to date (${trackers.length} trackers).`);
} else {
  writeFileSync(OUTPUT_PATH, output);
  console.log(`Wrote ROADMAP.md (${trackers.length} trackers).`);
}
