---
name: gemstone-docs
description: Search the official GemStone/S 64 Bit manuals (Programming Guide, System Administration Guide, Topaz, GemBuilder for C, Release Notes) for authoritative GemStone behavior — topaz command syntax, configuration parameters, transaction and session semantics, error numbers, or which release introduced a feature. Use when a task needs a GemStone fact that this repo's own code does not define. The manuals are an optional local download that may not be present; this skill never downloads them.
---

# Consulting the GemStone manuals

GemTalk's official manuals, when a developer has downloaded them, live at
`gs-docs/` in the repo root (a symlink to a shared cache — the PDFs themselves
are never committed, and `gs-docs/` is gitignored).

## First: are they here?

Usually `gs-docs/` in the repo root. That is a link into a shared cache, and
on a machine where the link could not be created the manuals may still be
downloaded — so check the fallbacks before concluding they are missing:

```sh
ls gs-docs/*.pdf 2>/dev/null ||
  ls "${GS_DOCS_DIR:-/nonexistent}"/*.pdf 2>/dev/null ||
  ls "$(node scripts/fetch-gs-docs.mjs --where)"/*.pdf 2>/dev/null
```

Do not pipe those into `head`: a pipeline exits with the status of its *last*
command, so `head` would report success even where `ls` found nothing and the
two fallbacks would never run.

`--where` only prints the resolved cache path; it touches no network and
downloads nothing. Use whichever directory answers, in place of `gs-docs/`
in the commands below.

**If none of them returns anything, stop — do not download anything.** The
manuals are opt-in and only a human runs the fetch. Answer the question from
the sources you do have (see "When the manuals are absent" below).

## Searching them

`pdfgrep` is the right tool. Its `-C` context flag works even though
`--help` does not list it, and a PDF's narrow page column means `-C 6`
returns a tight, well-sized window — usually the whole answer, with code
indentation intact.

```sh
# Across every manual, both versions:
pdfgrep -n -C 6 'abortTransaction' gs-docs/*.pdf

# One manual, when you know where it lives:
pdfgrep -n -C 6 'replaceFrom:' gs-docs/GS64-ProgGuide-3.7.pdf
```

Hits are reported as `PAGE: matching line`. When the context window is not
enough, read that page:

```sh
pdftotext -f 58 -l 58 -layout gs-docs/GS64-ProgGuide-3.7.pdf -
```

A page is ~2.5 KB of text, so reading one is cheap. Prefer it over widening
`-C` past ~10, which starts pulling in unrelated sections.

**If `pdfgrep` is not installed**, that is fine — do not treat it as an error
and do not install it. Use the Read tool on the PDF with its `pages:`
parameter instead, navigating from the manual's table of contents. Searching
is coarser without it. Mention once that `brew install pdfgrep` /
`apt install pdfgrep poppler-utils` would make this faster, then move on.

## Which manual answers what

| Manual | Answers |
| --- | --- |
| `GS64-ProgGuide` | Smalltalk-level semantics: collections, transactions, indexing, exceptions, class creation, SUnit, FFI |
| `GS64-SysAdminGuide` | stone/gem/NetLDI operation, configuration parameters, backups, logins, security |
| `GS64-Topaz` | topaz command syntax and its `%`-terminated input format |
| `GS64-GemBuilderforC` | the GCI C API — call semantics, argument conventions, error handling |
| `GS64-ReleaseNotes-<patch>` | what changed in one specific patch release |

## Version granularity — the trap

The four reference manuals are published **per minor version only**. There is
one `GS64-ProgGuide-3.7.pdf` covering all of 3.7.x. They therefore *cannot*
answer a patch-level question such as "did this change in 3.7.5?".

- Minor-level difference (3.6 vs 3.7) → compare the two manuals.
- Patch-level difference → `GS64-ReleaseNotes-<patch>.pdf`, which *is*
  per-patch, or `vendor/gci-headers/` for anything in the C API (it holds
  hash-verified headers for 12 individual patch releases).

Always say which manual and version you answered from — "per ProgGuide 3.7"
— so a reader can tell whether the answer covers the version they run.

## Trust

The manuals are vendor prose and may contain errors and stale passages. When
they disagree with something checkable, the checkable source wins:

- For GCI signatures, struct layouts, constants, and error numbers,
  `vendor/gci-headers/` is authoritative — those files were verified by hash
  against real installs.
- For the behavior of a Smalltalk selector, a live stone queried through the
  `jasper` MCP tools is authoritative — but it only ever reflects the one
  version that happens to be running, so it cannot settle cross-version
  questions on its own.

## When the manuals are absent

Answer from `vendor/gci-headers/` and the live stone as usual. Only if the
manuals would genuinely have been the right source — a topaz command, a
configuration parameter, a "why does GemStone work this way" — add a single
closing line noting they are not installed and that `npm run docs:fetch`
installs them. Do not repeat that note within a session, and never raise it
when the other sources already answered the question.
