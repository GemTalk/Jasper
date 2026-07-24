# client workspace

## Running tests

Run a single test file: `cd client && npx vitest run src/__tests__/extension.test.ts`.

## Conventions (non-standard — read before editing these areas)

- **Queries** (`client/src/queries/`) are pure functions `(execute: QueryExecutor, ...args) => string` that build a Smalltalk snippet and call `execute(code)`. `QueryExecutor` is `(code: string) => string`, supplied by the caller, so the same query runs in the extension (executor wraps `gciLibrary`) and in the MCP server (its own session). Shared helpers live in `util.ts` (`escapeString`, `classLookupExpr`, …).
- **Webview scripts** (`debuggerView.js`, `listFilter.js`, `methodListView.js`, `enhancedInspectorColumns.js`) are plain JS that runs in the webview DOM, **not** compiled into the extension bundle. They are read at runtime via `fs.readFileSync` and injected as `<script>` tags, and live in separate files so they can be unit-tested in jsdom. Follow this pattern for new webview behavior.

## Architecture

`client/src/extension.ts` registers all commands, tree views, and language features, starts the LSP client and MCP socket server, and manages sessions. Major client subsystems: GCI bridge (`gciLibrary.ts`), views (`systemBrowser.ts`, `globalsBrowser.ts`, `enhancedInspector.ts`, `debuggerPanel.ts`, `classBrowser.ts`), class sync (`sync/`), sessions (`sessionManager.ts`, `codeExecutor.ts`), Transcript sink (`transcriptSink.ts` — server-side Transcript with live streaming), infrastructure (`versionManager.ts`, `databaseManager.ts`, `processManager.ts`, `sysadminStorage.ts`), virtual FS (`gemstoneFileSystemProvider.ts`), debugger (`gemstoneDebugSession.ts`, `debugQueries.ts`), WSL support (`wslBridge.ts`, `wslFs.ts`).

<!-- Maintainer note (stripped from agent context): this map is intentionally lean. Deeper per-subsystem detail lives in .claude/rules/ (GCI, tests, client tests); all auto-load by path when relevant files are opened. Don't re-expand the map above. -->