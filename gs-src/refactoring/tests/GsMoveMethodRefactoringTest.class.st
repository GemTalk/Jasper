"
Correctness of the move-method refactoring (M6). Move relocates one OR MORE methods
from a source class/side to a DIFFERENT class -- and/or flips instance<->class side
-- keeping the selector and the source verbatim. Each selector stages a #methodAdd on
the target (compile the same source there) plus a #methodRemove on the source. Nothing
is compiled or committed while building; the server-side apply compiles the target and
removes the source WITHOUT committing (the user commits explicitly).

This suite pins down:

  - a pure method (no ivar, no super) moves to another class: a #methodAdd on the
    target carrying the verbatim source + category, and a #methodRemove on the source;
  - the move is DECLINED (that selector is skipped, with a reason) when: the target
    class does not exist (a GLOBAL decline that empties the whole change set); the
    target and side are the same as the source (no-op); the target already implements
    the selector (collision); the method sends super; or the method accesses an
    instance variable the target class does not define;
  - a method that reads an ivar the target ALSO defines moves cleanly; the same method
    is declined when the target lacks that ivar;
  - an instance method flips to the class side of its own class (target = source class,
    other side); the flip is declined for an ivar-reader (the class side has no such
    instance variable);
  - a MULTI-selector move moves the movable ones and reports the declined ones;
  - the analysis pre-flight reports per-selector decline + a movable count;
  - building compiles nothing and commits nothing; apply relocates the method and
    removes it from the source, guarding the removal so a deselected/failed add never
    strands the method in neither class; apply never commits; a token round-trip works.

