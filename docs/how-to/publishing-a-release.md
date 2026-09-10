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

**Actions → Release → Run workflow**, dispatched from `main`, with:

| Input | Meaning |
| --- | --- |
| `version` | the version to publish, e.g. `1.9.1` |
| `dry-run` | run every check, build the `.vsix` and scan it, but create nothing and publish nothing |

There is no `ref` input: the workflow publishes the tip of the branch it was dispatched against, and refuses to run anywhere but the default branch. A first release of the day is worth doing as a dry run — it exercises validation, the build and the secret scan without touching a registry or creating a tag.

### What runs, and in what order

```
validate ──▶ package ──▶ scan ──▶ gate ──▶ release ──┬──▶ publish-vsce ──┐
                                                     │                   ├──▶ verify
                                                     └──▶ publish-ovsx ──┘
```

| Job | What it does |
| --- | --- |
| `validate` | Checks nothing out. Over the API: the repository is `GemTalk/Jasper`, the dispatch was from the default branch, `package.json` is at `version`, `CHANGELOG.md` has a dated `[X.Y.Z]` section **and an empty `[Unreleased]`**, no `vX.Y.Z` tag exists, and the newest `ci-complete` on this exact commit concluded `success`. |
| `package` | `npm ci`, then `npm run package` with `SOURCE_DATE_EPOCH` set from the commit date, so the zip is reproducible. Uploads the one `.vsix` every later job uses. |
| `scan` | Unzips that `.vsix` and runs `gitleaks` over its **contents** — see [the secret scan](#the-secret-scan). |
| `gate` | Does nothing at all. Its only content is the `release-approval` environment, which holds the run until a required reviewer approves. |
| `release` | Creates the annotated tag, then the GitHub Release as a **draft**, attaches the `.vsix`, and publishes it. |
| `publish-vsce`, `publish-ovsx` | Independent. Each downloads the `.vsix` **from the Release** and publishes that file. Neither waits for the other. |
| `verify` | Polls both registries. Reports; does not gate. |

Two properties are worth understanding, because they are why the jobs are in this order rather than a simpler one.

**Everything irreversible happens last.** Both registries are immutable per `(publisher, name, version)`: a version number, once taken, cannot be reused, and even deleting a version leaves the identity reserved. A publish that goes wrong therefore burns `X.Y.Z` for good — the recovery is always `X.Y.Z+1`, never a retry. So the build, the scan and the approval all happen before any registry is touched, and the reviewer approves a package that already exists and has already been scanned.

**The Release is the source of the bytes.** `package` builds the `.vsix` once; `release` attaches it; both publish jobs download *that* file and publish it with `--packagePath`. The artifact on the run, the asset on the Release, and what each registry serves are the same object. A re-run cannot substitute different bytes, because the bytes come from an immutable Release rather than a fresh build. (Run by hand, each publish command repackages from source instead, so a locally built `.vsix` is *not* what gets uploaded.)

### The secret scan

Open VSX runs its own gitleaks-based scan **server-side, after accepting the upload**, and offers no way to allow a false positive. A hit leaves the version inactive or rejected — and the version number is already spent. This repo has been rejected that way twice, 1.7.6 and 1.8.3, both times on GemStone's *public* default password and both times failing only the Open VSX half after the Marketplace had already published.

The `scan` job scans the **unzipped `.vsix`**, not the working tree and not git history. That is deliberate in both directions: the tree misses what actually ships (the esbuild bundles are in the package but not in git, and both historical rejections lived in bundled output) and floods on what does not (`.vscodeignore` drops `client/tmp/**`, ~1GB of fixtures including example private keys).

Rules live in `.gitleaks.toml`. Two things there need to stay true:

- **The allowlists are narrow, and matched on the secret text.** esbuild inlines every dependency into one `extension.js`, so our code and vendor code cannot be separated by path. The current entries cover two class identifiers from bundled ASN.1/PKCS libraries and PEM *delimiter* literals in PEM-handling code. A real key in the same file is still caught.
- **`gemstone-password-literal` is a custom rule, and it is not redundant.** gitleaks' default ruleset does **not** flag the password form that Open VSX rejects, so scanning with the defaults alone would sail straight past the exact failure this job exists to prevent. It mirrors `client/src/__tests__/publishSecretScan.test.ts`, which stays: the unit test fails in seconds on every PR, while this covers the whole package.

A finding fails the run before anything is published, and the report is uploaded as an artifact. Fix it and re-dispatch; nothing has been spent.

### A success message is not a live release

Both CLIs print success as soon as the **upload** is accepted. The version then takes anywhere from ~2 to ~22 minutes to become publicly queryable, and the two registries are independent — either can be first. The `verify` job exists for this window.

- Open VSX answers `Extension not found` for the new version, and `ovsx publish` run again reports `already published, but currently isn't active and therefore not visible`. That message means *wait*, not *retry* — it has always resolved on its own. It is also proof the upload landed.
- The Marketplace omits the version from gallery queries, so `vsce show` still reports the previous one.

**A `verify` failure withholds nothing.** By the time it runs, the tag, the Release and both uploads already exist; nothing depends on it. It is telling you the registries are slower than its budget, not that the release is broken. Check them yourself:

```sh
scripts/registry-state.sh openvsx 1.9.1        # visible | absent | unknown
scripts/registry-state.sh marketplace 1.9.1
```

`absent` is genuinely ambiguous and the script says so rather than guessing: Open VSX answers the same 404 for a version that was never uploaded, one that landed and is awaiting activation, and one its scanner rejected. Nothing readable from outside distinguishes them — the publish attempt's own error message is the only thing that does, which is why `scripts/publish-to-registry.sh` interprets it there.

### If a job fails

| Where | What it means | What to do |
| --- | --- | --- |
| `validate`, `package`, `scan` | Nothing has been created and nothing published. | Fix and re-dispatch. The version number is untouched. |
| `release` | The tag may exist without a Release, or neither. Nothing has been published. | Delete the tag if it was created, then re-dispatch. |
| One publish job | That registry does not have it; the other may. The Release and tag exist and are correct. | **"Re-run failed jobs"** — never "Re-run all jobs", which would fail at the artifact upload by design rather than rebuild different bytes. |
| Both publish jobs | Nothing was accepted by either registry. | Re-run failed jobs. |
| `verify` | Everything landed; the registries are slow. | Nothing. Check by hand if you want confirmation. |

The one state with no way back is a publish that was **accepted** and then rejected server-side. The version number is spent: ship `X.Y.Z+1`.

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

One-time repository setup. **The workflow is not safe until step 2 is done** — GitHub creates a referenced environment implicitly, with no protection rules, so without required reviewers the `gate` job approves itself and anyone who can dispatch a workflow can publish.

1. Create three **environments** (Settings → Environments), so no environment holds more privilege than the job attached to it needs:
   - `release-approval` — the gate. **No secrets.**
   - `release-vsce` — holds `VSCE_PAT` only.
   - `release-ovsx` — holds `OVSX_PAT` only.
2. On `release-approval`, add **required reviewers** and enable **prevent self-review**. This is the approval gate and the audit trail of who released what.
3. On all three, add a **deployment branch policy** restricting them to `main`. This is the backstop that does not depend on the workflow's own checks being right.
4. Add each token as an **environment** secret, not a repository secret, so no other workflow can reach it.

Note for whoever does this: these are the repository's first third-party secrets — it holds only the automatic `GITHUB_TOKEN` today — so it is a governance change as much as a configuration one, and both tokens are one person's identity acting for the organisation.

Because these are personal tokens, they expire — Azure DevOps allows at most a year, and retires global PATs entirely on **1 December 2026**, after which Marketplace PAT publishing stops working and the workflow will need `vsce publish --oidc` / `ovsx publish --trusted-publishing` (each needs `id-token: write` and a policy registered on the registry) — and they expire silently, surfacing only at the next release. The workflow verifies both before it builds anything, so an expired token fails the run in seconds rather than halfway through; but whoever owns the tokens should still expect to rotate them.
