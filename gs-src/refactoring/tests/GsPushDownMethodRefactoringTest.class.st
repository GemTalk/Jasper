"
Correctness of the push-down-method refactoring (M8). Push-down relocates one OR MORE
methods from a source class into its immediate SUBCLASSES, same side, keeping the selector
and the source verbatim. Per movable selector it stages a #methodAdd on every immediate
subclass that does not already override the selector (each keeps its own override) plus a
SINGLE #methodRemove on the source. Nothing is compiled or committed while building; the
server-side apply compiles the subclasses and removes the source WITHOUT committing.

This suite pins down:

  - a pure method pushes down: one #methodAdd per receiving subclass (verbatim source +
    category) plus one #methodRemove on the source;
  - instance-variable access does NOT block a push-down (the subclasses inherit the source's
    ivars);
  - the push is DECLINED (that selector is skipped, with a reason) when: the method sends
    super; (a class where EVERY subclass already overrides the selector is NOT declined -- it
    is an all-overwrite push the user opts into);
  - a subclass that already overrides the selector gets an opt-in OVERWRITE add (existing
    body + a data-loss warning), NOT a silent skip, and the others get plain adds;
  - a class with no subclasses (an impossible push) is a GLOBAL decline that empties the
    change set;
  - a class-side method pushes down onto each subclass's class side;
  - a MULTI-selector push moves the movable ones and reports the declined ones;
  - the analysis pre-flight reports a null targetClass, a per-selector decline, and a
    movable count;
  - building compiles nothing and commits nothing; apply copies the method into each
    subclass and removes it from the source, guarding the removal so it fires only once
    every subclass understands the selector (a deselected subclass add leaves the source
    method in place); apply never commits; a token round-trip works.

