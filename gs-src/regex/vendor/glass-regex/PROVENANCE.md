# Vendored regular-expression library: provenance

This directory holds the regular-expression library that Jasper's server plugin installs for regex search. The files here are an unmodified copy. Jasper's changes are applied when the payload is built, never to these files, and every one is listed below.

## Origin

- **Original:** the Regular Expression Matcher v 1.1, Copyright (C) 1996, 1999 Vassili Bykov. Its own license is reproduced in full in the repository root's `THIRD-PARTY.md`, and lives in the library itself, in `RxParser class >> f:boringStuff:` (category `DOCUMENTATION`).
- **Exact source of these bytes:** GLASS, <https://github.com/glassdb/glass>, packages `Regex-Core` and `Regex-Tests-Core` under `repository/`, at commit `fddbc3b6f17179b328f52dd3466c48c3738db0ef` (2026-02-26). The packages themselves were last changed upstream in `f86eb90` (Dale Henrichs, 2013-06-23). Package version: `Regex-Core-DaleHenrichs.3`.
- **GLASS license:** MIT, Copyright (c) 2012 VMware, Inc. and (c) 2013 GemTalk Systems. The text is in `LICENSE` beside this file.
- **Format:** Monticello filetree, as GLASS keeps it (one file per method).

No file here was edited. `LICENSE` is GLASS's `LICENSE` at the same commit.

## Bykov's conditions, and how Jasper meets them

His license allows modified versions provided that (5a) a modified version is expressly marked as such, (5b) the original is credited in the source and documentation of the derived work, and (5c) his copyright notice accompanies the modified version's. It also requires (4) that the documentation and copyright notices be kept intact.

| # | Condition | How |
|---|---|---|
| 1 | 5a, marked as modified | The header of every generated payload file (`resources/regex/*.gs`) says "a MODIFIED version" and lists the changes; so do this file and `THIRD-PARTY.md`. |
| 2 | 5b, credit in source and documentation | The payload header, the `GsRegex` class comment, `gs-src/regex/README.md`, `THIRD-PARTY.md` and `NOTICE`. |
| 3 | 5c, copyright notice | `NOTICE` and `THIRD-PARTY.md` carry his notice next to Jasper's and GLASS's. |
| 4 | 4, documentation intact | The class-side `DOCUMENTATION` methods of `RxParser` ship unchanged. The class renames below touch code only, never comments or strings, so the documentation keeps the names it was written with. |

## Changes Jasper makes when building the payload

`gs-src/regex/build/adapt-glass-regex.js` applies them, each with the exact number of places it expects to change. If a re-vendor changes that number, the build stops.

### The library (`Regex-Core`)

| # | Change | Why | Sites |
|---|---|---|---|
| 1 | Leave out the package's only extension: the 12 methods it adds to `String` (`asRegex`, `matchesRegex:` and the rest). | Jasper adds no methods to a kernel class for this feature. On a GsDevKit or GLASS stone, the same 12 methods already exist, and installing or uninstalling ours would replace or delete them. `GsRegex` offers the same operations with the text as an argument. | 12 methods |
| 2 | Prefix every class name with `Gs` (`RxParser` becomes `GsRxParser`, `RegexError` becomes `GsRegexError`), in code only. | A GsDevKit or GLASS stone may already have the original classes. Different names, in Jasper's own `GsRegexLibrary` dictionary, keep the two copies apart. | 28 classes |
| 3 | `Character escape` → `Character esc` | GemStone has no `Character class >> escape`. | 1 |
| 4 | `(Association key: X value: Y)` → `(X -> Y)` | GemStone has no `Association class >> key:value:`. | 10 |
| 5 | `(String new: n) writeStream` → `(WriteStream on: (String new: n))` | GemStone has no `String >> writeStream`. | 4 |
| 6 | `contains:` → `anySatisfy:` | GemStone has no `Collection >> contains:`; `anySatisfy:` is the same test. | 9 |
| 7 | `a sameAs: b` → `a asLowercase = b asLowercase` (characters) | GemStone has no `Character >> sameAs:`. This is what case-insensitive matching uses. | 3 |
| 8 | Remove the `:name:` branch from `RxParser >> atom`. | Upstream, `:isVowel:` meant "a character that answers true to `#isVowel`". Smalltalk selectors are full of colons, so `printOn:` was a syntax error and `at:put:` searched for something else; and the pattern could choose a message to send. A colon is now an ordinary character. `[:alpha:]` inside a character set is parsed elsewhere and still works. | 1 |
| 9 | Add `RxmBranch class >> new` and `RxmSubstring class >> new`, which send `#initialize`. | Pharo's `new` sends `#initialize`; GemStone's does not, so these came up with unset instance variables and nearly every match failed. | 2 methods |
| 10 | In `RxMatcher >> isWordChar:`, count `_` as a word character. | It decides where `\<`, `\>`, `\b` and `\B` find a word's edges. Its own comment says "alphanumeric or _", but the code checked letters and digits only, so `\<halt\>` matched inside `_halt:`. Other regex tools, and this library's own `\w`, count `_` as part of a word. | 1 |

### The tests (`Regex-Tests-Core`)

| # | Change | Why | Sites |
|---|---|---|---|
| 11 | The same class renames as change 2. | The tests name the library's classes. | — |
| 12 | Calls to the `String` methods of change 1, always on string literals, rewritten as the matching `GsRegex` call: `('ab' matchesRegex: 'a*b')` becomes `(GsRegex matches: 'ab' pattern: 'a*b')`. The pattern, the text and the expected result are unchanged. | The `String` methods are not installed. | 76 calls in 29 methods: 27 tests and 2 that upstream disabled by renaming (`toDotest...`, `DoesNotWorktest...`) |
| 13 | `String cr` → `(String with: Character cr)` | GemStone has no `String class >> cr`. | 4 |
| 14 | `reversed` → `reverse` | GemStone 3.6.2 has no `String >> reversed`. | 3 |
| 15 | Delete `RxMatcherTest >> testRegex004`. | It tests the `:name:` syntax that change 8 removes, and expects `y` not to be a vowel, while GemStone's `Character >> isVowel` answers true for `$y`. | 1 method |

With these changes every remaining vendored test passes on GemStone 3.6.2 and 3.7.6: 172 in `GsRxMatcherTest` and 15 in `GsRxParserTest`. `client/src/regex/__tests__/regexLibrarySuite.integration.test.ts` checks those exact counts.

## Known differences from other regex dialects

These are the library's own behaviour, kept as is and documented for users in `gs-src/regex/README.md`:

1. No counted repetition (`a{3}`) and no `(?...)` groups. `GsRegex` refuses both with a message, because the library would otherwise read `a{3}` as literal text.
2. `.` matches a line break.
3. `^` and `$` match at the start and end of every line.
4. The matcher recurses once per character it consumes, so a long match can exhaust the stack, and a badly written pattern such as `(a+)+b` takes time that doubles with every extra character. `GsRegexSourceSearch` matches one line at a time to bound the first; Jasper's Stop ends the second.

## Re-vendoring

1. Copy `repository/Regex-Core.package` and `repository/Regex-Tests-Core.package` from the new GLASS commit over the two directories here, and `LICENSE` beside them.
2. Update the commit above.
3. Run `gs-src/regex/build/build-regex.sh`. If a count no longer matches, the build names the change; review it against the new upstream code before adjusting the count.
4. Run the integration tests with the plugin installed (`npm run test:server:install-plugin`, then `npm test` in `client`).
