# Smalltalk Formatter Settings

Fine-tune the Smalltalk formatter under `gemstoneSmalltalk.formatter.*` in your VS Code settings. Every option also shows up in the VS Code Settings UI with a live description; this page is the reference if you'd rather see them all in one place.

| Setting | Default | Description |
|---------|---------|-------------|
| `spacesInsideParens` | false | `( x )` vs `(x)` |
| `spacesInsideBrackets` | false | `[ x ]` vs `[x]` |
| `spacesInsideBraces` | false | `{ x }` vs `{x}` |
| `spacesAroundAssignment` | true | `x := y` vs `x:=y` |
| `spacesAroundBinarySelectors` | true | `a + b` vs `a+b` |
| `spaceAfterCaret` | false | `^ x` vs `^x` |
| `blankLineAfterMethodPattern` | true | Blank line between pattern and body |
| `maxLineLength` | 0 | Line wrapping (0 = off) |
| `continuationIndent` | 2 | Indent for continuation lines |
| `multiKeywordThreshold` | 2 | Keywords before splitting across lines |
| `removeUnnecessaryParens` | true | Remove parens based on Smalltalk precedence |

## Where the formatter runs

**Format Document** (`Shift+Alt+F`, or the editor context menu) works on Topaz files and on the method editors the GemStone Explorer opens — including new-method editors. It reformats the whole method: pattern, temporaries and body.

Class **definition** and class **comment** editors are deliberately left alone. A comment is prose, not code, so running it through the Smalltalk parser would break each sentence onto its own line and drop the paragraph breaks; a definition would come back reflowed with a trailing `.`. Format Document is a no-op on both.

**Format Selection** (`Ctrl+K Ctrl+F`) is not offered — on a method editor the only useful range is the whole method, which Format Document already covers.
