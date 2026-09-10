// The client program spans the extension host (Node) and the webviews (DOM), so
// it needs the DOM lib on top of tsconfig.base.json's list. `lib` in a tsconfig
// replaces rather than merges, so naming it there would mean re-stating the base
// entries with nothing keeping the two in sync; a lib reference here is additive.
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
