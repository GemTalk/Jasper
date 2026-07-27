---
paths:
  - "client/**/*.test.ts"
  - "client/src/**/__tests__/**"
---

# Client tests

General test conventions (naming, three-part structure) are in `.claude/rules/tests.md`. This file covers `client/` workspace specifics.

Tests that use `useIntegrationTest` run against the real GCI shared library — do not use mocks or stubs for `GciLibrary` or any GCI calls.

## VS Code API mocking

The VS Code API is not available in tests. Vitest picks up `src/__mocks__/vscode.ts` automatically — a comprehensive manual mock of the `vscode` module. Any test importing extension code that touches the VS Code API gets it for free; no explicit import or `vi.mock()` call is needed.

Mock test helpers:
- `__resetConfig()` — clears all stored configuration values; call in `beforeEach` if your test uses `workspace.getConfiguration`.
- `__setConfig(section, key, value)` — pre-seeds a config value before the test runs.

Two vitest setup files run before every suite: `vitest.windowSetup.cjs` (polyfills `CSS.escape` for jsdom) and `vitest.uriSetup.ts` (registers a URI equality tester so `expect(uri).toEqual(otherUri)` compares by string value rather than object identity).

Query functions in `queries/` take a `QueryExecutor` — in tests, pass a `vi.fn()` returning a canned string; this avoids any GCI dependency for unit tests of query-dependent code.

<!-- Maintainer note: the fire-and-forget pattern below is tech debt in systemBrowser.ts (these calls should ideally be awaited), not a pattern to imitate. Documented as current reality so tests account for it until a follow-up fixes the underlying code. -->

Some handlers (e.g. in `systemBrowser.ts`) call async methods without awaiting them (fire-and-forget), so tests must account for the effect landing a tick later. Which tool depends on the assertion's polarity:

- **Positive assertion** ("the effect eventually happens", e.g. `expect(window.showTextDocument).toHaveBeenCalled()`): use `await vi.waitFor(() => expect(...).toHaveBeenCalled())`. It polls until the condition holds, returns as soon as it does, tolerates chains that span several ticks, and gives a diagnostic error on timeout. Prefer this over a blind flush.
- **Negative assertion** ("the effect must *not* happen", e.g. `expect(window.showTextDocument).not.toHaveBeenCalled()`): `vi.waitFor` does **not** work here — a negative expectation is already satisfied on the first poll, so it returns immediately without ever draining the fire-and-forget queue, and the bug never gets a chance to manifest. Instead, deterministically drain the queue first, then assert: `await new Promise(resolve => setTimeout(resolve, 0));`. Note this flushes only a single macrotask tick — a chain with multiple awaits/nested microtasks may need more, so **verify new negative assertions actually fail against the unfixed code before trusting them green.**

Tests run in random order; the seed is printed at the top of the output. Reproduce a run by replaying that seed via `VITEST_SEED=<seed>` (a root `SeededSequencer` in `client/vitest.config.ts` reads it and pins it into both projects for a fully reproducible file order).

### Typing overloaded Node/vscode mocks without `any`

`vi.mocked()` on an overloaded function (`fs.readFileSync`, `fs.readdirSync`, `child_process.exec`, `vscode.window.showInformationMessage`, ...) types the mock using the *last* declared overload, not the one production code actually hits. Don't reach for `any` when a call against one of these doesn't type-check:

- First try the plain, unfixed-up value and let `npx tsc -p client/tsconfig.json --noEmit` tell you if it's actually a problem. The last overload's return/param type is often already a superset of what you need (e.g. `readFileSync`'s last overload returns `string | Buffer`, so a plain string return just works).
- When `tsc` reports a *real* mismatch (e.g. `readdirSync`'s last overload wants `Dirent[]`, not `string[]`; `showInformationMessage`'s last overload wants `T extends MessageItem`, not a bare string), that's genuine overload friction, not a typing mistake — use a precise, narrowly-scoped `as unknown as <ExpectedType>` at that one call site rather than widening to `any`.
- Optional callback params (e.g. `exec`'s `callback?: (...) => void`) are "possibly undefined" once you're not masking the type with `any` — call them with `cb?.(...)`, don't cast the optionality away.
- For partial interface mocks (`vscode.Terminal`, `vscode.ExtensionContext`), confine the one unavoidable `as unknown as T` cast to a single shared test helper (e.g. a `fakeTerminal()` factory) instead of repeating it at every call site — see `osConfigTreeProvider.test.ts`.

## Integration tests

Tests using `useIntegrationTest` require a live GemStone instance so plain `npm test` needs a running stone. Run `npm run test:server:start` once to provision one; it writes connection details to `.env.test` (which the user may override with `.env.test.local`). CI runs these as a matrix over `client/.gemstone-integration-releases.json`. The deep GCI binding suite (`npm run test:gci`) is separate.

GCI session/oop values are koffi `External` pointer wrappers with no enumerable properties, so vitest's deep equality (`toEqual`, and therefore `expect(spy).toHaveBeenCalledWith(someSession, ...)`) cannot tell two *different* sessions or oops apart — it treats any two of them as equal regardless of the underlying native pointer. To assert *which* session/oop a call received, pull the argument out of `spy.mock.calls` and compare with `toBe` (reference equality) instead.

### Tests that depend on the server plugin

CI runs the integration suite twice — once against a bare stone, then again after installing the Jasper Server Plugin. By default a test runs in *both* passes, so most tests need no gating. Only reach for a gate when the test makes sense in just one of those worlds; call it at the test's top (from `src/__tests__/requireServerPluginFeature.ts`). The gate skips the test, with a reason, when the connected stone isn't in the matching world, so each pass runs exactly the subset that applies instead of failing:

- The test exercises a plugin feature → `requireServerPluginFeature(pluginFeatures.refactoring, ctx, session())` — runs only when the feature is installed.
- The test asserts fallback/graceful-degradation behavior when the feature is missing → `requireServerPluginFeatureAbsent(pluginFeatures.refactoring, ctx, session())` — runs only when the feature is absent.

Pass the feature straight off the shared registry (`pluginFeatures` from `serverPlugin/pluginFeatures.ts`) — see the registry itself for the current set of features. Both gates decide live against the connected session (version applicability plus a presence probe) — there's no environment flag to set. See the JSDoc in those two files for the mechanics and how to add a new feature.
