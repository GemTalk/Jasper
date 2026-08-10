# npm supply-chain controls

What *this repo* sets, and why. For how each control works, follow the links to npm's own docs. See the [threat model](../explanation/npm-supply-chain-threat-model.md) for why these were chosen, and [adding a dependency with an install script](../how-to/add-a-dependency-with-install-scripts.md) for the add/bump procedure.

## Current floor

The dev-toolchain npm floor is enforced by `devEngines.packageManager` in root `package.json` and satisfied via `.nvmrc`; read those two files for the exact versions. The floor sits where it does because `strict-allow-scripts` and `npm approve-scripts` don't exist below npm 11.16.0.

## `.npmrc` config keys

See npm's [config reference](https://docs.npmjs.com/cli/v11/using-npm/config) for full semantics, including which npm version introduced each key. This repo's root `.npmrc` sets:

| Key | Value | Why this value, here |
|---|---|---|
| `strict-allow-scripts` | `true` | Fail-closed install-script allowlist: an unreviewed `allowScripts` verdict throws `ESTRICTALLOWSCRIPTS` before reify. |
| `allow-git` | `none` | No-op today (no git deps in the tree) — exists to block one being introduced. Becomes the npm 12 default. |
| `allow-remote` | `none` | No-op today — exists to block a non-registry dependency spec being introduced. Still permits the *configured* registry hostname, so a scoped `@foo:registry=` override slips through. Becomes the npm 12 default. |
| `min-release-age` | `7` | Cooldown in days before a freshly published version is installable; see [below](#min-release-age-escape-hatch). `lint:supply-chain` treats this one as a floor rather than an exact value, so a stricter local setting is fine — raising it is safe, lowering or unsetting it is what the check exists to catch. |

## `allowScripts` (root `package.json`)

See npm's docs for [`npm approve-scripts`](https://docs.npmjs.com/cli/v11/commands/npm-approve-scripts) and the [`allowScripts` field](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#allowscripts) for verdict/precedence semantics (allow/deny/unreviewed, version pinning). One repo-specific note npm's docs won't tell you:

- The field must live at the **root** `package.json` — a workspace copy is read from `npm.prefix` and is silently ignored (no warning; the `.npmrc`-in-a-workspace warning is a different code path). Running `npm install` from inside a workspace subdirectory is safe: npm's `loadLocalPrefix` resets the prefix to the repo root.

### Current verdicts

Read root `package.json`'s `allowScripts` for the exact pinned versions — not copied here, since Dependabot bumps them independently of this doc. The rationale per package:

| Package | Verdict | Why |
|---|---|---|
| `esbuild` | allow | bundler; `postinstall` links the platform binary |
| `koffi` | allow | production native dep; ships the GCI FFI binding |
| `@vscode/vsce-sign` | allow | needed by `vsce package`/`publish` |
| `lefthook` | allow | opt-in git hooks |
| `keytar` | allow | optional dep of `@vscode/vsce`, backing its keychain storage of the publish PAT; the version-pinned approval already blocks the worm vector, so there's no reason to deny it and lose that path |
| `fsevents` | deny | prebuilt binary, optional and macOS-only; it's still in the lockfile on Linux (`fsevents@2.3.3` and a nested `playwright/fsevents@2.3.2`), just inert there — worst case of denial is chokidar polling in `npm run watch`. That inertness is exactly why the deny entry can't be dropped as cleanup: on npm 11.17.0 an unreviewed (rather than denied) inert package still hard-fails `ESTRICTALLOWSCRIPTS` for a script that would never run |

## `min-release-age` escape hatch

See npm's [`min-release-age` config docs](https://docs.npmjs.com/cli/v11/using-npm/config#min-release-age). `min-release-age-exclude` needs a newer npm than this repo's floor, so an urgent patch inside the cooldown window needs a one-off override instead:

```sh
npm i <pkg> --min-release-age=0
```

Without the override the error reads like a normal `ETARGET`/`notarget` ("No matching version found for x@y with a date before …") — as if the version doesn't exist, rather than as a cooldown block.

## CI-only checks

Three additional checks run in the `lint` job (not `.npmrc` settings, so not enforced on a developer's local install):

| Check | Command | What it catches |
|---|---|---|
| `lockfile-lint` | `npm run lint:lockfile` | Bad `resolved` host, non-HTTPS URL, missing `integrity`, or a `resolved` URL whose path names a different package than the lockfile entry's own key (`--validate-package-names` — the dependency-confusion/substitution case: an entry claiming to be `mime` but actually resolving to some other package's tarball). See [lockfile-lint's docs](https://github.com/lirantal/lockfile-lint) for flag semantics |
| `npm audit signatures` | `npm audit signatures` | Missing or invalid registry signatures/attestations across the full tree, checked against the lockfile's declared `version` for each entry — see npm's [`audit signatures` docs](https://docs.npmjs.com/cli/v11/commands/npm-audit#signatures). |
| Version-vs-`resolved` drift | `npm run lint:supply-chain` | A lockfile entry whose `version` field disagrees with the version embedded in its `resolved` tarball filename. Neither of the above checks reliably catches this: `lockfile-lint` never looks at `version` at all, and `npm audit signatures` only fails *incidentally*, when the falsely-claimed version happens not to exist in the registry. This check is the only one that looks at whether an entry describes the artifact it points at, regardless of whether a phantom version happens to exist. |

## Known gaps

- **`rhysd/actionlint` docker digest** — pinned by SHA256 digest in `health-check.yml`'s `lint-workflows` job, but Dependabot's `github-actions` ecosystem scans `uses:` only, so this digest is a manual bump.
- **The exact npm pins in `health-check.yml` and `acceptance/Dockerfile`** — both install `npm@11.17.0`, the npm bundled by `.nvmrc`'s Node, so CI and the acceptance container match a contributor's toolchain rather than running ahead of it. Dependabot's `github-actions` ecosystem scans `uses:` only, not `run:` strings, so neither bumps automatically — re-pin both manually whenever `.nvmrc`'s Node version moves.

## Sunset conditions

| Condition | Then |
|---|---|
| npm 12 becomes reachable at the floor | `strict-allow-scripts` becomes optional (npm 12 skips unreviewed scripts by default) — keep it anyway for fail-closed behavior. `allow-git`/`allow-remote` become defaults, safe to drop. `lockfile-lint` becomes mostly redundant. |
| The CI floor job's Node line ever bundles an npm new enough for `strict-allow-scripts` | Its `npm install -g npm@11` step can be dropped. |
| A Node LTS ships an npm new enough for `min-release-age-exclude` | Raise the floor and adopt it in place of the CLI override. |
