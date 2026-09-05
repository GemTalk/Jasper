# Publishing a release

Releasing Jasper to the marketplaces is a maintainer task: it needs a personal access token for the `gemtalksystems` publisher on each of the two registries. Outside contributors need none of it — [CONTRIBUTING.md](../../CONTRIBUTING.md) covers the ordinary build-and-test loop.

## Pre-flight

Verify both tokens resolve before you build anything — a missing or expired one is far cheaper to find now than after the commit and tag exist:

```sh
npx @vscode/vsce verify-pat gemtalksystems
npx ovsx verify-pat gemtalksystems
```

## Steps

1. `npm version <X.Y.Z> --no-git-tag-version` — bumps `package.json`'s `version` and `package-lock.json`'s two root fields (`version` and `packages."".version`) atomically. Don't hand-edit these or find-and-replace the version string across the lockfile: the version can collide with an unrelated dependency's own version elsewhere in `package-lock.json` (e.g. `1.8.11` matches `typed-rest-client@1.8.11`), corrupting that entry. `--no-git-tag-version` skips npm's own commit/tag, since steps 3-4 below handle that.

   npm owns `package.json`'s formatting, and the file is currently in npm's own style, so this rewrites only the version line. Confirm that with `git diff package.json` before committing — `npm run format` globs only `*.{ts,mts,cts,js,mjs,cjs}`, so `format:check` will not catch stray churn here.

   Then promote the `[Unreleased]` section in `CHANGELOG.md` to a new dated `[X.Y.Z]` heading. Sweep `main` since the last release for changes that didn't add their own changelog entries — `git log --oneline --first-parent vX.Y.Z..HEAD` lists them, one line per landing on `main`. Use `--first-parent` rather than filtering for merge commits: it also catches a squash-merged PR and anything committed straight to `main`, which are exactly the changes least likely to have written their own entry. **Check the previous release's section too:** a branch cut before the last `[Unreleased]` → `[X.Y.Z]` rename merges its bullet into that now-released section, so the entry claims to have shipped in a version that never contained it. Move any such entry into the new section.

2. `npm run lint && npm run format:check && npm run compile && npm test` — the full gate, matching the one every PR is held to.
3. Commit the version + changelog changes (e.g. `Release X.Y.Z: <one-line summary>`).
4. `git tag -a vX.Y.Z -m "Release X.Y.Z"` — annotated tag, on the release commit.
5. `npm run package` — runs `vsce package`, producing `gemstone-ide-X.Y.Z.vsix` in the repo root. The previous version's `.vsix` is gitignored but stays on disk; delete it to keep the root tidy. Note this file is **not** what gets uploaded: both commands in step 6 repackage into their own temp `.vsix`. It is for local inspection and archival.
6. `npm run publish` — the two registries, in sequence. **The script is `publish:vsce && publish:ovsx`, so the halves are not independent:** if `vsce publish` exits non-zero, `ovsx publish` never runs at all, and the release is live on the Marketplace and absent from Open VSX.

   `vsce publish` does time out on the Azure DevOps Gallery API, and a timeout tells you nothing about whether the upload landed. So don't reason about which halves ran — ask the registries, and publish whatever is missing with `npm run publish:vsce` or `npm run publish:ovsx`. **A release is not done until both registries report the new version.** See [A success message is not a live release](#a-success-message-is-not-a-live-release) below for how to tell a missing publish from one that is merely still propagating; the two look identical from the outside and the difference decides whether you publish again or wait.
7. `git push origin main && git push origin vX.Y.Z` — push the commit and the tag (the tag does not piggyback on the branch push).

## A success message is not a live release

Both CLIs print success as soon as the **upload** is accepted. The version then takes anywhere from ~2 to ~22 minutes to become publicly queryable, and the two registries are independent — either can be first. During that window:

- Open VSX answers `Extension not found` for the new version, and `ovsx publish` run again reports `already published, but currently isn't active and therefore not visible`. That message means *wait*, not *retry* — it has always resolved on its own. It is also proof the upload landed.
- The Marketplace omits the version from gallery queries, so `vsce show` still reports the previous one.

Verify against each registry rather than trusting the CLI output:

```sh
# Open VSX
curl -s https://open-vsx.org/api/gemtalksystems/gemstone-ide | jq -r .version

# VS Code Marketplace
npx @vscode/vsce show gemtalksystems.gemstone-ide
```

**A registry that doesn't show the version is not proof the upload failed** — and this cuts both ways, so establish which case you are in before acting:

- **The publish command reported success.** The upload landed; this is propagation. Wait. Re-publishing is not the fix.
- **The publish command never ran, or exited non-zero.** Nothing is propagating. Publish that half — `npm run publish:vsce` or `npm run publish:ovsx`.

`npm run publish`'s `&&` makes the second case easy to hit: a failed `vsce publish` means `ovsx publish` was never reached, so Open VSX's `Extension not found` means *not published*, not *not yet visible*. If you are unsure which happened, re-running a publish is safe enough to settle it: `vsce` reports `already exists` and `ovsx` reports `already published, but currently isn't active and therefore not visible` rather than creating a duplicate — and either message is itself proof the upload had landed.

## Credentials

Each registry takes a personal access token, tied to your own account rather than to the publisher. Store both once and neither publish step needs anything in the environment:

```sh
npx @vscode/vsce login gemtalksystems   # VS Code Marketplace
npx ovsx login gemtalksystems           # Open VSX
```

`vsce` reads `VSCE_PAT` from the environment or its stored login; `ovsx` reads `OVSX_PAT` or its stored token. `npx @vscode/vsce ls-publishers` shows what is stored locally — an empty list means no credentials **on this machine**, not that the publisher is unregistered.

The **VS Code Marketplace** token comes from Azure DevOps (`dev.azure.com` → User settings → Personal Access Tokens). Two settings matter, and both are easy to get wrong:

- **Organization: All accessible organizations** — a token scoped to a single organization fails with a 401 that reads like a bad token.
- **Scopes: Marketplace → Manage** (under "Show all scopes").

Your account must also be a member of the `gemtalksystems` publisher; <https://marketplace.visualstudio.com/manage/publishers/gemtalksystems> loads if it is and 404s if it isn't. Azure DevOps shows a PAT once, at creation, and stores it hashed — a lost token is replaced, never recovered.

The **Open VSX** token comes from <https://open-vsx.org> (sign in with GitHub → user settings → Access Tokens), and your account must belong to the `gemtalksystems` namespace. The namespace itself already exists; `npx ovsx create-namespace gemtalksystems -p <token>` is a one-time step that does not need repeating.
