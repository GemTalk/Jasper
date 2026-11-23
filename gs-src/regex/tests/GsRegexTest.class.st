"
Tests for GsRegex: Jasper's changes to the library's behaviour (a colon is plain text;
unsupported constructs are refused with a reason), and the pattern analysis a
source search relies on (#spansLines:, #requiredLiteralIn:). The library's own
behaviour is covered by its vendored tests, GsRxMatcherTest and GsRxParserTest.
"
Class {
	#name : 'GsRegexTest',
	#superclass : 'TestCase',
	#instVars : [ ],
	#classVars : [ ],
	#classInstVars : [ ],
	#category : 'Regex-Jasper-Tests'
}

{ #category : 'colon' }
GsRegexTest >> testColonIsPlainText [
	self assert: (GsRegex matches: 'at:put:' pattern: 'at:put:').
	self assert: (GsRegex search: 'printOn: aStream' pattern: 'printOn:').
	self deny: (GsRegex search: 'printOn aStream' pattern: 'printOn:')
]

{ #category : 'colon' }
GsRegexTest >> testColonNameColonIsNotAPredicate [
	"Upstream, :isDigit: meant 'a character that answers true to #isDigit'."

	self deny: (GsRegex matches: '7' pattern: ':isDigit:').
	self assert: (GsRegex matches: ':isDigit:' pattern: ':isDigit:')
]

{ #category : 'colon' }
GsRegexTest >> testNamedClassesInSetsStillWork [
	self assert: (GsRegex matches: 'abc' pattern: '[[:alpha:]]+').
	self assert: (GsRegex matches: '42' pattern: '[[:digit:]]+').
	self deny: (GsRegex matches: 'a1' pattern: '[[:alpha:]]+')
]

{ #category : 'words' }
GsRegexTest >> testUnderscoreIsPartOfAWord [
	"As in other regex tools, and as \w already has it. Upstream, \<halt\> matched inside _halt:."

	self assert: (GsRegex search: 'self halt' pattern: '\<halt\>').
	self assert: (GsRegex search: 'self halt: ''x''' pattern: '\<halt\>').
	self deny: (GsRegex search: 'self _halt: ''x''' pattern: '\<halt\>').
	self deny: (GsRegex search: 'halt_now' pattern: '\<halt\>').
	self deny: (GsRegex search: 'my_foo' pattern: '\bfoo').
	self assert: (GsRegex search: 'my_foo' pattern: '\Bfoo').
	self assert: (GsRegex matches: 'my_var' pattern: '\w+')
]

{ #category : 'unsupported' }
GsRegexTest >> testCountedRepetitionIsRefused [
	#('a{3}' 'a{3,}' 'a{2,5}' 'x(ab){2}') do: [:p |
		self should: [ GsRegex pattern: p ] raise: GsRegexSyntaxError ].
	self
		assert: ([ GsRegex pattern: 'a{3}'. '' ] on: GsRegexSyntaxError do: [:e | e messageText ])
		equals: 'counted repetition such as {3} is not supported; write the repeated text out, or use * + ?'
]

{ #category : 'unsupported' }
GsRegexTest >> testBracesThatAreNotCountsAreText [
	self assert: (GsRegex search: 'x := { 1. 2 }' pattern: '{ 1').
	self assert: (GsRegex matches: 'a{x}' pattern: 'a{x}').
	self assert: (GsRegex matches: 'a{3}' pattern: 'a\{3}').
	self assert: (GsRegex matches: '{' pattern: '[{3}]').
	self assert: (GsRegex matches: 'a{' pattern: 'a{')
]

{ #category : 'unsupported' }
GsRegexTest >> testQuestionGroupsAreRefused [
	#('(?:a)b' '(?i)ab' 'a(?=b)' 'x((?:y))') do: [:p |
		self should: [ GsRegex pattern: p ] raise: GsRegexSyntaxError ].
	self
		assert: ([ GsRegex pattern: '(?:a)'. '' ] on: GsRegexSyntaxError do: [:e | e messageText ])
		equals: '(?...) groups are not supported'
]

{ #category : 'unsupported' }
GsRegexTest >> testEscapedOrBracketedQuestionGroupIsText [
	self assert: (GsRegex matches: 'a' pattern: '\(?a').
	self assert: (GsRegex matches: '(a' pattern: '\(?a').
	self assert: (GsRegex matches: '?' pattern: '[(?]')
]

{ #category : 'unsupported' }
GsRegexTest >> testEmptyPatternIsRefused [
	self should: [ GsRegex pattern: '' ] raise: GsRegexSyntaxError
]

{ #category : 'unsupported' }
GsRegexTest >> testLibrarySyntaxErrorsAreRegexErrors [
	#('a(' '(a|)*' '[ab' 'a\') do: [:p |
		self should: [ GsRegex pattern: p ] raise: GsRegexError ]
]

{ #category : 'matching' }
GsRegexTest >> testSearchAndIgnoreCase [
	self assert: (GsRegex search: 'an OrderedCollection new' pattern: 'Ordered\w+').
	self deny: (GsRegex search: 'an orderedcollection new' pattern: 'Ordered\w+').
	self assert: ((GsRegex pattern: 'Ordered\w+' ignoreCase: true) search: 'an orderedcollection new')
]

{ #category : 'matching' }
GsRegexTest >> testBackslashEscapes [
	self assert: (GsRegex matches: (String with: Character esc) pattern: '\e').
	self assert: (GsRegex matches: (String with: Character tab) pattern: '\t').
	self assert: (GsRegex matches: 'a.b' pattern: 'a\.b').
	self deny: (GsRegex matches: 'axb' pattern: 'a\.b')
]

{ #category : 'lines' }
GsRegexTest >> testSpansLines [
	self assert: (GsRegex spansLines: 'a\nb').
	self assert: (GsRegex spansLines: 'a\rb').
	self assert: (GsRegex spansLines: 'a', (String with: Character lf), 'b').
	self deny: (GsRegex spansLines: 'a.*b').
	self deny: (GsRegex spansLines: 'a\\nb').
	self deny: (GsRegex spansLines: '\w+\s')
]

{ #category : 'required literal' }
GsRegexTest >> testRequiredLiteral [
	#(
		#('printOn:' 'printOn:')
		#('Ordered\w+' 'Ordered')
		#('at:.*put:' 'put:')
		#('colou?r' 'colo')
		#('ab+c' 'ab')
		#('(foo|bar)baz' 'baz')
		#('(abc)*de' 'de')
		#('x[abc]yz' 'yz')
		#('[]abc]def' 'def')
		#('[^]x]+def' 'def')
		#('[[:alpha:]]+xyz' 'xyz')
		#('a\.b' 'a.b')
		#('\(foo\)' '(foo)')
		#('^self$' 'self')
		#('{ 1' '{ 1')
		#('ab\w+cd' 'ab')
	) do: [:pair |
		self
			assert: (GsRegex requiredLiteralIn: (pair at: 1))
			equals: (pair at: 2) ]
]

{ #category : 'required literal' }
GsRegexTest >> testNoRequiredLiteral [
	"A top-level | means any branch may match; groups may be optional; one character
	 is not worth a substring test."

	#('foo|bar' 'x|yz' '(printOn:)' '\w+' 'a' 'ab*' '.*' '[abc]+' '\d\d\d' 'a?b?c?') do: [:p |
		self assert: (GsRegex requiredLiteralIn: p) isNil ]
]

{ #category : 'required literal' }
GsRegexTest >> testRequiredLiteralIsInEveryMatch [
	"Whatever #requiredLiteralIn: answers must occur in every string the pattern matches."

	#(
		#('colou?r' #('color' 'colour'))
		#('ab+c' #('abc' 'abbbc'))
		#('(abc)*de' #('de' 'abcde' 'abcabcde'))
		#('at:.*put:' #('at:put:' 'at: 1 put:'))
		#('x[abc]yz' #('xayz' 'xcyz'))
	) do: [:row | | literal |
		literal := GsRegex requiredLiteralIn: (row at: 1).
		(row at: 2) do: [:s |
			self assert: (GsRegex matches: s pattern: (row at: 1)).
			literal ifNotNil: [ self assert: (s findString: literal startingAt: 1) > 0 ] ] ]
]

{ #category : 'unsupported' }
GsRegexTest >> testRequiredLiteralReadsNestedSetsAsTheLibraryDoes [
	"Every [ inside a set needs its own ], so [[]abcdef] is one set and abcdef is not required
	 text. Reading the set as [[] would make the search skip methods that match."

	self assert: (GsRegex matches: 'ax' pattern: '[[]abcdef]x').
	self assert: (GsRegex requiredLiteralIn: '[[]abcdef]x') isNil.
	self assert: (GsRegex requiredLiteralIn: '[[]ab]xyz') equals: 'xyz'
]

{ #category : 'unsupported' }
GsRegexTest >> testUnknownEscapesAreRefused [
	"A backslash before a letter or digit the library does not know would match that letter or
	 digit itself: (a)\1 would find a1, not aa."

	#('\1' '(a)\1' '\x41' '\A' '\z' '\p') do: [:p |
		self should: [ GsRegex pattern: p ] raise: GsRegexSyntaxError ].
	self
		assert: ([ GsRegex pattern: '(a)\1'. '' ] on: GsRegexSyntaxError do: [:e | e messageText ])
		equals: '\1 is not supported: there are no back-references'.
	#('\.' '\(' '\\' '\w' '\W' '\d' '\D' '\s' '\S' '\b' '\B' '\<' '\>' '\n' '\r' '\t' '\f' '\e' '\[1]')
		do: [:p | GsRegex pattern: p ]
]

{ #category : 'unsupported' }
GsRegexTest >> testLazyQuantifiersAreRefused [
	#('a.*?b' 'a+?' 'a??' 'a*+') do: [:p |
		self should: [ GsRegex pattern: p ] raise: GsRegexSyntaxError ].
	self
		assert: ([ GsRegex pattern: 'a.*?b'. '' ] on: GsRegexSyntaxError do: [:e | e messageText ])
		equals: 'lazy and possessive quantifiers such as *? and +? are not supported; * + ? always match as much as they can'.
	"Escaped, or inside a set, they are plain characters."
	GsRegex pattern: 'a\*?'.
	GsRegex pattern: '[*?]+'
]

{ #category : 'dialect' }
GsRegexTest >> testWhatUsersTypeFromOtherDialects [
	"The common constructs, as a user coming from JavaScript or PCRE would write them."

	self assert: (GsRegex search: 'x 42 y' pattern: '\d+').
	self assert: (GsRegex search: 'a b' pattern: 'a\sb').
	self assert: (GsRegex search: 'say halt now' pattern: '\bhalt\b').
	self deny: (GsRegex search: 'haltIfNil' pattern: '\bhalt\b').
	self assert: (GsRegex search: 'haltIfNil' pattern: 'halt\B').
	self assert: (GsRegex search: 'self' pattern: 'self$').
	self assert: (GsRegex search: 'cat' pattern: 'dog|cat').
	self assert: (GsRegex matches: 'abab' pattern: '((ab))+').
	self assert: (GsRegex search: 'foo_bar' pattern: '\w+')
]

{ #category : 'api' }
GsRegexTest >> testApiOperations [
	self assert: (GsRegex allMatchesIn: 'a1b22' pattern: '\d+') asArray equals: #('1' '22').
	self assert: (GsRegex allRangesIn: 'a1b22' pattern: '\d+') size equals: 2.
	self assert: (GsRegex copy: 'a1b22' replacing: '\d+' with: '#') equals: 'a#b#'.
	self assert: (GsRegex copy: 'ab' translating: '[a-z]' using: [:m | m asUppercase]) equals: 'AB'.
	self assert: (GsRegex in: 'a1b22' pattern: '\d+' collect: [:m | m size]) asArray equals: #(1 2).
	self assert: (GsRegex prefixMatches: 'abc' pattern: 'ab').
	self assert: (GsRegex prefixMatchesIgnoringCase: 'ABC' pattern: 'ab').
	self assert: (GsRegex matchesIgnoringCase: 'ABC' pattern: 'abc')
]
