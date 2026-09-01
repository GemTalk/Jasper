# GCI headers

Vendor snapshots of the GCI (GemStone C Interface) header files — `gci.ht`, `gcicmn.ht`, `gcits.hf`, `gcioop.ht`, `gcioc.ht`, `gcierr.ht`, and (from 3.7.2 onward) `gcits.ht` — copied verbatim from a GemStone server distribution's `include/` directory. They are the authoritative reference for GCI function signatures, struct layouts, and constants; not authored by this project, so don't edit them.

Three of them — `gcioop.ht`, `gcierr.ht`, and `gcioc.ht` — exist so that constants resolve without leaving the snapshot: `gcioop.ht` defines the well-known and class OOPs transcribed in `client/src/gciConstants.ts`, `gcierr.ht` the GCI error numbers branched on in code such as `client/src/debuggerPanel.ts`, and `gcioc.ht` completes `gci.ht`'s include chain. `versions.md` notes which further includes are deliberately left out and why.

One folder per **distinct header content revision**, named after the earliest GemStone version that shipped it. Several patch releases often ship byte-identical headers (see `versions.md`), so this avoids duplicate folders for content that hasn't changed.

`versions.md` maps every GemStone version we've checked to its content folder, with a sha256 per file and the date it was captured. Consult it before assuming a version not listed here is covered — an unlisted version simply hasn't been checked yet.

## These are load-bearing, not just reference

These headers are the ground truth that `client/src/gciLibrary/headerDeclarations.ts` parses and `optionalFunctions.headers.test.ts` checks the optional-function registry against — which in turn is what the `GciLibrary` bindings are type-checked against. See [GCI cross-version compatibility](../../docs/explanation/gci-version-compatibility.md) for the whole chain.

Two consequences:

- **Don't edit the header files.** They are verbatim vendor copies, hashed in `versions.md`; a local "fix" silently changes what the registry is verified against.
- **A GemStone release Jasper supports but hasn't vendored is not merely undocumented — it is answered wrongly.** Every check resolves "declared in all vendored revisions" to _required, present on every release_, so an unvendored release that dropped a symbol, or that added one we bind as required, passes every check and fails at `GciLibrary` construction on a user's install.

## Adding a new version

1. Install the GemStone distribution (or locate it under `~/Documents/GemStone/GemStone64Bit<version>-*/include/`).
2. Hash its header files — six before 3.7.2, seven from 3.7.2 on, since `gcits.ht` doesn't exist in earlier distributions — and compare against the entries in `versions.md`.
3. If the hashes match an existing folder exactly, just add a row to `versions.md` pointing at that folder — no new folder needed.
4. If any hash differs, create a new folder named after this version, copy those files in, and add a row.
5. Run `npm run lint:gci-headers` to confirm the new row matches the files on disk.
6. Run `npm test` — a genuinely new revision can move a floor in `client/src/gciLibrary/optionalFunctions.ts`, and `optionalFunctions.headers.test.ts` will fail and name the entry rather than silently adopting the new answer. That failure is the mechanism working: resolve it with a reviewed edit to the registry. A revision that _declares a new symbol_ fails the same test, and the fix is a registry entry plus a binding for it — Jasper binds every declared symbol, so bind the new one too rather than looking for a way to exempt it (`docs/explanation/gci-version-compatibility.md`, "The cost of an entry").
