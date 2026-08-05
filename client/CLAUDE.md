# client workspace

## Running tests

Run a single test file: `cd client && npx vitest run <path/to/file.test.ts>`.

## Conventions (non-standard — read before editing these areas)

- **Queries** are pure functions `(execute: QueryExecutor, ...args) => string` that build a Smalltalk snippet and call `execute(code)`. `QueryExecutor` is `(code: string) => string`, supplied by the caller, so the same query runs in the extension (executor wraps the GCI bridge) and in the MCP server (its own session). Shared helpers (`escapeString`, `classLookupExpr`, …) live in `queries/util.ts`. A query builder used by a single feature belongs in that feature's own `queries/` folder; only shared ones go in `client/src/queries/`.
- **Feature folders** hold a feature's modules, its webview scripts, its `queries/`, and its tests in a co-located `__tests__/`. Prefer one over adding more files to the flat top level; consumers deep-import (there are no `index.ts` barrels).
- **Webview scripts** are plain JS that runs in the webview DOM, **not** compiled into the extension bundle. They are read from disk at runtime and injected as `<script>` tags, and live in separate files so they can be unit-tested in jsdom. Follow this pattern for new webview behavior. Two things each one needs: read it with `readWebviewScript` (`webviewAssets.ts`) — a script in a feature folder has to resolve against both the source and the bundled `client/out` layout, which no single naive path does; and whitelist it with a `!` line in `.vscodeignore`, or it silently vanishes from the packaged `.vsix` and breaks activation. The `!`-prefixed `client/src` `.js` lines there are the authoritative list of runtime-read scripts.

## Architecture

`extension.ts` registers every command, tree view, and language feature, starts the LSP client and MCP socket server, and manages sessions — which also makes it the index: grep a command id there to reach the module that owns it. Module names under `client/src` are descriptive of their subsystem (browsers, panels, sessions, sync, WSL support, …). The two that aren't self-evident: `gciLibrary.ts` is the GCI bridge, the only module that talks to the native library, and `transcriptSink.ts` is the server-side Transcript with live streaming.

<!-- Maintainer note (stripped from agent context): this file deliberately names files only where the name is an API you must call, or where the file is not findable from its own name. Everything else is discoverable (extension.ts registrations, .vscodeignore whitelist, folder layout) — don't re-expand it into a subsystem file list; that list rots on every rename. This map is intentionally lean. Deeper per-subsystem detail lives in .claude/rules/ (GCI, tests, client tests); all auto-load by path when relevant files are opened. Don't re-expand the map above. -->
