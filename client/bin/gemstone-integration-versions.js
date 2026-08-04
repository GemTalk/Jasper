#!/usr/bin/env node
//
// Lists the GemStone versions available for integration testing.
//
//   node gemstone-integration-versions.js            → JSON array of all versions, oldest first
//   node gemstone-integration-versions.js --oldest   → oldest non-experimental version string
//
// Versions come from .gemstone-integration-releases.json. Other scripts use
// this to pick which GemStone build to download and run tests against.
//
// A release can be flagged "experimental": true to mark it as below the
// installable minimum (see MINIMUM_SUPPORTED_GEMSTONE_VERSION in
// versionManager.ts) — included in the matrix for coverage, but --oldest
// skips it so the Node-floor smoke test still pairs with the real
// minimum supported version, not an experimental probe.

const fs = require('fs');
const { compareGemStoneVersions } = require('../src/gemStoneVersion.js');

const releasesFileContents = fs.readFileSync(
  `${__dirname}/../.gemstone-integration-releases.json`,
  'utf8',
);
const releasesInAscendingOrder = JSON.parse(releasesFileContents).sort((release, anotherRelease) =>
  compareGemStoneVersions(release.version, anotherRelease.version),
);

if (process.argv.includes('--oldest')) {
  console.log(releasesInAscendingOrder.find((release) => !release.experimental).version);
  return;
}

console.log(JSON.stringify(releasesInAscendingOrder.map((release) => release.version)));
