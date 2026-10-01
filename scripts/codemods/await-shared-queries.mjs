#!/usr/bin/env node
//
// Codemod behind "Make every shared query awaitable".
//
// Makes QueryExecutor answer a promise, moves the client's executors onto
// the async fetchString seam, makes the MCP server's executor async, and
// lets asyncPropagation.mjs carry the promises outwards from there.
// Production code only; the test updates in the same commit are
// hand-written.
//
// It exists so a reviewer can confirm the commit's production changes are
// exactly this rewrite. From the commit that adds it:
//
//   git checkout HEAD~1 -- client mcp-server
//   node scripts/codemods/await-shared-queries.mjs
//   git diff HEAD -- client mcp-server ':!**/__tests__/**'   # expect no output
//   git checkout HEAD -- client mcp-server
//
// Usage: node scripts/codemods/await-shared-queries.mjs

import { runCodemod } from './asyncPropagation.mjs';

const QUERY_EXECUTOR = ['client/src/queries/types.ts', 'QueryExecutor'];

// The client functions that build an executor on a direct
// `session.gci.executeAndFetchString(session.handle, …)`.
const CLIENT_EXECUTORS = [
  ['client/src/browserQueries.ts', 'executeFetchString'],
  ['client/src/sessionManager.ts', 'refreshTransactionState'],
  ['client/src/sessionManager.ts', 'armGemAutoServiceSigAbort'],
  ['client/src/sessionManager.ts', 'setTransactionMode'],
];

runCodemod({
  'client/tsconfig.json': (codemod) => {
    codemod.retypeAlias(...QUERY_EXECUTOR);
    for (const [file, name] of CLIENT_EXECUTORS) codemod.moveFetchesOntoSeam(file, name);
  },
  'mcp-server/tsconfig.json': (codemod) => {
    codemod.retypeAlias(...QUERY_EXECUTOR);
    codemod.makeFunctionAsync('mcp-server/src/mcpSession.ts', 'executeFetchString');
  },
});
