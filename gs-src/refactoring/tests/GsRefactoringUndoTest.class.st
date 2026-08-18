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
same-named method elsewhere in the image, and every scope used is #class.

setUp builds throwaway classes in UserGlobals and clears any recorded undo; tearDown
removes them and clears again, so no test leaks an entry into the next.
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
	(Array with: #GsUndoSavings with: #GsUndoLedger with: #GsUndoAccount)
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
