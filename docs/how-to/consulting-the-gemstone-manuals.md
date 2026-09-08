# Consulting the official GemStone manuals

GemTalk publishes the GemStone/S 64 Bit manuals as PDFs. Having them locally
lets an agent working in this repo answer GemStone questions — topaz syntax,
configuration parameters, transaction semantics, error numbers — from the
manuals instead of guessing.

This is **entirely optional**. Nothing in the build, test, or install path
touches it, and no agent tooling downloads anything on its own.

## Getting them

```sh
npm run docs:fetch
```

That downloads 26 manuals (~22 MB) — the Programming Guide, System
Administration Guide, Topaz, and GemBuilder for C for both 3.6 and 3.7, plus
the per-patch Release Notes — into a shared cache and links it as `gs-docs/`.

Re-run it any time to pick up updates; it compares against the
catalog's published timestamps and re-downloads only what changed, so a
no-op run costs two HTTP requests.

```sh
npm run docs:fetch -- --where          # print the cache path, download nothing
npm run docs:fetch -- --list           # show the catalog, download nothing
npm run docs:fetch -- --force          # re-download everything
npm run docs:fetch -- --versions 3.7.x # one doc version only
```

The cache lives outside the repo so every git worktree shares one download
rather than carrying its own 22 MB. It resolves per platform:

| Platform | Cache directory |
| --- | --- |
| macOS | `~/Library/Caches/gemstone-docs` |
| Linux / WSL | `$XDG_CACHE_HOME/gemstone-docs`, else `~/.cache/gemstone-docs` |
| Windows | `%LOCALAPPDATA%\gemstone-docs` |

`GS_DOCS_DIR` overrides all three — set it to share one directory across
checkouts, or to move the cache off a small system volume. `--where` prints
whichever path applies on your machine.

`gs-docs/` in the repo root links to that cache (a directory junction on
Windows, which needs neither elevation nor Developer Mode). If the link cannot
be created the download still succeeds; the script then tells you to set
`GS_DOCS_DIR` to the cache path, and the agent skill checks that variable and
`--where` before concluding the manuals are missing.

## How the agent uses this

`.claude/skills/gemstone-docs/` tells the agent where the manuals are, how to
search them, and which manual answers what. It **never downloads them** — if
`gs-docs/` is missing it answers from the other available sources and, at
most once, mentions that `npm run docs:fetch` exists.
