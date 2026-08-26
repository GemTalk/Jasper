"
Correctness of the push-up-method refactoring (M7). Push-up relocates one OR MORE
methods from a source class to its immediate SUPERCLASS, same side, keeping the selector
and the source verbatim. Each selector stages a #methodAdd on the superclass (compile the
same source there) plus a #methodRemove on the source. Nothing is compiled or committed
while building; the server-side apply compiles the superclass and removes the source
WITHOUT committing (the user commits explicitly).

This suite pins down:

  - a pure method (no ivar, no super) pushes up to the superclass: a #methodAdd on the
    superclass carrying the verbatim source + category, and a #methodRemove on the source;
  - the push is DECLINED (that selector is skipped, with a reason) when: the method sends
    super; or the method accesses an instance variable the superclass does not define;
  - a collision (the superclass already implements the selector) is NOT declined: it stages
    an opt-in OVERWRITE add carrying the superclass's old body + a data-loss warning, and a
    deselected overwrite must NOT strip the source (regression guard);
  - a method that reads an ivar the superclass ALSO defines pushes up cleanly; the same
    method is declined when only the subclass declares that ivar;
  - a class with no superclass (an impossible push) is a GLOBAL decline that empties the
    change set;
  - a class-side method pushes up to the superclass's class side;
  - a MULTI-selector push moves the movable ones and reports the declined ones;
  - the analysis pre-flight reports the target superclass, a per-selector decline, and a
    movable count;
  - building compiles nothing and commits nothing; apply relocates the method to the
    superclass and removes it from the source, guarding the removal so a deselected/failed
    add never strands the method; apply never commits; a token round-trip works;
  - a method that will not COMPILE on the superclass is reported (naming the method) and
    left in place on the subclass, rather than stripped from both classes.

