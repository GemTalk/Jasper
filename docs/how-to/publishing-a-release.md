# Publishing a release

Releasing Jasper to the marketplaces is a maintainer task: it needs a personal access token for the `gemtalksystems` publisher on each of the two registries. Outside contributors need none of it — [CONTRIBUTING.md](../../CONTRIBUTING.md) covers the ordinary build-and-test loop.

A release comes in two halves, and the split is deliberate:

1. **The release PR** — the version bump and the changelog. Both need judgment, so both are done by a person and reviewed like any other change.
2. **The `Release` workflow** — tag, package, publish, wait, announce. All mechanical, so a pipeline does it, from a commit that is already on `main` and already green.

## 1. Open the release PR

```sh
npm version <X.Y.Z> --no-git-tag-version
```

This bumps `package.json`'s `version` and `package-lock.json`'s two root fields (`version` and `packages."".version`) atomically. Don't hand-edit these or find-and-replace the version string across the lockfile: the version can collide with an unrelated dependency's own version elsewhere in `package-lock.json` (e.g. `1.8.11` matches `typed-rest-client@1.8.11`), corrupting that entry. `--no-git-tag-version` skips npm's own commit and tag; the workflow owns the tag.

npm owns `package.json`'s formatting, and the file is currently in npm's own style, so this rewrites only the version line. Confirm that with `git diff package.json` before committing — `npm run format` globs only `*.{ts,mts,cts,js,mjs,cjs}`, so `format:check` will not catch stray churn here.

Then promote the `[Unreleased]` section in `CHANGELOG.md` to a new dated `[X.Y.Z]` heading. The date and the exact `## [X.Y.Z] - YYYY-MM-DD` shape matter: the workflow refuses to publish a version that has no dated section, and it uses that section as the GitHub Release notes.

Sweep `main` since the last release for changes that didn't add their own changelog entries:

```sh
git log --oneline --first-parent vX.Y.Z..HEAD
```

That is one line per landing on `main`. Use `--first-parent` rather than filtering for merge commits: it also catches a squash-merged PR and anything committed straight to `main`, which are exactly the changes least likely to have written their own entry.

**Check the previous release's section too.** A branch cut before the last `[Unreleased]` → `[X.Y.Z]` rename merges its bullet into that now-released section, so the entry claims to have shipped in a version that never contained it. Move any such entry into the new section.

Open the PR and let it merge through the queue normally. Don't run the release gate by hand: CI runs `lint`, `format:check`, `compile` and the full suite against a live stone on both Linux and Windows, across every GemStone version in `client/.gemstone-integration-releases.json` plus the Node floor, and it runs `npm run package` — a stronger gate than any local run, and the workflow requires it to have passed.

## 2. Run the `Release` workflow

**Actions → Release → Run workflow**, with:

| Input | Meaning |
| --- | --- |
| `version` | the version to publish, e.g. `1.8.15` |
| `ref` | the commit to publish; defaults to `main` |
| `dry-run` | run every check and build the `.vsix`, but tag, publish and release nothing |

A first release of the day is worth doing as a dry run: it exercises the token checks and the whole build without touching either registry.

Before asking for approval, the workflow refuses to go on unless the ref is an ancestor of `main`, `package.json` is at the requested version, `CHANGELOG.md` has a dated section for it, no `vX.Y.Z` tag exists yet, and `ci-complete` concluded `success` on that exact commit.

It then waits on the `release` environment's reviewer. Once approved it verifies both tokens, packages, publishes, waits for both registries, tags, and creates the GitHub Release.

**The `.vsix` is built once and published as-is** to both registries via `--packagePath`, then attached to the GitHub Release. The artifact you can download from the run, the two the registries serve, and the one on the Release are the same bytes. (Run by hand, each publish command repackages from source instead, so the `.vsix` you built locally is *not* what gets uploaded.)

The tag is created only after both registries are serving the version, so a failed or half-finished publish leaves no tag behind and the run can simply be repeated. `--skip-duplicate` on both commands makes that re-run safe.

### A success message is not a live release

Both CLIs print success as soon as the **upload** is accepted. The version then takes anywhere from ~2 to ~22 minutes to become publicly queryable, and the two registries are independent — either can be first. The workflow's wait step exists for this window, so normally you never see it. What it means when it fails:

- Open VSX answers `Extension not found` for the new version, and `ovsx publish` run again reports `already published, but currently isn't active and therefore not visible`. That message means *wait*, not *retry* — it has always resolved on its own. It is also proof the upload landed.
- The Marketplace omits the version from gallery queries, so `vsce show` still reports the previous one.

