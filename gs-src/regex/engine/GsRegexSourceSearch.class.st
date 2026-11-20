"
GsRegexSourceSearch finds the methods whose source matches a regular expression,
for GemStone Search's Source scope.

It matches one line at a time, unless the pattern asks for a line break (\n or \r),
in which case it matches each method as a whole. The reason is the library's
matcher: it recurses once per character it consumes, so a pattern such as `a.*b`
run over a long method overflows the stack (measured: methods longer than about
1,500 characters). A line is short enough; a whole method may not be, so a method
the matcher runs out of stack on is counted in #skipped instead of failing the
search (a very long single line can do it in line mode too). Only a literal \n or
\r in the pattern switches to whole methods; \s does not.

Any other error while matching a method is counted in #failed, apart from #skipped,
so a fault in the matcher is not reported as a method being too long.

When every match must contain some plain text (GsRegex class>>requiredLiteralIn:),
a method without that text is skipped with a substring test, which is about a
hundred times faster than running the matcher.

Only Error and AlmostOutOfStack are caught while matching. A soft break from the
client (Stop) is not an Error, so it still ends a search that runs too long.

For each method it keeps, it also records where in the source its matches are
(#ranges, at most #maxRangesPerMethod of them), so Jasper can open the method at
the first match and mark the others.
"
Class {
	#name : 'GsRegexSourceSearch',
	#superclass : 'Object',
	#instVars : [ 'pattern', 'ignoreCase', 'limit', 'matcher', 'literal', 'wholeMethods', 'methods', 'ranges', 'skipped', 'failed', 'scanned', 'truncated', 'classes' ],
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
	ranges := OrderedCollection new.
	skipped := 0.
	failed := 0.
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
				(self matchesIn: m) ifNotNil: [:found |
					methods size >= limit ifTrue: [ truncated := true. ^self ].
					methods add: m.
					ranges add: found ] ] ] ]
]

