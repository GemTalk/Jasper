"
Tests for GsRegexSourceSearch over a throwaway fixture class, whose methods carry
tokens (regexFixture...) found nowhere else in the image. setUp compiles it into
UserGlobals; tearDown removes it. Nothing is committed.
"
Class {
	#name : 'GsRegexSourceSearchTest',
	#superclass : 'TestCase',
	#instVars : [ 'fixture' ],
	#classVars : [ ],
	#classInstVars : [ ],
	#category : 'Regex-Jasper-Tests'
}

{ #category : 'running' }
GsRegexSourceSearchTest >> setUp [
	| lf cr long |
	super setUp.
	lf := String with: Character lf.
	cr := String with: Character cr.
	long := String new: 5000.
	long atAllPut: $x.
	fixture := Object
		subclass: 'GsRegexSearchFixture'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'alpha', lf, '	^#regexFixtureAlpha -> (Array new: 2) at: 1 put: 2; yourself'.
	self compile: 'beta', lf, '	^#regexFixtureBeta', lf, '		at: 1', lf, '		put: 2'.
	self compile: 'crOnly', cr, '	^#regexFixtureCrStart', cr, '	"regexFixtureCrEnd"'.
	self compile: 'long', lf, '	"regexFixtureLongStart ', long, lf, ' regexFixtureLongEnd"'.
	self compile: 'twice', lf, '	^#regexFixtureTwice -> #regexFixtureTwice'.
	fixture class
		compileMethod: 'gamma', lf, '	^#regexFixtureGamma'
		dictionaries: System myUserProfile symbolList
		category: 'fixture'
]

{ #category : 'running' }
GsRegexSourceSearchTest >> tearDown [
	UserGlobals removeKey: #GsRegexSearchFixture ifAbsent: [nil].
	super tearDown
]

{ #category : 'running' }
GsRegexSourceSearchTest >> compile: aString [
	fixture
		compileMethod: aString
		dictionaries: System myUserProfile symbolList
		category: 'fixture'
]

{ #category : 'running' }
GsRegexSourceSearchTest >> search: aPattern [
	^self search: aPattern ignoreCase: false limit: 1000
]

{ #category : 'running' }
GsRegexSourceSearchTest >> search: aPattern ignoreCase: aBoolean limit: anInteger [
	^(GsRegexSourceSearch pattern: aPattern ignoreCase: aBoolean limit: anInteger) run; yourself
]

{ #category : 'running' }
GsRegexSourceSearchTest >> fixtureSelectorsIn: aSearch [
	"The fixture's selectors among the hits, sorted; class-side ones as 'class>>sel'."

	^((aSearch methods select: [:m | m inClass theNonMetaClass == fixture])
		collect: [:m | m inClass isMeta ifTrue: ['class>>', m selector] ifFalse: [m selector asString]])
			asSortedCollection asArray
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testFindsMethodsAndBothSides [
	self
		assert: (self fixtureSelectorsIn: (self search: 'regexFixture(Alpha|Gamma)'))
		equals: #('alpha' 'class>>gamma')
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testColonPatternFindsKeywordSend [
	self assert: (self fixtureSelectorsIn: (self search: 'at: 1 put:')) equals: #('alpha')
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testLineByLineDoesNotCrossLines [
	"beta has at: and put: on different lines; alpha has them on one."

	| search |
	search := self search: 'at: 1.*put:'.
	self deny: search wholeMethods.
	self assert: (self fixtureSelectorsIn: search) equals: #('alpha')
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testLineBreakInPatternMatchesWholeMethods [
	| search |
	search := self search: 'regexFixtureBeta\n\t\tat: 1'.
	self assert: search wholeMethods.
	self assert: (self fixtureSelectorsIn: search) equals: #('beta')
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testCarriageReturnsSplitLines [
	"crOnly separates its lines with carriage returns alone; they still count as lines."

	self assert: (self fixtureSelectorsIn: (self search: 'regexFixtureCrStart.*regexFixtureCrEnd')) equals: #().
	self assert: (self fixtureSelectorsIn: (self search: 'regexFixtureCrStart\r.*regexFixtureCrEnd')) equals: #('crOnly')
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testTooLongToMatchIsSkippedNotFailed [
	"A 5,000-character run is more than the matcher's recursion can cover."

	| search |
	search := self search: 'regexFixtureLongStart.*\n.*regexFixtureLongEnd'.
	self assert: search wholeMethods.
	self assert: search skipped >= 1.
	self assert: (self fixtureSelectorsIn: search) equals: #()
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testLongLineIsSkippedNotFailed [
	| search |
	search := self search: 'regexFixtureLongStart x.*x$'.
	self deny: search wholeMethods.
	self assert: search skipped >= 1
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testIgnoreCase [
	self assert: (self fixtureSelectorsIn: (self search: 'REGEXFIXTUREALPHA' ignoreCase: false limit: 1000)) equals: #().
	self assert: (self fixtureSelectorsIn: (self search: 'REGEXFIXTUREALPHA' ignoreCase: true limit: 1000)) equals: #('alpha')
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testLimitTruncates [
	"Counted against every hit, not just the fixture's: this test's own source can match."

	| all search |
	all := (self search: 'regexFixture(Alpha|Beta|Gamma)') methods size.
	self assert: all >= 3.
	search := self search: 'regexFixture(Alpha|Beta|Gamma)' ignoreCase: false limit: all - 1.
	self assert: search methods size equals: all - 1.
	self assert: search truncated.
	search := self search: 'regexFixture(Alpha|Beta|Gamma)' ignoreCase: false limit: all.
	self assert: search methods size equals: all.
	self deny: search truncated
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testPrefilterDoesNotChangeResults [
	"The same pattern with and without a required literal (a group hides it) must find
	 the same methods; the literal only makes it faster."

	| fast slow |
	fast := self search: 'regexFixture\w+'.
	slow := self search: '(regexFixture\w+)'.
	self assert: fast requiredLiteral equals: 'regexFixture'.
	self assert: slow requiredLiteral isNil.
	self assert: (self fixtureSelectorsIn: fast) equals: (self fixtureSelectorsIn: slow).
	self assert: (fast methods collect: [:m | m asOop]) asSet equals: (slow methods collect: [:m | m asOop]) asSet
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testUnsupportedPatternSignalsBeforeScanning [
	| search |
	search := GsRegexSourceSearch pattern: 'regexFixture{2}' ignoreCase: false limit: 10.
	self should: [ search run ] raise: GsRegexSyntaxError.
	self assert: search scanned equals: 0
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testSummaryLine [
	| search fields |
	search := self search: 'regexFixture(Alpha|Beta)' ignoreCase: false limit: 1.
	fields := search summaryLine subStrings: (String with: Character tab).
	self assert: fields size equals: 5.
	self assert: (fields at: 1) equals: '0'.
	self assert: (fields at: 2) equals: search skipped printString.
	self assert: (fields at: 3) asNumber > 0.
	self assert: (fields at: 4) equals: '1'.
	self assert: (fields at: 5) equals: search failed printString
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testSeveralTooLongMethodsAreAllSkipped [
	"After the first method runs out of stack, the next ones must be counted the same way and
	 the search must end normally."

	| long lf search |
	lf := String with: Character lf.
	long := String new: 5000.
	long atAllPut: $x.
	self compile: 'long2', lf, '	"regexFixtureLongStart ', long, lf, ' regexFixtureLongEnd"'.
	self compile: 'long3', lf, '	"regexFixtureLongStart ', long, lf, ' regexFixtureLongEnd"'.
	search := (GsRegexSourceSearch pattern: 'regexFixtureLongStart.*\n.*regexFixtureLongEnd' ignoreCase: false limit: 10)
		classes: (Array with: fixture); run; yourself.
	self assert: search skipped equals: 3.
	self assert: search failed equals: 0.
	self assert: search methods isEmpty
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testOtherErrorsCountAsFailedNotSkipped [
	"A fault while matching is not a method being too long."

	| failing search |
	failing := GsRegexSourceSearch
		subclass: 'GsRegexFailingSearch'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	[ failing
		compileMethod: 'collect: aString after: offset into: found  ^self error: ''matcher fault'''
		dictionaries: System myUserProfile symbolList
		category: 'test'.
	  search := (failing pattern: 'regexFixtureAlpha' ignoreCase: false limit: 10)
		classes: (Array with: fixture); run; yourself.
	  self assert: search failed >= 1.
	  self assert: search skipped equals: 0 ]
		ensure: [ UserGlobals removeKey: #GsRegexFailingSearch ifAbsent: [nil] ]
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testNestedSetDoesNotHideAMatch [
	"With [[]abcdef] read wrongly, abcdef would be taken as required text and this method skipped."

	| search |
	self compile: 'nestedSet', (String with: Character lf), '	^#regexFixtureNested_ax'.
	search := (GsRegexSourceSearch pattern: 'Nested_[[]abcdef]x' ignoreCase: false limit: 10)
		classes: (Array with: fixture); run; yourself.
	self assert: (self fixtureSelectorsIn: search) equals: #('nestedSet')
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testCrlfLinesSplitAndRangesLineUp [
	| crlf src search r |
	crlf := String with: Character cr with: Character lf.
	self compile: 'crlf', crlf, '	^#regexFixtureCrlfOne', crlf, '	-> #regexFixtureCrlfTwo'.
	search := (GsRegexSourceSearch pattern: '^\s*-> #regexFixtureCrlf\w+$' ignoreCase: false limit: 10)
		classes: (Array with: fixture); run; yourself.
	self assert: (self fixtureSelectorsIn: search) equals: #('crlf').
	src := self sourceOf: #crlf.
	r := (self rangesOf: #crlf in: search) first.
	self assert: (src copyFrom: (r at: 1) to: (r at: 2)) equals: '	-> #regexFixtureCrlfTwo'
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testLimitZeroAnswersNothing [
	| search |
	search := self search: 'regexFixtureAlpha' ignoreCase: false limit: 0.
	self assert: search methods isEmpty.
	self assert: search truncated
]

{ #category : 'tests' }
GsRegexSourceSearchTest >> testClassesLimitTheScan [
	| search |
	search := (GsRegexSourceSearch pattern: 'regexFixture\w+' ignoreCase: false limit: 100)
		classes: (Array with: fixture); run; yourself.
	self assert: (search methods reject: [:m | m inClass theNonMetaClass == fixture ]) isEmpty.
	self assert: ((self fixtureSelectorsIn: search) includes: 'class>>gamma')
]

{ #category : 'running' }
GsRegexSourceSearchTest >> rangesOf: aSelector in: aSearch [
	"The recorded matches of the fixture's method aSelector, each #(start stop)."

	| i |
	i := aSearch methods findFirst: [:m | m inClass == fixture and: [ m selector == aSelector ] ].
	self assert: i > 0.
	^aSearch ranges at: i
]

{ #category : 'running' }
GsRegexSourceSearchTest >> sourceOf: aSelector [
	^(fixture compiledMethodAt: aSelector) sourceString
]

{ #category : 'running' }
GsRegexSourceSearchTest >> range: aString in: src after: anIndex [
	"#(start stop) of aString's first occurrence in src at or after anIndex."

	| start |
	start := src indexOfSubCollection: aString startingAt: anIndex.
	self assert: start > 0.
	^Array with: start with: start + aString size - 1
]

{ #category : 'ranges' }
GsRegexSourceSearchTest >> testRangeOfAMatchOnOneLine [
	| src |
	src := self sourceOf: #alpha.
	self
		assert: (self rangesOf: #alpha in: (self search: 'at: 1 put:'))
		equals: (Array with: (self range: 'at: 1 put:' in: src after: 1))
]

{ #category : 'ranges' }
GsRegexSourceSearchTest >> testRangeOfAMatchAcrossALineBreak [
	"One match spanning two lines: from the token on the first to 'at: 1' on the second."

	| src start stop |
	src := self sourceOf: #beta.
	start := src indexOfSubCollection: 'regexFixtureBeta' startingAt: 1.
	stop := (src indexOfSubCollection: 'at: 1' startingAt: 1) + 4.
	self
		assert: (self rangesOf: #beta in: (self search: 'regexFixtureBeta\n\t\tat: 1'))
		equals: (Array with: (Array with: start with: stop))
]

{ #category : 'ranges' }
GsRegexSourceSearchTest >> testRangesOnLaterLinesCountTheLinesBefore [
	"crOnly's lines are separated by carriage returns alone; offsets still index the whole source."

	| src |
	src := self sourceOf: #crOnly.
	self
		assert: (self rangesOf: #crOnly in: (self search: 'regexFixtureCr\w+'))
		equals: (Array
			with: (self range: 'regexFixtureCrStart' in: src after: 1)
			with: (self range: 'regexFixtureCrEnd' in: src after: 1))
]

{ #category : 'ranges' }
GsRegexSourceSearchTest >> testEveryMatchIsRecordedInOrder [
	| src first |
	src := self sourceOf: #twice.
	first := self range: 'regexFixtureTwice' in: src after: 1.
	self
		assert: (self rangesOf: #twice in: (self search: 'regexFixtureTwice'))
		equals: (Array
			with: first
			with: (self range: 'regexFixtureTwice' in: src after: first last + 1))
]

{ #category : 'ranges' }
GsRegexSourceSearchTest >> testMatchesPerMethodAreCapped [
	"#long holds a run of 5,000 x's: a thousand matches of xxxxx."

	| search |
	search := self search: 'xxxxx'.
	self assert: (self rangesOf: #long in: search) size equals: search maxRangesPerMethod
]

{ #category : 'ranges' }
GsRegexSourceSearchTest >> testRangesLineHasOneEntryPerMethod [
	| search entries |
	search := self search: 'regexFixture(Alpha|Twice)'.
	entries := search rangesLine subStrings: ' '.
	self assert: entries size equals: search methods size.
	entries with: search ranges do: [:entry :found | | pairs |
		pairs := entry subStrings: ','.
		self assert: pairs size equals: found size.
		pairs with: found do: [:pair :range |
			self assert: pair equals: (range at: 1) printString, '-', (range at: 2) printString ] ]
]