setUp builds a throwaway base + two subclasses in UserGlobals; tearDown removes them.
"
Class {
	#name : 'GsPushDownMethodRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsPushDownMethodRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'asserting' }
GsPushDownMethodRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsPushDownMethodRefactoringTest >> baseFixture [
	^UserGlobals at: #GsPDBase
]

{ #category : 'fixture' }
GsPushDownMethodRefactoringTest >> aFixture [
	^UserGlobals at: #GsPDA
]

{ #category : 'fixture' }
GsPushDownMethodRefactoringTest >> bFixture [
	^UserGlobals at: #GsPDB
]

{ #category : 'fixture' }
GsPushDownMethodRefactoringTest >> compile: aSource in: aClass [
	[aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture']
		on: CompileWarning
		do: [:ex | ex resume: nil]
]

{ #category : 'fixture' }
GsPushDownMethodRefactoringTest >> pushSelectors: sels [
	"Push instance-side sels from GsPDBase down into its subclasses."
	^GsPushDownMethodRefactoring
		sourceClass: self baseFixture
		selectors: sels
		meta: false
]

{ #category : 'fixture' }
GsPushDownMethodRefactoringTest >> push: aSelector [
	^self pushSelectors: (Array with: aSelector)
]

{ #category : 'fixture' }
GsPushDownMethodRefactoringTest >> sourceIn: aClass for: aSelector [
	"The instance-side source of aSelector in aClass, or '' if absent."
	^(aClass compiledMethodAt: aSelector environmentId: 0 otherwise: nil)
		ifNil: [''] ifNotNil: [:m | m sourceString]
]

{ #category : 'fixture' }
GsPushDownMethodRefactoringTest >> addChangeFor: aSelector in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodAdd and: [c selector = aSelector]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsPushDownMethodRefactoringTest >> addChangeFor: aSelector inClass: aName in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodAdd and: [c selector = aSelector and: [c className = aName]]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsPushDownMethodRefactoringTest >> removeChangeFor: aSelector in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodRemove and: [c selector = aSelector]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsPushDownMethodRefactoringTest >> addCountFor: aSelector in: aChangeSet [
	^(aChangeSet changes select: [:c | c kind = #methodAdd and: [c selector = aSelector]]) size
]

{ #category : 'running' }
GsPushDownMethodRefactoringTest >> setUp [
	| base a b |
	base := Object
		subclass: 'GsPDBase'
		instVarNames: #('state')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	a := base
		subclass: 'GsPDA'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	b := base
		subclass: 'GsPDB'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	"--- base instance methods (candidates to push down) ---"
	self compile: 'pureCompute ^ 40 + 2' in: base.
	self compile: 'greet ^ ''hi''' in: base.
	self compile: 'usesState ^ state' in: base.
	self compile: 'callsSuper ^ super hash' in: base.
	self compile: 'overriddenByA ^ ''base''' in: base.
	self compile: 'overriddenByAll ^ ''base''' in: base.
	"--- A overrides overriddenByA + overriddenByAll; B overrides only overriddenByAll ---"
	self compile: 'overriddenByA ^ ''a''' in: a.
	self compile: 'overriddenByAll ^ ''a''' in: a.
	self compile: 'overriddenByAll ^ ''b''' in: b.
	"--- class-side method to push down ---"
	self compile: 'makeOne ^ self new' in: base class
]

{ #category : 'running' }
GsPushDownMethodRefactoringTest >> tearDown [
	#('GsPDA' 'GsPDB' 'GsPDBase')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests - push' }
GsPushDownMethodRefactoringTest >> testPushesPureMethodStagesAddPerSubclassAndOneRemove [
	| ref cs |
	ref := self push: #pureCompute.
	cs := ref changeSet.

	"two subclasses both lack it -> 2 adds + 1 remove"
	self assert: cs size equals: 3.
	self assert: (self addCountFor: #pureCompute in: cs) equals: 2.
	self assert: (self addChangeFor: #pureCompute inClass: 'GsPDA' in: cs) notNil.
	self assert: (self addChangeFor: #pureCompute inClass: 'GsPDB' in: cs) notNil.
	self assert: (self removeChangeFor: #pureCompute in: cs) className equals: 'GsPDBase'.
	self assert: (ref declineFor: #pureCompute) isNil
]

{ #category : 'tests - push' }
GsPushDownMethodRefactoringTest >> testPushedAddPreservesSourceAndCategory [
	| add |
	add := self addChangeFor: #pureCompute inClass: 'GsPDA' in: (self push: #pureCompute) changeSet.

	self assert: add newSource includesSubstring: '40 + 2'.
	self assert: add category equals: 'fixture'
]

{ #category : 'tests - ivar' }
GsPushDownMethodRefactoringTest >> testIvarReaderPushesDown [
	| ref |
	"#usesState reads 'state' on the base; subclasses inherit it -- movable."
	ref := self push: #usesState.

	self assert: (ref declineFor: #usesState) isNil.
	self assert: (self addCountFor: #usesState in: ref changeSet) equals: 2
]

{ #category : 'tests - decline' }
GsPushDownMethodRefactoringTest >> testNoSubclassesIsGlobalDecline [
	| ref |
	"GsPDA is a leaf -- pushing down from it is impossible."
	ref := GsPushDownMethodRefactoring sourceClass: self aFixture selectors: #(#overriddenByA) meta: false.

	self assert: ref globalDecline notNil.
	self assert: ref globalDecline includesSubstring: 'subclasses'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsPushDownMethodRefactoringTest >> testSuperSenderIsDeclined [
	| ref |
	ref := self push: #callsSuper.

	self assert: (ref declineFor: #callsSuper) notNil.
	self assert: (ref declineFor: #callsSuper) includesSubstring: 'super'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - overwrite' }
GsPushDownMethodRefactoringTest >> testEveryoneOverridesIsMovableAsOverwrites [
	"#overriddenByAll is overridden by BOTH subclasses -- no longer a decline; it stages an
	 opt-in overwrite add for each, plus one remove."
	| ref cs addA addB |
	ref := self push: #overriddenByAll.
	cs := ref changeSet.
	addA := self addChangeFor: #overriddenByAll inClass: 'GsPDA' in: cs.
	addB := self addChangeFor: #overriddenByAll inClass: 'GsPDB' in: cs.

	self assert: (ref declineFor: #overriddenByAll) isNil.
	self assert: cs size equals: 3.
	self assert: (self addCountFor: #overriddenByAll in: cs) equals: 2.
	self assert: addA warning notNil.
	self assert: addB warning notNil.
	self assert: (ref overwriteWarningFor: #overriddenByAll) notNil
]

{ #category : 'tests - overwrite' }
GsPushDownMethodRefactoringTest >> testOverridingSubclassBecomesOverwriteRow [
	"#overriddenByA is overridden only by A -- B gets a plain add, A gets an opt-in
	 overwrite (not a silent skip)."
	| ref cs addA addB |
	ref := self push: #overriddenByA.
	cs := ref changeSet.
	addA := self addChangeFor: #overriddenByA inClass: 'GsPDA' in: cs.
	addB := self addChangeFor: #overriddenByA inClass: 'GsPDB' in: cs.

	self assert: (ref declineFor: #overriddenByA) isNil.
	self assert: cs size equals: 3.
	self assert: (self addCountFor: #overriddenByA in: cs) equals: 2.
	self assert: addA notNil.
	self assert: addA warning notNil.
	self assert: addB notNil.
	self assert: addB warning isNil
]

{ #category : 'tests - overwrite' }
GsPushDownMethodRefactoringTest >> testApplyingOverwriteReplacesSubclassOverride [
	"Opting in to overwrite A's override: A receives the base body, B receives it too, and
	 the source is removed (every subclass now understands it on its own)."
	| json |
	json := (self push: #overriddenByA) applyDeselected: #().

	self assert: json includesSubstring: '"applied":3'.
	self assert: (self sourceIn: self aFixture for: #overriddenByA) includesSubstring: 'base'.
	self assert: (self bFixture includesSelector: #overriddenByA).
	self deny: (self baseFixture includesSelector: #overriddenByA)
]

{ #category : 'tests - overwrite' }
GsPushDownMethodRefactoringTest >> testDeselectingOverwriteKeepsSubclassOverride [
	"Leaving A's overwrite un-ticked keeps A's own override; B still gets the copy and the
	 source is removed (A already understands it via its override, B via the copy)."
	| ref cs addAId |
	ref := self push: #overriddenByA.
	cs := ref changeSet.
	addAId := (self addChangeFor: #overriddenByA inClass: 'GsPDA' in: cs) id.
	ref applyDeselected: (Array with: addAId).

	self deny: (self sourceIn: self aFixture for: #overriddenByA) includesSubstring: 'base'.
	self assert: (self bFixture includesSelector: #overriddenByA).
	self deny: (self baseFixture includesSelector: #overriddenByA)
]

{ #category : 'tests - side' }
GsPushDownMethodRefactoringTest >> testClassSideMethodPushesDown [
	| ref cs |
	ref := GsPushDownMethodRefactoring
		sourceClass: self baseFixture
		selectors: (Array with: #makeOne)
		meta: true.
	cs := ref changeSet.

	self assert: cs size equals: 3.
	self assert: (self addCountFor: #makeOne in: cs) equals: 2.
	self assert: (self addChangeFor: #makeOne inClass: 'GsPDA' in: cs) isMeta.
	self assert: (self removeChangeFor: #makeOne in: cs) isMeta
]

{ #category : 'tests - multi' }
GsPushDownMethodRefactoringTest >> testMultiPushMovesMovableAndSkipsDeclined [
	| ref cs |
	ref := self pushSelectors: #(#pureCompute #callsSuper #greet).
	cs := ref changeSet.

	"pureCompute + greet each push into 2 subclasses (2 adds + 1 remove each = 6);
	 callsSuper is skipped"
	self assert: cs size equals: 6.
	self assert: (self addCountFor: #pureCompute in: cs) equals: 2.
	self assert: (self addCountFor: #greet in: cs) equals: 2.
	self assert: (self addChangeFor: #callsSuper in: cs) isNil.
	self assert: (ref declineFor: #callsSuper) notNil
]

{ #category : 'tests - preflight' }
GsPushDownMethodRefactoringTest >> testAnalysisPreflightReportsPerSelectorAndMovableCount [
	| json |
	json := GsPushDownMethodRefactoring
		analyzeForClass: self baseFixture
		selectors: #(#pureCompute #callsSuper)
		meta: false.

	self assert: json includesSubstring: '"targetClass":null'.
	self assert: json includesSubstring: '"movableCount":1'.
	self assert: json includesSubstring: '"selector":"pureCompute"'.
	self assert: json includesSubstring: '"selector":"callsSuper"'
]

{ #category : 'tests - staging' }
GsPushDownMethodRefactoringTest >> testBuildingChangeSetCompilesNothingAndDoesNotCommit [
	| before |
	before := System needsCommit.
	(self push: #pureCompute) changeSet.

	"base still has it; subclasses do not; nothing committed"
	self assert: (self baseFixture includesSelector: #pureCompute).
	self deny: (self aFixture includesSelector: #pureCompute).
	self assert: System needsCommit equals: before
]

{ #category : 'tests - preview' }
GsPushDownMethodRefactoringTest >> testPreviewJsonSerializesAddAndRemove [
	| json |
	json := (self push: #pureCompute) previewJsonString.

	self assert: json includesSubstring: 'methodAdd'.
	self assert: json includesSubstring: 'methodRemove'
]

{ #category : 'tests - preview' }
GsPushDownMethodRefactoringTest >> testStartPreviewCarriesTotalsAndPage [
	| json |
	json := (self push: #pureCompute)
		startPreviewToken: 'm8Tok' maxBytes: 100000.
	[self assert: json includesSubstring: '"targetClass":null'.
	 self assert: json includesSubstring: '"total":3'.
	 self assert: json includesSubstring: '"movableCount":1'.
	 self assert: json includesSubstring: '"changes":']
		ensure: [GsPushDownMethodRefactoring clearToken: 'm8Tok']
]

{ #category : 'tests - apply' }
GsPushDownMethodRefactoringTest >> testApplyRelocatesMethodIntoSubclassesAndRemovesFromSource [
	| json |
	json := (self push: #pureCompute) applyDeselected: #().

	self assert: json includesSubstring: '"applied":3'.
	self assert: (self aFixture includesSelector: #pureCompute).
	self assert: (self bFixture includesSelector: #pureCompute).
	self deny: (self baseFixture includesSelector: #pureCompute)
]

{ #category : 'tests - apply' }
GsPushDownMethodRefactoringTest >> testApplyDoesNotCommit [
	| before |
	before := System needsCommit.
	(self push: #pureCompute) applyDeselected: #().

	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsPushDownMethodRefactoringTest >> testDeselectingOneSubclassAddGuardsTheRemove [
	"Unticking one subclass's #methodAdd must NOT strand it: the guarded remove is
	 skipped because not every subclass received the method, so the source keeps it."
	| ref cs addBId |
	ref := self push: #pureCompute.
	cs := ref changeSet.
	addBId := (self addChangeFor: #pureCompute inClass: 'GsPDB' in: cs) id.
	ref applyDeselected: (Array with: addBId).

	self assert: (self baseFixture includesSelector: #pureCompute).
	self assert: (self aFixture includesSelector: #pureCompute).
	self deny: (self bFixture includesSelector: #pureCompute)
]

{ #category : 'tests - apply' }
GsPushDownMethodRefactoringTest >> testTokenRoundTripStartThenApply [
	| ref json before |
	before := System needsCommit.
	ref := self push: #pureCompute.
	ref startPreviewToken: 'm8rt' maxBytes: 100000.
	[json := GsPushDownMethodRefactoring applyForToken: 'm8rt' deselected: #().
	 self assert: json includesSubstring: '"applied":3'.
	 self assert: (self aFixture includesSelector: #pureCompute).
	 self assert: System needsCommit equals: before]
		ensure: [GsPushDownMethodRefactoring clearToken: 'm8rt']
]

{ #category : 'tests - apply' }
GsPushDownMethodRefactoringTest >> testApplyForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsPushDownMethodRefactoring applyForToken: 'nope' deselected: #())
		includesSubstring: 'expired'
]

{ #category : 'tests - apply' }
GsPushDownMethodRefactoringTest >> testPageForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsPushDownMethodRefactoring pageForToken: 'nope' from: 1 maxBytes: 100)
		includesSubstring: 'expired'
]
