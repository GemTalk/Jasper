# gciLibrary

The beginning of a home for the layer that wraps the GCI C library (`libgcits`, loaded
through koffi). It is meant to absorb that logic progressively, over several PRs. Today it
is intentionally incomplete.

Do not read the current arrangement as the target layout. It is not settled, and each PR
moves another slice.

## What is here, and why only this

`__tests__/` mostly holds integration tests for the **raw bindings** — the wrappers that are
1:1 with a GCI C entry point (`GciTs*`, plus the session-free `Gci*` host utilities), with one
deliberate exception: the login wrappers force `GCI_LOGIN_QUIET` into `loginFlags` — see
`quietedLoginFlags` in `client/src/gciLibrary.ts`. It also now holds unit tests for this
folder's own production modules, such as `headerDeclarations.test.ts`.

The narrow scope of the raw-binding tests is deliberate. They can move without touching the
wrapper code, which keeps this first step reviewable. The ergonomic layer on top of the
bindings, and its tests, have not moved.

## A resolution trap to know about

From inside this folder, `import { GciLibrary } from '../../gciLibrary'` resolves to the
**file** `client/src/gciLibrary.ts`, not to this directory. It works only because
file-over-directory module resolution wins. Adding an `index.ts` here would silently
redirect every one of those imports into this folder without a single import line changing.
