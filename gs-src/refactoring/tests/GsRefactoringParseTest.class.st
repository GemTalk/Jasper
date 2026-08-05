"
Regression tests for the RBScanner non-ASCII (wide-source) parse gap. The
vendored RBScanner classifies characters with #isSqueakSeparator; GemStone's
Character lacked it, so parsing any method whose STORED SOURCE is a wide
DoubleByteString (a non-ASCII character in a comment, string or character
literal) raised MessageNotUnderstood inside RBParser -- silently breaking
convert-temp and push-up/down accessor detection. The compat shim
(Character>>isSqueakSeparator, feature-detected) closes that gap.

Every method-under-test's source is assembled at run time from #codePoint:
pieces -- the wide character, and even the quote/comment delimiters -- so THIS
test's own stored source stays pure ASCII (no wide bytes, no literal quotes).
"
Class {
	#name : 'GsRefactoringParseTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'private' }
GsRefactoringParseTest >> ch: anInteger [
	^String with: (Character codePoint: anInteger)
]

{ #category : 'private' }
GsRefactoringParseTest >> emDash [
	"U+2014 EM DASH -- built by codePoint so this source is not itself wide."
	^Character codePoint: 8212
]

{ #category : 'tests' }
GsRefactoringParseTest >> testIsSqueakSeparatorAnswersBooleanForWideChar [
	"It must ANSWER (not DNU) for a wide character -- that is the whole fix."
	self assert: (self emDash isSqueakSeparator isKindOf: Boolean)
]

{ #category : 'tests' }
GsRefactoringParseTest >> testIsSqueakSeparatorFalseForEmDash [
	self deny: self emDash isSqueakSeparator
]

{ #category : 'tests' }
GsRefactoringParseTest >> testIsSqueakSeparatorFalseForLetter [
	self deny: $a isSqueakSeparator
]

{ #category : 'tests' }
GsRefactoringParseTest >> testIsSqueakSeparatorFalseForNonBmpChar [
	self deny: (Character codePoint: 128512) isSqueakSeparator
]

{ #category : 'tests' }
GsRefactoringParseTest >> testIsSqueakSeparatorTrueForAsciiWhitespace [
	"The five ASCII whitespace separators the scanner treats as boundaries:
	 tab, LF, form-feed, CR, space."
	self assert: (Character codePoint: 9) isSqueakSeparator.
	self assert: (Character codePoint: 10) isSqueakSeparator.
	self assert: (Character codePoint: 12) isSqueakSeparator.
	self assert: (Character codePoint: 13) isSqueakSeparator.
	self assert: (Character codePoint: 32) isSqueakSeparator
]

{ #category : 'tests' }
GsRefactoringParseTest >> testParsesMethodWithWideCharacterLiteral [
	"Source: foo ^$<emdash>"
	| src node |
	src := 'foo ^$', (String with: self emDash).
	node := RBParser parseMethod: src.
	self deny: node isNil.
	self assert: (node selector = #foo)
]

{ #category : 'tests' }
GsRefactoringParseTest >> testParsesMethodWithWideComment [
	"Source: foo <dq>c<emdash>d<dq> ^42  (dq = double quote, so a real comment)."
	| dq src node |
	dq := self ch: 34.
	src := 'foo ', dq, 'c', (String with: self emDash), 'd', dq, ' ^42'.
	node := RBParser parseMethod: src.
	self deny: node isNil.
	self assert: (node selector = #foo)
]

{ #category : 'tests' }
GsRefactoringParseTest >> testParsesMethodWithWideStringLiteral [
	"Source: foo ^<sq>x<emdash>y<sq>  (sq = single quote)."
	| sq src node |
	sq := self ch: 39.
	src := 'foo ^', sq, 'x', (String with: self emDash), 'y', sq.
	node := RBParser parseMethod: src.
	self deny: node isNil.
	self assert: (node selector = #foo)
]

{ #category : 'tests' }
GsRefactoringParseTest >> testWideAndAsciiCommentYieldSameSelector [
	"A wide comment must not change the parse: same method, ASCII vs wide comment,
	 parses to the same selector."
	| dq wide ascii |
	dq := self ch: 34.
	wide := 'foo ', dq, 'c', (String with: self emDash), 'd', dq, ' ^42'.
	ascii := 'foo ', dq, 'cxd', dq, ' ^42'.
	self assert: ((RBParser parseMethod: wide) selector
		= (RBParser parseMethod: ascii) selector)
]
