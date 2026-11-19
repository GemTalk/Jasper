"
GsRegexSourceSearch finds the methods whose source matches a regular expression,
for GemStone Search's Source scope.

It matches one line at a time, unless the pattern asks for a line break (\n or \r),
in which case it matches each method as a whole. The reason is the library's
matcher: it recurses once per character it consumes, so a pattern such as `a.*b`
run over a long method overflows the stack (measured: methods longer than about
1,500 characters). A line is short enough; a whole method may not be, so in that
mode a method the matcher cannot finish is counted in #skipped instead of failing
the search.

When every match must contain some plain text (GsRegex class>>requiredLiteralIn:),
a method without that text is skipped with a substring test, which is about a
hundred times faster than running the matcher.

Only Error and AlmostOutOfStack are caught while matching. A soft break from the
client (Stop) is not an Error, so it still ends a search that runs too long.
"
Class {
	#name : 'GsRegexSourceSearch',
	#superclass : 'Object',
	#instVars : [ 'pattern', 'ignoreCase', 'limit', 'matcher', 'literal', 'wholeMethods', 'methods', 'skipped', 'scanned', 'truncated' ],
	#classVars : [ ],
	#classInstVars : [ ],
	#category : 'Regex-Jasper'
}

{ #category : 'instance creation' }
GsRegexSourceSearch class >> pattern: aString ignoreCase: aBoolean limit: anInteger [
	"A search, not yet run. At most anInteger methods are kept; #truncated tells whether
	 there were more."

	^self new setPattern: aString ignoreCase: aBoolean limit: anInteger
]

{ #category : 'initialization' }
GsRegexSourceSearch >> setPattern: aString ignoreCase: aBoolean limit: anInteger [
	pattern := aString.
	ignoreCase := aBoolean.
	limit := anInteger.
	methods := OrderedCollection new.
	skipped := 0.
	scanned := 0.
	truncated := false
]

{ #category : 'running' }
GsRegexSourceSearch >> run [
	"Scan every method in the user's symbol list, instance and class side, environment 0.
	 Signals GsRegexSyntaxError, before scanning anything, for a pattern that cannot be used."

	matcher := GsRegex pattern: pattern ignoreCase: ignoreCase.
	wholeMethods := GsRegex spansLines: pattern.
	literal := GsRegex requiredLiteralIn: pattern.
	self behaviorsDo: [:cls |
		cls selectors do: [:sel | | m |
			m := cls compiledMethodAt: sel otherwise: nil.
			m ifNotNil: [
				(self sourceMatches: m) ifTrue: [
					methods size >= limit ifTrue: [ truncated := true. ^self ].
					methods add: m ] ] ] ]
]

{ #category : 'running' }
GsRegexSourceSearch >> behaviorsDo: aBlock [
	"Each class in the user's symbol list once, then its metaclass."

	| seen |
	seen := IdentitySet new.
	System myUserProfile symbolList do: [:dict |
		dict valuesDo: [:v |
			(v isBehavior and: [ (seen includes: v) not ]) ifTrue: [
				seen add: v.
				aBlock value: v.
				aBlock value: v class ] ] ]
]

{ #category : 'running' }
GsRegexSourceSearch >> sourceMatches: aMethod [
	| src |
	src := [ aMethod sourceString ] on: Error do: [:e | nil ].
	src isNil ifTrue: [ ^false ].
	scanned := scanned + 1.
	(literal notNil and: [ (self source: src contains: literal) not ]) ifTrue: [ ^false ].
	^[ wholeMethods
		ifTrue: [ matcher search: src ]
		ifFalse: [ (self linesOf: src) anySatisfy: [:line | matcher search: line ] ] ]
		on: AlmostOutOfStack, Error
		do: [:e | skipped := skipped + 1. e return: false ]
]

{ #category : 'running' }
GsRegexSourceSearch >> source: src contains: aString [
	^(ignoreCase
		ifTrue: [ src findStringNoCase: aString startingAt: 1 ]
		ifFalse: [ src findString: aString startingAt: 1 ]) > 0
]

{ #category : 'running' }
GsRegexSourceSearch >> linesOf: src [
	"Split on line feed and carriage return both: a method saved with carriage returns
	 alone would otherwise be one long line, and could overflow the matcher again."

	^src subStrings: (String with: Character lf with: Character cr)
]

{ #category : 'results' }
GsRegexSourceSearch >> methods [
	"The matching methods, at most #limit of them, as an Array."

	^methods asArray
]

{ #category : 'results' }
GsRegexSourceSearch >> skipped [
	"How many methods the matcher could not finish (too long to match as a whole)."

	^skipped
]

{ #category : 'results' }
GsRegexSourceSearch >> scanned [
	"How many methods' source was read before the search ended."

	^scanned
]

{ #category : 'results' }
GsRegexSourceSearch >> truncated [
	"True when more methods matched than #limit allowed: the search stopped early."

	^truncated
]

{ #category : 'results' }
GsRegexSourceSearch >> wholeMethods [
	"True when the pattern spans lines, so methods were matched as a whole."

	^wholeMethods
]

{ #category : 'results' }
GsRegexSourceSearch >> requiredLiteral [
	"The plain text every match must contain, used to skip methods quickly, or nil."

	^literal
]

{ #category : 'results' }
GsRegexSourceSearch >> summaryLine [
	"One tab-separated line for the client: wholeMethods (0/1), skipped, scanned, truncated (0/1)."

	| ws |
	ws := WriteStream on: String new.
	ws
		nextPutAll: (wholeMethods ifTrue: [ '1' ] ifFalse: [ '0' ]); tab;
		print: skipped; tab;
		print: scanned; tab;
		nextPutAll: (truncated ifTrue: [ '1' ] ifFalse: [ '0' ]).
	^ws contents
]
