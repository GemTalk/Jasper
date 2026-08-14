# The four kinds of tests

Jasper has four test tiers. They differ in what they can prove, what they need to run, and whether CI runs them at all. This page is the shared vocabulary: what each tier is called, what it means, and which one a new test belongs in.

## At a glance

| Tier            | What makes it one                                 | Run with                  | Needs a live stone? | Runs in CI?       |
| --------------- | ------------------------------------------------- | ------------------------- | ------------------- | ----------------- |
| **Unit**        | A Vitest test that needs no stone                 | `npm test`                | No                  | Yes               |
| **Integration** | A client test that calls `useIntegrationTest`     | `npm test`                | **Yes**             | Yes — full matrix |
| **GCI**         | Any test under `client/src/__tests__/gci/`        | `npm run test:gci`        | **Yes**             | **No** — legacy   |
| **Acceptance**  | A `*.spec.ts` under `acceptance/tests/`           | `npm run test:acceptance` | Only some specs     | Not yet           |

`npm test` runs the first two, in all three workspaces. Everything else is opt-in.

## Unit tests

Plain Vitest over `client/`, `server/`, and `mcp-server/`. They exercise TypeScript decisions in isolation: parser and formatter behavior in the LSP server, tree providers and command handlers in the client, tool registration in the MCP server.

They never talk to GemStone. The `vscode` module is supplied by a manual mock (`client/src/__mocks__/vscode.ts`) that Vitest picks up automatically, and query builders are driven by a fake `QueryExecutor` returning canned strings. A unit test that would need a stone is, by definition, an integration test.

This is the default tier: if a behavior can be proven without a stone, prove it here — it's the fastest feedback and the only tier with no external prerequisites.

## Integration tests

A test is an integration test because it calls `useIntegrationTest` — that's the whole definition. Such tests log into a **real GemStone stone** over the real GCI shared library — no mocks anywhere in the GCI path — and assert that our Smalltalk snippets, GCI calls, and refactorings actually do what we think against a live database.

The harness wraps each test in a transaction it always aborts, and arms GemStone's commit guard on every session, so a test cannot leave anything behind. See [integration test isolation](integration-test-isolation.md) for why, and [the harness reference](../reference/integration-test-harness.md) for the contract.

They are part of `npm test`. This is deliberate and has a consequence worth internalizing: **`npm test` fails, rather than skips, when no stone is reachable.** Provision one with `npm run test:server:start`.

CI runs this tier the widest: a matrix over every GemStone release in `client/.gemstone-integration-releases.json`, and within each cell, twice — once against a bare stone, once after installing the Jasper Server Plugin.

The convention is to name the file `*.integration.test.ts` and co-locate it in the `__tests__/` dir next to the code it exercises. Two separate things ride on that, and only one is a convention:

- **The `__tests__/` dir is load-bearing.** The `default` project's glob is `src/**/__tests__/**/*.test.ts`, so a test placed anywhere else under `src/` is never collected — it doesn't fail, it silently never runs.
- **The `.integration.` suffix is the courtesy.** Nothing enforces it; the harness works from any collected file. It makes the tier visible from a directory listing, so follow it — but read the name as a hint, not a guarantee.

Grep for `useIntegrationTest` when you need the real list, and note it over-reports: a handful of files in the CI-excluded `gci/` directory call the harness too, so filter those out.

## GCI tests

The on-demand suite under `client/src/__tests__/gci/`, run with `npm run test:gci`. Historically this was where anything touching a live stone went, before the integration harness existed.

**It is legacy and being retired.** It never runs in CI, so nothing it covers is actually protected on a push. The directory is closed: tests move out of it, not into it. The narrow set of cases that still genuinely belong there is enumerated in `.claude/rules/client/tests.md`.

## Acceptance tests

Playwright driving a **real VS Code window** with the extension loaded, under `acceptance/`. Where the other tiers call our API, these click the UI: the GemStone activity-bar item, the tree views, the command palette. They answer "does the feature work for a user", not "does this function return the right value".

