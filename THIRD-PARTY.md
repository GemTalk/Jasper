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

## Enhanced Inspector (feenk GToolkit remote inspector, and its dependencies)

- **What:** the GemStone-side support for the Enhanced Inspector — feenk's
  GToolkit remote-inspector protocol (`RemotePhlow` objects and views), its
  wire encoding, the GT4GemStone bindings, and the three libraries they need on
  the stone: GemTalk's RemoteServiceReplication transport, GemTalk's
  Announcements framework, and STON serialization.
- **Where in this repo:** `resources/enhancedInspector/*.gs` — seven generated
  payload files, shipped verbatim in the VSIX and filed into a stone (into the
  dedicated `GsEnhancedInspector` dictionary) by the extension's "Install Server
  Support" command. Unlike the AST-Core component above, **no vendored source is
  kept in this repo**: `gs-src/enhancedInspector/` holds only build tooling.
- **Obtained via:** local checkouts of the upstream repos in
  `$ROWAN_PROJECTS_HOME`, copied by
  `gs-src/enhancedInspector/build/update_enhanced_inspector_support.sh` and then
  post-processed by `gs-src/enhancedInspector/build/apply_jasper_transforms.sh`.
  The `.gs` files themselves are Rowan/topaz exports produced *by those upstream
  projects* (their own `src-gs/` directories), not by Jasper.
- **Modifications:** two deterministic, behaviour-preserving transforms applied
  by `apply_jasper_transforms.sh` — (1) a per-file attribution header is
  prepended, and (2) class placement is rewritten from upstream's `Globals` to
  the dedicated `GsEnhancedInspector` dictionary, so the whole payload can be
  removed by dropping one dictionary. Otherwise verbatim.
- **License:** MIT throughout — but across **six** upstream repos with **seven**
  distinct copyright holders. See the table and the notices below.

### Per-file provenance

| Payload file | Copied from (repo / path) | Upstream project | Copyright holder per that project's `LICENSE` |
|---|---|---|---|
| `gt4gemstone.gs` | `feenkcom/gt4gemstone` — `src-gs/gt4gemstone.gs` | same | feenk (2021) |
| `patch-gemstone.gs` | `feenkcom/gt4gemstone` — `src-gs/patch-gemstone.gs` | same | feenk (2021) |
| `gtoolkit-remote.gs` | `feenkcom/gtoolkit-remote` — `src-gs/gtoolkit-remote.gs` | same | Juraj Kubelka (2019) |
| `gtoolkit-wireencoding.gs` | `feenkcom/gtoolkit-wireencoding` — `src-gs/gtoolkit-wireencoding.gs` | same | feenk (2024) |
| `RemoteServiceReplication.gs` | `GemTalk/RemoteServiceReplication` — `src-gs/bootstrapRSR.gs` | same | GemTalk Systems (2017–2024) |
| `Announcements.gs` | `feenkcom/gt4gemstone` — `src-gs/Announcements.gs` | `GemTalk/Announcements` | GemTalk Systems (2020–2021) |
| `STON.gs` | `feenkcom/gt4gemstone` — `src-gs/STON.gs` | `svenvc/ston`; GemStone port in `GemTalk/Rowan` | Sven Van Caekenberghe (2012); Dale Henrichs (2018) for the Rowan port |

`LICENSE` files, in the same order:

- <https://github.com/feenkcom/gt4gemstone/blob/main/LICENSE>
- <https://github.com/feenkcom/gtoolkit-remote/blob/main/LICENSE>
- <https://github.com/feenkcom/gtoolkit-wireencoding/blob/main/LICENSE>
- <https://github.com/GemTalk/RemoteServiceReplication/blob/main-v2/LICENSE>
- <https://github.com/GemTalk/Announcements/blob/main/LICENSE>
- <https://github.com/svenvc/ston/blob/master/LICENSE> and
  <https://github.com/GemTalk/Rowan/blob/masterV3.4/LICENSE>

> Why the last two rows differ from the file they were copied out of:
> `gt4gemstone`'s `src-gs/Announcements.gs` and `src-gs/STON.gs` are *exports of
> other projects* that gt4gemstone's `scripts/convertRsrToGsFormat.topaz` writes
> into its own `src-gs/`; the packages inside them
> (`Announcements-Core-GemStone…`, `STON-Core` / `STON-GemStone-Kernel`) belong
> to `GemTalk/Announcements` and to STON respectively, not to feenk. The
> copyright holders above are the ones named in those projects' `LICENSE` files.

### MIT License

All six upstream repos (seven counting `GemTalk/Rowan` for the STON port) are
under the MIT License. The permission and warranty text is **word-for-word
identical** in all of them — they differ only in the copyright line, in whether
they carry an `MIT License` title, and in line wrapping. It is therefore
reproduced once here, under the full set of copyright notices:

```
Copyright (c) 2021 feenk                                 (gt4gemstone)
Copyright (c) 2019 Juraj Kubelka                         (gtoolkit-remote)
Copyright (c) 2024 feenk                                 (gtoolkit-wireencoding)
Copyright (c) 2017-2024 GemTalk Systems                  (RemoteServiceReplication)
Copyright (c) 2020-2021 GemTalk Systems                  (Announcements)
Copyright (C) 2012 Sven Van Caekenberghe                 (STON)
Copyright (c) 2018 Dale Henrichs                         (Rowan, STON GemStone port)

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
> - Verified against upstream: none of the seven payload `.gs` files carries a
>   per-class or per-method copyright/author notice of its own, so the applicable
>   terms are the repo-level `LICENSE` files linked above (the same situation as
>   AST-Core).
> - The copyright lines above are quoted from each project's `LICENSE` **as
>   written there** — note that they say `feenk`, not `feenk gmbh`, and
>   `GemTalk Systems`, not `GemTalk Systems, Inc.`, and that `gtoolkit-remote`
>   names an individual rather than the company.
> - **No upstream revision is recorded** for this payload, unlike the AST-Core
>   component (which pins RowanV3 3.7.5, build `cf61017e`). The `.gs` files were
>   generated from whatever the maintainer's `$ROWAN_PROJECTS_HOME` checkouts
>   held at the time, so provenance here is repo-level only. Recording the
>   upstream commit for each file on the next re-vendor would make this section
>   exact.
