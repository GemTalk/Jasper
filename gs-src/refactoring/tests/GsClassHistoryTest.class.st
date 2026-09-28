"
Correctness of the class-definition history view + redo, built on GemStone's
native classHistory:

  - forClassNamed: answers one JSON object per version, newest first, carrying the
    version index, the name it had then, its oop, timeStamp, userId, an isCurrent
    flag, its definition source, and the methods added / removed / modified relative
    to the previous version;
  - the baseline version lists all of its methods as 'added';
  - forClassNamed: is read-only (no commit);
  - revertClassNamed:toIndex: restores a historical version's shape and methods as
    a NEW version under the current name, bumping the history, without committing;
  - an unbound name / out-of-range index answer an error envelope.

setUp builds a two-version fixture in UserGlobals (a shape change plus a modified,
an unchanged, and an added method) and tearDown removes it.

The `tests - shadowed class name` category covers #396. Both the read and the restore take a
dictionary, because resolving a class name alone answers the first binding on the symbol list --
a different class when the name is shadowed, whose history was shown and, on Restore, rewritten.
The client always knows the dictionary (it is the Explorer selection), so the dictionary-scoped
selectors are the ones under test; the unscoped ones remain for callers with nothing to give.
"
Class {
	#name : 'GsClassHistoryTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsClassHistoryTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'fixture' }
GsClassHistoryTest >> compile: aSource in: aClass [
	aClass compileMethod: aSource dictionaries: System myUserProfile symbolList category: 'fixture'
]

{ #category : 'asserting' }
GsClassHistoryTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsClassHistoryTest >> fixture [
	^UserGlobals at: #GsCHFixture
]

{ #category : 'running' }
GsClassHistoryTest >> setUp [
	| c |
	super setUp.
	"Version 1: instVar a; methods m1, common."
	c := Object
		subclass: 'GsCHFixture'
		instVarNames: #('a')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'm1 ^a' in: c.
	self compile: 'common ^1' in: c.
	"Version 2 (current): shape change adds b (new version starts empty); re-add m1
	 unchanged, modify common, add m2."
	c := Object
		subclass: 'GsCHFixture'
		instVarNames: #('a' 'b')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'm1 ^a' in: c.
	self compile: 'common ^2' in: c.
	self compile: 'm2 ^b' in: c
]

{ #category : 'running' }
GsClassHistoryTest >> tearDown [
	UserGlobals removeKey: #GsCHFixture ifAbsent: [].
	super tearDown
]

{ #category : 'tests' }
GsClassHistoryTest >> testForClassNamedCarriesVersionMetadata [
	| json |
	json := GsClassHistory forClassNamed: 'GsCHFixture'.

	self assert: json includesSubstring: '"name":"GsCHFixture"'.
	self assert: json includesSubstring: '"isCurrent":true'.
	self assert: json includesSubstring: '"userId":'.
	self assert: json includesSubstring: '"timeStamp":'.
	self assert: json includesSubstring: '"oop":'.
	"Both versions present; the current one names both instVars."
	self assert: json includesSubstring: '"index":2'.
	self assert: json includesSubstring: '"index":1'
]

{ #category : 'tests' }
GsClassHistoryTest >> testChangedMethodsDiffCurrentAgainstPrevious [
	| json |
	json := GsClassHistory forClassNamed: 'GsCHFixture'.

	"Current version (2): common modified, m2 added, m1 unchanged (not listed)."
	self assert: json includesSubstring: '"selector":"common","change":"modified"'.
	self assert: json includesSubstring: '"selector":"m2","change":"added"'
]

{ #category : 'tests' }
GsClassHistoryTest >> testBaselineListsMethodsAsAdded [
	| json baselineTail |
	json := GsClassHistory forClassNamed: 'GsCHFixture'.
	"The baseline is the last object in the (newest-first) array."
	baselineTail := json copyFrom: (json indexOfSubCollection: '"index":1') to: json size.

	self assert: baselineTail includesSubstring: '"selector":"m1","change":"added"'.
	self assert: baselineTail includesSubstring: '"selector":"common","change":"added"'
]

{ #category : 'tests' }
GsClassHistoryTest >> testTimeStampIsLocaleNeutralIso [
	"The timestamp is emitted as a locale-neutral ISO-8601 string
	 (yyyy-mm-ddTHH:MM:SS) so the client can render it in the user's own locale:
	 a four-digit year, dashes at positions 5 and 8, a T at position 11."
	| json i s |
	json := GsClassHistory forClassNamed: 'GsCHFixture'.
	i := json indexOfSubCollection: '"timeStamp":"'.
	self assert: i > 0.
	s := json copyFrom: i + '"timeStamp":"' size to: json size.

	self assert: ((s copyFrom: 1 to: 4) allSatisfy: [:c | c isDigit]).
	self assert: (s at: 5) equals: $-.
	self assert: (s at: 8) equals: $-.
	self assert: (s at: 11) equals: $T
]

{ #category : 'tests' }
GsClassHistoryTest >> testForClassNamedDoesNotCommit [
	| before |
	before := System needsCommit.
	GsClassHistory forClassNamed: 'GsCHFixture'.
	self assert: System needsCommit equals: before
]

{ #category : 'tests' }
GsClassHistoryTest >> testForClassNamedUnboundNameIsError [
	self assert: (GsClassHistory forClassNamed: 'GsCHNoSuchClass')
		includesSubstring: '"error"'
]

{ #category : 'tests' }
GsClassHistoryTest >> testRevertRestoresHistoricalShapeAndMethods [
	| res current |
	res := GsClassHistory revertClassNamed: 'GsCHFixture' toIndex: 1.
	self assert: res includesSubstring: '"reverted":true'.

	current := self fixture.
	"Restored the version-1 shape (only a) and its methods, as a new version."
	self assert: current instVarNames asArray equals: #(#'a').
	self assert: (current includesSelector: #m1).
	self assert: (current includesSelector: #common).
	self assert: (current includesSelector: #m2) not.
	"common was restored to its version-1 source."
	self assert: (current compiledMethodAt: #common environmentId: 0 otherwise: nil) sourceString
		includesSubstring: '^1'.
	self assert: current classHistory size >= 3
]

{ #category : 'tests' }
GsClassHistoryTest >> testRestoreAcrossRenameRenamesBackAndReparents [
	"A class with a subclass and an external reference, renamed, then restored to the
	 pre-rename version: the restore renames the class back, re-parents the subclass,
	 and rewrites the external reference back -- restore is a full rename-back, not just
	 a shape/method redo."
	| base sub other renamed restored |
	base := Object
		subclass: 'GsCHRenBase'
		instVarNames: #('x') classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	base compileMethod: 'foo ^x' dictionaries: System myUserProfile symbolList category: 'fixture'.
	sub := base
		subclass: 'GsCHRenSub'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	other := Object
		subclass: 'GsCHRenOther'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	other compileMethod: 'make ^GsCHRenBase new'
		dictionaries: System myUserProfile symbolList category: 'fixture'.
	[ "rename GsCHRenBase -> GsCHRenAsset"
	 (GsRenameClassRefactoring class: base renameTo: 'GsCHRenAsset' scope: #wholeSystem)
		applyDeselected: #().
	 renamed := UserGlobals at: #GsCHRenAsset.
	 "restore to the original (pre-rename) version"
	 GsClassHistory
		revertClassNamed: 'GsCHRenAsset'
		toIndex: (renamed classHistory findFirst: [:v | v name asString = 'GsCHRenBase']).
	 restored := UserGlobals at: #GsCHRenBase ifAbsent: [nil].

	 self assert: (UserGlobals includesKey: #GsCHRenBase).
	 self assert: (UserGlobals includesKey: #GsCHRenAsset) not.
	 self assert: (UserGlobals at: #GsCHRenSub) superclass == restored.
	 self assert: ((UserGlobals at: #GsCHRenOther)
		compiledMethodAt: #make environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'GsCHRenBase new' ]
		ensure: [
			#('GsCHRenSub' 'GsCHRenOther' 'GsCHRenBase' 'GsCHRenAsset')
				do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]]
]

{ #category : 'tests' }
GsClassHistoryTest >> testRevertDoesNotCommit [
	| before |
	before := System needsCommit.
	GsClassHistory revertClassNamed: 'GsCHFixture' toIndex: 1.
	self assert: System needsCommit equals: before
]

{ #category : 'tests' }
GsClassHistoryTest >> testRemoveVersionTrimsHistory [
	| res |
	self assert: self fixture classHistory size >= 2.
	res := GsClassHistory removeVersionOf: 'GsCHFixture' index: 1.

	self assert: res includesSubstring: '"removed":true'.
	self assert: self fixture classHistory size equals: 1
]

{ #category : 'tests' }
GsClassHistoryTest >> testRemoveVersionRefusesCurrent [
	| current |
	current := self fixture classHistory indexOf: self fixture.
	self assert: (GsClassHistory removeVersionOf: 'GsCHFixture' index: current)
		includesSubstring: '"error"'
]

{ #category : 'tests' }
GsClassHistoryTest >> testRemoveVersionDoesNotCommit [
	| before |
	before := System needsCommit.
	GsClassHistory removeVersionOf: 'GsCHFixture' index: 1.
	self assert: System needsCommit equals: before
]

{ #category : 'tests' }
GsClassHistoryTest >> testRevertOutOfRangeIsError [
	self assert: (GsClassHistory revertClassNamed: 'GsCHFixture' toIndex: 99)
		includesSubstring: '"error"'
]

{ #category : 'tests - shadowed class name' }
GsClassHistoryTest >> testForClassNamedReadsTheDictionaryScopedClassNotAGlobalFirstMatch [
	"The read must describe the class in the dictionary the user selected. Resolving the name alone
	 through `symbolList objectNamed:` describes the first binding on the symbol list instead -- a
	 different class's versions, definitions and changed methods (#396). The client always knows
	 the dictionary (it is the Explorer selection), so the scoped selector is what it calls."
	| decoy json |
	decoy := SymbolDictionary new name: #GsCHShadowDict; yourself.
	System myUserProfile insertDictionary: decoy at: 1.
	[Object
		subclass: 'GsCHFixture'
		instVarNames: #('decoyOwn')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: decoy.
	 json := GsClassHistory forClassNamed: 'GsCHFixture' inDictionary: 'UserGlobals'.

	 "the history read belongs to the fixture, which never had an instance variable named decoyOwn"
	 self deny: json includesSubstring: 'decoyOwn']
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsClassHistoryTest >> testRevertActsOnTheDictionaryScopedClassNotAGlobalFirstMatch [
	"The destructive half. A restore hands the resolved class to GsRenameClassRefactoring
	 restoreClass:toVersion:, which re-parents subclasses and rewrites references image-wide, so
	 resolving the name alone aimed all of that at a class the user never selected (#396)."
	| decoy decoyClass res |
	decoy := SymbolDictionary new name: #GsCHShadowRevertDict; yourself.
	System myUserProfile insertDictionary: decoy at: 1.
	[decoyClass := Object
		subclass: 'GsCHFixture'
		instVarNames: #('decoyOwn')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: decoy.
	 res := GsClassHistory revertClassNamed: 'GsCHFixture' toIndex: 1 inDictionary: 'UserGlobals'.

	 self assert: res includesSubstring: '"reverted":true'.
	 "the restore applied in full"
	 self assert: res includesSubstring: '"failed":[]'.
	 "the fixture is the class restored to its version-1 shape"
	 self assert: (UserGlobals at: #GsCHFixture) instVarNames asArray equals: #(#'a').
	 "and the shadowing dictionary's class is left alone"
	 self assert: (decoy at: #GsCHFixture) == decoyClass]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]
