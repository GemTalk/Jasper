# Raising the VS Code / Node version floor

**Current floor:** see `engines.vscode` / `engines.node` in the root `package.json` for the VS Code/Node floor, and the `@typescript/native` devDependency range there for the compiler floor. That alias — not the `typescript` one — is the compiler: `typescript` is deliberately aliased to the TS 6 API package, which only typescript-eslint reads (see the [TypeScript 7 note](#typescript-7-is-installed-under-an-alias) below).

## Why the floor is what it is

Jasper's runtime floor is dictated by `engines.vscode`: VS Code bundles a specific Electron/Node build, and that bundled Node is the actual lowest common denominator the extension runs on — regardless of what `@types/node` or local dev tooling assume.

We want the floor as far back as reasonably possible, to keep supporting users on VS Code installs that haven't auto-updated recently. Two independent ceilings limit how far back we're willing to go — whichever one lands on the *more recent* release wins:

1. **Node LTS support.** The bundled Node must still be an actively-maintained LTS, not EOL — an EOL Node no longer receives security patches, so the extension's stated runtime floor would be unpatched.
2. **Adoption ceiling, ~1 year.** Even when an older release's Node hasn't gone EOL yet, we don't chase VS Code installs back indefinitely. About a year is judged enough time for the userbase to have auto-updated past very old releases, so reaching back further has diminishing returns and just adds support burden.

Look up the VS Code → Electron → Node mapping at [github.com/ewanharris/vscode-versions](https://github.com/ewanharris/vscode-versions) to check both bounds when re-evaluating the floor.

`tsconfig.base.json`'s `target` and `lib` values are sourced from [github.com/tsconfig/bases](https://github.com/tsconfig/bases)' preset for the Node version matching the floor (e.g. its `nodeNN` preset for whichever Node major the floor bundles). We can't `extends` that package directly, though: its presets assume ESM (`"module": "node16"`/`"nodenext"`), while this project compiles to `"module": "commonjs"` — so the matching preset's `target`/`lib` fields are copied in by hand instead of pulled in via `extends`.

Both `@types` ranges are deliberately pinned tight rather than left on a caret, and both use the same shape for the same reason.

Both are DefinitelyTyped releases, so in both cases the patch digit is DT's own revision counter rather than the upstream project's — a single minor can pick up several corrections that all describe the same API surface. Both therefore take a **tilde** on the floor's minor: `@types/vscode` mirrors `engines.vscode`'s minor, `@types/node` mirrors the bundled Node's minor. Same API surface as the floor, best-known description of it.

The `@typescript/native` devDependency range is a separate, compiler-version concern rather than a Node-runtime one — it just needs to stay new enough to recognize whatever `tsconfig.base.json`'s `lib` array declares. Check the [TypeScript release notes](https://www.typescriptlang.org/docs/handbook/release-notes/) for the minimum version that ships each `lib` entry whenever `lib` changes.

## How to raise it

1. Using the [vscode-versions](https://github.com/ewanharris/vscode-versions) mapping, find both bounds and take whichever is more recent:
   - the earliest VS Code release whose bundled Node is still an actively-maintained LTS (not EOL), and
   - the VS Code release from about a year ago.

   That release is the new floor; note its bundled Node version.
2. Update all of these together — they encode the same runtime floor and are a **coordinated set, not independent knobs**. A partial bump lets the type checker or bundler assume APIs that don't exist on the shipped runtime floor:
   - `engines.vscode` and `engines.node` (root `package.json`)
   - `devEngines.runtime` (root `package.json`) — mirrors `engines.node`; a partial bump desyncs it. `devEngines.packageManager`, alongside it, pins the *npm* floor instead — a separate, dev-toolchain-only concern that this document does not govern, but with an invariant this list still has to protect: that floor must stay ≤ the npm bundled by `.nvmrc`'s Node, or every setup path (contributor and CI alike) needs an explicit `npm i -g` step. Bumping `.nvmrc` down (or the `devEngines.packageManager` floor up) can break that silently — and if it holds, re-pin the global `npm install -g npm@…` calls in the CI floor job and `acceptance/Dockerfile` to whatever npm the new `.nvmrc` bundles
   - root `@types/node` — keep it a **tilde** on the floor's Node minor, never a caret; see above for why the shape matters
   - `client/package.json`'s `@types/vscode` — keep it a **tilde** on `engines.vscode`'s minor, never a caret; see above
   - `tsconfig.base.json`'s `target` and `lib` (copy the values from the matching Node-version preset in [tsconfig/bases](https://github.com/tsconfig/bases) — see above for why we copy rather than `extends`)
   - `esbuild.mjs`'s `target` (the `client` and `server` build calls)
   - the floor `node-version` in the `health-check.yml` CI `include` job (the *dev* jobs read `.nvmrc` automatically and don't need a separate edit)
3. If the `lib` bump requires a newer TypeScript feature, raise the `@typescript/native` devDependency range in root `package.json` to match (see the release-notes link above). Leave the `typescript` alias alone — it tracks typescript-eslint's needs, not the compiler's.
4. Run `npm run compile && npm test` to confirm the new floor builds and passes.

## TypeScript 7 is installed under an alias

TypeScript 7 is the native Go compiler, and it ships **no JS API** — the `typescript` module's entry point is now just a version string. typescript-eslint reads that API, and refuses to load when it finds a major of 7 or above ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)), which would take out every type-aware lint rule in `eslint.config.mjs`.

So the root `package.json` uses the [side-by-side layout](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0) TypeScript recommends, with two npm aliases:

| devDependency | Resolves to | Provides | Read by |
| --- | --- | --- | --- |
| `@typescript/native` | `typescript@7` | the `tsc` bin | every `compile:*` script, and `watch` |
| `typescript` | `@typescript/typescript6` | the TS 6 JS API, plus a `tsc6` bin nothing calls | typescript-eslint only |

Consequences worth knowing:

- **Type checking and type-aware linting run on different compilers.** `npm run compile` is TS 7; `npm run lint` type-checks through TS 6. A disagreement between them is possible in principle, and would show up as a rule firing (or not) against code `tsc` is happy with.
- **`lint:lockfile` has to name the aliases.** `lockfile-lint --validate-package-names` rejects every npm alias, so the script carries three `--allowed-package-name-aliases` entries — the two above, plus `@typescript/old`, which is how `@typescript/typescript6` aliases TS 6 internally.
- **Don't point VS Code at the workspace TypeScript.** `node_modules/typescript/lib` has no `tsserver.js` under this layout, so `typescript.tsdk` set to it will not load. Use the editor's bundled TypeScript (the default — no workspace setting pins it).

Undo all of this once typescript-eslint supports TS >= 7.1: drop `@typescript/native`, put `typescript` back on a plain `^7` range, and strip the `--allowed-package-name-aliases` flags from `lint:lockfile`.