Slow and GUI-bound. macOS cannot run them headless — a local run flashes a window and steals focus — so the container path (`npm run test:acceptance:docker`) is the recommended one. A run also produces a storyboard: the suite rendered as an illustrated manual, screenshots paired with the steps that produced them. See [acceptance/README.md](../../acceptance/README.md).

They are experimental and a work in progress. They are not wired into CI.

## What the tests run inside

The first three tiers run under **plain Node**, driven by Vitest. The extension they test does not: it runs inside **Electron's** Node, in a VS Code extension host, with the real `vscode` API supplied by the editor. That difference is the ceiling on what those tiers can prove.

Three environments, then:

- **Node** — the default for every Vitest test, unit through GCI. The `vscode` module doesn't exist here; a manual mock (`client/src/__mocks__/vscode.ts`) stands in for it. Integration and GCI tests do load the real native GCI library via koffi, so the GemStone side is genuine — but it's Node's process loading it, not Electron's.
- **Node + jsdom** — opted into per file with a `// @vitest-environment jsdom` docblock, for the webview scripts that run in a real DOM in production. jsdom is not a browser and not Electron's renderer; it's a good enough DOM to unit-test script behavior.
- **Electron + real VS Code** — acceptance specs only. The actual editor binary, the actual extension host, the actual `vscode` API.

So a passing unit or integration suite says nothing about whether the extension **activates**, whether a command is registered where VS Code can find it, or whether the native library loads under Electron's ABI. Only the acceptance tier exercises the runtime users get, which is why "all green" and "it works when I launch it" are separate claims.

## Names that mislead

Four collisions that cost people time:

- **`npm run test:server` vs `npm run test:server:start`.** The first runs the **LSP server workspace's** unit tests (no stone involved). The second starts the **GemStone test stone**. Two unrelated meanings of "server" that happen to share a prefix.
- **"Integration" doesn't mean "several modules together."** Here it means exactly one thing: *runs against a live stone*. A test that wires up five client modules with no stone is still a unit test.
- **"GCI test" is ambiguous — prefer "the `gci` suite" for the legacy one.** Plenty of *integration* tests exercise the GCI bindings (`client/src/gciLibrary/__tests__/*.integration.test.ts`), and those are the ones that run in CI. "The GCI suite" / `npm run test:gci` refers only to the legacy on-demand directory.
- **`.test.ts` vs `.spec.ts`.** Vitest tiers use `.test.ts`; acceptance specs use `.spec.ts`. The suffix is what keeps Playwright's files out of Vitest's globs — and it's also why the repo-wide test conventions in `.claude/rules/tests.md` don't apply to acceptance specs, which follow Playwright's own idioms.

One more piece of vocabulary: `client/vitest.config.ts` defines two Vitest **projects**, `default` and `gci`. `npm test` pins `--project default` (unit + integration); `npm run test:gci` pins `--project gci`. Both show up in the VS Code Testing panel, which is why they live in one config file.

## Choosing a tier for a new test

1. Can it be proven without a stone? → **unit test**.
2. Does it need a live stone? → **integration test**, using `useIntegrationTest`, co-located with the code. This is the default for stone-dependent work, and a case that *can* be written this way MUST be. The detailed decision guide — including the reasons that look like justifications for the `gci` suite but aren't — is in `.claude/rules/client/tests.md`.
3. Does it need to verify UI/DOM behavior? → **unit jsdom test**.
4. **GCI suite**: no. Add nothing here without checking the closed-directory rules first.

## See also

- [CONTRIBUTING.md](../../CONTRIBUTING.md) — provisioning a test stone, pointing tests at your own stone, reproducing a shuffled run via `VITEST_SEED`.
- [Integration test harness](../reference/integration-test-harness.md) — `GciTestContext`, hook order, the commit invariant.
- [Integration test isolation](integration-test-isolation.md) — why transaction-abort, and why the commit guard is irreversible.
- [acceptance/README.md](../../acceptance/README.md) — running acceptance specs locally vs. containerised.
