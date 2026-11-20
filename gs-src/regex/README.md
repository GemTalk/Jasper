# Regex support (server plugin)

Regex support lets GemStone Search find methods whose source matches a regular expression. It is the server plugin's third feature, beside the refactoring engine and the Enhanced Inspector, and it installs, reports and uninstalls the same way they do. It loads on every supported GemStone release (3.6.2 and later) and adds no methods to any kernel class.

The library is a modified version of Vassili Bykov's Regular Expression Matcher, as GLASS ships it. `vendor/glass-regex/PROVENANCE.md` lists what Jasper changes and why, and the repository root's `THIRD-PARTY.md` and `NOTICE` carry both licenses.

## What it can match

1. The usual building blocks: literal text, `.`, `*`, `+`, `?`, `|`, `( )`, `[...]` sets with ranges and `[^...]`, `^` and `$` (start and end of a line), and `\` escapes.
2. Classes: `\w` `\W` (word characters), `\d` `\D` (digits), `\s` `\S` (white space), `[[:alpha:]]` and the other named classes inside a set. `\b` `\B` `\<` `\>` match word boundaries.
3. Control characters: `\n` line feed, `\r` carriage return, `\t` tab, `\f` form feed, `\e` escape.
4. A colon is an ordinary character, so `printOn:` and `at:.*put:` search for exactly that text.
5. `_` is part of a word, as in other regex tools: `\<halt\>` finds `self halt` and `self halt: 'x'` but not `_halt:`.

Not supported, and refused with a message rather than misread: counted repetition such as `a{3}`; `(?...)` groups (non-capturing groups, flags, lookaround); lazy and possessive quantifiers such as `*?` and `+?`; and a backslash before a letter or digit not listed above, such as the back-reference `\1` or `\x41`, which the library would otherwise read as that letter or digit itself. A `{` that is not a count is plain text.

## How a source search runs

`GsRegexSourceSearch` reads every method in the user's symbol list, instance and class side, and keeps the ones whose source matches.

1. **One line at a time.** The matcher recurses once per character it consumes, so a pattern such as `a.*b` over a long method overflows the stack. A line is short enough. A pattern with `\n` or `\r` asks to cross lines, so it is matched against whole methods instead; a method too long to match that way (or with one very long line) is counted as skipped. Any other error while matching a method is counted apart, as failed, so a fault is not reported as a method being too long.
2. **A quick test first.** When every match must contain some plain text (`GsRegex class >> requiredLiteralIn:`), a method without it is skipped with a substring test. On a 3.6.2 base image, `Ordered\w+` takes about 17 ms this way, against about 1.5 s for the matcher alone.
3. **Stop works.** Only errors are caught while matching. A badly written pattern such as `(a+)+b` can take time that doubles with each extra character, and Jasper's Stop (a soft break) ends it.
4. **Where the matches are.** For each method it returns, the search records where its matches are in the source (up to 100 per method), so GemStone Search can open the method at the first match and mark the others. A match across lines, in whole-method mode, is recorded as one range.

## Layout

| # | Path | What |
|---|---|---|
| 1 | `vendor/glass-regex/` | The library and its tests, verbatim from GLASS (filetree), with `PROVENANCE.md` and GLASS's `LICENSE` |
| 2 | `engine/` | Jasper's classes (Tonel): `GsRegex`, the entry point, and `GsRegexSourceSearch` |
| 3 | `loader/` | `GsRegexLoader`, which every install path uses |
| 4 | `tests/` | Jasper's Smalltalk tests: `GsRegexTest`, `GsRegexSourceSearchTest` |
| 5 | `build/` | `build-regex.sh`, `adapt-glass-regex.js` (applies and audits every change to the vendored code) and the generated-file headers |

The build writes `resources/regex/`: `regex-loader.gs`, `regex-core.gs`, `engine.gs` and `manifest.gs`, which ship in the VSIX, and `regex-tests.gs`, which does not. `load-regex.gs` there is the by-hand bootstrap and is not generated.

## Building

```sh
gs-src/regex/build/build-regex.sh
```

Run it after any change under `gs-src/regex/`, and commit the regenerated `resources/regex/*.gs` with the change. `client/src/regex/__tests__/regexBuild.test.ts` fails if the committed `regex-core.gs` no longer matches its source. The build reuses the refactoring engine's converter, `gs-src/refactoring/build/tonel-to-gs.js`.

## Installing

Jasper's **GemStone: Install Server Support** command installs it with the other features, over a short-lived SystemUser session. CI uses `npm run test:server:install-plugin`, which runs the same installer. Both file in `regex-loader.gs`, then send `GsRegexLoader loadFromServerDir:`.

By hand, on a local stone (the gem reads the payload files itself), as SystemUser:

1. In `resources/regex/load-regex.gs`, replace both `<PAYLOAD_DIR>` with the absolute path to `resources/regex`.
2. Run it in topaz:

   ```
   topaz> set user SystemUser password <pw> gemstone <stoneName>
   topaz> login
   topaz> input <path>/resources/regex/load-regex.gs
   ```

The loader creates the `GsRegexLibrary` dictionary at the end of every user's symbol list, files in the payload, checks that every class and method arrived and that a match and a search work, and commits only if all of that passed. The last lines of its report say `Committed.` or `Aborted -- nothing was committed.` A load by hand records no receipt, so **GemStone: Show Server Support Status** reports its version as unknown until Jasper reinstalls it.

## Uninstalling

**GemStone: Uninstall Server Support** removes `GsRegexLibrary` from every user's symbol list, empties it, and removes `GsRegexLoader` from UserGlobals. Nothing else was added, so nothing else needs removing.

## Tests

| # | Where | What |
|---|---|---|
| 1 | `gs-src/regex/tests/` | Jasper's Smalltalk tests (35), built into `regex-tests.gs` with the library's own (187) |
| 2 | `client/src/regex/__tests__/regexLibrarySuite.integration.test.ts` | Runs all 222 in a stone and checks the exact count of each class |
| 3 | `client/src/regex/__tests__/*.integration.test.ts` | Install, reinstall, a stone that already has GLASS's regex classes, uninstall, and the search end to end, including Stop |
| 4 | `client/src/regex/__tests__/*.test.ts`, `client/src/queries/__tests__/regexSourceSearch.test.ts` | The install and uninstall drivers, the availability check, the build's audits, and the search query |

Most integration tests run in one of CI's two passes: the install tests on a bare stone, the search and suite tests with the plugin installed.
