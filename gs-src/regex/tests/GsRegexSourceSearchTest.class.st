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
	self assert: fields size equals: 4.
	self assert: (fields at: 1) equals: '0'.
	self assert: (fields at: 2) equals: search skipped printString.
	self assert: (fields at: 3) asNumber > 0.
	self assert: (fields at: 4) equals: '1'
]
