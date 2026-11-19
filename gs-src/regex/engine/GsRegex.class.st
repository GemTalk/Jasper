"
GsRegex is Jasper's entry point to the regular-expression library vendored from
GLASS (Vassili Bykov's Regular Expression Matcher, renamed GsRx*). It offers the
operations the library's own String extension methods offered, with the text
passed as an argument, because Jasper adds no methods to String.

It also decides, before the library sees a pattern, two things the library
cannot: which constructs this dialect does not support (#checkSupported:), and
which plain text every match must contain (#requiredLiteralIn:), so a search can
skip a method with a fast substring test instead of running the matcher.
"
Class {
	#name : 'GsRegex',
	#superclass : 'Object',
	#instVars : [ ],
	#classVars : [ ],
	#classInstVars : [ ],
	#category : 'Regex-Jasper'
}

{ #category : 'compiling' }
GsRegex class >> pattern: aString [
	"A matcher for aString. Signals GsRegexSyntaxError for a pattern this dialect cannot read."

	^self pattern: aString ignoreCase: false
]

{ #category : 'compiling' }
GsRegex class >> patternIgnoringCase: aString [
	^self pattern: aString ignoreCase: true
]

{ #category : 'compiling' }
GsRegex class >> pattern: aString ignoreCase: aBoolean [
	self checkSupported: aString.
	^GsRxParser preferredMatcherClass
		for: (GsRxParser new parse: aString)
		ignoreCase: aBoolean
]

{ #category : 'matching' }
GsRegex class >> matches: aString pattern: rxString [
	"True when the whole of aString matches rxString."

	^(self pattern: rxString) matches: aString
]

{ #category : 'matching' }
GsRegex class >> matchesIgnoringCase: aString pattern: rxString [
	^(self patternIgnoringCase: rxString) matches: aString
]

{ #category : 'matching' }
GsRegex class >> prefixMatches: aString pattern: rxString [
	"True when some prefix of aString matches rxString."

	^(self pattern: rxString) matchesPrefix: aString
]

{ #category : 'matching' }
GsRegex class >> prefixMatchesIgnoringCase: aString pattern: rxString [
	^(self patternIgnoringCase: rxString) matchesPrefix: aString
]

{ #category : 'matching' }
GsRegex class >> search: aString pattern: rxString [
	"True when rxString matches somewhere in aString."

	^(self pattern: rxString) search: aString
]

{ #category : 'enumerating' }
GsRegex class >> allMatchesIn: aString pattern: rxString [
	^(self pattern: rxString) matchesIn: aString
]

{ #category : 'enumerating' }
GsRegex class >> allRangesIn: aString pattern: rxString [
	^(self pattern: rxString) matchingRangesIn: aString
]

{ #category : 'enumerating' }
GsRegex class >> in: aString pattern: rxString do: aBlock [
	^(self pattern: rxString) matchesIn: aString do: aBlock
]

{ #category : 'enumerating' }
GsRegex class >> in: aString pattern: rxString collect: aBlock [
	^(self pattern: rxString) matchesIn: aString collect: aBlock
]

{ #category : 'copying' }
GsRegex class >> copy: aString replacing: rxString with: replacement [
	"A copy of aString with every match of rxString replaced by replacement."

	^(self pattern: rxString) copy: aString replacingMatchesWith: replacement
]

{ #category : 'copying' }
GsRegex class >> copy: aString translating: rxString using: aBlock [
	"A copy of aString with every match of rxString replaced by aBlock's answer for it."

	^(self pattern: rxString) copy: aString translatingMatchesUsing: aBlock
]

{ #category : 'checking' }
GsRegex class >> checkSupported: aString [
	"Signal GsRegexSyntaxError for a construct the library would misread, rather than let it.
	 A counted repetition such as a{3} is not supported, and the library would quietly
	 treat it as the literal text a{3}; a (?...) group is not supported either, and the
	 library's own error for it ('nullable closure') does not say why. Inside [...] and
	 after a backslash these characters are ordinary, as they are to the library."

	| i size |
	aString isEmpty ifTrue: [ ^GsRegexSyntaxError new signal: 'the pattern is empty' ].
	i := 1.
	size := aString size.
	[ i <= size ] whileTrue: [ | ch |
		ch := aString at: i.
		ch = $\
			ifTrue: [ i := i + 2 ]
			ifFalse: [
				ch = $[
					ifTrue: [ i := self indexAfterSetIn: aString at: i ]
					ifFalse: [
						(ch = $( and: [ i < size and: [ (aString at: i + 1) = $? ] ])
							ifTrue: [ ^GsRegexSyntaxError new signal: '(?...) groups are not supported' ].
						(ch = ${ and: [ self isCountedRepetitionIn: aString at: i ])
							ifTrue: [ ^GsRegexSyntaxError new signal: 'counted repetition such as {3} is not supported; write the repeated text out, or use * + ?' ].
						i := i + 1 ] ] ]
]

{ #category : 'checking' }
GsRegex class >> isCountedRepetitionIn: aString at: anIndex [
	"True when the text from anIndex reads {n}, {n,} or {n,m}."

	| i size digits |
	size := aString size.
	i := anIndex + 1.
	digits := 0.
	[ i <= size and: [ (aString at: i) isDigit ] ] whileTrue: [ i := i + 1. digits := digits + 1 ].
	digits = 0 ifTrue: [ ^false ].
	(i <= size and: [ (aString at: i) = $, ]) ifTrue: [
		i := i + 1.
		[ i <= size and: [ (aString at: i) isDigit ] ] whileTrue: [ i := i + 1 ] ].
	^i <= size and: [ (aString at: i) = $} ]
]

{ #category : 'checking' }
GsRegex class >> indexAfterSetIn: aString at: anIndex [
	"The index just past the character set that opens with [ at anIndex. Follows the
	 library's rules (GsRxParser>>characterSet): a ] right after [ or [^ is a member,
	 and [:name:] is a named class. An unclosed set answers the index past the end."

	| i size |
	size := aString size.
	i := anIndex + 1.
	(i <= size and: [ (aString at: i) = $^ ]) ifTrue: [ i := i + 1 ].
	(i <= size and: [ (aString at: i) = $] ]) ifTrue: [ i := i + 1 ].
	[ i <= size ] whileTrue: [ | ch |
		ch := aString at: i.
		ch = $] ifTrue: [ ^i + 1 ].
		(ch = $[ and: [ i < size and: [ (aString at: i + 1) = $: ] ])
			ifTrue: [ i := self indexAfterNamedClassIn: aString at: i ]
			ifFalse: [ i := i + 1 ] ].
	^size + 1
]

{ #category : 'checking' }
GsRegex class >> indexAfterNamedClassIn: aString at: anIndex [
	"The index just past a [:name:] that starts at anIndex, or past its [ if it never closes."

	| i size |
	size := aString size.
	i := anIndex + 2.
	[ i < size ] whileTrue: [
		((aString at: i) = $: and: [ (aString at: i + 1) = $] ]) ifTrue: [ ^i + 2 ].
		i := i + 1 ].
	^anIndex + 1
]

{ #category : 'analysing' }
GsRegex class >> spansLines: aString [
	"True when the pattern asks for a line break, with \n or \r (or holds one): a search
	 must then match whole methods, since no single line contains one."

	| i size |
	i := 1.
	size := aString size.
	[ i <= size ] whileTrue: [ | ch |
		ch := aString at: i.
		(ch = Character lf or: [ ch = Character cr ]) ifTrue: [ ^true ].
		(ch = $\ and: [ i < size and: [ 'nr' includes: (aString at: i + 1) ] ]) ifTrue: [ ^true ].
		i := i + (ch = $\ ifTrue: [ 2 ] ifFalse: [ 1 ]) ].
	^false
]

{ #category : 'analysing' }
GsRegex class >> requiredLiteralIn: aString [
	"The longest run of plain text that every match of aString must contain, or nil when
	 there is none worth testing for (shorter than 2 characters).

	 A search uses it to skip a method with a fast substring test before running the
	 matcher, so an answer that is NOT really required would silently drop real hits.
	 The rules are therefore conservative: only text outside every group counts (a group
	 may be optional or one branch of an alternation); a | outside groups means no text
	 is required at all; a character followed by * or ? is optional and ends the run; one
	 followed by + is required once and ends the run; and anything else special ends it."

	| best run i size depth |
	best := ''.
	run := WriteStream on: String new.
	depth := 0.
	i := 1.
	size := aString size.
	[ i <= size ] whileTrue: [ | ch next |
		ch := aString at: i.
		next := i < size ifTrue: [ aString at: i + 1 ] ifFalse: [ nil ].
		ch = $\
			ifTrue: [
				(next notNil and: [ depth = 0 and: [ self isLiteralEscape: next ] ])
					ifTrue: [ run := self extend: run with: next before: (i + 2 <= size ifTrue: [ aString at: i + 2 ] ifFalse: [ nil ]) best: [:s | best := self longer: best than: s] ]
					ifFalse: [ best := self longer: best than: run contents. run := WriteStream on: String new ].
				i := i + 2 ]
			ifFalse: [
				ch = $[
					ifTrue: [
						best := self longer: best than: run contents.
						run := WriteStream on: String new.
						i := self indexAfterSetIn: aString at: i ]
					ifFalse: [
						ch = $( ifTrue: [ depth := depth + 1 ].
						ch = $) ifTrue: [ depth := depth - 1 max: 0 ].
						(ch = $| and: [ depth = 0 ]) ifTrue: [ ^nil ].
						(depth = 0 and: [ (self isSpecial: ch) not ])
							ifTrue: [ run := self extend: run with: ch before: next best: [:s | best := self longer: best than: s] ]
							ifFalse: [ best := self longer: best than: run contents. run := WriteStream on: String new ].
						i := i + 1 ] ] ].
	best := self longer: best than: run contents.
	^best size >= 2 ifTrue: [ best ] ifFalse: [ nil ]
]

{ #category : 'analysing' }
GsRegex class >> extend: aStream with: aCharacter before: nextCharacter best: aBlock [
	"Add aCharacter to the run in aStream, given the character after it, and answer the
	 run to continue with. A following * or ? makes aCharacter optional, so the run ends
	 before it; a following + makes it required once, so the run ends after it."

	(nextCharacter = $* or: [ nextCharacter = $? ]) ifTrue: [
		aBlock value: aStream contents.
		^WriteStream on: String new ].
	aStream nextPut: aCharacter.
	nextCharacter = $+ ifTrue: [
		aBlock value: aStream contents.
		^WriteStream on: String new ].
	^aStream
]

{ #category : 'analysing' }
GsRegex class >> isSpecial: aCharacter [
	"Characters with a meaning of their own outside a character set."

	^'.*+?^$|()[]\' includes: aCharacter
]

{ #category : 'analysing' }
GsRegex class >> isLiteralEscape: aCharacter [
	"True when backslash + aCharacter stands for aCharacter itself: anything but a letter,
	 since \w \d \s \b \< \> \n \e and the rest are classes, conditions or control
	 characters, and an unknown letter may become one in a later release."

	^aCharacter isLetter not and: [ ('<>' includes: aCharacter) not ]
]

{ #category : 'analysing' }
GsRegex class >> longer: aString than: anotherString [
	^anotherString size > aString size ifTrue: [ anotherString ] ifFalse: [ aString ]
]
