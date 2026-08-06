# Documentation index

New docs are organized by [Diátaxis](https://diataxis.fr/) category — `how-to/` for a specific task, `explanation/` for background and rationale, `reference/` for lookup. Older docs still sit unclassified at the top level of `docs/`; move one into a category when you next touch it.

## How-to guides

- [Adding a dependency with an install script](how-to/add-a-dependency-with-install-scripts.md) — the `strict-allow-scripts` bootstrap sequence when a new dependency has a `pre`/`post`/`install` script.
- [Using `overrides` in root `package.json`](how-to/npm-overrides.md) — an override may only narrow; violating that silently breaks packaging.
- [Raising the VS Code / Node version floor](how-to/raising-the-version-floor.md) — the coordinated set of files that must move together.

## Explanation

- [npm supply-chain threat model](explanation/npm-supply-chain-threat-model.md) — the install-time execution threat these controls defend against, and why each is shaped the way it is.

## Reference

- [npm supply-chain controls](reference/supply-chain-controls.md) — this repo's `.npmrc` keys, `allowScripts` verdicts, CI-only checks, and sunset conditions.