setUp builds throwaway classes in UserGlobals; tearDown removes them.
"
Class {
	#name : 'GsMoveMethodRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsMoveMethodRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'asserting' }
GsMoveMethodRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsMoveMethodRefactoringTest >> sourceFixture [
	^UserGlobals at: #GsMMSource
]

{ #category : 'fixture' }
GsMoveMethodRefactoringTest >> targetFixture [
	^UserGlobals at: #GsMMTarget
]

{ #category : 'fixture' }
GsMoveMethodRefactoringTest >> noVarFixture [
	^UserGlobals at: #GsMMNoVar
]

{ #category : 'fixture' }
GsMoveMethodRefactoringTest >> compile: aSource in: aClass [
	[aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture']
		on: CompileWarning
		do: [:ex | ex resume: nil]
]

{ #category : 'fixture' }
GsMoveMethodRefactoringTest >> moveSelectors: sels to: aTargetName [
	"Move instance-side sels from GsMMSource to the instance side of aTargetName."
	^GsMoveMethodRefactoring
		sourceClass: self sourceFixture
		selectors: sels
		meta: false
		toClassNamed: aTargetName
		toMeta: false
]

{ #category : 'fixture' }
GsMoveMethodRefactoringTest >> move: aSelector to: aTargetName [
	^self moveSelectors: (Array with: aSelector) to: aTargetName
]

{ #category : 'fixture' }
GsMoveMethodRefactoringTest >> addChangeFor: aSelector in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodAdd and: [c selector = aSelector]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsMoveMethodRefactoringTest >> removeChangeFor: aSelector in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodRemove and: [c selector = aSelector]]
		ifNone: [nil]
]

{ #category : 'running' }
GsMoveMethodRefactoringTest >> setUp [
	| source target novar |
	super setUp.
	source := Object
		subclass: 'GsMMSource'
		instVarNames: #('balance')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	target := Object
		subclass: 'GsMMTarget'
		instVarNames: #('balance')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	novar := Object
		subclass: 'GsMMNoVar'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	"--- source instance methods ---"
	self compile: 'pureCompute ^ 40 + 2' in: source.
	self compile: 'greet ^ ''hi''' in: source.
	self compile: 'usesBalance ^ balance' in: source.
	self compile: 'callsSuper ^ super hash' in: source.
	self compile: 'existing ^ 2' in: source.
	"--- target already implements #existing (collision) ---"
	self compile: 'existing ^ 1' in: target
]

{ #category : 'running' }
GsMoveMethodRefactoringTest >> tearDown [
	#('GsMMSource' 'GsMMTarget' 'GsMMNoVar')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests - move' }
GsMoveMethodRefactoringTest >> testMovesPureMethodStagesAddAndRemove [
	| ref cs add remove |
	ref := self move: #pureCompute to: 'GsMMTarget'.
	cs := ref changeSet.
	add := self addChangeFor: #pureCompute in: cs.
	remove := self removeChangeFor: #pureCompute in: cs.

	self assert: cs size equals: 2.
	self assert: add notNil.
	self assert: add className equals: 'GsMMTarget'.
	self assert: add newSource includesSubstring: '40 + 2'.
	self assert: remove notNil.
	self assert: remove className equals: 'GsMMSource'.
	self assert: (ref declineFor: #pureCompute) isNil
]

{ #category : 'tests - move' }
GsMoveMethodRefactoringTest >> testMovedAddPreservesCategory [
	| add |
	add := self addChangeFor: #pureCompute in: (self move: #pureCompute to: 'GsMMTarget') changeSet.

	self assert: add category equals: 'fixture'
]

{ #category : 'tests - decline' }
GsMoveMethodRefactoringTest >> testMissingTargetIsGlobalDeclineAndEmptyChangeSet [
	| ref |
	ref := self move: #pureCompute to: 'GsMMNoSuchClass'.

	self assert: ref globalDecline notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsMoveMethodRefactoringTest >> testSameClassSameSideIsNoOpDecline [
	| ref |
	ref := self move: #pureCompute to: 'GsMMSource'.

	self assert: ref globalDecline notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsMoveMethodRefactoringTest >> testCollisionIsDeclined [
	| ref |
	ref := self move: #existing to: 'GsMMTarget'.

	self assert: (ref declineFor: #existing) notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsMoveMethodRefactoringTest >> testSuperSenderIsDeclined [
	| ref |
	ref := self move: #callsSuper to: 'GsMMTarget'.

	self assert: (ref declineFor: #callsSuper) notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - ivar' }
GsMoveMethodRefactoringTest >> testIvarReaderMovesWhenTargetHasTheIvar [
	| ref |
	ref := self move: #usesBalance to: 'GsMMTarget'.

	self assert: (ref declineFor: #usesBalance) isNil.
	self assert: ref changeSet size equals: 2
]

{ #category : 'tests - ivar' }
GsMoveMethodRefactoringTest >> testIvarReaderDeclinedWhenTargetLacksTheIvar [
	| ref |
	ref := self move: #usesBalance to: 'GsMMNoVar'.

	self assert: (ref declineFor: #usesBalance) notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - side flip' }
GsMoveMethodRefactoringTest >> testInstanceToClassSideFlipMovesPure [
	| ref cs add remove |
	ref := GsMoveMethodRefactoring
		sourceClass: self sourceFixture
		selectors: (Array with: #pureCompute)
		meta: false
		toClassNamed: 'GsMMSource'
		toMeta: true.
	cs := ref changeSet.
	add := self addChangeFor: #pureCompute in: cs.
	remove := self removeChangeFor: #pureCompute in: cs.

	self assert: cs size equals: 2.
	self assert: add isMeta.
	self deny: remove isMeta
]

{ #category : 'tests - side flip' }
GsMoveMethodRefactoringTest >> testInstanceToClassSideFlipDeclinesIvarReader [
	| ref |
	ref := GsMoveMethodRefactoring
		sourceClass: self sourceFixture
		selectors: (Array with: #usesBalance)
		meta: false
		toClassNamed: 'GsMMSource'
		toMeta: true.

	self assert: (ref declineFor: #usesBalance) notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - multi' }
GsMoveMethodRefactoringTest >> testMultiMoveMovesMovableAndSkipsDeclined [
	| ref cs |
	ref := self moveSelectors: #(#pureCompute #callsSuper #greet) to: 'GsMMTarget'.
	cs := ref changeSet.

	"pureCompute + greet move (2 changes each); callsSuper is skipped"
	self assert: cs size equals: 4.
	self assert: (self addChangeFor: #pureCompute in: cs) notNil.
	self assert: (self addChangeFor: #greet in: cs) notNil.
	self assert: (self addChangeFor: #callsSuper in: cs) isNil.
	self assert: (ref declineFor: #callsSuper) notNil
]

{ #category : 'tests - preflight' }
GsMoveMethodRefactoringTest >> testAnalysisPreflightReportsPerSelectorAndMovableCount [
	| json |
	json := GsMoveMethodRefactoring
		analyzeForClass: self sourceFixture
		selectors: #(#pureCompute #callsSuper)
		meta: false
		toClassNamed: 'GsMMTarget'
		toMeta: false.

	self assert: json includesSubstring: '"targetClass":"GsMMTarget"'.
	self assert: json includesSubstring: '"movableCount":1'.
	self assert: json includesSubstring: '"selector":"pureCompute"'.
	self assert: json includesSubstring: '"selector":"callsSuper"'
]

{ #category : 'tests - staging' }
GsMoveMethodRefactoringTest >> testBuildingChangeSetCompilesNothingAndDoesNotCommit [
	| before |
	before := System needsCommit.
	(self move: #pureCompute to: 'GsMMTarget') changeSet.

	"source still has it; target does not; nothing committed"
	self assert: (self sourceFixture includesSelector: #pureCompute).
	self deny: (self targetFixture includesSelector: #pureCompute).
	self assert: System needsCommit equals: before
]

{ #category : 'tests - preview' }
GsMoveMethodRefactoringTest >> testPreviewJsonSerializesAddAndRemove [
	| json |
	json := (self move: #pureCompute to: 'GsMMTarget') previewJsonString.

	self assert: json includesSubstring: 'methodAdd'.
	self assert: json includesSubstring: 'methodRemove'
]

{ #category : 'tests - preview' }
GsMoveMethodRefactoringTest >> testStartPreviewCarriesTotalsAndPage [
	| json |
	json := (self move: #pureCompute to: 'GsMMTarget')
		startPreviewToken: 'm6Tok' maxBytes: 100000.
	[self assert: json includesSubstring: '"targetClass":"GsMMTarget"'.
	 self assert: json includesSubstring: '"total":2'.
	 self assert: json includesSubstring: '"movableCount":1'.
	 self assert: json includesSubstring: '"changes":']
		ensure: [GsMoveMethodRefactoring clearToken: 'm6Tok']
]

{ #category : 'tests - apply' }
GsMoveMethodRefactoringTest >> testApplyRelocatesMethodAndRemovesFromSource [
	| json |
	json := (self move: #pureCompute to: 'GsMMTarget') applyDeselected: #().

	self assert: json includesSubstring: '"applied":2'.
	self assert: (self targetFixture includesSelector: #pureCompute).
	self deny: (self sourceFixture includesSelector: #pureCompute)
]

{ #category : 'tests - apply' }
GsMoveMethodRefactoringTest >> testApplyDoesNotCommit [
	| before |
	before := System needsCommit.
	(self move: #pureCompute to: 'GsMMTarget') applyDeselected: #().

	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsMoveMethodRefactoringTest >> testDeselectingAddGuardsTheRemove [
	"Unticking the #methodAdd must NOT strand the method: the guarded remove is
	 skipped because the target never received the method."
	| ref cs addId json |
	ref := self move: #pureCompute to: 'GsMMTarget'.
	cs := ref changeSet.
	addId := (self addChangeFor: #pureCompute in: cs) id.
	json := ref applyDeselected: (Array with: addId).

	self assert: (self sourceFixture includesSelector: #pureCompute).
	self deny: (self targetFixture includesSelector: #pureCompute)
]

{ #category : 'tests - apply' }
GsMoveMethodRefactoringTest >> testTokenRoundTripStartThenApply [
	| ref json before |
	before := System needsCommit.
	ref := self move: #pureCompute to: 'GsMMTarget'.
	ref startPreviewToken: 'm6rt' maxBytes: 100000.
	[json := GsMoveMethodRefactoring applyForToken: 'm6rt' deselected: #().
	 self assert: json includesSubstring: '"applied":2'.
	 self assert: (self targetFixture includesSelector: #pureCompute).
	 self assert: System needsCommit equals: before]
		ensure: [GsMoveMethodRefactoring clearToken: 'm6rt']
]

{ #category : 'tests - apply' }
GsMoveMethodRefactoringTest >> testApplyForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsMoveMethodRefactoring applyForToken: 'nope' deselected: #())
		includesSubstring: 'expired'
]

{ #category : 'tests - apply' }
GsMoveMethodRefactoringTest >> testPageForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsMoveMethodRefactoring pageForToken: 'nope' from: 1 maxBytes: 100)
		includesSubstring: 'expired'
]