The wait step is only reached once both publish steps have returned success, so a timeout there is propagation rather than a failed publish: **re-publishing is not the fix.** (If a publish step itself fails, the run stops there and never reaches the wait — the following step is skipped, so a `vsce` failure means Open VSX was never published to at all.) Check both registries yourself before doing anything else:

```sh
# Open VSX
curl -s https://open-vsx.org/api/gemtalksystems/gemstone-ide | jq -r .version

# VS Code Marketplace
npx @vscode/vsce show gemtalksystems.gemstone-ide
```

If they are serving the version, the release landed and only the tag and GitHub Release are missing — re-run the workflow, which will skip both duplicate uploads and finish the job.

## Releasing by hand

The pipeline is the normal path, not the only one. If it is unavailable, the same steps run locally, from a merged release commit, with credentials stored as below:

```sh
npm run lint && npm run format:check && npm run compile && npm test
npm run package                                    # gemstone-ide-X.Y.Z.vsix
npm run publish:vsce                               # or: npm run publish
npm run publish:ovsx
git tag -a vX.Y.Z -m "Release X.Y.Z" && git push origin vX.Y.Z
```

The two halves are listed separately above on purpose. `npm run publish` is `publish:vsce && publish:ovsx`, so **they are not independent: if `vsce publish` exits non-zero, `ovsx publish` never runs**, leaving the release live on the Marketplace and absent from Open VSX. `vsce publish` does time out on the Azure DevOps Gallery API, and a timeout tells you nothing about whether the upload landed.

So by hand, don't reason about which halves ran — ask the registries with the two commands above, and publish whatever is missing. **A release is not done until both registries report the new version.** Which action to take depends on a distinction the registries alone cannot show you:

- **The publish command reported success.** The upload landed; this is propagation. Wait.
- **The publish command never ran, or exited non-zero.** Nothing is propagating; publish that half.

Where it is unclear which happened, re-running a publish settles it safely: `vsce` reports `already exists` and `ovsx` reports `already published, but currently isn't active and therefore not visible` rather than creating a duplicate, and either message is itself proof the upload had landed.

## Credentials

Each registry takes a personal access token, tied to your own account rather than to the publisher.

The **VS Code Marketplace** token comes from Azure DevOps (`dev.azure.com` → User settings → Personal Access Tokens). Two settings matter, and both are easy to get wrong:

- **Organization: All accessible organizations** — a token scoped to a single organization fails with a 401 that reads like a bad token.
- **Scopes: Marketplace → Manage** (under "Show all scopes").

Your account must also be a member of the `gemtalksystems` publisher; <https://marketplace.visualstudio.com/manage/publishers/gemtalksystems> loads if it is and 404s if it isn't. Azure DevOps shows a PAT once, at creation, and stores it hashed — a lost token is replaced, never recovered.

The **Open VSX** token comes from <https://open-vsx.org> (sign in with GitHub → user settings → Access Tokens), and your account must belong to the `gemtalksystems` namespace. The namespace itself already exists; `npx ovsx create-namespace gemtalksystems -p <token>` is a one-time step that does not need repeating.

Check either token without publishing anything:

```sh
npx @vscode/vsce verify-pat gemtalksystems
npx ovsx verify-pat gemtalksystems
```

### Storing them locally

For releasing by hand, store both once and neither publish step needs anything in the environment:

```sh
npx @vscode/vsce login gemtalksystems   # VS Code Marketplace
npx ovsx login gemtalksystems           # Open VSX
```

`vsce` reads `VSCE_PAT` from the environment or its stored login; `ovsx` reads `OVSX_PAT` or its stored token. `npx @vscode/vsce ls-publishers` shows what is stored locally — an empty list means no credentials **on this machine**, not that the publisher is unregistered.

### Storing them for the workflow

One-time repository setup, and the only place the tokens are shared:

1. Create a **`release` environment** (Settings → Environments).
2. Add **required reviewers** to it. This is what makes the workflow's approval step a real gate, and it is where the audit trail of who released what comes from. Without it, anyone who can run a workflow can publish.
3. Add `VSCE_PAT` and `OVSX_PAT` as **environment** secrets, not repository secrets, so no other workflow can reach them.

Because these are personal tokens, they expire — Azure DevOps allows at most a year — and they expire silently, surfacing only at the next release. The workflow verifies both before it builds anything, so an expired token fails the run in seconds rather than halfway through; but whoever owns the tokens should still expect to rotate them.
