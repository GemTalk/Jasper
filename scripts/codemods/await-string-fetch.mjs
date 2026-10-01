#!/usr/bin/env node
//
// Codemod behind "Await the debugger and Transcript string fetches".
//
// Moves a fixed set of blocking string fetches onto the async fetchString
// seam and lets asyncPropagation.mjs carry the promises outwards from them.
// Production code only; the test updates in the same commit are
// hand-written.
//
// It exists so a reviewer can confirm the commit's production changes are
// exactly this rewrite. From the commit that adds it:
//
//   git checkout HEAD~1 -- client
//   node scripts/codemods/await-string-fetch.mjs
//   git diff HEAD -- client ':!**/__tests__/**'   # expect no output
//   git checkout HEAD -- client
//
// Usage: node scripts/codemods/await-string-fetch.mjs

import { runCodemod } from './asyncPropagation.mjs';

// The functions whose direct `session.gci.executeAndFetchString(session.handle, …)`
// moves onto the seam. Other direct fetches (browser queries, the login-time
// service callbacks) are left blocking on purpose.
const SEEDS = [
  ['client/src/debugQueries.ts', 'executeAndFetchString'],
  ['client/src/codeExecutor.ts', 'fetchResultString'],
  ['client/src/methodHistory/methodHistoryServer.ts', 'installMethodHistory'],
  ['client/src/transcriptSink.ts', 'installTranscriptSink'],
  ['client/src/transcriptSink.ts', 'runFetchString'],
];

runCodemod({
  'client/tsconfig.json': (codemod) => {
    for (const [file, name] of SEEDS) codemod.moveFetchesOntoSeam(file, name);
  },
});
