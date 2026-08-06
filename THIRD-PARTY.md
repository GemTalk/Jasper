# Third-party software

Jasper (`gemstone-ide`) is licensed under the MIT License (see `LICENSE`). It
also incorporates vendored third-party source, listed here with its origin and
license.

---

## Pharo AST-Core (Refactoring Browser AST)

- **What:** the abstract syntax tree, parser, scanner, and parse-tree rewriter
  used by the server-side refactoring engine — `RBParser`,
  `RBParseTreeRewriter`, `RBParseTreeSearcher`, `RB*Node`/`RB*Token`,
  `RBScanner`, `RBSmallDictionary`, `RBConfigurableFormatter`, and the
  `AST-Kernel-Core` kernel-class extensions.
- **Where in this repo:** `gs-src/refactoring/vendor/rowanv3-ast/` (verbatim
  Tonel); compiled into the shipped payload `resources/refactoring/ast-core.gs`
  by `gs-src/refactoring/build/build-ast-payload.sh`.
- **Origin:** the Refactoring Browser, originally by John Brant and Don Roberts,
  as maintained in the Pharo project's `AST-Core` package:
  <https://github.com/pharo-project/pharo/tree/v12.0.0/src/AST-Core>.
- **Obtained via:** GemStone RowanV3, released 3.7.5 (Build `cf61017e`),
  `projects/RowanV3/rowan/src/` (packages `AST-Core`, `AST-Kernel-Core`,
  `AST-Tests-Core`). This — not the GitHub link above — is the exact source of
  the vendored bytes; the GitHub link is the canonical upstream for lineage and
  for diffing on a re-vendor.
- **License:** MIT — Pharo `LICENSE`:
  <https://github.com/pharo-project/pharo/blob/v12.0.0/LICENSE>.
- **Modifications:** verbatim except one behaviour-preserving adaptation applied
  at build time (`Rowan globalNamed:` → `System myUserProfile symbolList
  objectNamed:`) so the engine loads on a non-Rowan stone. Detailed in
  `gs-src/refactoring/vendor/rowanv3-ast/PROVENANCE.md`.

### MIT License

```
The MIT License (MIT)

Copyright (c) 2008-2019 The Pharo Project, and Contributors
The Refactoring Browser AST vendored here was originally authored by
John Brant and Don Roberts.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> Notes:
> - Verified against upstream: the vendored `AST-Core` files (and the RowanV3
>   Tonel we copied) carry **no per-file copyright/license/author header**, so the
>   applicable terms are the package-level Pharo `LICENSE` linked above.
> - The full Pharo `LICENSE` is MIT with some parts under the Apache License, and
>   also lists Inria, Viewpoints Research Institute, and Apple Inc. (1996)
>   copyrights. Those cover **Squeak-descended parts of the whole Pharo image**,
>   not the Refactoring Browser AST vendored here (a distinct Brant/Roberts
>   lineage), so only the Pharo Project copyright above is reproduced for this
>   component. See the linked `LICENSE` for the complete picture.

---

## Microsoft codicons (icon font)

- **What:** the icon font the GemStone Manager panel draws every glyph with —
  `codicon.ttf` and the `codicon.css` that declares its `@font-face` and glyph
  classes. A webview inherits none of VS Code's own fonts, so the panel loads
  these two files itself through `asWebviewUri`.
- **Where in this repo:** not vendored. Taken as the `@vscode/codicons`
  production dependency and shipped **verbatim in the `.vsix`** from
  `node_modules/@vscode/codicons/dist/`, which two `!` lines in `.vscodeignore`
  keep out of the wholesale `node_modules/**` exclusion.
- **Origin:** <https://github.com/microsoft/vscode-codicons>.
- **License:** the icons are **CC BY 4.0** (the package's `LICENSE`, and its
  `license` field); the accompanying code is **MIT** (its `LICENSE-CODE`). Only
  the font and its stylesheet ship here, so the CC BY 4.0 attribution below is
  what applies.
- **Modifications:** none — both files ship byte-for-byte as published.

### Attribution (CC BY 4.0)

```
Copyright (c) Microsoft Corporation.
"codicons" by Microsoft, licensed under CC BY 4.0:
https://creativecommons.org/licenses/by/4.0/
```

> Note: the two shipped files are pinned by a guard in
> `client/src/__tests__/vscodeignoreShippedAssets.test.ts` — losing either the
> whitelist or the production dependency would leave every glyph in the panel a
> blank box, and only in the packaged extension.
