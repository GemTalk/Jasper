"
Characterization tests for the canonical JSON escaper (RB catalog C1). The
serializers used to each carry a byte-identical copy of jsonQuote:/jsonEscape:/
hex2:; those now delegate to GsRefactoringJson, so the escaper's contract is
pinned here in one place.

The load-bearing property is testEscapeOutputIsPureAscii: every escaped byte is
<= 126, so the client's non-blocking GCI fetch is never handed a Unicode-promoted
(wide) result. Every wide char AND every expected escape sequence is built from
#codePoint: (backslash is codePoint 92), so THIS test's own stored source stays
pure ASCII -- there is not one backslash or non-ASCII byte in a string literal
here (the 3.6.2 ComStrmSetCursor discipline, applied to the test itself).
"
Class {
	#name : 'GsRefactoringJsonTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'private' }
GsRefactoringJsonTest >> bslash [
	"A one-character String holding a single backslash (codePoint 92), so no
	 string literal in this test needs to spell an escape sequence."
	^String with: (Character codePoint: 92)
]

{ #category : 'private' }
GsRefactoringJsonTest >> dquote [
	^String with: (Character codePoint: 34)
]

{ #category : 'private' }
GsRefactoringJsonTest >> escape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testBmpCharBecomesLowercaseHexUnicode [
	"U+FB01 (ligature fi) exercises lowercase hex digits a-f in the escape."
	self assert: ((self escape: (String with: (Character codePoint: 64257)))
		= (self bslash, 'ufb01'))
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testControlCharBecomesUnicodeEscape [
	self assert: ((self escape: (String with: (Character codePoint: 1)))
		= (self bslash, 'u0001'))
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testEmDashBecomesUnicodeEscape [
	"U+2014 EM DASH -- the character that first exposed the wide-source hazard."
	self assert: ((self escape: (String with: (Character codePoint: 8212)))
		= (self bslash, 'u2014'))
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testEmptyString [
	self assert: ((self escape: '') = '')
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testEscapeOutputIsPureAscii [
	"The load-bearing invariant: no escaped byte exceeds 126, for ANY input --
	 including control, DEL, wide-BMP and non-BMP characters."
	| inputs |
	inputs := OrderedCollection new.
	inputs add: 'plain text 123'.
	inputs add: (String with: (Character codePoint: 34)).
	inputs add: (String with: (Character codePoint: 92)).
	inputs add: (String with: (Character codePoint: 0)).
	inputs add: (String with: (Character codePoint: 9)).
	inputs add: (String with: (Character codePoint: 10)).
	inputs add: (String with: (Character codePoint: 13)).
	inputs add: (String with: (Character codePoint: 31)).
	inputs add: (String with: (Character codePoint: 127)).
	inputs add: (String with: (Character codePoint: 8212)).
	inputs add: (String with: (Character codePoint: 64257)).
	inputs add: (String with: (Character codePoint: 128512)).
	inputs do: [:s |
		(self escape: s) do: [:c | self assert: (c asInteger <= 126)]]
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testEscapesBackslash [
	self assert: ((self escape: self bslash) = (self bslash, self bslash))
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testEscapesCarriageReturn [
	self assert: ((self escape: (String with: (Character codePoint: 13)))
		= (self bslash, 'r'))
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testEscapesNewline [
	self assert: ((self escape: (String with: (Character codePoint: 10)))
		= (self bslash, 'n'))
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testEscapesQuote [
	self assert: ((self escape: self dquote) = (self bslash, self dquote))
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testEscapesTab [
	self assert: ((self escape: (String with: (Character codePoint: 9)))
		= (self bslash, 't'))
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testHex2 [
	self assert: ((GsRefactoringJson hex2: 255) = 'ff').
	self assert: ((GsRefactoringJson hex2: 0) = '00').
	self assert: ((GsRefactoringJson hex2: 10) = '0a').
	self assert: ((GsRefactoringJson hex2: 16) = '10')
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testJsonQuoteEscapesContents [
	"jsonQuote: wraps in quotes AND escapes -- an embedded quote comes back
	 escaped, so the whole thing stays one valid JSON string."
	self assert: ((GsRefactoringJson jsonQuote: self dquote)
		= (self dquote, self bslash, self dquote, self dquote))
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testJsonQuoteWraps [
	self assert: ((GsRefactoringJson jsonQuote: 'ab') = (self dquote, 'ab', self dquote))
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testNonBmpBecomesQuestionMark [
	"Above U+FFFF the escaper emits a literal ? (surrogate pairs are not encoded)."
	self assert: ((self escape: (String with: (Character codePoint: 128512))) = '?')
]

{ #category : 'tests' }
GsRefactoringJsonTest >> testPlainCharactersUnchanged [
	self assert: ((self escape: 'abcXYZ 09') = 'abcXYZ 09')
]
