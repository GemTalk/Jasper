---
paths:
  - "client/src/gciLibrary.ts"
  - "client/src/__tests__/gci/**"
---

# GCI / native library

The GCI library (`libgcits`) is a platform-native `.so`/`.dylib`/`.dll` bundled with each GemStone distribution. `gciLibrary.ts` loads it at runtime via [koffi](https://github.com/Koromix/koffi) (FFI). All GemStone VM calls go through here. When adding new GCI calls, follow the struct and pointer patterns already in that file.

`GciLibrary` also has an ergonomic layer on top of the raw `GciTsXxx` wrappers (see the class-level doc comment in `gciLibrary.ts`). When adding a new ergonomic method: throw `GciLibraryError` (via `throwUnless`/`throwOnIllegalOop`, or `GciLibraryError.fromGciError`/`.withMessage` directly) instead of returning a `{success, err}`/`{result, err}` pair, and document it with JSDoc — including a `@throws {GciLibraryError}` line whenever the method can throw.

`docs/3.7/` contains the GCI header files (`gcits.hf`, `gci.ht`, `gcicmn.ht`, `gcits.ht`) — the authoritative reference for GCI function signatures, struct layouts, and constants.

## The on-demand `gci` suite (`npm run test:gci`) — legacy, being retired

`client/src/__tests__/gci/**` is a separate vitest project named `gci` (in `client/vitest.config.ts`), excluded from `npm test` (which runs the `default` project); run it with `npm run test:gci` (`--project gci`). It reads its connection from `.env.test` (`VITE_GEMSTONE_*`, written by `npm run test:server:start`) via `client/src/__tests__/gci/gciTestConfig.ts`; `GCI_LIBRARY_PATH` / `GS_*` shell vars are honored as a fallback for a custom stone. Needs a running stone at localhost.

Because it is excluded from `npm test`, **nothing in this project runs in CI** — it only ever runs on demand, locally. Its tests are being migrated to `useIntegrationTest` integration tests that do run, across the release matrix. Treat the directory as closed: move tests out of it rather than adding to it, and consult "Choosing where a stone-dependent test lives" in `.claude/rules/client/tests.md` for the narrow set of cases that still belong here.