{ #category : 'initialization' }
GsRegexSourceSearch >> classes: aCollection [
	"Search only these classes (each with its metaclass) rather than the whole symbol list."

	classes := aCollection
]

{ #category : 'running' }
GsRegexSourceSearch >> behaviorsDo: aBlock [
	"Each class in the user's symbol list once (or each of #classes:, when given), then its
	 metaclass."

	| seen |
	classes ifNotNil: [
		^classes do: [:cls | aBlock value: cls. aBlock value: cls class ] ].
	seen := IdentitySet new.
	System myUserProfile symbolList do: [:dict |
		dict valuesDo: [:v |
			(v isBehavior and: [ (seen includes: v) not ]) ifTrue: [
				seen add: v.
				aBlock value: v.
				aBlock value: v class ] ] ]
]

{ #category : 'constants' }
GsRegexSourceSearch >> maxRangesPerMethod [
	"Enough to mark every match a reader will look at; a cap so a method full of matches (a
	 pattern like . over a long method) cannot swell the reply."

	^100
]

{ #category : 'running' }
GsRegexSourceSearch >> matchesIn: aMethod [
	"Where the matches in aMethod's source are, each #(start stop) indexing the whole source, in
	 order; nil when there are none. A method the matcher runs out of stack on counts as
	 skipped, and one it fails on for any other reason as failed."

	| src found |
	src := [ aMethod sourceString ] on: Error do: [:e | nil ].
	src isNil ifTrue: [ ^nil ].
	scanned := scanned + 1.
	(literal notNil and: [ (self source: src contains: literal) not ]) ifTrue: [ ^nil ].
	found := OrderedCollection new.
	[ wholeMethods
		ifTrue: [ self collect: src after: 0 into: found ]
		ifFalse: [
			self linesOf: src do: [:line :offset |
				found size >= self maxRangesPerMethod ifFalse: [
					self collect: line after: offset into: found ] ] ] ]
		on: AlmostOutOfStack, Error
		do: [:e |
			(self isStackExhaustion: e)
				ifTrue: [ skipped := skipped + 1 ]
				ifFalse: [ failed := failed + 1 ].
			^nil ].
	^found isEmpty ifTrue: [ nil ] ifFalse: [ found asArray ]
]

{ #category : 'running' }
GsRegexSourceSearch >> isStackExhaustion: anException [
	"True when anException means the matcher ran out of stack: AlmostOutOfStack, or the hard
	 stack-overflow error GemStone raises if the stack is exhausted again before that
	 notification is re-armed."

	(anException isKindOf: AlmostOutOfStack) ifTrue: [ ^true ].
	^(anException messageText ifNil: [ '' ]) asLowercase
		includesString: 'stack'
]

{ #category : 'running' }
GsRegexSourceSearch >> collect: aString after: offset into: found [
	"Add each match in aString to found, as #(start stop) shifted by offset (the characters
	 before aString in the method), up to #maxRangesPerMethod. The matcher's position is the end
	 of the match it has just answered."

	matcher matchesIn: aString do: [:match | | stop |
		found size >= self maxRangesPerMethod ifTrue: [ ^self ].
		stop := matcher position.
		found add: (Array with: stop - match size + 1 + offset with: stop + offset) ]
]

{ #category : 'running' }
GsRegexSourceSearch >> source: src contains: aString [
	^(ignoreCase
		ifTrue: [ src findStringNoCase: aString startingAt: 1 ]
		ifFalse: [ src findString: aString startingAt: 1 ]) > 0
]

{ #category : 'running' }
GsRegexSourceSearch >> linesOf: src do: aBlock [
	"Each non-empty line of src with the number of characters before it. Splits on line feed and
	 carriage return both: a method saved with carriage returns alone would otherwise be one long
	 line, and could overflow the matcher again."

	| start lf cr |
	lf := Character lf.
	cr := Character cr.
	start := 1.
	1 to: src size do: [:i | | ch |
		ch := src at: i.
		(ch = lf or: [ ch = cr ]) ifTrue: [
			i > start ifTrue: [ aBlock value: (src copyFrom: start to: i - 1) value: start - 1 ].
			start := i + 1 ] ].
	start <= src size ifTrue: [ aBlock value: (src copyFrom: start to: src size) value: start - 1 ]
]

{ #category : 'results' }
GsRegexSourceSearch >> methods [
	"The matching methods, at most #limit of them, as an Array."

	^methods asArray
]

{ #category : 'results' }
GsRegexSourceSearch >> ranges [
	"For each of #methods, in the same order, the Array of its matches, each #(start stop): 1-based
	 indexes into its source, both inclusive (an empty match has stop = start - 1)."

	^ranges asArray
]

{ #category : 'results' }
GsRegexSourceSearch >> rangesLine [
	"#ranges as one line for the client: one entry per method, separated by spaces, each its
	 start-stop pairs separated by commas."

	| ws |
	ws := WriteStream on: String new.
	ranges
		do: [:found |
			found
				do: [:r | ws print: (r at: 1); nextPut: $-; print: (r at: 2) ]
				separatedBy: [ ws nextPut: $, ] ]
		separatedBy: [ ws space ].
	^ws contents
]

{ #category : 'results' }
GsRegexSourceSearch >> skipped [
	"How many methods the matcher ran out of stack on: too long to match (as a whole, or one
	 very long line)."

	^skipped
]

{ #category : 'results' }
GsRegexSourceSearch >> failed [
	"How many methods the matcher failed on for a reason other than running out of stack."

	^failed
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
	"One tab-separated line for the client: wholeMethods (0/1), skipped, scanned, truncated (0/1),
	 failed."

	| ws |
	ws := WriteStream on: String new.
	ws
		nextPutAll: (wholeMethods ifTrue: [ '1' ] ifFalse: [ '0' ]); tab;
		print: skipped; tab;
		print: scanned; tab;
		nextPutAll: (truncated ifTrue: [ '1' ] ifFalse: [ '0' ]); tab;
		print: failed.
	^ws contents
]
