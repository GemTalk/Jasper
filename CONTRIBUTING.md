# Contributing to Jasper

Jasper is a VS Code extension that provides a full GemStone/S Smalltalk development environment — browse, edit, debug, and test Smalltalk code without leaving the editor.

## First-time setup

Follow these steps in order after cloning the repo:

1. **Install NVM** if you don't have it: https://github.com/nvm-sh/nvm

2. **Activate the pinned Node version** (defined in `.nvmrc`):

   ```sh
   nvm use
   ```

3. **Install dependencies:**

   ```sh
   npm install
   ```

4. **Install the recommended extensions** (VS Code will prompt you, or install manually): the
   Prettier extension (`esbenp.prettier-vscode`) formats TS/JS files on save, matching
   `npm run format` / `npm run format:check`. `.vscode/settings.json` is gitignored (personal
   editor prefs aren't shared), so add this yourself to get format-on-save:

   ```json
   {
     "editor.formatOnSave": true,
     "[typescript]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
     "[javascript]": { "editor.defaultFormatter": "esbenp.prettier-vscode" }
   }
   ```

5. **Start the GemStone test server** (integration tests are part of `npm test` and require a running GemStone instance):

   ```sh
   npm run test:server:start
   ```

   This installs GemStone (if not already present), stops any running test stone, resets the database to a pristine state, starts a fresh Stone and NetLDI, and writes `.env.test` with the connection details the test suite reads.

   Two companion commands let you manage the instance day-to-day:

   ```sh
   npm run test:server:stop   # stop the Stone and NetLDI when you're done
   npm run test:server:list   # list all running GemStone processes for the test stone
   ```

   To use a specific GemStone version instead of the oldest, pass it as an argument: `npm run test:server:start -- 3.7.5`.

   **Supported on Linux and macOS (Apple Silicon) only — Windows is not yet supported.**

   > **Destructive:** re-running `test:server:start` stops any running stone, resets the database to a pristine state, and overwrites `.env.test`.

6. **Ignore the Prettier reformat commit in `git blame`:**

   ```sh
   git config blame.ignoreRevsFile .git-blame-ignore-revs
   ```

   This skips the one-time "Format codebase with Prettier" commit when attributing lines (GitHub's blame view honors `.git-blame-ignore-revs` automatically, no config needed there).

## Supported VS Code & Node versions

**Current floor:** VS Code `1.101.0` → bundled Node `22.15.1`.

See [docs/how-to/raising-the-version-floor.md](docs/how-to/raising-the-version-floor.md) for the policy behind this floor and the steps to raise it.

## Build and test

- Lint: `npm run lint`
- Format: `npm run format` (writes changes), `npm run format:check` (verifies only)
- Build: `npm run compile`
- Watch: `npm run watch`
- Test: `npm test`
- Package: `npm run package`

Tests run in a random order on every run. The seed is printed at the top of the output — to reproduce a specific run, set the `VITEST_SEED` environment variable (e.g. `VITEST_SEED=<seed> npm test`, or `cd client && VITEST_SEED=<seed> npx vitest run`). Passing `--sequence.seed` directly does not work: `client/vitest.config.ts` pins the seed from `VITEST_SEED` (or the clock) into both projects, overriding the CLI flag.

Before pushing changes, ensure `npm run lint && npm run format:check && npm run compile && npm test` passes locally.

### Manual dev window (`dev:fresh`)

`npm run dev:fresh` (or `bash scripts/dev-fresh.sh`) launches a throwaway editor window loading the extension from this working copy, with an isolated profile (no personal settings/extensions/keychain) and an isolated `gemstone.rootPath` (pass `--keep-installs` / use `npm run dev:fresh:keep-installs` to reuse your real `~/Documents/GemStone` instead).

It **only compiles `client/out` when that directory is missing** — if a build already exists (from another branch, or edits made without `watch`), it launches with that build as-is, even if it's stale. To make sure you're running current code:

- Run `npm run watch` in another terminal for live reload (then "Developer: Reload Window" in the dev window after edits), or
- Force a one-off rebuild first: `npm run compile:client` (or `rm -rf client/out` to guarantee a clean recompile).

### Optional local git hooks

If you'd like, you can install some optional [lefthook](https://github.com/evilmartians/lefthook) git hooks:

```sh
npm run hooks:install    # opt in
npm run hooks:uninstall  # opt out
```

- **pre-commit**: runs `eslint` and `prettier --check` on staged files
- **post-checkout** / **post-merge** / **post-rewrite**: warns (non-blocking) when the root `package-lock.json` changed, as a reminder to run `npm install`

If you've already installed the hooks, re-run `npm run hooks:install` after pulling changes to `lefthook.yml` to pick up any new/changed hooks.

## Running integration tests against a custom GemStone instance

If you want to run the integration tests against your own GemStone instance instead of the one provisioned by `test:server:start`, you can override the connection details via environment files. Vite loads these automatically when running tests; later files take precedence over earlier ones:

| File | When loaded | Notes |
|---|---|---|
| `.env` | always | shared defaults across all modes |
| `.env.local` | always | personal overrides for all modes; gitignored |
| `.env.test` | test mode only | test-specific defaults; generated by `test:server:start`; gitignored |
| `.env.test.local` | test mode only | personal test overrides; gitignored |

All variables must be prefixed with `VITE_` to be accessible in test code (e.g. `process.env.VITE_GEMSTONE_USER`). The `.env.test` generated by `test:server:start` already follows this convention. To override a value for your local setup without touching `.env.test`, add the same key to `.env.test.local` — it takes precedence and is already gitignored.

`test:server:start` emits `VITE_GEMSTONE_STONE_NRS` and `VITE_GEMSTONE_GEM_NRS` — composed NRS connection strings — plus a handful of atomic vars (`VITE_GEMSTONE_USER`, `VITE_GEMSTONE_PASSWORD`, `VITE_GEMSTONE_GCI_LIBRARY_PATH`, `VITE_GEMSTONE_GLOBAL_DIR`, `VITE_GEMSTONE_VERSION`). **The composed NRS is authoritative**: to point tests at a different stone, override the NRS pair together in `.env.test.local` rather than an individual atomic var — some atomic vars are fallback-only, for values the NRS doesn't encode at all (e.g. version), not an independent way to redirect the connection. See `testConnection.ts` for the full resolution order and the reasoning behind it.

## Continuous integration

CI runs on **GitHub Actions**. The [Health Check workflow](.github/workflows/health-check.yml) runs on every push, as a matrix job once per GemStone version listed in `client/.gemstone-integration-releases.json`. Most jobs run on the Node version pinned by `.nvmrc` (the common recent-VS-Code case); one additional job pins the supported-floor Node (see [Supported VS Code & Node versions](#supported-vs-code--node-versions)) against the oldest *non-experimental* GemStone version — i.e. the real installable minimum (`MINIMUM_SUPPORTED_GEMSTONE_VERSION` in `versionManager.ts`) — as a retrocompatibility smoke test. To add a GemStone version to the matrix, add an entry to `client/.gemstone-integration-releases.json`; the `reasons` array is human-readable documentation and is not parsed by any script. Mark an entry `"experimental": true` if it's below the installable minimum (e.g. a version some customers still run in the field) — it still gets its own matrix job, but is excluded from the Node-floor pairing.

## Publishing a release

1. Update the version in `package.json` (and `package-lock.json` — both the top-level `version` and `packages."".version`) and promote the `[Unreleased]` section in `CHANGELOG.md` to a new dated `[X.Y.Z]` heading. Sweep `main` since the last release for merged PRs that didn't add their own changelog entries.
2. `npm run compile && npm test`
3. Commit the version + changelog changes (e.g. `Release X.Y.Z: <one-line summary>`).
4. `git tag -a vX.Y.Z -m "Release X.Y.Z"` — annotated tag, on the release commit.
5. `npx @vscode/vsce package` — produces `gemstone-ide-X.Y.Z.vsix` in the repo root. The previous version's `.vsix` is gitignored but stays on disk; delete it to keep the root tidy.
6. `npm run publish` — runs `vsce publish` then `ovsx publish` for the VS Code Marketplace and Open VSX. If `vsce publish` times out on the Azure DevOps Gallery API (it happens), re-run `npx @vscode/vsce publish` directly — don't re-run `npm run publish`, since the ovsx step will then double-publish and fail with "already exists."
7. `git push origin main && git push origin vX.Y.Z` — push the commit and the tag (the tag does not piggyback on the branch push).

You must be logged in with Personal Access Tokens for both publishers. To set up credentials:

```sh
npx @vscode/vsce login gemtalksystems   # VS Code Marketplace
npx ovsx create-namespace gemtalksystems -p <token>   # Open VSX (one-time)
```

`ovsx publish` reads `OVSX_PAT` from the environment (or a stored token).
