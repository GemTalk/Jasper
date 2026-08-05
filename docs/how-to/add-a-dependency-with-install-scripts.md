# Adding a dependency with an install script

`strict-allow-scripts` (set in `.npmrc`) blocks any `preinstall`/`install`/`postinstall` script from a package that isn't explicitly approved in root `package.json`'s `allowScripts`. Adding a new dependency that has one of these scripts needs a three-step bootstrap — `npm approve-scripts` operates on the *installed* tree, so on a clean checkout it fails with `ENOMATCH` while `npm install` is simultaneously blocked.

## Bootstrap sequence

1. Install without running any scripts:

   ```sh
   npm install --ignore-scripts <pkg>
   ```

2. Review the package, then approve it:

   ```sh
   npm approve-scripts <pkg>
   ```

   This writes a version-pinned entry to root `package.json`'s `allowScripts`. Deny it instead with `npm deny-scripts <pkg>` if the script turns out to be unnecessary.

3. **Run `npm rebuild`.** This step is not optional: after an `--ignore-scripts` install, a plain `npm install` reports "up to date" and never runs the newly approved script.

   ```sh
   npm rebuild
   ```

Commit the `package.json` and `package-lock.json` changes together.

## When Dependabot bumps an approved package

Approvals are version-pinned (`allow-scripts-pin=true`), so a Dependabot PR that bumps an approved package's version fails CI with `ESTRICTALLOWSCRIPTS` — the pin doing its job, not a bug. To fix it on the PR's branch:

1. Check out the branch and run `npm approve-scripts <pkg>` to re-approve at the new version (review the diff between the old and new version's install script first).
2. `npm rebuild`.
3. Commit the updated `package.json` on the branch and push.

Packages that receive this treatment regularly are grouped into Dependabot's `install-scripts` group (see [docs/reference/supply-chain-controls.md](../reference/supply-chain-controls.md)) so they arrive together, in one recognizable PR per cycle.
