"
Correctness of the refactoring UNDO record and executor (issue #434).

GsRefactoringUndo wraps an ordinary refactoring apply, snapshots the live state of
every method slot the change set touches BEFORE and AFTER it, and diffs the two into
an INVERSE change set that puts the stone back.

This suite pins down, for each of the method-only refactorings, that apply-then-undo
returns the affected classes to their ORIGINAL state -- and it asserts that over the
WHOLE class, both sides, including methods the refactoring had no reason to touch,
with their categories intact, because those are the ones no change set mentions and
so nothing else would catch their loss.

It also pins down the machinery around that:

  - the inverse is ordered restore-then-recompile-then-remove, so undoing a rename
    brings the old selector back before the new one goes;
  - a change set that touches CLASS SHAPE records no undo entry at all (this tier is
    method changes only) and says so via an undoRecorded:false field;
  - deselecting an inverse change leaves that one slot alone and keeps the entry;
  - a clean undo consumes the entry (there is nothing left to undo);
  - drift -- a method edited after the refactoring -- surfaces as a per-change
    warning rather than a refusal, and undoing still proceeds;
  - undoing is idempotent where it can be (removing an already-removed method is
    not an error);
  - nothing here commits.

Every fixture selector is prefixed `gsu` so no refactoring in this suite can reach a
same-named method elsewhere in the image. Every scope used is #class, except one whole-system
rename in the shadowed-name tests, whose second implementor is the point of the test.

setUp builds throwaway classes in UserGlobals and clears any recorded undo; tearDown
removes them and clears again, so no test leaks an entry into the next.

The `tests - shadowed class name` category covers #396 across all THREE undo mechanisms, each of
which used to resolve its class by name:

  - #changeSet replay resolves every recorded change through the environment, the same lookup the
    forward apply uses -- so the safety net had the hole it is meant to catch;
  - #mirror re-runs the opposite operation through the engine itself, inheriting whatever the
    engine gets wrong, including `dictionaryForNewVersionOf:`;
  - #historyRevert captures and replays through `GsClassHistory`.

Most of them shadow the class name only AFTER the forward refactoring has landed, so the
refactoring itself is correct and the undo alone is on trial. That leaves the decoy outside the
change set, so one test instead binds a second GsUndoAccount from the start and has the refactoring
touch both: the undo must then record and restore both.
"
Class {
	#name : 'GsRefactoringUndoTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsRefactoringUndoTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'asserting' }
GsRefactoringUndoTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> fixture [
	^UserGlobals at: #GsUndoAccount
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> otherFixture [
	^UserGlobals at: #GsUndoLedger
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> subFixture [
	^UserGlobals at: #GsUndoSavings
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> compile: aSource in: aClass category: aCategory [
	[aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: aCategory]
		on: CompileWarning
		do: [:ex | ex resume: nil]
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> sourceOf: aSelector in: aBehavior [
	^(aBehavior compiledMethodAt: aSelector environmentId: 0 otherwise: nil)
		ifNil: [nil]
		ifNotNil: [:m | m sourceString]
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> categoryOf: aSelector in: aBehavior [
	^(aBehavior categoryOfSelector: aSelector environmentId: 0)
		ifNil: [nil]
		ifNotNil: [:c | c asString]
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> offsetIn: aBehavior selector: aSelector at: aSubstring [
	^(self sourceOf: aSelector in: aBehavior) indexOfSubCollection: aSubstring
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> snapshotOf: aClass [
	"Everything about aClass an undo must restore: every selector on BOTH sides, each
	 with its source and its category. Deliberately whole-class -- an undo that quietly
	 loses a method it never mentioned is exactly what this catches."
	| result |
	result := Dictionary new.
	(Array with: false with: true) do: [:meta | | behavior |
		behavior := meta ifTrue: [aClass class] ifFalse: [aClass].
		behavior selectors do: [:sel |
			result
				at: (meta printString, '|', sel asString)
				put: (Array
					with: (self sourceOf: sel in: behavior)
					with: (self categoryOf: sel in: behavior))]].
	^result
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> assertSnapshot: expected restoredFor: aClass [
	"aClass is back to `expected` EXACTLY: the same selectors on both sides (nothing
	 lost, nothing left over), each with the same source and the same category."
	| actual |
	actual := self snapshotOf: aClass.
	self
		assert: actual keys asSortedCollection asArray
		equals: expected keys asSortedCollection asArray.
	expected keysAndValuesDo: [:k :v |
		self assert: (GsRefactoringUndo source: (actual at: k) first matches: (v at: 1)).
		self assert: (actual at: k) last equals: (v at: 2)]
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> applyRecording: aRefactoring [
	"Stage aRefactoring's preview under a token and apply it through the recorder,
	 exactly as the client does. Answers the apply-result JSON."
	^self applyRecording: aRefactoring deselected: #()
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> applyRecording: aRefactoring deselected: ids [
	| token |
	token := 'undo-test-token'.
	aRefactoring changeSet.
	SessionTemps current at: token asSymbol put: aRefactoring.
	^[GsRefactoringUndo
		recordAndApplyForToken: token
		engine: aRefactoring class name asString
		deselected: ids
		label: 'test refactoring']
		ensure: [SessionTemps current removeKey: token asSymbol ifAbsent: []]
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> undoAll [
	"Preview and apply the whole recorded undo, as the client's panel does."
	^self undoDeselecting: #()
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> undoDeselecting: ids [
	| token |
	token := 'undo-test-preview'.
	GsRefactoringUndo startPreviewToken: token maxBytes: 1000000.
	^[GsRefactoringUndo applyForToken: token deselected: ids]
		ensure: [GsRefactoringUndo clearToken: token]
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> undoPreviewJson [
	| token json |
	token := 'undo-test-preview'.
	json := GsRefactoringUndo startPreviewToken: token maxBytes: 1000000.
	GsRefactoringUndo clearToken: token.
	^json
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> renameInFixture: oldSelector to: newSelector [
	^GsRenameMethodRefactoring
		class: self fixture
		renameSelector: oldSelector
		toParts: (Array with: newSelector)
		permutation: #()
		scope: #class
]

{ #category : 'running' }
GsRefactoringUndoTest >> setUp [
	| account ledger savings |
	super setUp.
	GsRefactoringUndo clear.
	GsRefactoringUndo discardPendingCapture.
	account := Object
		subclass: 'GsUndoAccount'
		instVarNames: #('balance' 'owner')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	ledger := Object
		subclass: 'GsUndoLedger'
		instVarNames: #('balance')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	savings := account
		subclass: 'GsUndoSavings'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	"Instance side. #gsuUntouched and #gsuAlsoUntouched are named in NO change set any
	 refactoring here stages -- they are the survival canaries."
	self compile: 'gsuTotal ^ 40 + 2' in: account category: 'computing'.
	self compile: 'gsuReport ^ ''total is '', self gsuTotal printString' in: account category: 'printing'.
	self compile: 'gsuUntouched ^ ''kept''' in: account category: 'fixture'.
	self compile: 'gsuBalance ^ balance' in: account category: 'accessing'.
	self compile: 'gsuPure ^ 7 * 6' in: account category: 'computing'.
	"Class side -- an undo must not disturb it, and must restore it when it is the target."
	self compile: 'gsuAlsoUntouched ^ ''class side''' in: account class category: 'fixture'.
	self compile: 'gsuMake ^ self new' in: account class category: 'instance creation'.
	"Other class, for move-method."
	self compile: 'gsuLedgerOwn ^ 1' in: ledger category: 'fixture'.
	"Subclass, for push up / push down."
	self compile: 'gsuSavingsOwn ^ 2' in: savings category: 'fixture'
]

{ #category : 'running' }
GsRefactoringUndoTest >> tearDown [
	GsRefactoringUndo clear.
	GsRefactoringUndo discardPendingCapture.
	"GsUndoOldLedger / GsUndoVarHolder only exist in the reverse-rename tests, and a test that
	 fails mid-way can leave either behind -- remove them unconditionally."
	#(#GsUndoSavings #GsUndoLedger #GsUndoAccount #GsUndoOldLedger #GsUndoVarHolder #GsUndoCreated)
		do: [:n | UserGlobals removeKey: n ifAbsent: []].
	super tearDown
]

{ #category : 'tests - source comparison' }
GsRefactoringUndoTest >> testSourceMatchesComparesCharacterwiseAndHandlesNil [
	self assert: (GsRefactoringUndo source: 'abc' matches: 'abc').
	self deny: (GsRefactoringUndo source: 'abc' matches: 'abd').
	self deny: (GsRefactoringUndo source: 'abc' matches: 'abcd').
	self assert: (GsRefactoringUndo source: nil matches: nil).
	self deny: (GsRefactoringUndo source: nil matches: '').
	self deny: (GsRefactoringUndo source: '' matches: nil)
]

{ #category : 'tests - envelope' }
GsRefactoringUndoTest >> testResultWithUndoRecordedSplicesTheFlagIn [
	self
		assert: (GsRefactoringUndo result: '{"applied":3,"failed":[]}' withUndoRecorded: true)
		equals: '{"applied":3,"failed":[],"undoRecorded":true}'.
	self
		assert: (GsRefactoringUndo result: '{"applied":0,"failed":[]}' withUndoRecorded: false)
		equals: '{"applied":0,"failed":[],"undoRecorded":false}'
]

{ #category : 'tests - envelope' }
GsRefactoringUndoTest >> testResultWithUndoRecordedLeavesANonObjectPayloadAlone [
	"The apply's own answer always matters more than the annotation."
	self
		assert: (GsRefactoringUndo result: 'Class not found: Foo' withUndoRecorded: false)
		equals: 'Class not found: Foo'
]

{ #category : 'tests - envelope' }
GsRefactoringUndoTest >> testStatusJsonReportsNothingToUndoWhenEmpty [
	self assert: GsRefactoringUndo statusJson equals: '{"available":false}'
]

{ #category : 'tests - scope' }
GsRefactoringUndoTest >> testAClassShapeChangeRecordsNoUndoAtAll [
	"This tier reverses METHOD changes only. A change set that reshapes a class must
	 record NOTHING -- half an undo is worse than none."
	| cs |
	cs := GsRefactoringChangeSet new.
	cs
		addMethodRecompileInDictionary: nil className: 'GsUndoAccount' isMeta: false
		selector: 'gsuTotal' category: 'computing' oldSource: 'gsuTotal ^1' newSource: 'gsuTotal ^2'.
	cs
		addClassDefinitionEditInDictionary: nil className: 'GsUndoAccount'
		oldSource: 'old' newSource: 'new'.
	self assert: (GsRefactoringUndo slotsTouchedIn: cs deselected: #()) isNil
]

{ #category : 'tests - scope' }
GsRefactoringUndoTest >> testADeselectedClassShapeChangeDoesNotBlockRecording [
	"Only the changes that are actually APPLIED constrain what can be undone."
	| cs classChange slots |
	cs := GsRefactoringChangeSet new.
	cs
		addMethodRecompileInDictionary: nil className: 'GsUndoAccount' isMeta: false
		selector: 'gsuTotal' category: 'computing' oldSource: 'gsuTotal ^1' newSource: 'gsuTotal ^2'.
	classChange := cs
		addClassDefinitionEditInDictionary: nil className: 'GsUndoAccount'
		oldSource: 'old' newSource: 'new'.
	slots := GsRefactoringUndo
		slotsTouchedIn: cs
		deselected: (Array with: classChange id).
	self assert: slots size equals: 1.
	self assert: (slots first at: 4) equals: 'gsuTotal'
]

{ #category : 'tests - scope' }
GsRefactoringUndoTest >> testARenameContributesBothItsSelectorsAsSlots [
	"A #methodRename touches TWO slots on the same class; both must be snapshotted, or
	 the undo would never notice the new selector appearing."
	| cs slots names |
	cs := GsRefactoringChangeSet new.
	cs
		addMethodRenameInDictionary: nil className: 'GsUndoAccount' isMeta: false
		oldSelector: 'gsuTotal' newSelector: 'gsuSum' category: 'computing'
		oldSource: 'gsuTotal ^1' newSource: 'gsuSum ^1'.
	slots := GsRefactoringUndo slotsTouchedIn: cs deselected: #().
	names := (slots collect: [:s | s at: 4]) asSortedCollection asArray.
	self assert: names equals: #('gsuSum' 'gsuTotal')
]

{ #category : 'tests - scope' }
GsRefactoringUndoTest >> testTheSameSelectorOnSameNamedClassesInTwoDictionariesIsTwoSlots [
	"A class name does not identify a class, so neither does `Class>>selector`. A change set that
	 touches #gsuTotal on a GsUndoAccount in each of two dictionaries touches two slots, and the
	 undo has to snapshot both -- or it restores one and reports success for the pair (#396)."
	| cs slots |
	cs := GsRefactoringChangeSet new.
	cs
		addMethodRecompileInDictionary: 'UserGlobals' className: 'GsUndoAccount' isMeta: false
		selector: 'gsuTotal' category: 'computing' oldSource: 'gsuTotal ^1' newSource: 'gsuTotal ^2'.
	cs
		addMethodRecompileInDictionary: 'GsUndoTwinDict' className: 'GsUndoAccount' isMeta: false
		selector: 'gsuTotal' category: 'computing' oldSource: 'gsuTotal ^1' newSource: 'gsuTotal ^2'.
	slots := GsRefactoringUndo slotsTouchedIn: cs deselected: #().
	self assert: slots size equals: 2.
	self
		assert: (slots collect: [:s | s at: 1]) asSortedCollection asArray
		equals: #('GsUndoTwinDict' 'UserGlobals')
]

{ #category : 'tests - scope' }
GsRefactoringUndoTest >> testMethodHistorySlotsKeepSameNamedClassesInTwoDictionariesApart [
	"The slots method HISTORY records come from the same de-duplication, minus the refusal of a
	 class reshape. A reshape that recompiles #gsuTotal on a GsUndoAccount in each of two
	 dictionaries owes both methods their version entries."
	| cs slots |
	cs := GsRefactoringChangeSet new.
	cs
		addClassDefinitionEditInDictionary: 'UserGlobals' className: 'GsUndoAccount'
		oldSource: 'old' newSource: 'new'.
	cs
		addMethodRecompileInDictionary: 'UserGlobals' className: 'GsUndoAccount' isMeta: false
		selector: 'gsuTotal' category: 'computing' oldSource: 'gsuTotal ^1' newSource: 'gsuTotal ^2'.
	cs
		addMethodRecompileInDictionary: 'GsUndoTwinDict' className: 'GsUndoAccount' isMeta: false
		selector: 'gsuTotal' category: 'computing' oldSource: 'gsuTotal ^1' newSource: 'gsuTotal ^2'.
	slots := GsRefactoringUndo methodSlotsIn: cs deselected: #().
	self assert: slots size equals: 2.
	self
		assert: (slots collect: [:s | s at: 1]) asSortedCollection asArray
		equals: #('GsUndoTwinDict' 'UserGlobals')
]

{ #category : 'tests - rename method' }
GsRefactoringUndoTest >> testUndoRenameMethodRestoresTheWholeClass [
	| before applyJson undoJson |
	before := self snapshotOf: self fixture.
	applyJson := self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	self assert: applyJson includesSubstring: '"undoRecorded":true'.
	"The rename really happened before we undo it."
	self assert: (self sourceOf: #gsuSum in: self fixture) notNil.
	self assert: (self sourceOf: #gsuTotal in: self fixture) isNil.

	undoJson := self undoAll.
	self assert: undoJson includesSubstring: '"failed":[]'.
	self assertSnapshot: before restoredFor: self fixture
]

{ #category : 'tests - rename method' }
GsRefactoringUndoTest >> testUndoRenameMethodRestoresTheSenderToo [
	"#gsuReport sends #gsuTotal; the rename rewrote it. Undoing must put the send back."
	| before |
	before := self sourceOf: #gsuReport in: self fixture.
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	self deny: (self sourceOf: #gsuReport in: self fixture) includesSubstring: 'self gsuTotal'.
	self undoAll.
	self assert: (GsRefactoringUndo source: (self sourceOf: #gsuReport in: self fixture) matches: before)
]

{ #category : 'tests - rename method' }
GsRefactoringUndoTest >> testUndoRestoresTheOldSelectorBeforeRemovingTheNewOne [
	"The inverse is ordered restore-then-remove; the change set must reflect that, or an
	 interrupted undo could leave the method under NEITHER selector."
	| kinds |
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	kinds := GsRefactoringUndo currentEntry changeSet changes collect: [:c | c kind asString].
	self assert: (kinds indexOf: 'methodAdd') < (kinds indexOf: 'methodRemove')
]

{ #category : 'tests - rename method' }
GsRefactoringUndoTest >> testACleanUndoConsumesTheEntry [
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	self assert: GsRefactoringUndo currentEntry notNil.
	self undoAll.
	self assert: GsRefactoringUndo currentEntry isNil.
	self assert: GsRefactoringUndo statusJson equals: '{"available":false}'
]

{ #category : 'tests - rename method' }
GsRefactoringUndoTest >> testAPartialUndoKeepsTheEntryAndLeavesDeselectedSlotsAlone [
	| keep |
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	"Deselect the removal of the NEW selector: undoing should bring #gsuTotal back and
	 leave #gsuSum in place."
	keep := GsRefactoringUndo currentEntry changeSet changes
		detect: [:c | c kind == #methodRemove] ifNone: [nil].
	self assert: keep notNil.
	self undoDeselecting: (Array with: keep id).
	self assert: (self sourceOf: #gsuSum in: self fixture) notNil.
	self assert: (self sourceOf: #gsuTotal in: self fixture) notNil.
	"A partial undo is not used up."
	self assert: GsRefactoringUndo currentEntry notNil
]

{ #category : 'tests - rename method' }
GsRefactoringUndoTest >> testStatusJsonNamesWhatWouldBeUndone [
	| json |
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	json := GsRefactoringUndo statusJson.
	self assert: json includesSubstring: '"available":true'.
	self assert: json includesSubstring: '"label":"test refactoring"'.
	self assert: json includesSubstring: '"engine":"GsRenameMethodRefactoring"'
]

{ #category : 'tests - drift' }
GsRefactoringUndoTest >> testAnEditAfterTheRefactoringWarnsButStillUndoes [
	| json |
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	"Edit the renamed method after the fact."
	self compile: 'gsuSum ^ 999' in: self fixture category: 'computing'.
	json := self undoPreviewJson.
	self assert: json includesSubstring: 'Edited since the refactoring'.
	self deny: json includesSubstring: '"drifted":0'.
	"Warned, not refused: the undo still runs and puts the original back."
	self undoAll.
	self assert: (self sourceOf: #gsuTotal in: self fixture) notNil.
	self assert: (self sourceOf: #gsuSum in: self fixture) isNil
]

{ #category : 'tests - drift' }
GsRefactoringUndoTest >> testACleanUndoPreviewReportsNoDrift [
	| json |
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	json := self undoPreviewJson.
	self assert: json includesSubstring: '"drifted":0'.
	self assert: json includesSubstring: '"warning":null'
]

{ #category : 'tests - drift' }
GsRefactoringUndoTest >> testRemovingAMethodTheUndoWouldDeleteIsNotAnError [
	"Undo is idempotent where it can be: a method already gone is in the state the undo
	 wants it in, so the removal succeeds rather than failing."
	| json |
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	self fixture removeSelector: #gsuSum.
	json := self undoAll.
	self assert: json includesSubstring: '"failed":[]'.
	self assert: (self sourceOf: #gsuTotal in: self fixture) notNil
]

{ #category : 'tests - preview' }
GsRefactoringUndoTest >> testPreviewWithNothingRecordedAnswersAnErrorEnvelope [
	| json |
	json := self undoPreviewJson.
	self assert: json includesSubstring: '"error"'.
	self assert: json includesSubstring: 'no refactoring to undo'
]

{ #category : 'tests - preview' }
GsRefactoringUndoTest >> testApplyingAnExpiredUndoTokenAnswersAnErrorEnvelope [
	self
		assert: (GsRefactoringUndo applyForToken: 'undo-nope' deselected: #())
		equals: '{"applied":0,"failed":[],"error":"preview session expired"}'
]

{ #category : 'tests - preview' }
GsRefactoringUndoTest >> testThePreviewPaginatesLikeAForwardPreview [
	| first |
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	GsRefactoringUndo startPreviewToken: 'undo-page-token' maxBytes: 1.
	first := GsRefactoringUndo pageForToken: 'undo-page-token' from: 1 maxBytes: 1.
	"maxBytes 1 still emits the one change that crosses the threshold, and reports more."
	self assert: first includesSubstring: '"done":false'.
	self assert: first includesSubstring: '"nextOffset":2'.
	GsRefactoringUndo clearToken: 'undo-page-token'
]

{ #category : 'tests - preview' }
GsRefactoringUndoTest >> testClosingThePreviewDoesNotThrowTheUndoAway [
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	self undoPreviewJson.
	self assert: GsRefactoringUndo currentEntry notNil
]

{ #category : 'tests - extract method' }
GsRefactoringUndoTest >> testUndoExtractMethodRestoresTheWholeClass [
	| before start |
	before := self snapshotOf: self fixture.
	start := self offsetIn: self fixture selector: #gsuTotal at: '40 + 2'.
	self applyRecording: (GsExtractMethodRefactoring
		class: self fixture
		selector: #gsuTotal
		meta: false
		selStart: start
		selStop: start + '40 + 2' size - 1
		newSelector: 'gsuAnswer').
	self assert: (self sourceOf: #gsuAnswer in: self fixture) notNil.
	self undoAll.
	self assertSnapshot: before restoredFor: self fixture
]

{ #category : 'tests - inline method' }
GsRefactoringUndoTest >> testUndoInlineMethodBringsTheRemovedMethodBackWithItsCategory [
	| before |
	before := self snapshotOf: self fixture.
	self applyRecording: (GsInlineMethodRefactoring
		class: self fixture
		selector: #gsuReport
		meta: false
		atOffset: (self offsetIn: self fixture selector: #gsuReport at: 'gsuTotal printString')).
	"The last sender was inlined, so the target method was deleted."
	self assert: (self sourceOf: #gsuTotal in: self fixture) isNil.
	self undoAll.
	self assertSnapshot: before restoredFor: self fixture.
	"Explicitly: the category came back too, not 'as yet unclassified'."
	self assert: (self categoryOf: #gsuTotal in: self fixture) equals: 'computing'
]

{ #category : 'tests - move method' }
GsRefactoringUndoTest >> testUndoMoveMethodRestoresBothClasses [
	| beforeSource beforeTarget |
	beforeSource := self snapshotOf: self fixture.
	beforeTarget := self snapshotOf: self otherFixture.
	self applyRecording: (GsMoveMethodRefactoring
		sourceClass: self fixture
		selectors: #('gsuPure')
		meta: false
		toClassNamed: 'GsUndoLedger'
		toMeta: false).
	self assert: (self sourceOf: #gsuPure in: self otherFixture) notNil.
	self assert: (self sourceOf: #gsuPure in: self fixture) isNil.
	self undoAll.
	self assertSnapshot: beforeSource restoredFor: self fixture.
	self assertSnapshot: beforeTarget restoredFor: self otherFixture
]

{ #category : 'tests - push method' }
GsRefactoringUndoTest >> testUndoPushDownMethodRestoresBothClasses [
	| beforeParent beforeChild |
	beforeParent := self snapshotOf: self fixture.
	beforeChild := self snapshotOf: self subFixture.
	self applyRecording: (GsPushDownMethodRefactoring
		sourceClass: self fixture
		selectors: #('gsuPure')
		meta: false).
	self assert: (self sourceOf: #gsuPure in: self subFixture) notNil.
	self undoAll.
	self assertSnapshot: beforeParent restoredFor: self fixture.
	self assertSnapshot: beforeChild restoredFor: self subFixture
]

{ #category : 'tests - push method' }
GsRefactoringUndoTest >> testUndoPushUpMethodRestoresBothClasses [
	| beforeParent beforeChild |
	self compile: 'gsuSavingsPure ^ 3' in: self subFixture category: 'computing'.
	beforeParent := self snapshotOf: self fixture.
	beforeChild := self snapshotOf: self subFixture.
	self applyRecording: (GsPushUpMethodRefactoring
		sourceClass: self subFixture
		selectors: #('gsuSavingsPure')
		meta: false).
	self assert: (self sourceOf: #gsuSavingsPure in: self fixture) notNil.
	self undoAll.
	self assertSnapshot: beforeParent restoredFor: self fixture.
	self assertSnapshot: beforeChild restoredFor: self subFixture
]

{ #category : 'tests - change signature' }
GsRefactoringUndoTest >> testUndoChangeSignatureRestoresTheWholeClass [
	| before |
	self compile: 'gsuScaleBy: aNumber ^ 42 * aNumber' in: self fixture category: 'computing'.
	self compile: 'gsuUseScale ^ self gsuScaleBy: 2' in: self fixture category: 'computing'.
	before := self snapshotOf: self fixture.
	self applyRecording: (GsChangeSignatureRefactoring
		class: self fixture
		meta: false
		changeSelector: #'gsuScaleBy:'
		toParts: #('gsuTimes:')
		permutation: #(1)
		argNames: #('aNumber')
		defaults: (Array with: nil)
		scope: #class).
	self assert: (self sourceOf: #'gsuTimes:' in: self fixture) notNil.
	self undoAll.
	self assertSnapshot: before restoredFor: self fixture
]

{ #category : 'tests - temporaries' }
GsRefactoringUndoTest >> testUndoRenameTemporaryRestoresTheMethod [
	| before |
	self compile: 'gsuWithTemp | t | t := 3. ^ t + 1' in: self fixture category: 'computing'.
	before := self snapshotOf: self fixture.
	self applyRecording: (GsRenameTemporaryRefactoring
		class: self fixture
		selector: #gsuWithTemp
		meta: false
		renameTemp: 't'
		to: 'count'
		atOffset: (self offsetIn: self fixture selector: #gsuWithTemp at: 't := 3')).
	self assert: (self sourceOf: #gsuWithTemp in: self fixture) includesSubstring: 'count'.
	self undoAll.
	self assertSnapshot: before restoredFor: self fixture
]

{ #category : 'tests - temporaries' }
GsRefactoringUndoTest >> testUndoExtractTemporaryRestoresTheMethod [
	| before start |
	before := self snapshotOf: self fixture.
	start := self offsetIn: self fixture selector: #gsuPure at: '7 * 6'.
	self applyRecording: (GsExtractTemporaryRefactoring
		class: self fixture
		selector: #gsuPure
		meta: false
		selStart: start
		selStop: start + '7 * 6' size - 1
		newName: 'product').
	self assert: (self sourceOf: #gsuPure in: self fixture) includesSubstring: 'product'.
	self undoAll.
	self assertSnapshot: before restoredFor: self fixture
]

{ #category : 'tests - temporaries' }
GsRefactoringUndoTest >> testUndoInlineTemporaryRestoresTheMethod [
	| before |
	self compile: 'gsuInlineMe | tOnce | tOnce := 5. ^ tOnce + 1' in: self fixture category: 'computing'.
	before := self snapshotOf: self fixture.
	self applyRecording: (GsInlineTemporaryRefactoring
		class: self fixture
		selector: #gsuInlineMe
		meta: false
		atOffset: (self offsetIn: self fixture selector: #gsuInlineMe at: 'tOnce := 5')).
	self deny: (self sourceOf: #gsuInlineMe in: self fixture) includesSubstring: 'tOnce := 5'.
	self undoAll.
	self assertSnapshot: before restoredFor: self fixture
]

{ #category : 'tests - class side' }
GsRefactoringUndoTest >> testUndoRestoresAClassSideRenameAndLeavesTheInstanceSideAlone [
	| before |
	before := self snapshotOf: self fixture.
	self applyRecording: (self renameInFixture: 'gsuMake' to: 'gsuBuild').
	self assert: (self sourceOf: #gsuBuild in: self fixture class) notNil.
	self assert: (self sourceOf: #gsuMake in: self fixture class) isNil.
	self undoAll.
	self assertSnapshot: before restoredFor: self fixture
]

{ #category : 'tests - non commit' }
GsRefactoringUndoTest >> testRecordingAndUndoingCommitNothing [
	"Neither the record nor the undo may commit -- the user commits explicitly."
	| before |
	before := System needsCommit.
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	self undoAll.
	self assert: System needsCommit equals: before
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> recordClassRenameFrom: fromName to: toName [
	"Record the reversal of a class rename that has already landed: the class is bound under
	 fromName now, and toName is where it goes back to."
	^GsRefactoringUndo
		recordReverseRename: #classRename
		className: fromName
		from: fromName
		to: toName
		scopeKind: #wholeSystem
		scopeDictName: nil
		classDictName: 'UserGlobals' label: 'Rename class ', toName, ' to ', fromName
		engine: 'GsRenameClassRefactoring'
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testRecordingARenameAnswersARenameBackEntry [
	self assert: (self recordClassRenameFrom: 'GsUndoLedger' to: 'GsUndoOldLedger') equals: 'ok'.
	self assert: GsRefactoringUndo currentEntry mechanism equals: #mirror.
	self assert: GsRefactoringUndo statusJson includesSubstring: '"mechanism":"mirror"'
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testAMethodEntryReportsTheChangeSetMechanism [
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	self assert: GsRefactoringUndo currentEntry mechanism equals: #changeSet.
	self assert: GsRefactoringUndo statusJson includesSubstring: '"mechanism":"changeSet"'
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testAnUnreversibleKindRecordsNothing [
	"Recording something this cannot reverse must record NOTHING rather than something wrong."
	self
		assert: (GsRefactoringUndo
			recordReverseRename: #splitClass className: 'GsUndoAccount' from: 'a' to: 'b'
			scopeKind: nil scopeDictName: nil classDictName: 'UserGlobals' label: 'x' engine: 'GsSplitClassRefactoring')
		equals: 'unsupported'.
	self assert: GsRefactoringUndo currentEntry isNil
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testTheReverseIsBuiltFromTheRENAMEEngineItself [
	"The reversal is the same engine run the other way -- not a hand-rolled inverse."
	self recordClassRenameFrom: 'GsUndoLedger' to: 'GsUndoOldLedger'.
	self
		assert: GsRefactoringUndo currentEntry reverseRefactoring class name asString
		equals: 'GsRenameClassRefactoring'
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testTheReverseRefactoringIsBuiltOnceAndCached [
	"The preview and the apply must run against the SAME object, or the change ids the user
	 deselected in the preview would not match the set the apply walks."
	| first |
	self recordClassRenameFrom: 'GsUndoLedger' to: 'GsUndoOldLedger'.
	first := GsRefactoringUndo currentEntry reverseRefactoring.
	self assert: GsRefactoringUndo currentEntry reverseRefactoring == first
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testTheReversePreviewIsTheReverseRenamesOwnChangeSet [
	| json |
	self recordClassRenameFrom: 'GsUndoLedger' to: 'GsUndoOldLedger'.
	json := self undoPreviewJson.
	self assert: json includesSubstring: '"mechanism":"mirror"'.
	"A class rename stages a classRename row (plus reparents/recompiles) -- class-shape kinds
	 the client's undo preview therefore has to render."
	self assert: json includesSubstring: '"kind":"classRename"'.
	self assert: json includesSubstring: '"newName":"GsUndoOldLedger"'
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testAReverseRenamePreviewReportsNoPerChangeDrift [
	"Its change set is derived from the stone as it is right now, by the engine that would
	 apply it, so every row is current by construction."
	| json |
	self recordClassRenameFrom: 'GsUndoLedger' to: 'GsUndoOldLedger'.
	json := self undoPreviewJson.
	self assert: json includesSubstring: '"drifted":0'.
	self assert: GsRefactoringUndo currentEntry driftedCount equals: 0
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testReversingAClassRenamePutsTheNameBack [
	| applied |
	"Rename GsUndoLedger -> GsUndoOldLedger for real, then record and reverse it."
	applied := (GsRenameClassRefactoring
		class: self otherFixture renameTo: 'GsUndoOldLedger' scope: #wholeSystem)
		applyDeselected: #().
	self assert: applied includesSubstring: '"failed":[]'.
	self assert: (UserGlobals at: #GsUndoOldLedger ifAbsent: [nil]) notNil.
	self assert: (UserGlobals at: #GsUndoLedger ifAbsent: [nil]) isNil.

	self recordClassRenameFrom: 'GsUndoOldLedger' to: 'GsUndoLedger'.
	self undoAll.

	self assert: (UserGlobals at: #GsUndoLedger ifAbsent: [nil]) notNil.
	self assert: (UserGlobals at: #GsUndoOldLedger ifAbsent: [nil]) isNil.
	"And the class still works -- its methods came forward through both renames."
	self assert: (self sourceOf: #gsuLedgerOwn in: (UserGlobals at: #GsUndoLedger)) notNil
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testWorkWrittenAfterTheRenameSurvivesTheReversal [
	"The compensation for not being a rollback: a rename carries methods FORWARD, so a method
	 added after the rename survives -- where a classHistory revert would have discarded it."
	(GsRenameClassRefactoring class: self otherFixture renameTo: 'GsUndoOldLedger' scope: #wholeSystem)
		applyDeselected: #().
	self
		compile: 'gsuAddedAfterTheRename ^ 99'
		in: (UserGlobals at: #GsUndoOldLedger)
		category: 'after'.

	self recordClassRenameFrom: 'GsUndoOldLedger' to: 'GsUndoLedger'.
	self undoAll.

	self
		assert: (self sourceOf: #gsuAddedAfterTheRename in: (UserGlobals at: #GsUndoLedger))
		notNil.
	self
		assert: (self categoryOf: #gsuAddedAfterTheRename in: (UserGlobals at: #GsUndoLedger))
		equals: 'after'
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testACleanReversalConsumesTheEntry [
	(GsRenameClassRefactoring class: self otherFixture renameTo: 'GsUndoOldLedger' scope: #wholeSystem)
		applyDeselected: #().
	self recordClassRenameFrom: 'GsUndoOldLedger' to: 'GsUndoLedger'.
	self assert: GsRefactoringUndo currentEntry notNil.
	self undoAll.
	self assert: GsRefactoringUndo currentEntry isNil
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testAReversalRefusesWithAReasonWhenTheClassIsGone [
	| json |
	self recordClassRenameFrom: 'GsUndoNoSuchClass' to: 'GsUndoWhatever'.
	self assert: GsRefactoringUndo currentEntry reverseUnavailableReason notNil.
	json := self undoPreviewJson.
	self assert: json includesSubstring: '"error"'.
	self assert: json includesSubstring: 'no longer exists'
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testAReversalRefusesWhenTheOldNameHasBeenTakenBySomethingElse [
	"The reachable collision: rename A -> B, then create a NEW class named A. Reversing would
	 have to put B back as A, and A is taken. It must refuse -- and above all must not clobber
	 the new A."
	| newcomer |
	(GsRenameClassRefactoring class: self otherFixture renameTo: 'GsUndoOldLedger' scope: #wholeSystem)
		applyDeselected: #().
	newcomer := Object
		subclass: 'GsUndoLedger'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'gsuIAmTheNewOne ^ true' in: newcomer category: 'fixture'.

	self recordClassRenameFrom: 'GsUndoOldLedger' to: 'GsUndoLedger'.
	self assert: GsRefactoringUndo currentEntry reverseUnavailableReason notNil.

	"The newcomer is untouched, and the renamed class is still under its new name."
	self assert: (self sourceOf: #gsuIAmTheNewOne in: (UserGlobals at: #GsUndoLedger)) notNil.
	self assert: (UserGlobals at: #GsUndoOldLedger ifAbsent: [nil]) notNil
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testAnInstVarReversalRefusesWhenTheOldNameIsDeclaredAgain [
	"Rename balance -> gsuFunds, then add a NEW instance variable called balance. Reversing
	 would declare it twice, which the class-creation primitive rejects mid-apply -- and the
	 ivar rename engine has no collision check of its own, so the reversal must make it."
	(GsRenameInstanceVariableRefactoring
		class: self fixture renameInstVar: 'balance' to: 'gsuFunds') applyDeselected: #().
	"Re-declare the class with `balance` back alongside `gsuFunds` -- a new class version, which
	 is what adding an instance variable by hand amounts to."
	Object
		subclass: 'GsUndoAccount'
		instVarNames: #('gsuFunds' 'owner' 'balance')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.

	GsRefactoringUndo
		recordReverseRename: #instVarRename className: 'GsUndoAccount'
		from: 'gsuFunds' to: 'balance' scopeKind: nil scopeDictName: nil
		classDictName: 'UserGlobals' label: 'Rename instance variable balance to gsuFunds'
		engine: 'GsRenameInstanceVariableRefactoring'.

	self assert: GsRefactoringUndo currentEntry reverseUnavailableReason notNil.
	self
		assert: GsRefactoringUndo currentEntry reverseUnavailableReason
		includesSubstring: 'already declares an instance variable'
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testReversingARenamedInstanceVariablePutsTheNameBack [
	| cls |
	(GsRenameInstanceVariableRefactoring
		class: self fixture renameInstVar: 'balance' to: 'gsuFunds') applyDeselected: #().
	cls := UserGlobals at: #GsUndoAccount.
	self assert: ((cls instVarNames collect: [:e | e asString]) includes: 'gsuFunds').

	GsRefactoringUndo
		recordReverseRename: #instVarRename className: 'GsUndoAccount'
		from: 'gsuFunds' to: 'balance' scopeKind: nil scopeDictName: nil
		classDictName: 'UserGlobals' label: 'Rename instance variable balance to gsuFunds'
		engine: 'GsRenameInstanceVariableRefactoring'.
	self undoAll.

	cls := UserGlobals at: #GsUndoAccount.
	self assert: ((cls instVarNames collect: [:e | e asString]) includes: 'balance').
	self deny: ((cls instVarNames collect: [:e | e asString]) includes: 'gsuFunds').
	"The accessor that reads it recompiled both ways and still works."
	self assert: (self sourceOf: #gsuBalance in: cls) includesSubstring: 'balance'
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testReversingARenamedClassVariablePutsTheNameBack [
	| cls |
	cls := Object
		subclass: 'GsUndoVarHolder'
		instVarNames: #()
		classVars: #('GsuRegistry')
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'gsuReadIt ^ GsuRegistry' in: cls category: 'accessing'.
	[(GsRenameClassVariableRefactoring
		class: cls renameClassVar: 'GsuRegistry' to: 'GsuCatalog') applyDeselected: #().
	self assert: (((UserGlobals at: #GsUndoVarHolder) classVarNames
		collect: [:e | e asString]) includes: 'GsuCatalog').

	GsRefactoringUndo
		recordReverseRename: #classVarRename className: 'GsUndoVarHolder'
		from: 'GsuCatalog' to: 'GsuRegistry' scopeKind: nil scopeDictName: nil
		classDictName: 'UserGlobals' label: 'Rename class variable GsuRegistry to GsuCatalog'
		engine: 'GsRenameClassVariableRefactoring'.
	self undoAll.

	self assert: (((UserGlobals at: #GsUndoVarHolder) classVarNames
		collect: [:e | e asString]) includes: 'GsuRegistry')]
		ensure: [UserGlobals removeKey: #GsUndoVarHolder ifAbsent: []]
]

{ #category : 'tests - reverse rename' }
GsRefactoringUndoTest >> testReversingARenameCommitsNothing [
	| before |
	before := System needsCommit.
	(GsRenameClassRefactoring class: self otherFixture renameTo: 'GsUndoOldLedger' scope: #wholeSystem)
		applyDeselected: #().
	self recordClassRenameFrom: 'GsUndoOldLedger' to: 'GsUndoLedger'.
	self undoAll.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - deselection semantics' }
GsRefactoringUndoTest >> testDeselectionMeansThreeDifferentThings [
	"A client that renders all these rows the same way misleads: for one kind un-ticking simply
	 skips the change, for another it DELETES the method, and for the rest it does nothing at all."
	self assert: (GsRefactoringUndo deselectionFor: #classRename) equals: #perChange.
	self assert: (GsRefactoringUndo deselectionFor: #instVarRename) equals: #dropsMethod.
	self assert: (GsRefactoringUndo deselectionFor: #classVarRename) equals: #ignored.
	self assert: (GsRefactoringUndo deselectionFor: #instVarAdd) equals: #ignored.
	self assert: (GsRefactoringUndo deselectionFor: #instVarRemove) equals: #ignored
]

{ #category : 'tests - deselection semantics' }
GsRefactoringUndoTest >> testAChangeSetEntryIsAlwaysPerChange [
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	self assert: GsRefactoringUndo currentEntry deselection equals: #perChange
]

{ #category : 'tests - deselection semantics' }
GsRefactoringUndoTest >> testThePreviewReportsTheDeselectionSemantics [
	"An instance-variable reshape is all-or-nothing, so the client must render its rows disabled
	 rather than invite a click that silently does nothing."
	| json |
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuExtra')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self recordInstVarAddOf: 'gsuExtra'.
	json := self undoPreviewJson.
	self assert: json includesSubstring: '"deselection":"ignored"'
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> recordInstVarAddOf: aName [
	"Record the reversal of an instance-variable ADD that has already landed."
	^GsRefactoringUndo
		recordReverseRename: #instVarAdd
		className: 'GsUndoAccount'
		from: aName
		to: aName
		scopeKind: nil
		scopeDictName: nil
		classDictName: 'UserGlobals' label: 'Add instance variable ', aName, ' to GsUndoAccount'
		engine: 'GsInstVarRefactoring'
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> recordInstVarRemoveOf: aName [
	^GsRefactoringUndo
		recordReverseRename: #instVarRemove
		className: 'GsUndoAccount'
		from: aName
		to: aName
		scopeKind: nil
		scopeDictName: nil
		classDictName: 'UserGlobals' label: 'Remove instance variable ', aName, ' from GsUndoAccount'
		engine: 'GsInstVarRefactoring'
]

{ #category : 'fixture' }
GsRefactoringUndoTest >> ownInstVarsOf: aClassName [
	^((UserGlobals at: aClassName asSymbol) instVarNames collect: [:e | e asString]) asArray
]

{ #category : 'tests - instvar add/remove' }
GsRefactoringUndoTest >> testReversingAnInstVarAddTakesTheVariableBackOut [
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuExtra')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self assert: ((self ownInstVarsOf: #GsUndoAccount) includes: 'gsuExtra').

	self recordInstVarAddOf: 'gsuExtra'.
	self assert: GsRefactoringUndo currentEntry reverseKind equals: #instVarAdd.
	self undoAll.

	self deny: ((self ownInstVarsOf: #GsUndoAccount) includes: 'gsuExtra').
	"The variables that were always there, and the methods, survived both reshapes."
	self assert: ((self ownInstVarsOf: #GsUndoAccount) includes: 'balance').
	self assert: (self sourceOf: #gsuUntouched in: (UserGlobals at: #GsUndoAccount)) notNil.
	self assert: (self sourceOf: #gsuAlsoUntouched in: (UserGlobals at: #GsUndoAccount) class) notNil
]

{ #category : 'tests - instvar add/remove' }
GsRefactoringUndoTest >> testReversingAnInstVarRemovePutsTheVariableBack [
	(GsInstVarRefactoring class: self fixture removeInstVar: 'owner')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self deny: ((self ownInstVarsOf: #GsUndoAccount) includes: 'owner').

	self recordInstVarRemoveOf: 'owner'.
	self assert: GsRefactoringUndo currentEntry reverseKind equals: #instVarRemove.
	self undoAll.

	self assert: ((self ownInstVarsOf: #GsUndoAccount) includes: 'owner').
	self assert: (self sourceOf: #gsuUntouched in: (UserGlobals at: #GsUndoAccount)) notNil
]

{ #category : 'tests - instvar add/remove' }
GsRefactoringUndoTest >> testReversingAnAddCountsTheMethodsItWouldDrop [
	"Reversing an ADD removes the variable, so a method written since that USES it cannot be
	 recompiled and is dropped. The count is surfaced so the client can say the number."
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuExtra')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self compile: 'gsuUsesExtra ^ gsuExtra' in: (UserGlobals at: #GsUndoAccount) category: 'after'.

	self recordInstVarAddOf: 'gsuExtra'.
	self assert: GsRefactoringUndo currentEntry mirrorDropCount > 0.
	self assert: self undoPreviewJson includesSubstring: '"dropCount":'
]

{ #category : 'tests - instvar add/remove' }
GsRefactoringUndoTest >> testAKindWithNothingToDropCountsZero [
	self recordInstVarRemoveOf: 'owner'.
	self assert: GsRefactoringUndo currentEntry mirrorDropCount equals: 0.
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	self assert: GsRefactoringUndo currentEntry mirrorDropCount equals: 0
]

{ #category : 'tests - instvar add/remove' }
GsRefactoringUndoTest >> testReversingAnAddRefusesWhenTheVariableIsAlreadyGone [
	"Nothing to take back out -- offering it would be misleading."
	self recordInstVarAddOf: 'gsuNeverExisted'.
	self assert: GsRefactoringUndo currentEntry reverseUnavailableReason notNil.
	self
		assert: GsRefactoringUndo currentEntry reverseUnavailableReason
		includesSubstring: 'nothing to take back out'
]

{ #category : 'tests - instvar add/remove' }
GsRefactoringUndoTest >> testReversingARemoveRefusesWhenTheNameIsDeclaredAgain [
	"Adding it back would declare it twice, which the class-creation primitive rejects mid-apply."
	self recordInstVarRemoveOf: 'balance'.
	self assert: GsRefactoringUndo currentEntry reverseUnavailableReason notNil.
	self
		assert: GsRefactoringUndo currentEntry reverseUnavailableReason
		includesSubstring: 'already declares'
]

{ #category : 'tests - instvar add/remove' }
GsRefactoringUndoTest >> testAnInstVarReversalNeverCommitsAndNeverDeletesHistory [
	"migrate and deleteHistory are the two irreversible options in the family: one moves user
	 data, the other destroys what a later reversal needs. A reversal hardcodes both false, so it
	 must leave the transaction dirty -- if it had committed, needsCommit would be false."
	| before |
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuExtra')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	before := System needsCommit.
	self recordInstVarAddOf: 'gsuExtra'.
	self undoAll.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testCaptureAndCommitMakeAHistoryRevertEntry [
	self assert: (GsRefactoringUndo captureClassHistoryOf: 'GsUndoAccount' inDictionary: 'UserGlobals') equals: 'ok'.
	self
		assert: (GsRefactoringUndo commitHistoryRevert: 'Push up balance' engine: 'GsInstVarStructureRefactoring' created: #())
		equals: 'ok'.
	self assert: GsRefactoringUndo currentEntry mechanism equals: #historyRevert
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testCaptureRecordsTheSubtreeTopDown [
	"Parent before child: GsClassHistory re-versions each subclass onto its parent's restored
	 version, so replaying a child first would re-parent it onto a version about to be superseded."
	| names |
	GsRefactoringUndo captureClassHistoryOf: 'GsUndoAccount' inDictionary: 'UserGlobals'.
	GsRefactoringUndo commitHistoryRevert: 'x' engine: 'y' created: #().
	names := GsRefactoringUndo currentEntry revertPlan collect: [:e | e at: 1].
	self assert: (names indexOf: 'GsUndoAccount') < (names indexOf: 'GsUndoSavings')
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testCommittingWithNoCaptureRecordsNothing [
	"A caller that forgot to capture must fail loudly rather than record an empty undo."
	self
		assert: (GsRefactoringUndo commitHistoryRevert: 'x' engine: 'y' created: #())
		equals: 'nothing captured'.
	self assert: GsRefactoringUndo currentEntry isNil
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testADiscardedCaptureLeavesNoEntry [
	GsRefactoringUndo captureClassHistoryOf: 'GsUndoAccount' inDictionary: 'UserGlobals'.
	GsRefactoringUndo discardPendingCapture.
	self
		assert: (GsRefactoringUndo commitHistoryRevert: 'x' engine: 'y' created: #())
		equals: 'nothing captured'
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testCapturingAnUnknownClassRecordsNothing [
	self
		assert: (GsRefactoringUndo captureClassHistoryOf: 'GsUndoNoSuchThing')
		equals: 'not a class'
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testAHistoryRevertIsAllOrNothing [
	GsRefactoringUndo captureClassHistoryOf: 'GsUndoAccount' inDictionary: 'UserGlobals'.
	GsRefactoringUndo commitHistoryRevert: 'x' engine: 'y' created: #().
	self assert: GsRefactoringUndo currentEntry deselection equals: #ignored.
	self assert: self undoPreviewJson includesSubstring: '"deselection":"ignored"'
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testHistoryRevertRestoresAReshapedClass [
	"The real thing: reshape a class, then put it back to its pre-refactoring state."
	| before |
	before := (self ownInstVarsOf: #GsUndoAccount) asSortedCollection asArray.
	GsRefactoringUndo captureClassHistoryOf: 'GsUndoAccount' inDictionary: 'UserGlobals'.
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuReshaped')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	GsRefactoringUndo
		commitHistoryRevert: 'Add gsuReshaped to GsUndoAccount'
		engine: 'GsInstVarRefactoring'
		created: #().
	self assert: ((self ownInstVarsOf: #GsUndoAccount) includes: 'gsuReshaped').

	self undoAll.

	self assert: (self ownInstVarsOf: #GsUndoAccount) asSortedCollection asArray equals: before.
	"And the methods came back with the shape -- that is the point of reverting rather than
	 re-declaring by hand."
	self assert: (self sourceOf: #gsuUntouched in: (UserGlobals at: #GsUndoAccount)) notNil.
	self assert: (self sourceOf: #gsuAlsoUntouched in: (UserGlobals at: #GsUndoAccount) class) notNil
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testHistoryRevertNamesTheMethodsItWillDiscard [
	"Eric 2026-08-19: the reversal returns the class to its PRE-REFACTORING state, and the user
	 must be told that -- so anything written since is named, not discovered afterwards."
	| json |
	GsRefactoringUndo captureClassHistoryOf: 'GsUndoAccount' inDictionary: 'UserGlobals'.
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuReshaped')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	GsRefactoringUndo commitHistoryRevert: 'x' engine: 'y' created: #().
	self compile: 'gsuWrittenAfter ^ 7' in: (UserGlobals at: #GsUndoAccount) category: 'after'.

	self assert: GsRefactoringUndo currentEntry totalDiscardedCount > 0.
	json := self undoPreviewJson.
	self assert: json includesSubstring: 'pre-refactoring state DISCARDS'.
	self assert: json includesSubstring: 'gsuWrittenAfter'
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testNothingWrittenSinceMeansNothingDiscarded [
	GsRefactoringUndo captureClassHistoryOf: 'GsUndoAccount' inDictionary: 'UserGlobals'.
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuReshaped')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	GsRefactoringUndo commitHistoryRevert: 'x' engine: 'y' created: #().
	self assert: GsRefactoringUndo currentEntry totalDiscardedCount equals: 0
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testThePreviewShowsADefinitionDiffPerRevertedClass [
	| json |
	GsRefactoringUndo captureClassHistoryOf: 'GsUndoAccount' inDictionary: 'UserGlobals'.
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuReshaped')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	GsRefactoringUndo commitHistoryRevert: 'x' engine: 'y' created: #().
	json := self undoPreviewJson.
	self assert: json includesSubstring: '"kind":"classDefinitionEdit"'.
	self assert: json includesSubstring: '"mechanism":"historyRevert"'
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testAClassTheRefactoringCREATEDIsUnbound [
	"An inserted superclass or an extracted component has no earlier version to revert to, so the
	 reversal takes the name back out."
	| created |
	created := Object
		subclass: 'GsUndoCreated'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	GsRefactoringUndo captureClassHistoryOf: 'GsUndoAccount' inDictionary: 'UserGlobals'.
	GsRefactoringUndo
		commitHistoryRevert: 'Extract superclass GsUndoCreated'
		engine: 'GsExtractSuperclassRefactoring'
		created: (Array with: 'GsUndoCreated').
	self assert: self undoPreviewJson includesSubstring: '"kind":"classRemove"'.

	self undoAll.
	self assert: (UserGlobals at: #GsUndoCreated ifAbsent: [nil]) isNil
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testAHistoryRevertRefusesWhenEveryClassIsGone [
	GsRefactoringUndo captureClassHistoryOf: 'GsUndoLedger'.
	GsRefactoringUndo commitHistoryRevert: 'x' engine: 'y' created: #().
	UserGlobals removeKey: #GsUndoLedger ifAbsent: [].
	self assert: GsRefactoringUndo currentEntry reverseUnavailableReason notNil.
	self assert: self undoPreviewJson includesSubstring: 'cannot be reversed'
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testACleanHistoryRevertConsumesTheEntry [
	GsRefactoringUndo captureClassHistoryOf: 'GsUndoAccount' inDictionary: 'UserGlobals'.
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuReshaped')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	GsRefactoringUndo commitHistoryRevert: 'x' engine: 'y' created: #().
	self undoAll.
	self assert: GsRefactoringUndo currentEntry isNil
]

{ #category : 'tests - history revert' }
GsRefactoringUndoTest >> testAHistoryRevertCommitsNothing [
	| before |
	before := System needsCommit.
	GsRefactoringUndo captureClassHistoryOf: 'GsUndoAccount' inDictionary: 'UserGlobals'.
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuReshaped')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	GsRefactoringUndo commitHistoryRevert: 'x' engine: 'y' created: #().
	self undoAll.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> shadowDecoyFor: aClassName [
	"A decoy class of the given name in a dictionary inserted at the FRONT of the symbol list, so
	 an unscoped name lookup finds it before the fixture's own class in UserGlobals. Callers must
	 remove the dictionary with `System myUserProfile removeDictionaryAt: 1` in an ensure:."
	| decoy |
	decoy := SymbolDictionary new name: #GsUndoShadowDict; yourself.
	System myUserProfile insertDictionary: decoy at: 1.
	^Object
		subclass: aClassName
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: decoy
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoRenameMethodRestoresTheActedOnClassNotAGlobalFirstMatch [
	"Undo records the inverse of a refactoring as changes keyed by class NAME, and replays them
	 through `env classNamed:` -- first-match across the symbol list, exactly like the forward
	 apply. So the safety net has the same hole as the thing it is meant to catch: a decoy
	 introduced between apply and undo used to send the undo at that class instead, leaving the real
	 class renamed with no way back (#396)."
	| decoy before undoJson |
	before := self snapshotOf: self fixture.
	self applyRecording: (self renameInFixture: 'gsuTotal' to: 'gsuSum').
	self assert: (self sourceOf: #gsuSum in: self fixture) notNil.

	decoy := self shadowDecoyFor: 'GsUndoAccount'.
	[undoJson := self undoAll.

	 self assert: undoJson includesSubstring: '"failed":[]'.
	 self assertSnapshot: before restoredFor: self fixture.
	 self assert: (self sourceOf: #gsuTotal in: decoy) isNil]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoExtractMethodRestoresTheActedOnClassNotAGlobalFirstMatch [
	| decoy before start undoJson |
	before := self snapshotOf: self fixture.
	start := self offsetIn: self fixture selector: #gsuTotal at: '40 + 2'.
	self applyRecording: (GsExtractMethodRefactoring
		class: self fixture
		selector: #gsuTotal
		meta: false
		selStart: start
		selStop: start + '40 + 2' size - 1
		newSelector: 'gsuAnswer').
	self assert: (self sourceOf: #gsuAnswer in: self fixture) notNil.

	decoy := self shadowDecoyFor: 'GsUndoAccount'.
	[undoJson := self undoAll.

	 self assert: undoJson includesSubstring: '"failed":[]'.
	 self assertSnapshot: before restoredFor: self fixture.
	 self assert: (self sourceOf: #gsuAnswer in: decoy) isNil]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoInlineMethodRestoresTheActedOnClassNotAGlobalFirstMatch [
	| decoy before undoJson |
	before := self snapshotOf: self fixture.
	self applyRecording: (GsInlineMethodRefactoring
		class: self fixture
		selector: #gsuReport
		meta: false
		atOffset: (self offsetIn: self fixture selector: #gsuReport at: 'gsuTotal printString')).
	self assert: (self sourceOf: #gsuTotal in: self fixture) isNil.

	decoy := self shadowDecoyFor: 'GsUndoAccount'.
	[undoJson := self undoAll.

	 self assert: undoJson includesSubstring: '"failed":[]'.
	 self assertSnapshot: before restoredFor: self fixture.
	 self assert: (self sourceOf: #gsuTotal in: decoy) isNil]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoMoveMethodRestoresBothActedOnClassesNotAGlobalFirstMatch [
	"Both ends of a move are keyed by name, so a decoy on either side breaks the undo. This one
	 shadows the SOURCE; the target half is restored from the same change set through the same
	 `classNamed:`."
	| decoy beforeSource beforeTarget undoJson |
	beforeSource := self snapshotOf: self fixture.
	beforeTarget := self snapshotOf: self otherFixture.
	self applyRecording: (GsMoveMethodRefactoring
		sourceClass: self fixture
		selectors: #('gsuPure')
		meta: false
		toClassNamed: 'GsUndoLedger'
		toMeta: false).
	self assert: (self sourceOf: #gsuPure in: self otherFixture) notNil.

	decoy := self shadowDecoyFor: 'GsUndoAccount'.
	[undoJson := self undoAll.

	 self assert: undoJson includesSubstring: '"failed":[]'.
	 self assertSnapshot: beforeSource restoredFor: self fixture.
	 self assertSnapshot: beforeTarget restoredFor: self otherFixture.
	 self assert: (self sourceOf: #gsuPure in: decoy) isNil]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoPushDownMethodRestoresBothActedOnClassesNotAGlobalFirstMatch [
	| decoy beforeParent beforeChild undoJson |
	beforeParent := self snapshotOf: self fixture.
	beforeChild := self snapshotOf: self subFixture.
	self applyRecording: (GsPushDownMethodRefactoring
		sourceClass: self fixture
		selectors: #('gsuPure')
		meta: false).
	self assert: (self sourceOf: #gsuPure in: self subFixture) notNil.

	decoy := self shadowDecoyFor: 'GsUndoSavings'.
	[undoJson := self undoAll.

	 self assert: undoJson includesSubstring: '"failed":[]'.
	 self assertSnapshot: beforeParent restoredFor: self fixture.
	 self assertSnapshot: beforeChild restoredFor: self subFixture.
	 self assert: (self sourceOf: #gsuPure in: decoy) isNil]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoChangeSignatureRestoresTheActedOnClassNotAGlobalFirstMatch [
	| decoy before undoJson |
	self compile: 'gsuScaleBy: aNumber ^ 42 * aNumber' in: self fixture category: 'computing'.
	self compile: 'gsuUseScale ^ self gsuScaleBy: 2' in: self fixture category: 'computing'.
	before := self snapshotOf: self fixture.
	self applyRecording: (GsChangeSignatureRefactoring
		class: self fixture
		meta: false
		changeSelector: #'gsuScaleBy:'
		toParts: #('gsuTimes:')
		permutation: #(1)
		argNames: #('aNumber')
		defaults: (Array with: nil)
		scope: #class).
	self assert: (self sourceOf: #'gsuTimes:' in: self fixture) notNil.

	decoy := self shadowDecoyFor: 'GsUndoAccount'.
	[undoJson := self undoAll.

	 self assert: undoJson includesSubstring: '"failed":[]'.
	 self assertSnapshot: before restoredFor: self fixture.
	 self assert: (self sourceOf: #'gsuTimes:' in: decoy) isNil]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoRenameTemporaryRestoresTheActedOnClassNotAGlobalFirstMatch [
	| decoy before undoJson |
	self compile: 'gsuWithTemp | t | t := 3. ^ t + 1' in: self fixture category: 'computing'.
	before := self snapshotOf: self fixture.
	self applyRecording: (GsRenameTemporaryRefactoring
		class: self fixture
		selector: #gsuWithTemp
		meta: false
		renameTemp: 't'
		to: 'count'
		atOffset: (self offsetIn: self fixture selector: #gsuWithTemp at: 't := 3')).
	self assert: (self sourceOf: #gsuWithTemp in: self fixture) includesSubstring: 'count'.

	decoy := self shadowDecoyFor: 'GsUndoAccount'.
	[undoJson := self undoAll.

	 self assert: undoJson includesSubstring: '"failed":[]'.
	 self assertSnapshot: before restoredFor: self fixture.
	 self assert: (self sourceOf: #gsuWithTemp in: decoy) isNil]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoClassSideRenameRestoresTheActedOnClassNotAGlobalFirstMatch [
	"The meta side is reached as `cls class` after the same `classNamed:` lookup, so a shadowed
	 name used to misdirect a class-side undo exactly as it did an instance-side one. See #396."
	| decoy before undoJson |
	before := self snapshotOf: self fixture.
	self applyRecording: (self renameInFixture: 'gsuMake' to: 'gsuBuild').
	self assert: (self sourceOf: #gsuBuild in: self fixture class) notNil.

	decoy := self shadowDecoyFor: 'GsUndoAccount'.
	[undoJson := self undoAll.

	 self assert: undoJson includesSubstring: '"failed":[]'.
	 self assertSnapshot: before restoredFor: self fixture.
	 self assert: (self sourceOf: #gsuBuild in: decoy class) isNil]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoInstVarAddRemovesItFromTheActedOnClassNotAGlobalFirstMatch [
	"A reshape records no change set -- its undo is a #mirror entry that re-runs the opposite
	 engine operation. That re-run goes back through GsInstVarRefactoring, so it inherits the
	 `dictionaryForNewVersionOf:` defect: with a decoy ahead of UserGlobals the reversal used to reshape the
	 wrong class, leaving the variable on the real one. See #396."
	| decoy |
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuExtra')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self assert: ((self ownInstVarsOf: #GsUndoAccount) includes: 'gsuExtra').
	self recordInstVarAddOf: 'gsuExtra'.

	decoy := self shadowDecoyFor: 'GsUndoAccount'.
	[self undoAll.

	 self deny: ((self ownInstVarsOf: #GsUndoAccount) includes: 'gsuExtra').
	 self assert: ((self ownInstVarsOf: #GsUndoAccount) includes: 'balance').
	 self deny: ((decoy instVarNames collect: [:e | e asString]) includes: 'gsuExtra')]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoInstVarRemovePutsItBackOnTheActedOnClassNotAGlobalFirstMatch [
	"The mirror of the test above: reversing a REMOVE re-runs the add, through the same defect."
	| decoy |
	(GsInstVarRefactoring class: self fixture removeInstVar: 'owner')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self deny: ((self ownInstVarsOf: #GsUndoAccount) includes: 'owner').
	self recordInstVarRemoveOf: 'owner'.

	decoy := self shadowDecoyFor: 'GsUndoAccount'.
	[self undoAll.

	 self assert: ((self ownInstVarsOf: #GsUndoAccount) includes: 'owner').
	 self deny: ((decoy instVarNames collect: [:e | e asString]) includes: 'owner')]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoClassRenameRenamesBackTheActedOnClassNotAGlobalFirstMatch [
	"Reversing a class rename is a #mirror entry that re-runs GsRenameClassRefactoring, which binds
	 the renamed-back class through `dictionaryForNewVersionOf:`. With a decoy binding the CURRENT name ahead of
	 UserGlobals, the rename-back used to file the class in the decoy. See #396."
	| decoy |
	(GsRenameClassRefactoring class: self otherFixture renameTo: 'GsUndoOldLedger' scope: #wholeSystem)
		applyDeselected: #().
	self deny: (UserGlobals at: #GsUndoOldLedger ifAbsent: [nil]) isNil.
	self assert: (self recordClassRenameFrom: 'GsUndoOldLedger' to: 'GsUndoLedger') equals: 'ok'.

	decoy := self shadowDecoyFor: 'GsUndoOldLedger'.
	[self undoAll.

	 "the class is back under its original name, in the dictionary that held it"
	 self deny: (UserGlobals at: #GsUndoLedger ifAbsent: [nil]) isNil.
	 "and the decoy is untouched: it still binds its own class, and gained no GsUndoLedger"
	 self assert: ((System myUserProfile symbolList at: 1) at: #GsUndoOldLedger ifAbsent: [nil])
		== decoy.
	 self assert: ((System myUserProfile symbolList at: 1) at: #GsUndoLedger ifAbsent: [nil]) isNil]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoHistoryRevertRestoresTheActedOnClassNotAGlobalFirstMatch [
	"The third undo mechanism. A class reshape records no change set; it is reversed by putting each
	 reshaped class back to its pre-apply classHistory version. Both halves used to resolve by NAME:
	 `captureClassHistoryOf:` through `env classNamed:`, and the replay through
	 `GsClassHistory revertClassNamed:toIndex:`. Reshape the fixture, then introduce a decoy binding
	 its name ahead of UserGlobals before undoing: the revert used to be aimed at the decoy, leaving
	 the real class with the variable the undo was supposed to take back out (#396)."
	| decoy before |
	before := (self ownInstVarsOf: #GsUndoAccount) asSortedCollection asArray.
	GsRefactoringUndo captureClassHistoryOf: 'GsUndoAccount' inDictionary: 'UserGlobals'.
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuReshaped')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	GsRefactoringUndo
		commitHistoryRevert: 'Add gsuReshaped to GsUndoAccount'
		engine: 'GsInstVarRefactoring'
		created: #().
	self assert: ((self ownInstVarsOf: #GsUndoAccount) includes: 'gsuReshaped').

	decoy := self shadowDecoyFor: 'GsUndoAccount'.
	[self undoAll.

	 "the fixture is back to its pre-reshape shape, with its methods"
	 self assert: (self ownInstVarsOf: #GsUndoAccount) asSortedCollection asArray equals: before.
	 self assert: (self sourceOf: #gsuUntouched in: (UserGlobals at: #GsUndoAccount)) notNil.
	 "and the decoy was not the class reverted"
	 self deny: ((decoy instVarNames collect: [:e | e asString]) includes: 'gsuReshaped')]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoInstVarAddAcceptsTheDictionaryAsASymbolListIndex [
	"The client identifies a dictionary by its 1-based SymbolList INDEX, not by name -- an index is
	 unambiguous where a name is not. Recording coerced it with `asString`, so index 10 was stored
	 as '10', matched no dictionary name, and the scoped lookup fell back to the first-match it
	 exists to replace. The fallback is legitimate for a record made WITHOUT a dictionary, so
	 nothing reported a problem: the reversal simply declined with 'no longer declares an instance
	 variable named ...', naming a class the user had not touched (#396).

	 The sibling tests pass a dictionary NAME and so never exercised the form the client sends."
	| decoy idx |
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuExtra')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self assert: ((self ownInstVarsOf: #GsUndoAccount) includes: 'gsuExtra').

	decoy := self shadowDecoyFor: 'GsUndoAccount'.
	["the fixture's own dictionary, by index, exactly as the client resolves it"
	 idx := System myUserProfile symbolList indexOf: (UserGlobals).
	 GsRefactoringUndo
		recordReverseRename: #instVarAdd className: 'GsUndoAccount'
		from: 'gsuExtra' to: 'gsuExtra' scopeKind: nil scopeDictName: nil classDictName: idx
		label: 'Add gsuExtra to GsUndoAccount' engine: 'GsInstVarRefactoring'.

	 "an index must scope as well as a name: no decline, and the reversal acts on the fixture"
	 self assert: GsRefactoringUndo currentEntry reverseUnavailableReason isNil.
	 self undoAll.
	 self deny: ((self ownInstVarsOf: #GsUndoAccount) includes: 'gsuExtra').
	 self deny: ((decoy instVarNames collect: [:e | e asString]) includes: 'gsuExtra')]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testADeclinedReversalNamesTheDictionaryItResolved [
	"A decline that names only the class is unreadable when the name is shadowed: 'Shadowed no
	 longer declares abc' reads as a broken undo, when what it means is that the reversal resolved
	 a DIFFERENT class of that name. Naming the dictionary makes the two tellable apart, and is
	 what turns a report of 'undo is broken' into a diagnosis (#396)."
	| decoy reason |
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuExtra')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.

	decoy := self shadowDecoyFor: 'GsUndoAccount'.
	["record WITHOUT a dictionary, so the reversal resolves by name and lands on the decoy"
	 GsRefactoringUndo
		recordReverseRename: #instVarAdd className: 'GsUndoAccount'
		from: 'gsuExtra' to: 'gsuExtra' scopeKind: nil scopeDictName: nil
		label: 'Add gsuExtra to GsUndoAccount' engine: 'GsInstVarRefactoring'.
	 reason := GsRefactoringUndo currentEntry reverseUnavailableReason.

	 self assert: reason notNil.
	 "it declines -- and says which class it was looking at, by naming its dictionary"
	 self assert: reason includesSubstring: 'GsUndoAccount in GsUndoShadowDict'.
	 self assert: reason includesSubstring: 'no longer declares an instance variable named gsuExtra']
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - stale dictionary reference' }
GsRefactoringUndoTest >> testUndoDeclinesWhenTheRecordedDictionaryIndexHasGoneStale [
	"The client sends a SymbolList INDEX, and an index only means anything while the list keeps
	 its order. Jasper lets the user insert, remove and reorder dictionaries between a
	 refactoring and its Undo. Recording the index and re-resolving it at undo time made index 2
	 mean a DIFFERENT dictionary after an insert at position 1 -- the decoy gained the variable
	 and the real class kept it, with {applied:1, failed:[]} reported. Recording the dictionary
	 OBJECT makes the insert irrelevant. See #396."
	| idx decoy |
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuExtra')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	idx := System myUserProfile symbolList indexOf: UserGlobals.
	GsRefactoringUndo
		recordReverseRename: #instVarAdd className: 'GsUndoAccount'
		from: 'gsuExtra' to: 'gsuExtra' scopeKind: nil scopeDictName: nil classDictName: idx
		label: 'Add gsuExtra to GsUndoAccount' engine: 'GsInstVarRefactoring'.

	"the shift happens AFTER the record -- every index at or past 1 now means something else"
	decoy := self shadowDecoyFor: 'GsUndoAccount'.
	[self assert: GsRefactoringUndo currentEntry reverseUnavailableReason isNil.
	 self undoAll.
	 "the real class lost the variable"
	 self deny: ((self ownInstVarsOf: #GsUndoAccount) includes: 'gsuExtra').
	 "and the decoy, which the stale index would have pointed at, was never touched"
	 self deny: ((decoy instVarNames collect: [:e | e asString]) includes: 'gsuExtra')]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]

{ #category : 'tests - stale dictionary reference' }
GsRefactoringUndoTest >> testUndoDeclinesWhenTheRecordedDictionaryIsRemoved [
	"A dictionary the user has taken off their symbol list is not somewhere the undo may write.
	 It must decline by name, not fall back to whatever else binds the name."
	| extra cls |
	extra := SymbolDictionary new name: #GsUndoGoneDict; yourself.
	System myUserProfile insertDictionary: extra at: 1.
	cls := Object
		subclass: 'GsUndoGoneClass' instVarNames: #('gsuGone')
		classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: extra.
	GsRefactoringUndo
		recordReverseRename: #instVarAdd className: 'GsUndoGoneClass'
		from: 'gsuGone' to: 'gsuGone' scopeKind: nil scopeDictName: nil classDictName: 1
		label: 'Add gsuGone to GsUndoGoneClass' engine: 'GsInstVarRefactoring'.
	System myUserProfile removeDictionaryAt: 1.
	"a same-named class left in plain sight is exactly what must NOT be reached"
	[Object
		subclass: 'GsUndoGoneClass' instVarNames: #('gsuGone')
		classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals.
	 self assert: GsRefactoringUndo currentEntry reverseUnavailableReason notNil.
	 self assert: ((UserGlobals at: #GsUndoGoneClass) instVarNames collect: [:e | e asString])
		= #('gsuGone')]
		ensure: [UserGlobals removeKey: #GsUndoGoneClass ifAbsent: []]
]

{ #category : 'tests - stale dictionary reference' }
GsRefactoringUndoTest >> testUndoDeclinesWhenTheNameNowBindsADifferentClass [
	"The name being bound is not enough. Delete the class and create a fresh one under the same
	 name in the same dictionary and the reversal would reshape a class that was never part of
	 the refactoring. The recorded class history tells the two apart."
	| cls |
	(GsInstVarRefactoring class: self fixture addInstVar: 'gsuExtra')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	GsRefactoringUndo
		recordReverseRename: #instVarAdd className: 'GsUndoAccount'
		from: 'gsuExtra' to: 'gsuExtra' scopeKind: nil scopeDictName: nil
		classDictName: (System myUserProfile symbolList indexOf: UserGlobals)
		label: 'Add gsuExtra to GsUndoAccount' engine: 'GsInstVarRefactoring'.

	UserGlobals removeKey: #GsUndoAccount ifAbsent: [].
	cls := Object
		subclass: 'GsUndoAccount' instVarNames: #('gsuExtra')
		classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals.

	self assert: GsRefactoringUndo currentEntry reverseUnavailableReason notNil.
	"the replacement class keeps its variable -- the undo did not reach into it"
	self assert: ((cls instVarNames collect: [:e | e asString]) includes: 'gsuExtra')
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoWholeSystemRenameRestoresBothSameNamedImplementors [
	"The shadow tests above introduce the decoy AFTER the refactoring, so it is never in the change
	 set. Here the second GsUndoAccount exists from the start and implements #gsuTotal too, so a
	 whole-system rename legitimately renames both -- and the undo has to put both back. Keying the
	 recorded slots by `Class>>selector` alone dropped the second class's slots, so the undo
	 restored one class, reported success, and left the other renamed (#396)."
	| twinDict twin beforeReal beforeTwin applyJson undoJson |
	twinDict := SymbolDictionary new name: #GsUndoTwinDict; yourself.
	System myUserProfile symbolList add: twinDict.
	[twin := Object
		subclass: 'GsUndoAccount'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: twinDict.
	 self compile: 'gsuTotal ^ 1 + 1' in: twin category: 'computing'.
	 beforeReal := self snapshotOf: self fixture.
	 beforeTwin := self snapshotOf: twin.
	 applyJson := self applyRecording: (GsRenameMethodRefactoring
		class: self fixture
		renameSelector: 'gsuTotal'
		toParts: #('gsuSum')
		permutation: #()
		scope: #wholeSystem).
	 self assert: applyJson includesSubstring: '"undoRecorded":true'.
	 "The rename reached both classes, so both are the undo's to restore."
	 self assert: (self sourceOf: #gsuSum in: self fixture) notNil.
	 self assert: (self sourceOf: #gsuSum in: twin) notNil.

	 undoJson := self undoAll.

	 self assert: undoJson includesSubstring: '"failed":[]'.
	 self assertSnapshot: beforeReal restoredFor: self fixture.
	 self assertSnapshot: beforeTwin restoredFor: twin]
		ensure: [System myUserProfile symbolList remove: twinDict ifAbsent: []]
]

{ #category : 'tests - shadowed class name' }
GsRefactoringUndoTest >> testUndoHistoryRevertRestoresASameNamedSubclassInAnotherDictionary [
	"Adding an instance variable to GsUndoAccount re-versions every subclass, and here that includes
	 a second GsUndoSavings, in another dictionary, that subclasses it too. The history revert
	 records and replays each class by name AND dictionary, so both GsUndoSavings have to go back to
	 their own pre-reshape versions, each in its own dictionary, with its own methods."
	| twinDict twin |
	twinDict := SymbolDictionary new name: #GsUndoTwinDict; yourself.
	System myUserProfile symbolList add: twinDict.
	[twin := self fixture
		subclass: 'GsUndoSavings'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: twinDict.
	 self compile: 'gsuTwinOwn ^ 3' in: twin category: 'fixture'.
	 GsRefactoringUndo captureClassHistoryOf: 'GsUndoAccount' inDictionary: 'UserGlobals'.
	 (GsInstVarRefactoring class: self fixture addInstVar: 'gsuReshaped')
		applyDeselected: #() options: nil migrate: false deleteHistory: false.
	 GsRefactoringUndo
		commitHistoryRevert: 'Add gsuReshaped to GsUndoAccount'
		engine: 'GsInstVarRefactoring'
		created: #().
	 "The reshape reached the other GsUndoSavings, so it is the undo's to put back."
	 self deny: (twinDict at: #GsUndoSavings) == twin.

	 self undoAll.

	 self deny: ((self ownInstVarsOf: #GsUndoAccount) includes: 'gsuReshaped').
	 #(#UserGlobals #GsUndoTwinDict) do: [:dn | | d savings |
		d := dn == #UserGlobals ifTrue: [UserGlobals] ifFalse: [twinDict].
		savings := d at: #GsUndoSavings.
		self deny: (savings allInstVarNames includes: #gsuReshaped).
		self assert: savings superclass == (UserGlobals at: #GsUndoAccount)].
	 "A revert binds a fresh version of each subclass, so identity is not the test; staying in its
	 own class history is -- neither GsUndoSavings may have been reverted into the other's."
	 self assert: (twinDict at: #GsUndoSavings) classHistory == twin classHistory.
	 self deny: (UserGlobals at: #GsUndoSavings) classHistory == twin classHistory.
	 self assert: (self sourceOf: #gsuTwinOwn in: (twinDict at: #GsUndoSavings)) notNil.
	 self assert: (self sourceOf: #gsuSavingsOwn in: (UserGlobals at: #GsUndoSavings)) notNil]
		ensure: [System myUserProfile symbolList remove: twinDict ifAbsent: []]
]

{ #category : 'tests - shadowed dictionary name' }
GsRefactoringUndoTest >> twinNamedDictionaries [
	"Two dictionaries with the SAME name, appended to the symbol list in order, each binding its own
	 GsUndoTwinClass. Callers remove them with #removeDictionaries: in an ensure:."
	| first second |
	first := SymbolDictionary new name: #GsUndoTwinName; yourself.
	second := SymbolDictionary new name: #GsUndoTwinName; yourself.
	System myUserProfile symbolList add: first; add: second.
	#(1 2) do: [:i |
		Object
			subclass: 'GsUndoTwinClass'
			instVarNames: #('gsuOwn')
			classVars: #() classInstVars: #() poolDictionaries: #()
			inDictionary: (i = 1 ifTrue: [first] ifFalse: [second])].
	^Array with: first with: second
]

{ #category : 'tests - shadowed dictionary name' }
GsRefactoringUndoTest >> indexOfDictionary: aDict [
	| sl |
	sl := System myUserProfile symbolList.
	1 to: sl size do: [:i | (sl at: i) == aDict ifTrue: [^i]].
	^0
]

{ #category : 'tests - shadowed dictionary name' }
GsRefactoringUndoTest >> removeDictionaries: dicts [
	"By identity: two empty dictionaries of one name can compare equal."
	dicts do: [:d | | i |
		i := self indexOfDictionary: d.
		i > 0 ifTrue: [System myUserProfile removeDictionaryAt: i]]
]

{ #category : 'tests - shadowed dictionary name' }
GsRefactoringUndoTest >> testUndoHistoryRevertPreviewsTheClassInTheSecondOfTwoSameNamedDictionaries [
	"The history revert recorded each class's dictionary by NAME. With two dictionaries of one
	 name, the reversal looked the name up and found the FIRST, whose class of that name the
	 refactoring never touched -- so the undo described, and would have reverted, the wrong class.
	 The capture pins the dictionary itself; the reversal's preview has to be of the class that
	 was reshaped, which is the only one that carries gsuReshaped.

	 This stops at the preview. Applying the revert hands each class to the forward rename engine,
	 which records its changes' dictionaries by name and so still reaches the first dictionary --
	 a limit of the forward engine, not of the undo's own lookup. The reshape is a new class
	 version defined directly rather than through a refactoring for the same reason."
	| dicts second json |
	dicts := self twinNamedDictionaries.
	second := dicts last.
	[GsRefactoringUndo
		captureClassHistoryOf: 'GsUndoTwinClass'
		inDictionary: (self indexOfDictionary: second).
	 Object
		subclass: 'GsUndoTwinClass'
		instVarNames: #('gsuOwn' 'gsuReshaped')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: second.
	 GsRefactoringUndo
		commitHistoryRevert: 'Add gsuReshaped to GsUndoTwinClass'
		engine: 'GsInstVarRefactoring'
		created: #().
	 self assert: ((second at: #GsUndoTwinClass) instVarNames includes: #gsuReshaped).

	 json := self undoPreviewJson.

	 "the revert is described against the reshaped class: what it is now carries gsuReshaped"
	 self assert: json includesSubstring: '"total":1'.
	 self assert: json includesSubstring: 'gsuOwn gsuReshaped']
		ensure: [self removeDictionaries: dicts]
]

{ #category : 'tests - shadowed dictionary name' }
GsRefactoringUndoTest >> testUndoHistoryRevertUnbindsACreatedClassOnlyFromItsOwnDictionary [
	"A class the refactoring created is unbound from the dictionary it was filed in. That dictionary
	 was found by NAME, so every dictionary of that name lost its binding -- including an unrelated
	 class the other one holds."
	| dicts first second |
	dicts := self twinNamedDictionaries.
	first := dicts first.
	second := dicts last.
	[| unrelated |
	 unrelated := Object
		subclass: 'GsUndoCreated' instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: first.
	 GsRefactoringUndo
		captureClassHistoryOf: 'GsUndoTwinClass'
		inDictionary: (self indexOfDictionary: second).
	 "what the refactoring created, next to its anchor"
	 Object
		subclass: 'GsUndoCreated' instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: second.
	 GsRefactoringUndo
		commitHistoryRevert: 'Extract GsUndoCreated'
		engine: 'GsExtractSuperclassRefactoring'
		created: #('GsUndoCreated').
	 "the preview lists the one removal, from the pinned dictionary"
	 self assert: self undoPreviewJson includesSubstring: '"kind":"classRemove"'.

	 self undoAll.

	 self deny: (second includesKey: #GsUndoCreated).
	 self assert: (first at: #GsUndoCreated ifAbsent: [nil]) == unrelated]
		ensure: [self removeDictionaries: dicts]
]

{ #category : 'tests - shadowed dictionary name' }
GsRefactoringUndoTest >> undoWithPlan: aPlan [
	"An undo entry holding aPlan as its revert plan, for the entry-level lookups."
	^GsRefactoringUndo new
		setLabel: 'plan' engine: 'test' sequence: 1 revertPlan: aPlan removePlan: #()
]

{ #category : 'tests - shadowed dictionary name' }
GsRefactoringUndoTest >> testAnEntryResolvesToThePinnedDictionaryWhereverItNowSits [
	"The capture pins the dictionary object; the lookup answers where it sits on the symbol list
	 NOW -- so inserting a dictionary ahead of it after the capture does not redirect the undo."
	| dicts second entry undo before |
	dicts := self twinNamedDictionaries.
	second := dicts last.
	[entry := Array with: 'GsUndoTwinClass' with: 1 with: 'def' with: 'GsUndoTwinName' with: second.
	 undo := self undoWithPlan: (Array with: entry).
	 before := self indexOfDictionary: second.
	 self assert: (undo dictRefForEntry: entry) equals: before.
	 System myUserProfile insertDictionary: (SymbolDictionary new name: #GsUndoAhead; yourself) at: 1.
	 [self assert: (undo dictRefForEntry: entry) equals: before + 1]
		ensure: [System myUserProfile removeDictionaryAt: 1]]
		ensure: [self removeDictionaries: dicts]
]

{ #category : 'tests - shadowed dictionary name' }
GsRefactoringUndoTest >> testAnEntryWhosePinnedDictionaryIsGoneResolvesToNothing [
	"0 is no SymbolList position, so the class resolves to nil and the reversal reports it --
	 rather than falling back to the first dictionary with the recorded name."
	| gone entry |
	gone := SymbolDictionary new name: #UserGlobals; yourself.
	entry := Array with: 'GsUndoAccount' with: 1 with: 'def' with: 'UserGlobals' with: gone.
	self assert: ((self undoWithPlan: (Array with: entry)) dictRefForEntry: entry) equals: 0
]

{ #category : 'tests - shadowed dictionary name' }
GsRefactoringUndoTest >> testAnEntryRecordedBeforeThePinScopesByItsNameOrNotAtAll [
	"A four-slot entry, from before the dictionary object was pinned, still scopes by the name it
	 recorded; a three-slot one, from before any dictionary was recorded, is unscoped."
	| four three undo |
	four := Array with: 'GsUndoAccount' with: 1 with: 'def' with: 'UserGlobals'.
	three := Array with: 'GsUndoAccount' with: 1 with: 'def'.
	undo := self undoWithPlan: (Array with: four).
	self assert: (undo dictRefForEntry: four) equals: 'UserGlobals'.
	self assert: (undo dictRefForEntry: three) isNil
]

{ #category : 'tests - shadowed dictionary name' }
GsRefactoringUndoTest >> testCreatedClassesGoToTheRootEntrysDictionary [
	"The dictionary created classes were filed in is the revert plan's root's: the pinned object
	 when there is one, and its name for a plan recorded before the pin."
	| pinned legacy |
	pinned := self undoWithPlan: (Array
		with: (Array with: 'GsUndoAccount' with: 1 with: 'def' with: 'UserGlobals' with: UserGlobals)
		with: (Array with: 'GsUndoSavings' with: 1 with: 'def' with: 'Globals' with: Globals)).
	self assert: pinned createdClassesDictionary == UserGlobals.
	self assert: pinned createdClassesDictionaryName equals: 'UserGlobals'.
	legacy := self undoWithPlan:
		(Array with: (Array with: 'GsUndoAccount' with: 1 with: 'def' with: 'UserGlobals')).
	self assert: legacy createdClassesDictionary isNil.
	self assert: legacy createdClassesDictionaryName equals: 'UserGlobals'.
	self assert: (self undoWithPlan: #()) createdClassesDictionary isNil.
	self assert: (self undoWithPlan: #()) createdClassesDictionaryName isNil
]

{ #category : 'tests - shadowed dictionary name' }
GsRefactoringUndoTest >> testUndoHistoryRevertReportsAClassWhoseDictionaryWasRemoved [
	"The dictionary the capture pinned has left the symbol list by the time of the undo. The
	 reversal has nowhere to put the class back, and says so, instead of reverting a same-named
	 class somewhere else -- here, another dictionary that carries the same NAME."
	| dicts second json |
	dicts := self twinNamedDictionaries.
	second := dicts last.
	[GsRefactoringUndo
		captureClassHistoryOf: 'GsUndoTwinClass'
		inDictionary: (self indexOfDictionary: second).
	 Object
		subclass: 'GsUndoTwinClass'
		instVarNames: #('gsuOwn' 'gsuReshaped')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: second.
	 GsRefactoringUndo
		commitHistoryRevert: 'Add gsuReshaped to GsUndoTwinClass'
		engine: 'GsInstVarRefactoring'
		created: #().
	 System myUserProfile removeDictionaryAt: (self indexOfDictionary: second).

	 json := self undoAll.

	 self deny: json includesSubstring: '"failed":[]'.
	 self assert: json includesSubstring: 'not a class']
		ensure: [self removeDictionaries: dicts]
]

{ #category : 'tests - shadowed dictionary name' }
GsRefactoringUndoTest >> testUndoHistoryRevertCountsTheMethodsItWouldDiscardOnTheRightClass [
	"The preview's drop count -- the methods reverting would discard -- is computed on the class in
	 the pinned dictionary. The first dictionary's class of the same name has no such method."
	| dicts second json |
	dicts := self twinNamedDictionaries.
	second := dicts last.
	[GsRefactoringUndo
		captureClassHistoryOf: 'GsUndoTwinClass'
		inDictionary: (self indexOfDictionary: second).
	 Object
		subclass: 'GsUndoTwinClass'
		instVarNames: #('gsuOwn' 'gsuReshaped')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: second.
	 self compile: 'gsuSince ^ 1' in: (second at: #GsUndoTwinClass) category: 'fixture'.
	 GsRefactoringUndo
		commitHistoryRevert: 'Add gsuReshaped to GsUndoTwinClass'
		engine: 'GsInstVarRefactoring'
		created: #().

	 json := self undoPreviewJson.

	 self assert: json includesSubstring: '"dropCount":1'.
	 self assert: json includesSubstring: 'gsuSince']
		ensure: [self removeDictionaries: dicts]
]
