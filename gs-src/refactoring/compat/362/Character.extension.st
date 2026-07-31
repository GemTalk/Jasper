"
Compatibility shim for the vendored RowanV3 AST-Core.

The RBScanner classifies each source character with #isSqueakSeparator (a
Pharo/Squeak Character method), and RBMessageNode>>#addNewlineBefore: probes the
preceding character the same way. GemStone's Character does NOT implement it, so
parsing any method whose STORED SOURCE contains a non-ASCII character -- in a
comment, string, or symbol, which makes the source a wide DoubleByteString --
raised `MessageNotUnderstood (2010)` inside `RBParser parseMethod:`. That broke
(silently, via an `on: Error do: [nil]` swallow) the source-parsing refactorings:
convert-temp-to-ivar hard-declined, and push up/down skipped accessor detection on
any getter/setter carrying a Unicode comment.

Feature-detected (installed only where the base release lacks it -- see the build's
--feature-detect flag), so it never shadows a method a newer release already has.
Wide-safe by construction: only the five ASCII whitespace separators answer true;
every other code point (including wide, non-BMP) answers false.
"
Extension { #name : 'Character' }

{ #category : '*ast-core-compat-362' }
Character >> isSqueakSeparator [
	"True for the ASCII whitespace separators the RBScanner treats as token
	 boundaries: space, tab, LF, CR, form-feed. Any other character (including any
	 wide character) is not a separator."
	| v |
	v := self asInteger.
	^v == 32 or: [v == 9 or: [v == 10 or: [v == 13 or: [v == 12]]]]
]
