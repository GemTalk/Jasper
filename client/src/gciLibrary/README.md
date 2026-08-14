# gciLibrary

The beginning of a home for the layer that wraps the GCI C library (`libgcits`, loaded
through koffi). It is meant to absorb that logic progressively, over several PRs. Today it
is intentionally incomplete: it holds tests and nothing else, and the module it is named
after still lives one level up, at `client/src/gciLibrary.ts`.

Do not read the current arrangement as the target layout. It is not settled, and each PR
moves another slice.

## What is here, and why only this

`__tests__/` holds integration tests for the **raw bindings** only — the wrappers that are
1:1 with a GCI C entry point (`GciTs*`, plus the session-free `Gci*` host utilities).

The narrow scope is deliberate. Raw-binding tests can move without touching the wrapper
code, which keeps this first step reviewable. The ergonomic layer on top of the bindings,
and its tests, have not moved.

## A resolution trap to know about

From inside this folder, `import { GciLibrary } from '../../gciLibrary'` resolves to the
**file** `client/src/gciLibrary.ts`, not to this directory. It works only because
file-over-directory module resolution wins. Adding an `index.ts` here would silently
redirect every one of those imports into this folder without a single import line changing.
