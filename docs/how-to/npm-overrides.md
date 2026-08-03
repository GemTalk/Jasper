# Using `overrides` in root `package.json`

## The rule

An `overrides` entry may only **narrow** the range the declaring package already permits — it pins a specific version *within* that package's own dependency range, it cannot replace the range with something outside it.

If the version you need to force falls outside the declaring package's existing range, bump the parent package instead of (or as well as) adding/adjusting the override.

## Why

An out-of-range override makes npm mark that edge of the dependency tree `invalid`. `vsce package` refuses to package the extension when `npm ls` reports invalid edges, so a bad override silently breaks packaging rather than failing loudly at the time it's added. This has blocked a release twice.

## How to apply

Before adding or editing an entry in the root `package.json`'s `"overrides"` block:

1. Find the package that actually depends on the module you want to override, and check the range it declares for that dependency (e.g. via `npm ls <package>` or reading its own `package.json`).
2. Confirm the version you want to pin falls inside that range.
3. If it doesn't, bump the parent package to a version whose declared range includes the version you need — then add the override only if one is still necessary.
4. Run `npm run package` (or at least `npm ls`) to confirm no edge comes back `invalid`.

The `package-check` CI job (see `health-check.yml`) exists specifically to catch this class of breakage before it reaches a release.

## Example of the mistake

[Issue #351](https://github.com/GemTalk/Jasper/issues/351): PR #288 added an override forcing `vscode-languageclient`'s `minimatch` to `^10.2.5` to patch a `brace-expansion` advisory. But the pinned `vscode-languageclient@9` declares `minimatch: ^5.1.0`, so `minimatch@10.2.5` fell outside that range and npm marked the edge `invalid`. `vsce package` aborted while walking production dependencies with:

```
npm error code ELSPROBLEMS
npm error invalid: minimatch@10.2.5 .../node_modules/minimatch
```

This silently blocked the release rather than failing at the time the override was added. If you've hit this error, check every entry in `"overrides"` against the rule above. This was the second time this exact pattern broke packaging (the first was the `@hono/node-server` override, reverted in 1.8.9).
