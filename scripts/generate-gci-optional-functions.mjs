#!/usr/bin/env node
//
// Writes client/src/gciLibrary/optionalFunctions.generated.ts from the vendored
// GCI headers, so the version- and platform-gated half of the optional-functions
// registry is derived rather than transcribed. Run it after vendoring a header
// revision:
//
//   npm run generate:gci-optional-functions
//
// which also Prettier-formats the result. CI's Lint & Format job reruns that
// script and fails on any diff, so the committed file cannot drift from
// vendor/gci-headers/ — and a floor that moves stays visible in the diff.
//
// Only the writing lives here. The derivation and the rendering live in
// client/src/gciLibrary/optionalFunctionsFromHeaders.ts, so vitest can drive
// them against fixture header trees without crossing the workspace root; this
// file is the client/bin/install-server-plugin.mjs → *Main.ts pattern again.
// It must stay .mjs: a scripts/*.ts would match eslint.config.mjs's
// `files: ['**/*.ts']` with no owning tsconfig and error out.
//
// Runs only under `tsx` — plain `node` cannot resolve the `.ts` import below.
//
// The derivation throws rather than guessing when the headers say something the
// registry schema cannot express. Following scripts/generate-roadmap.mjs, that
// is reported on stderr and exits nonzero WITHOUT writing, so a half-derived
// registry is never left behind for someone to commit.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  deriveOptionalFunctions,
  renderOptionalFunctionsModule,
} from '../client/src/gciLibrary/optionalFunctionsFromHeaders.ts';

const OUTPUT_PATH = fileURLToPath(
  new URL('../client/src/gciLibrary/optionalFunctions.generated.ts', import.meta.url),
);

let entries;
let revisions;
try {
  ({ entries, revisions } = deriveOptionalFunctions());
} catch (error) {
  console.error(`error: ${error.message}`);
  console.error('optionalFunctions.generated.ts was NOT regenerated.');
  process.exit(1);
}

const output = renderOptionalFunctionsModule(entries, revisions);
let previous;
try {
  previous = readFileSync(OUTPUT_PATH, 'utf8');
} catch {
  // First generation: no existing file to compare against.
}

const summary = `${entries.length} optional function(s) from ${revisions.length} vendored revision(s)`;
if (previous === output) {
  console.log(`optionalFunctions.generated.ts is up to date (${summary}).`);
} else {
  writeFileSync(OUTPUT_PATH, output);
  console.log(`Wrote optionalFunctions.generated.ts (${summary}).`);
}
