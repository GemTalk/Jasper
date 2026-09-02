---
paths:
  - 'client/src/gciLibrary.ts'
  - 'client/src/__tests__/gci/**'
---

# GCI / native library

The GCI library (`libgcits`) is a platform-native `.so`/`.dylib`/`.dll` bundled with each GemStone distribution. `gciLibrary.ts` loads it at runtime via [koffi](https://github.com/Koromix/koffi) (FFI). All GemStone VM calls go through here. When adding new GCI calls, follow the struct and pointer patterns already in that file.

`GciLibrary` also has an ergonomic layer on top of the raw `GciTsXxx` wrappers (see the class-level doc comment in `gciLibrary.ts`). When adding a new ergonomic method: throw `GciLibraryError` (via `throwUnless`/`throwOnIllegalOop`, or `GciLibraryError.fromGciError`/`.withMessage` directly) instead of returning a `{success, err}`/`{result, err}` pair, and document it with JSDoc — including a `@throws {GciLibraryError}` line whenever the method can throw.

`client/src/gciLibrary/optionalFunctions.ts` is the single source of truth for which GCI bindings are optional and why (`addedIn`/`absentOn`/`removedIn`). Binding a symbol with `optionalFunc` requires adding it to this registry — `_optional` in `gciLibrary.ts` is a mapped type over the registry's keys, so a missing or stale entry is a compiler error. Floors recorded there aren't hand-claimed: `client/src/gciLibrary/__tests__/optionalFunctions.headers.test.ts` verifies every entry against the parsed headers in `vendor/gci-headers/`, in both directions.

Every symbol in that registry is gated out of production code by `client/src/__tests__/gciOptionalityGate.test.ts`. A version- or platform-conditional fallback belongs **inside** `client/src/gciLibrary/gciLibrary.ts`: optionality is the binding layer's knowledge, so code above it calls a helper rather than pairing `isAvailable`/`supportsNonBlockingLogin` with a raw optional binding. The gate's `ALLOWED_OPTIONAL_FUNCTION` list holds the three call sites that predate this rule; don't add to it.

For details on the GCI cross-version compatibility enforcement read the docs [here](../../../docs/explanation/gci-version-compatibility.md). **Supporting a new GemStone release includes vendoring its headers**: every check above resolves an unvendored release to "present everywhere", which is the unsafe default.

`vendor/gci-headers/` contains vendor snapshots of the GCI header files (`gcits.hf`, `gci.ht`, `gcicmn.ht`, `gcits.ht`) — the authoritative reference for GCI function signatures, struct layouts, and constants. It holds one folder per distinct header content revision (several GemStone patch releases share identical headers); see `vendor/gci-headers/versions.md` for which GemStone version maps to which folder.

## The on-demand `gci` suite (`npm run test:gci`) — legacy, being retired

`client/src/__tests__/gci/**` is a separate vitest project named `gci` (in `client/vitest.config.ts`), excluded from `npm test` (which runs the `default` project); run it with `npm run test:gci` (`--project gci`). It reads its connection from `.env.test` (`VITE_GEMSTONE_*`, written by `npm run test:server:start`) via `client/src/__tests__/gci/gciTestConfig.ts`; `GCI_LIBRARY_PATH` / `GS_*` shell vars are honored as a fallback for a custom stone. Needs a running stone at localhost.

Because it is excluded from `npm test`, **nothing in this project runs in CI** — it only ever runs on demand, locally. Its tests are being migrated to `useIntegrationTest` integration tests that do run, across the release matrix. Treat the directory as closed: move tests out of it rather than adding to it, and consult "Choosing where a stone-dependent test lives" in `.claude/rules/client/tests.md` for the narrow set of cases that still belong here — a plain commit doesn't automatically qualify anymore, since `allowedCommits` covers _some_ committing scenarios (see [the harness reference](../../../docs/reference/integration-test-harness.md) for which ones — instance migration and repository replacement are known cases it does not cover).
