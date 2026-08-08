# Raising the VS Code / Node version floor

**Current floor:** VS Code `1.101.0` → bundled Node `22.15.1`. TypeScript is a dual-install: `npm run compile` / CI compile via `tsgo` (`typescript@7.0.2`, exact-pinned), while `typescript` itself stays at `>=6.0.3 <6.1.0` solely so typescript-eslint's type-aware rules keep working — see the version-split section below.

## Why the floor is what it is

Jasper's runtime floor is dictated by `engines.vscode`: VS Code bundles a specific Electron/Node build, and that bundled Node is the actual lowest common denominator the extension runs on — regardless of what `@types/node` or local dev tooling assume.

We want the floor as far back as reasonably possible, to keep supporting users on VS Code installs that haven't auto-updated recently. Two independent ceilings limit how far back we're willing to go — whichever one lands on the *more recent* release wins:

1. **Node LTS support.** The bundled Node must still be an actively-maintained LTS, not EOL — an EOL Node no longer receives security patches, so the extension's stated runtime floor would be unpatched.
2. **Adoption ceiling, ~1 year.** Even when an older release's Node hasn't gone EOL yet, we don't chase VS Code installs back indefinitely. About a year is judged enough time for the userbase to have auto-updated past very old releases, so reaching back further has diminishing returns and just adds support burden.

Look up the VS Code → Electron → Node mapping at [github.com/ewanharris/vscode-versions](https://github.com/ewanharris/vscode-versions) to check both bounds when re-evaluating the floor. Currently the two coincide: the release from about a year ago is also the earliest one bundling Node `22`, which is still an actively-maintained LTS.

`tsconfig.base.json`'s `target` and `lib` values are sourced from [github.com/tsconfig/bases](https://github.com/tsconfig/bases)' preset for the Node version matching the floor (e.g. its `node22` preset for Node `22`). We can't `extends` that package directly, though: its presets set `"module": "nodenext"`, which tracks whatever module-resolution algorithm the *installed* TypeScript ships as "current" — `tsconfig.base.json` deliberately pins `"module": "node16"` instead, a fixed spec point, so the resolution behavior doesn't shift under us on a compiler bump. So the matching preset's `target`/`lib` fields are copied in by hand instead of pulled in via `extends`.

The `typescript`/`tsgo` devDependency ranges are a separate, compiler-version concern rather than a Node-runtime one — both just need to stay new enough to recognize whatever `tsconfig.base.json`'s `lib` array declares. Check the [TypeScript release notes](https://www.typescriptlang.org/docs/handbook/release-notes/) for the minimum version that ships each `lib` entry whenever `lib` changes. `tsgo`'s floor moves freely (it has no JS-API consumer to constrain it), but the plain `typescript` devDependency's *ceiling* is set by typescript-eslint's peer range (`>=4.8.4 <6.1.0` as of `typescript-eslint@8`) — raising it past that range breaks `npm install` with `ERESOLVE`, independent of what `lib` needs.

## How to raise it

1. Using the [vscode-versions](https://github.com/ewanharris/vscode-versions) mapping, find both bounds and take whichever is more recent:
   - the earliest VS Code release whose bundled Node is still an actively-maintained LTS (not EOL), and
   - the VS Code release from about a year ago.

   That release is the new floor; note its bundled Node version.
2. Update all of these together — they encode the same runtime floor and are a **coordinated set, not independent knobs**. A partial bump lets the type checker or bundler assume APIs that don't exist on the shipped runtime floor:
   - `engines.vscode` and `engines.node` (root `package.json`)
   - root `@types/node`
   - `client/package.json`'s `@types/vscode`
   - `tsconfig.base.json`'s `target` and `lib` (copy the values from the matching Node-version preset in [tsconfig/bases](https://github.com/tsconfig/bases) — see above for why we copy rather than `extends`)
   - `esbuild.mjs`'s `target` (the `client` and `server` build calls)
   - the floor `node-version` in the `health-check.yml` CI `include` job (the *dev* jobs read `.nvmrc` automatically and don't need a separate edit)
3. If the `lib` bump requires a newer TypeScript feature, raise **both** `typescript` and `tsgo` devDependency ranges in root `package.json` to match (see the release-notes link above). `tsgo` can move to whatever `typescript@7.x` picks up the feature; `typescript`'s new floor must still fit under typescript-eslint's peer ceiling — if the required feature landed after that ceiling, the dual-install itself is blocked and needs a separate decision, not a version bump.
4. Update the "Current floor" line at the top of this document.
5. Run `npm run compile && npm test` to confirm the new floor builds and passes.

## The three-way TypeScript version split

Editor, lint, and compile each run a different TypeScript version, and that's deliberate — `.vscode/settings.json` (where you'd normally pin the editor to the workspace version) stays gitignored, so the split is documented here instead:

| Where | Version | Source |
|---|---|---|
| Editor IntelliSense | ~5.8 | VS Code bundled |
| ESLint (type-aware rules) | 6.0.x | `node_modules/typescript` |
| `npm run compile` / CI | 7.0.2 | `node_modules/tsgo` |

**CI is the gate, the editor is not.** A dev who wants TS 6 semantics in-editor (matching what ESLint's type-aware rules actually see) runs *TypeScript: Select Version → Use Workspace Version* from the command palette. This divergence is exactly what let the `client/` jsdom breakage and the `mcp-server/` rootDir bug hide for as long as they did — the editor's own (bundled) TypeScript never saw either error — worth naming explicitly rather than leaving implicit.
