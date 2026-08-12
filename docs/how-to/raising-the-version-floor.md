# Raising the VS Code / Node version floor

**Current floor:** VS Code `1.101.0` → bundled Node `22.15.1`. TypeScript devDependency floor: `^5.7.2`.

## Why the floor is what it is

Jasper's runtime floor is dictated by `engines.vscode`: VS Code bundles a specific Electron/Node build, and that bundled Node is the actual lowest common denominator the extension runs on — regardless of what `@types/node` or local dev tooling assume.

We want the floor as far back as reasonably possible, to keep supporting users on VS Code installs that haven't auto-updated recently. Two independent ceilings limit how far back we're willing to go — whichever one lands on the *more recent* release wins:

1. **Node LTS support.** The bundled Node must still be an actively-maintained LTS, not EOL — an EOL Node no longer receives security patches, so the extension's stated runtime floor would be unpatched.
2. **Adoption ceiling, ~1 year.** Even when an older release's Node hasn't gone EOL yet, we don't chase VS Code installs back indefinitely. About a year is judged enough time for the userbase to have auto-updated past very old releases, so reaching back further has diminishing returns and just adds support burden.

Look up the VS Code → Electron → Node mapping at [github.com/ewanharris/vscode-versions](https://github.com/ewanharris/vscode-versions) to check both bounds when re-evaluating the floor. Currently the two coincide: the release from about a year ago is also the earliest one bundling Node `22`, which is still an actively-maintained LTS.

`tsconfig.base.json`'s `target` and `lib` values are sourced from [github.com/tsconfig/bases](https://github.com/tsconfig/bases)' preset for the Node version matching the floor (e.g. its `node22` preset for Node `22`). We can't `extends` that package directly, though: its presets assume ESM (`"module": "node16"`/`"nodenext"`), while this project compiles to `"module": "commonjs"` — so the matching preset's `target`/`lib` fields are copied in by hand instead of pulled in via `extends`.

The `typescript` devDependency range is a separate, compiler-version concern rather than a Node-runtime one — it just needs to stay new enough to recognize whatever `tsconfig.base.json`'s `lib` array declares. Check the [TypeScript release notes](https://www.typescriptlang.org/docs/handbook/release-notes/) for the minimum version that ships each `lib` entry whenever `lib` changes.

## How to raise it

1. Using the [vscode-versions](https://github.com/ewanharris/vscode-versions) mapping, find both bounds and take whichever is more recent:
   - the earliest VS Code release whose bundled Node is still an actively-maintained LTS (not EOL), and
   - the VS Code release from about a year ago.

   That release is the new floor; note its bundled Node version.
2. Update all of these together — they encode the same runtime floor and are a **coordinated set, not independent knobs**. A partial bump lets the type checker or bundler assume APIs that don't exist on the shipped runtime floor:
   - `engines.vscode` and `engines.node` (root `package.json`)
   - `devEngines.runtime` (root `package.json`) — mirrors `engines.node`; a partial bump desyncs it. `devEngines.packageManager`, alongside it, pins the *npm* floor instead — a separate, dev-toolchain-only concern that this document does not govern, but with an invariant this list still has to protect: that floor must stay ≤ the npm bundled by `.nvmrc`'s Node, or every setup path (contributor and CI alike) needs an explicit `npm i -g` step. Bumping `.nvmrc` down (or the `devEngines.packageManager` floor up) can break that silently — and if it holds, re-pin the global `npm install -g npm@…` calls in the CI floor job and `acceptance/Dockerfile` to whatever npm the new `.nvmrc` bundles
   - root `@types/node`
   - `client/package.json`'s `@types/vscode`
   - `tsconfig.base.json`'s `target` and `lib` (copy the values from the matching Node-version preset in [tsconfig/bases](https://github.com/tsconfig/bases) — see above for why we copy rather than `extends`)
   - `esbuild.mjs`'s `target` (the `client` and `server` build calls)
   - the floor `node-version` in the `health-check.yml` CI `include` job (the *dev* jobs read `.nvmrc` automatically and don't need a separate edit)
3. If the `lib` bump requires a newer TypeScript feature, raise the `typescript` devDependency range in root `package.json` to match (see the release-notes link above).
4. Update the "Current floor" line at the top of this document.
5. Run `npm run compile && npm test` to confirm the new floor builds and passes.
