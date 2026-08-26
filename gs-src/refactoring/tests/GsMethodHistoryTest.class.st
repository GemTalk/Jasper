"
Correctness of the per-method source history store + read view. Unlike class
history there is no native GemStone mechanism, so GsMethodHistory keeps its own
store in UserGlobals and captures versions on the compile path via
beforeCompileIn:source:environmentId: (seed the about-to-be-replaced source) and
afterCompileIn:method:source:category: (record the newly-compiled source, stamped
with the time and userId).

  - the first edit of a pre-existing method SEEDS the original as version 1, so it
    survives (the bug Jadeite for Pharo's early version had);
  - each version carries a timeStamp and userId (which Jadeite for Pharo dropped);
  - re-recording identical source is skipped, so re-accepting text does not inflate
    the history;
  - a brand-new method starts from its first compile (nothing to seed);
  - the version matching the installed method is flagged isCurrent; an installed
    method not in the history shows a synthetic current version (notInHistory);
  - forClassNamed:selector:meta: is read-only (no commit) and answers an error
    envelope for an unbound name;
  - instance and class sides are tracked separately;
  - removeHistoryForClassNamed:selector:meta: forgets a method's versions.

The `edit:in:` helper stands in for the client compile query: it brackets a real
compile with the two capture calls. setUp installs a pre-existing method with no
history; setUp/tearDown clear the fixture's store entries so tests do not leak.
"
Class {
	#name : 'GsMethodHistoryTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsMethodHistoryTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'asserting' }
GsMethodHistoryTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsMethodHistoryTest >> clearFixtureHistory [
	"Remove only this fixture's entries from the shared per-user store, so a test run
	 leaves no trace (and does not disturb any real recorded history)."
	| store |
	store := GsMethodHistory store.
	store keys asArray do: [:k |
		(k asString indexOfSubCollection: 'GsMHFixture') = 1
			ifTrue: [store removeKey: k ifAbsent: []]]
]

{ #category : 'fixture' }
GsMethodHistoryTest >> edit: source in: aBehavior [
	"Stand in for the client compile query: seed, compile, record."
	| m |
	GsMethodHistory beforeCompileIn: aBehavior source: source environmentId: 0.
	m := aBehavior compileMethod: source
		dictionaries: System myUserProfile symbolList category: 'fixture' environmentId: 0.
	GsMethodHistory afterCompileIn: aBehavior method: m source: source category: 'fixture'.
	^m
]

{ #category : 'fixture' }
GsMethodHistoryTest >> fixture [
	^UserGlobals at: #GsMHFixture
]

{ #category : 'running' }
GsMethodHistoryTest >> setUp [
	| c |
	super setUp.
	self clearFixtureHistory.
	c := Object
		subclass: 'GsMHFixture'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	"A pre-existing method compiled WITHOUT the history hooks -- so it has no recorded
	 history until the first edit seeds it."
	c compileMethod: 'm1 ^1'
		dictionaries: System myUserProfile symbolList category: 'fixture' environmentId: 0
]

{ #category : 'running' }
GsMethodHistoryTest >> tearDown [
	self clearFixtureHistory.
	UserGlobals removeKey: #GsMHFixture ifAbsent: [].
	super tearDown
]

{ #category : 'tests' }
GsMethodHistoryTest >> testRecordsVersionsWithTimeStampAndAuthor [
	| json |
	self edit: 'm1 ^2' in: self fixture.
	json := GsMethodHistory forClassNamed: 'GsMHFixture' selector: 'm1' meta: false.

	self assert: json includesSubstring: '"timeStamp":'.
	self assert: json includesSubstring: '"userId":'.
	self assert: json includesSubstring: '"category":"fixture"'.
	"Both sources are retained so the client can diff them."
	self assert: json includesSubstring: '^1'.
	self assert: json includesSubstring: '^2'
]

{ #category : 'tests' }
GsMethodHistoryTest >> testFirstEditSeedsTheOriginalVersion [
	| json |
	self edit: 'm1 ^2' in: self fixture.
	json := GsMethodHistory forClassNamed: 'GsMHFixture' selector: 'm1' meta: false.

	"Version 1 is the seeded original (^1); version 2 is the edit (^2)."
	self assert: json includesSubstring: '"index":1'.
	self assert: json includesSubstring: '"index":2'.
	"The newest version (the edit) matches the installed method."
	self assert: json includesSubstring: '"isCurrent":true'
]

{ #category : 'tests' }
GsMethodHistoryTest >> testIdenticalSourceIsNotRecordedTwice [
	| json |
	self edit: 'm1 ^2' in: self fixture.
	self edit: 'm1 ^2' in: self fixture.
	json := GsMethodHistory forClassNamed: 'GsMHFixture' selector: 'm1' meta: false.

	"Only the seed (^1) and one ^2 -- no third version for the identical re-accept."
	self assert: json includesSubstring: '"index":2'.
	self deny: json includesSubstring: '"index":3'
]

{ #category : 'tests' }
GsMethodHistoryTest >> testNewMethodStartsFromItsFirstCompile [
	| json |
	self edit: 'brandNew ^42' in: self fixture.
	json := GsMethodHistory forClassNamed: 'GsMHFixture' selector: 'brandNew' meta: false.

	"Nothing to seed -- the first compile is version 1, and it is current."
	self assert: json includesSubstring: '"index":1'.
	self deny: json includesSubstring: '"index":2'.
	self assert: json includesSubstring: '^42'.
	self assert: json includesSubstring: '"isCurrent":true'
]

{ #category : 'tests' }
GsMethodHistoryTest >> testInstalledMethodNotInHistoryShowsSyntheticCurrent [
	| json |
	"m1 was installed in setUp without the hooks, so it has no recorded history."
	json := GsMethodHistory forClassNamed: 'GsMHFixture' selector: 'm1' meta: false.

	self assert: json includesSubstring: '"notInHistory":true'.
	self assert: json includesSubstring: '"isCurrent":true'.
	self assert: json includesSubstring: '^1'
]

{ #category : 'tests' }
GsMethodHistoryTest >> testRestoringAnOldVersionRecordsANewVersion [
	| json |
	self edit: 'm1 ^2' in: self fixture.
	self edit: 'm1 ^3' in: self fixture.
	"A restore is just recompiling an old source -- it appends a new version, so it is
	 itself undoable."
	self edit: 'm1 ^1' in: self fixture.
	json := GsMethodHistory forClassNamed: 'GsMHFixture' selector: 'm1' meta: false.

	self assert: json includesSubstring: '"index":4'
]

{ #category : 'tests' }
GsMethodHistoryTest >> testInstanceAndClassSidesAreSeparate [
	self edit: 'm1 ^2' in: self fixture.
	self edit: 'cm ^9' in: self fixture class.

	self assert: (GsMethodHistory forClassNamed: 'GsMHFixture' selector: 'cm' meta: true)
		includesSubstring: '^9'.
	self deny: (GsMethodHistory forClassNamed: 'GsMHFixture' selector: 'm1' meta: false)
		includesSubstring: '^9'
]

{ #category : 'tests' }
GsMethodHistoryTest >> testRemoveHistoryForgetsTheVersions [
	| json |
	self edit: 'm1 ^2' in: self fixture.
	GsMethodHistory removeHistoryForClassNamed: 'GsMHFixture' selector: 'm1' meta: false.
	json := GsMethodHistory forClassNamed: 'GsMHFixture' selector: 'm1' meta: false.

	"No recorded versions remain -- only the synthetic current (installed ^2)."
	self assert: json includesSubstring: '"notInHistory":true'.
	self deny: json includesSubstring: '"index":2'
]

{ #category : 'tests' }
GsMethodHistoryTest >> testForClassNamedUnboundNameIsError [
	self assert: (GsMethodHistory forClassNamed: 'GsMHNoSuchClass' selector: 'x' meta: false)
		includesSubstring: '"error"'
]

{ #category : 'tests' }
GsMethodHistoryTest >> testForClassNamedDoesNotCommit [
	| before |
	self edit: 'm1 ^2' in: self fixture.
	before := System needsCommit.
	GsMethodHistory forClassNamed: 'GsMHFixture' selector: 'm1' meta: false.
	self assert: System needsCommit equals: before
]

{ #category : 'tests' }
GsMethodHistoryTest >> testTimeStampIsLocaleNeutralIso [
	"yyyy-mm-ddTHH:MM:SS: four-digit year, dashes at 5 and 8, T at 11 -- so the client
	 can render it in the user's own locale."
	| json i s |
	self edit: 'm1 ^2' in: self fixture.
	json := GsMethodHistory forClassNamed: 'GsMHFixture' selector: 'm1' meta: false.
	i := json indexOfSubCollection: '"timeStamp":"'.
	self assert: i > 0.
	s := json copyFrom: i + '"timeStamp":"' size to: json size.

	self assert: ((s copyFrom: 1 to: 4) allSatisfy: [:c | c isDigit]).
	self assert: (s at: 5) equals: $-.
	self assert: (s at: 8) equals: $-.
	self assert: (s at: 11) equals: $T
]