setUp builds a throwaway superclass/subclass pair in UserGlobals; tearDown removes them.
"
Class {
	#name : 'GsPushUpMethodRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsPushUpMethodRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'asserting' }
GsPushUpMethodRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsPushUpMethodRefactoringTest >> superFixture [
	^UserGlobals at: #GsPUSuper
]

{ #category : 'fixture' }
GsPushUpMethodRefactoringTest >> subFixture [
	^UserGlobals at: #GsPUSub
]

{ #category : 'fixture' }
GsPushUpMethodRefactoringTest >> compile: aSource in: aClass [
	[aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture']
		on: CompileWarning
		do: [:ex | ex resume: nil]
]

{ #category : 'fixture' }
GsPushUpMethodRefactoringTest >> pushSelectors: sels [
	"Push instance-side sels from GsPUSub up to GsPUSuper."
	^GsPushUpMethodRefactoring
		sourceClass: self subFixture
		selectors: sels
		meta: false
]

{ #category : 'fixture' }
GsPushUpMethodRefactoringTest >> push: aSelector [
	^self pushSelectors: (Array with: aSelector)
]

{ #category : 'fixture' }
GsPushUpMethodRefactoringTest >> sourceIn: aClass for: aSelector [
	"The instance-side source of aSelector in aClass, or '' if absent."
	^(aClass compiledMethodAt: aSelector environmentId: 0 otherwise: nil)
		ifNil: [''] ifNotNil: [:m | m sourceString]
]

{ #category : 'fixture' }
GsPushUpMethodRefactoringTest >> addChangeFor: aSelector in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodAdd and: [c selector = aSelector]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsPushUpMethodRefactoringTest >> removeChangeFor: aSelector in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodRemove and: [c selector = aSelector]]
		ifNone: [nil]
]

{ #category : 'running' }
GsPushUpMethodRefactoringTest >> setUp [
	| sup sub |
	sup := Object
		subclass: 'GsPUSuper'
		instVarNames: #('shared')
		classVars: #('SharedCVar')
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := sup
		subclass: 'GsPUSub'
		instVarNames: #('own')
		classVars: #('SubOnlyCVar')
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	"--- subclass instance methods (candidates to push up) ---"
	self compile: 'pureCompute ^ 40 + 2' in: sub.
	self compile: 'greet ^ ''hi''' in: sub.
	self compile: 'usesShared ^ shared' in: sub.
	self compile: 'usesOwn ^ own' in: sub.
	self compile: 'usesSharedCVar ^ SharedCVar' in: sub.
	self compile: 'usesSubCVar ^ SubOnlyCVar' in: sub.
	self compile: 'callsSuper ^ super hash' in: sub.
	self compile: 'existing ^ 2' in: sub.
	self compile: 'quoteAndBackslash ^ ''a"b\c''' in: sub.
	"--- superclass already implements #existing (collision) ---"
	self compile: 'existing ^ 1' in: sup.
	"--- class-side method to push up ---"
	self compile: 'buildOne ^ self new' in: sub class
]

{ #category : 'running' }
GsPushUpMethodRefactoringTest >> tearDown [
	#('GsPUSub' 'GsPUSuper')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests - push' }
GsPushUpMethodRefactoringTest >> testPushesPureMethodStagesAddAndRemove [
	| ref cs add remove |
	ref := self push: #pureCompute.
	cs := ref changeSet.
	add := self addChangeFor: #pureCompute in: cs.
	remove := self removeChangeFor: #pureCompute in: cs.

	self assert: cs size equals: 2.
	self assert: add notNil.
	self assert: add className equals: 'GsPUSuper'.
	self assert: add newSource includesSubstring: '40 + 2'.
	self assert: remove notNil.
	self assert: remove className equals: 'GsPUSub'.
	self assert: (ref declineFor: #pureCompute) isNil
]

{ #category : 'tests - push' }
GsPushUpMethodRefactoringTest >> testPushedAddPreservesCategory [
	| add |
	add := self addChangeFor: #pureCompute in: (self push: #pureCompute) changeSet.

	self assert: add category equals: 'fixture'
]

{ #category : 'tests - push' }
GsPushUpMethodRefactoringTest >> testTargetSuperclassResolved [
	self assert: (self push: #pureCompute) superClass name asString equals: 'GsPUSuper'
]

{ #category : 'tests - decline' }
GsPushUpMethodRefactoringTest >> testNoSuperclassIsGlobalDecline [
	| ref |
	"Object has no superclass; pushing up from it is impossible."
	ref := GsPushUpMethodRefactoring sourceClass: Object selectors: #(#hash) meta: false.

	self assert: ref globalDecline notNil.
	self assert: ref globalDecline includesSubstring: 'superclass'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - ivar' }
GsPushUpMethodRefactoringTest >> testSharedClassVarReaderPushesUp [
	| ref |
	"#usesSharedCVar reads SharedCVar, declared on the superclass -- movable."
	ref := self push: #usesSharedCVar.

	self assert: (ref declineFor: #usesSharedCVar) isNil.
	self assert: ref changeSet size equals: 2
]

{ #category : 'tests - ivar' }
GsPushUpMethodRefactoringTest >> testSubclassOnlyClassVarReaderDeclined [
	| ref |
	"#usesSubCVar reads SubOnlyCVar, declared only on the subclass -- would not compile on
	 the superclass, so it is a hard decline (not an overwrite)."
	ref := self push: #usesSubCVar.

	self assert: (ref declineFor: #usesSubCVar) notNil.
	self assert: (ref declineFor: #usesSubCVar) includesSubstring: 'class/pool variable'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - overwrite' }
GsPushUpMethodRefactoringTest >> testCollisionIsMovableAsOverwrite [
	"The superclass already defines #existing -- pushing up is NOT declined; it stages an
	 opt-in overwrite add carrying the superclass's old body + a data-loss warning."
	| ref cs add |
	ref := self push: #existing.
	cs := ref changeSet.
	add := self addChangeFor: #existing in: cs.

	self assert: (ref declineFor: #existing) isNil.
	self assert: cs size equals: 2.
	self assert: add notNil.
	self assert: add warning notNil.
	self assert: add warning includesSubstring: 'overwrites'.
	self assert: add oldSource includesSubstring: '1'.
	self assert: add newSource includesSubstring: '2'.
	self assert: (ref overwriteWarningFor: #existing) notNil
]

{ #category : 'tests - overwrite' }
GsPushUpMethodRefactoringTest >> testApplyingOverwriteReplacesSuperclassMethod [
	"Applying the overwrite compiles the pushed body onto the superclass (replacing its old
	 definition) and removes the source."
	| json |
	json := (self push: #existing) applyDeselected: #().

	self assert: json includesSubstring: '"applied":2'.
	self assert: (self superFixture includesSelector: #existing).
	self assert: (self sourceIn: self superFixture for: #existing) includesSubstring: '2'.
	self deny: (self subFixture includesSelector: #existing)
]

{ #category : 'tests - overwrite' }
GsPushUpMethodRefactoringTest >> testDeselectingOverwriteDoesNotStripSource [
	"Regression: un-ticking the overwrite add must NOT remove the source. The superclass
	 already defines the selector, so a bare includesSelector: guard would wrongly fire the
	 remove and lose the subclass version. The applied-add guard prevents that."
	| ref cs addId |
	ref := self push: #existing.
	cs := ref changeSet.
	addId := (self addChangeFor: #existing in: cs) id.
	ref applyDeselected: (Array with: addId).

	self assert: (self subFixture includesSelector: #existing).
	self assert: (self superFixture includesSelector: #existing).
	self assert: (self sourceIn: self superFixture for: #existing) includesSubstring: '1'
]

{ #category : 'tests - decline' }
GsPushUpMethodRefactoringTest >> testSuperSenderIsDeclined [
	| ref |
	ref := self push: #callsSuper.

	self assert: (ref declineFor: #callsSuper) notNil.
	self assert: (ref declineFor: #callsSuper) includesSubstring: 'super'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - ivar' }
GsPushUpMethodRefactoringTest >> testSharedIvarReaderPushesUp [
	| ref |
	"#usesShared reads 'shared', which the superclass declares -- movable."
	ref := self push: #usesShared.

	self assert: (ref declineFor: #usesShared) isNil.
	self assert: ref changeSet size equals: 2
]

{ #category : 'tests - ivar' }
GsPushUpMethodRefactoringTest >> testOwnIvarReaderDeclined [
	| ref |
	"#usesOwn reads 'own', declared only on the subclass -- cannot push up."
	ref := self push: #usesOwn.

	self assert: (ref declineFor: #usesOwn) notNil.
	self assert: (ref declineFor: #usesOwn) includesSubstring: 'instance variable'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - side' }
GsPushUpMethodRefactoringTest >> testClassSideMethodPushesUp [
	| ref cs add remove |
	ref := GsPushUpMethodRefactoring
		sourceClass: self subFixture
		selectors: (Array with: #buildOne)
		meta: true.
	cs := ref changeSet.
	add := self addChangeFor: #buildOne in: cs.
	remove := self removeChangeFor: #buildOne in: cs.

	self assert: cs size equals: 2.
	self assert: add isMeta.
	self assert: add className equals: 'GsPUSuper'.
	self assert: remove isMeta.
	self assert: remove className equals: 'GsPUSub'
]

{ #category : 'tests - multi' }
GsPushUpMethodRefactoringTest >> testMultiPushMovesMovableAndSkipsDeclined [
	| ref cs |
	ref := self pushSelectors: #(#pureCompute #callsSuper #greet).
	cs := ref changeSet.

	"pureCompute + greet move (2 changes each); callsSuper is skipped"
	self assert: cs size equals: 4.
	self assert: (self addChangeFor: #pureCompute in: cs) notNil.
	self assert: (self addChangeFor: #greet in: cs) notNil.
	self assert: (self addChangeFor: #callsSuper in: cs) isNil.
	self assert: (ref declineFor: #callsSuper) notNil
]

{ #category : 'tests - preflight' }
GsPushUpMethodRefactoringTest >> testAnalysisPreflightReportsTargetPerSelectorAndMovableCount [
	| json |
	json := GsPushUpMethodRefactoring
		analyzeForClass: self subFixture
		selectors: #(#pureCompute #callsSuper)
		meta: false.

	self assert: json includesSubstring: '"targetClass":"GsPUSuper"'.
	self assert: json includesSubstring: '"movableCount":1'.
	self assert: json includesSubstring: '"selector":"pureCompute"'.
	self assert: json includesSubstring: '"selector":"callsSuper"'
]

{ #category : 'tests - staging' }
GsPushUpMethodRefactoringTest >> testBuildingChangeSetCompilesNothingAndDoesNotCommit [
	| before |
	before := System needsCommit.
	(self push: #pureCompute) changeSet.

	"subclass still has it; superclass does not; nothing committed"
	self assert: (self subFixture includesSelector: #pureCompute).
	self deny: (self superFixture includesSelector: #pureCompute).
	self assert: System needsCommit equals: before
]

{ #category : 'tests - preview' }
GsPushUpMethodRefactoringTest >> testPreviewJsonSerializesAddAndRemove [
	| json |
	json := (self push: #pureCompute) previewJsonString.

	self assert: json includesSubstring: 'methodAdd'.
	self assert: json includesSubstring: 'methodRemove'
]

{ #category : 'tests - preview' }
GsPushUpMethodRefactoringTest >> testPreviewJsonEscapesQuoteAndBackslash [
	"A source containing a double-quote and a backslash must be JSON-escaped by the engine's
	 jsonEscape: (backslash-quote and backslash-backslash), or the client JSON.parse chokes."
	| json |
	json := (self push: #quoteAndBackslash) previewJsonString.

	self assert: json includesSubstring: '\"'.
	self assert: json includesSubstring: '\\'
]

{ #category : 'tests - preview' }
GsPushUpMethodRefactoringTest >> testPaginationSpansMultiplePages [
	"With a tiny byte budget the preview pages one change at a time: the first page reports
	 done:false + the next offset, and a later page reports done:true. Exercises the engine's
	 real byte-bounded slicing, not just a single all-in-one page."
	| ref first |
	ref := self pushSelectors: #(#pureCompute #greet #usesShared).
	ref startPreviewToken: 'm7pg' maxBytes: 1.
	[first := GsPushUpMethodRefactoring pageForToken: 'm7pg' from: 1 maxBytes: 1.
	 self assert: first includesSubstring: '"done":false'.
	 self assert: first includesSubstring: '"nextOffset":2'.
	 self assert: (GsPushUpMethodRefactoring pageForToken: 'm7pg' from: 6 maxBytes: 1)
		includesSubstring: '"done":true']
		ensure: [GsPushUpMethodRefactoring clearToken: 'm7pg']
]

{ #category : 'tests - creation' }
GsPushUpMethodRefactoringTest >> testEnvironmentCtorSetsEnvironment [
	"The environment:sourceClass:selectors:meta: creation path stores the supplied
	 environment (used for symbol-dict / multi-environment scope) and still builds."
	| env ref |
	env := GsRefactoringEnvironment new.
	ref := GsPushUpMethodRefactoring
		environment: env
		sourceClass: self subFixture
		selectors: #(#pureCompute)
		meta: false.

	self assert: ref environment == env.
	self assert: ref changeSet size equals: 2
]

{ #category : 'tests - preview' }
GsPushUpMethodRefactoringTest >> testStartPreviewCarriesTotalsAndPage [
	| json |
	json := (self push: #pureCompute)
		startPreviewToken: 'm7Tok' maxBytes: 100000.
	[self assert: json includesSubstring: '"targetClass":"GsPUSuper"'.
	 self assert: json includesSubstring: '"total":2'.
	 self assert: json includesSubstring: '"movableCount":1'.
	 self assert: json includesSubstring: '"changes":']
		ensure: [GsPushUpMethodRefactoring clearToken: 'm7Tok']
]

{ #category : 'tests - apply' }
GsPushUpMethodRefactoringTest >> testApplyRelocatesMethodAndRemovesFromSource [
	| json |
	json := (self push: #pureCompute) applyDeselected: #().

	self assert: json includesSubstring: '"applied":2'.
	self assert: (self superFixture includesSelector: #pureCompute).
	self deny: (self subFixture includesSelector: #pureCompute)
]

{ #category : 'tests - apply' }
GsPushUpMethodRefactoringTest >> testApplyKeepsTheSourceMethodWhenTheSuperclassCompileFails [
	"The apply compiles onto the superclass and THEN removes the source, guarding the removal
	 on the applied-add set. compileMethod: answers its errors rather than raising, so an
	 unchecked add recorded the selector as applied regardless -- a method that would not
	 compile on the superclass was stripped from the subclass anyway, leaving it on NEITHER
	 class while the apply reported success. Make the pushed method un-compilable by removing
	 a global it was compiled against: the failure must be reported, and the subclass must
	 still hold the method."
	| json |
	UserGlobals at: #GsPUGone put: 7.
	self compile: 'usesGone ^GsPUGone' in: self subFixture.
	UserGlobals removeKey: #GsPUGone.

	json := (self push: #usesGone) applyDeselected: #().

	self deny: json includesSubstring: '"failed":[]'.
	self assert: json includesSubstring: 'did not recompile'.
	"Name the METHOD, not the owning class -- the failure list is what the user opens to go fix."
	self assert: json includesSubstring: 'GsPUSuper>>usesGone'.
	"The whole point: the method survives on the subclass and never lands on the superclass."
	self assert: (self subFixture includesSelector: #usesGone).
	self deny: (self superFixture includesSelector: #usesGone)
]

{ #category : 'tests - apply' }
GsPushUpMethodRefactoringTest >> testApplyDoesNotCommit [
	| before |
	before := System needsCommit.
	(self push: #pureCompute) applyDeselected: #().

	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsPushUpMethodRefactoringTest >> testDeselectingAddGuardsTheRemove [
	"Unticking the #methodAdd must NOT strand the method: the guarded remove is
	 skipped because the superclass never received the method."
	| ref cs addId |
	ref := self push: #pureCompute.
	cs := ref changeSet.
	addId := (self addChangeFor: #pureCompute in: cs) id.
	ref applyDeselected: (Array with: addId).

	self assert: (self subFixture includesSelector: #pureCompute).
	self deny: (self superFixture includesSelector: #pureCompute)
]

{ #category : 'tests - apply' }
GsPushUpMethodRefactoringTest >> testTokenRoundTripStartThenApply [
	| ref json before |
	before := System needsCommit.
	ref := self push: #pureCompute.
	ref startPreviewToken: 'm7rt' maxBytes: 100000.
	[json := GsPushUpMethodRefactoring applyForToken: 'm7rt' deselected: #().
	 self assert: json includesSubstring: '"applied":2'.
	 self assert: (self superFixture includesSelector: #pureCompute).
	 self assert: System needsCommit equals: before]
		ensure: [GsPushUpMethodRefactoring clearToken: 'm7rt']
]

{ #category : 'tests - apply' }
GsPushUpMethodRefactoringTest >> testApplyForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsPushUpMethodRefactoring applyForToken: 'nope' deselected: #())
		includesSubstring: 'expired'
]

{ #category : 'tests - apply' }
GsPushUpMethodRefactoringTest >> testPageForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsPushUpMethodRefactoring pageForToken: 'nope' from: 1 maxBytes: 100)
		includesSubstring: 'expired'
]
