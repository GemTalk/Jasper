# Documentation index

This directory is moving towards the [Diátaxis](https://diataxis.fr/) framework: how-to guides for a specific task, explanation for background and rationale, and reference for lookup tables. So far only the docs below have been organized this way — the rest of `docs/` is still flat, unclassified files.

## How-to guides

- [Adding a dependency with an install script](how-to/add-a-dependency-with-install-scripts.md) — bootstrap sequence for `strict-allow-scripts` when a new dependency has a `pre`/`post`/`install` script.
- [Using `overrides` in root `package.json`](how-to/npm-overrides.md) — the narrowing rule for `overrides` entries and why violating it silently breaks packaging.
- [Raising the VS Code / Node version floor](how-to/raising-the-version-floor.md) — how to move the runtime floor and every file that must change together.

## Explanation

- [npm supply-chain threat model](explanation/npm-supply-chain-threat-model.md) — the install-time worm class these controls defend against, and why each control is shaped the way it is.

## Reference

- [npm supply-chain controls](reference/supply-chain-controls.md) — lookup table of this repo's `.npmrc` keys, `allowScripts` verdicts, CI-only checks, and sunset conditions.
