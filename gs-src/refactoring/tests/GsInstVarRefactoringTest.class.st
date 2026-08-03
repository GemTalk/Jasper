"
Correctness of the add / remove instance-variable refactoring (catalog V1):

  - #add appends the variable to the class definition, versions the whole subtree, and declines a
    duplicate/inherited name, an invalid name, or a name that would shadow a class variable;
  - #remove drops the variable and reports every method (defining class and descendants) that will
    no longer recompile because it accessed the variable;
  - class options are preserved across the new version (the earlier engines dropped them) and can be
    replaced with a user-edited set for the acted-on class;
  - applying (with neither migrate nor delete-history) never commits, and a method that references a
    removed variable is dropped and reported.

setUp builds a throwaway hierarchy (GsIVBase -> GsIVSub -> GsIVLeaf) in UserGlobals; tearDown removes
it. Applying an operation creates new, uncommitted class versions; nothing here commits. The
delete-history STEP (deletePriorVersionsOf:) is exercised no-commit against a just-applied version;
the full committing migrate / delete-history round trip (which needs a clean committed transaction)
is exercised via the GCI e2e (gciInstVar.e2e.test.ts).
"
Class {
	#name : 'GsInstVarRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsInstVarRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'asserting' }
GsInstVarRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'asserting' }
GsInstVarRefactoringTest >> assert: aCollection includesItem: anObject [
	self assert: (aCollection includes: anObject)
]

{ #category : 'asserting' }
GsInstVarRefactoringTest >> deny: aCollection includesItem: anObject [
	self deny: (aCollection includes: anObject)
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> base [
	^UserGlobals at: #GsIVBase
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> sub [
	^UserGlobals at: #GsIVSub
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> leaf [
	^UserGlobals at: #GsIVLeaf
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> compile: aSource in: aClass [
	aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture'
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> classDefinitionEditFor: aName in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #classDefinitionEdit and: [c className asString = aName]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> add: aName [
	^GsInstVarRefactoring class: self base addInstVar: aName
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> remove: aName [
	^GsInstVarRefactoring class: self base removeInstVar: aName
]

{ #category : 'running' }
GsInstVarRefactoringTest >> setUp [
	| base sub leaf |
	super setUp.
	base := Object
		subclass: 'GsIVBase'
		instVarNames: #('count' 'other')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsIVSub'
		instVarNames: #('subOwn')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	leaf := sub
		subclass: 'GsIVLeaf'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'combine ^count + other' in: base.
	self compile: 'getOther ^other' in: base.
	self compile: 'doubleCount ^count * 2' in: sub.
	self compile: 'readSubOwn ^subOwn' in: sub.
	self compile: 'leafCount ^count negated' in: leaf
]

{ #category : 'running' }
GsInstVarRefactoringTest >> tearDown [
	#('GsIVLeaf' 'GsIVSub' 'GsIVBase')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddStagesClassDefinitionEditWithNewIvar [
	| change |
	change := self classDefinitionEditFor: 'GsIVBase' in: (self add: 'tally') changeSet.
	self assert: change notNil.
	self assert: change newSource includesSubstring: 'tally'.
	self assert: change newSource includesSubstring: 'count'.
	self assert: change oldSource includesSubstring: 'count'.
	self deny: change oldSource includesSubstring: 'tally'
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddVersionsTheWholeSubtree [
	"base's shape changes, so base + sub + leaf are all recompiled and nothing else is."
	| cs names |
	cs := (self add: 'tally') changeSet.
	names := cs changes collect: [:c | c className asString].
	self assert: names includesItem: 'GsIVBase'.
	self assert: names includesItem: 'GsIVSub'.
	self assert: names includesItem: 'GsIVLeaf'.
	self assert: cs size equals: 3
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddDeclinesDuplicateOwnName [
	self assert: (self add: 'count') decline notNil
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddDeclinesInheritedName [
	"count is inherited by the subclass, so adding it there is also a duplicate."
	self assert: (GsInstVarRefactoring class: self sub addInstVar: 'count') decline notNil
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddDeclinesInvalidName [
	self assert: (self add: '9bad') decline notNil.
	self assert: (self add: 'has space') decline notNil.
	self assert: (self add: '') decline notNil
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddDeclinesClassVariableShadow [
	| withCvar |
	withCvar := Object
		subclass: 'GsIVCv'
		instVarNames: #()
		classVars: #('Shared')
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	[self assert: (GsInstVarRefactoring class: withCvar addInstVar: 'Shared') decline notNil]
		ensure: [UserGlobals removeKey: #GsIVCv ifAbsent: []]
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddDeclinesInheritedClassVariableShadow [
	"A class variable declared on a SUPERCLASS is still visible to the subclass, so adding an
	 instance variable of that name on the subclass would shadow it and is declined."
	| sup sub |
	sup := Object
		subclass: 'GsIVCvSup'
		instVarNames: #()
		classVars: #('Shared')
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := sup
		subclass: 'GsIVCvSub'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	[self assert: (GsInstVarRefactoring class: sub addInstVar: 'Shared') decline notNil]
		ensure: [#('GsIVCvSub' 'GsIVCvSup') do: [:n | UserGlobals removeKey: n asSymbol ifAbsent: []]]
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddHasNoWillNotRecompile [
	self assert: (self add: 'tally') willNotRecompileSelectorCount equals: 0
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testUnknownOperationDeclines [
	"A refactoring built with an operation other than #add / #remove declines rather than acting."
	| ref |
	ref := GsInstVarRefactoring new
		setEnvironment: GsRefactoringEnvironment new
		operation: #frobnicate
		class: self base
		varName: 'x'.
	self assert: ref decline notNil.
	self assert: ref decline includesSubstring: 'Unknown operation'
]

{ #category : 'tests - remove' }
GsInstVarRefactoringTest >> testRemoveStagesClassDefinitionEditDroppingIvar [
	| change |
	change := self classDefinitionEditFor: 'GsIVBase' in: (self remove: 'count') changeSet.
	self assert: change notNil.
	self assert: change newSource includesSubstring: 'other'.
	self deny: change newSource includesSubstring: 'count'
]

{ #category : 'tests - remove' }
GsInstVarRefactoringTest >> testRemoveDeclinesNonOwnIvar [
	"'count' is inherited by the subclass, not owned; only its declaring class can remove it."
	self assert: (GsInstVarRefactoring class: self sub removeInstVar: 'count') decline notNil.
	self assert: (self remove: 'missing') decline notNil
]

{ #category : 'tests - remove' }
GsInstVarRefactoringTest >> testRemoveListsEveryMethodThatWillNotRecompile [
	"combine (base), doubleCount (sub), leafCount (leaf) all read count and will lose it; getOther
	 reads only other and survives."
	| refactoring |
	refactoring := self remove: 'count'.
	refactoring decline.
	self assert: refactoring willNotRecompileSelectorCount equals: 3.
	self assert: refactoring willNotRecompileJsonString includesSubstring: 'combine'.
	self assert: refactoring willNotRecompileJsonString includesSubstring: 'doubleCount'.
	self assert: refactoring willNotRecompileJsonString includesSubstring: 'leafCount'.
	self deny: refactoring willNotRecompileJsonString includesSubstring: 'getOther'
]

{ #category : 'tests - remove' }
GsInstVarRefactoringTest >> testRemoveCleanIvarDropsNothing [
	"Removing an instance variable that no method references reports nothing will-not-recompile and
	 drops no method; the still-referenced sibling ivar and its accessor survive."
	| cls ref result |
	cls := Object
		subclass: 'GsIVClean'
		instVarNames: #('used' 'unused')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'readUsed ^used' in: cls.
	[ref := GsInstVarRefactoring class: cls removeInstVar: 'unused'.
	 self assert: ref willNotRecompileSelectorCount equals: 0.
	 result := ref applyDeselected: #() options: nil migrate: false deleteHistory: false.
	 self assert: result includesSubstring: '"dropped":[]'.
	 self deny: ((UserGlobals at: #GsIVClean) instVarNames includes: #unused).
	 self assert: ((UserGlobals at: #GsIVClean) includesSelector: #readUsed)]
		ensure: [UserGlobals removeKey: #GsIVClean ifAbsent: []]
]

{ #category : 'tests - json' }
GsInstVarRefactoringTest >> testAnalysisJsonStringShape [
	| json |
	json := GsInstVarRefactoring analyzeClass: self base addInstVar: 'tally'.
	self assert: json includesSubstring: '"decline":null'.
	self assert: json includesSubstring: '"operation":"add"'.
	self assert: json includesSubstring: '"sourceClass":"GsIVBase"'.
	self assert: json includesSubstring: '"affectedCount":3'
]

{ #category : 'tests - json' }
GsInstVarRefactoringTest >> testAnalysisJsonStringReportsDecline [
	| json |
	json := GsInstVarRefactoring analyzeClass: self base addInstVar: 'count'.
	self deny: json includesSubstring: '"decline":null'
]

{ #category : 'tests - json' }
GsInstVarRefactoringTest >> testOutOfScopeJsonCarriesWarningsAndCommitNote [
	| refactoring json |
	refactoring := self remove: 'count'.
	json := refactoring outOfScopeJsonString.
	self assert: json includesSubstring: '"willNotRecompile":'.
	self assert: json includesSubstring: 'commit'.
	self assert: json includesSubstring: '"actedOnClass":"GsIVBase"'
]

{ #category : 'tests - json' }
GsInstVarRefactoringTest >> testPreviewJsonSerializesChangeSet [
	| json |
	json := (self add: 'tally') previewJsonString.
	self assert: (json isKindOf: String).
	self assert: json includesSubstring: 'classDefinitionEdit'.
	self assert: json includesSubstring: 'classReparent'
]

{ #category : 'tests - json' }
GsInstVarRefactoringTest >> testStartPreviewTokenStoresSelfAndPaginates [
	| refactoring start page |
	refactoring := self add: 'tally'.
	start := refactoring startPreviewToken: 'gsivtok1' maxBytes: 100000.
	self assert: start includesSubstring: '"token":"gsivtok1"'.
	self assert: start includesSubstring: '"total":3'.
	page := GsInstVarRefactoring pageForToken: 'gsivtok1' from: 1 maxBytes: 100000.
	self assert: page includesSubstring: 'classDefinitionEdit'.
	GsInstVarRefactoring clearToken: 'gsivtok1'.
	self assert: (GsInstVarRefactoring pageForToken: 'gsivtok1' from: 1 maxBytes: 100) includesSubstring: 'expired'
]

{ #category : 'tests - json' }
GsInstVarRefactoringTest >> testPaginatedPreviewReturnsBoundedPages [
	"A tiny byte budget yields one change per page: the first page is not done and points at the
	 next offset; fetching from the last change reports done."
	| ref total first last |
	ref := self add: 'tally'.
	total := ref changeSet size.
	self assert: total > 1.

	first := ref pageJsonFrom: 1 maxBytes: 1.
	self assert: first includesSubstring: '"nextOffset":2'.
	self assert: first includesSubstring: '"done":false'.

	last := ref pageJsonFrom: total maxBytes: 1000000.
	self assert: last includesSubstring: '"done":true'
]

{ #category : 'tests - no commit' }
GsInstVarRefactoringTest >> testBuildingChangeSetDoesNotCommit [
	| before |
	before := System needsCommit.
	self add: 'tally'.
	self remove: 'count'.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyAddInstallsNewVersionWithIvar [
	| refactoring result |
	refactoring := self add: 'tally'.
	result := refactoring applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self assert: result includesSubstring: '"committed":false'.
	self assert: (self base instVarNames includes: #tally).
	self assert: ((self sub new) class allInstVarNames includes: #tally)
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyPreservesClassOptions [
	"The acted-on class's options must survive the new version (the bug the earlier engines had:
	 they passed options: #() and dropped them)."
	| optioned refactoring |
	optioned := Object
		_subclass: 'GsIVOpt'
		instVarNames: #('a')
		format: Object format
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals
		inClassHistory: nil
		description: ''
		options: #(#disallowGciStore).
	[refactoring := GsInstVarRefactoring class: optioned addInstVar: 'b'.
	 refactoring applyDeselected: #() options: nil migrate: false deleteHistory: false.
	 self assert: ((UserGlobals at: #GsIVOpt) _optionsArray includes: #disallowGciStore)]
		ensure: [UserGlobals removeKey: #GsIVOpt ifAbsent: []]
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyEditsClassOptions [
	| optioned refactoring |
	optioned := Object
		_subclass: 'GsIVOpt2'
		instVarNames: #('a')
		format: Object format
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals
		inClassHistory: nil
		description: ''
		options: #().
	[refactoring := GsInstVarRefactoring class: optioned addInstVar: 'b'.
	 refactoring applyDeselected: #() options: #('disallowGciStore') migrate: false deleteHistory: false.
	 self assert: ((UserGlobals at: #GsIVOpt2) _optionsArray includes: #disallowGciStore)]
		ensure: [UserGlobals removeKey: #GsIVOpt2 ifAbsent: []]
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyReparentsSubclassesKeepingOwnMethods [
	"Reshaping the base versions the whole subtree: every descendant is re-parented onto the new
	 version of its superclass and keeps its own methods."
	| ref |
	ref := self add: 'tally'.
	ref applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self assert: self sub superclass == self base.
	self assert: (self sub includesSelector: #readSubOwn).
	self assert: (self sub includesSelector: #doubleCount).
	self assert: self leaf superclass == self sub.
	self assert: (self leaf includesSelector: #leafCount)
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyIgnoresDeselectionApplyingAllChanges [
	"An instance-variable add/remove is all-or-nothing: the shape edit and the descendant reparents
	 must move together, so a deselection is ignored and every staged change is still applied."
	| ref result |
	ref := self add: 'tally'.
	result := ref
		applyDeselected: #('bogus-id-1' 'bogus-id-2')
		options: nil
		migrate: false
		deleteHistory: false.
	self assert: result includesSubstring: '"applied":3'.
	self assert: (self base instVarNames includes: #tally).
	self assert: self sub superclass == self base
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testDeleteHistoryTrimsPriorVersionsToCurrent [
	"Applying versions the acted-on class, so its history gains the prior version;
	 deletePriorVersionsOf: (the delete-history step) then trims that history down to just the
	 current version. Exercised WITHOUT committing (setUp's fixture is abort-restored); the full
	 committing migrate / delete-history round trip is exercised via the GCI e2e, since it needs a
	 clean, committed transaction and so cannot run in a no-commit SUnit test."
	| refactoring current |
	refactoring := self add: 'tally'.
	refactoring applyDeselected: #() options: nil migrate: false deleteHistory: false.
	current := self base.
	self assert: current classHistory size >= 2.

	refactoring deletePriorVersionsOf: current.
	self assert: current classHistory size equals: 1.
	self assert: (current classHistory at: 1) == current
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyRemoveDropsBrokenMethodsAndReportsThem [
	| refactoring result |
	refactoring := self remove: 'count'.
	result := refactoring applyDeselected: #() options: nil migrate: false deleteHistory: false.
	"combine, doubleCount, leafCount reference count -> dropped; getOther survives."
	self assert: result includesSubstring: '"dropped":'.
	self assert: result includesSubstring: 'combine'.
	self assert: (self base compiledMethodAt: #combine environmentId: 0 otherwise: nil) isNil.
	self assert: (self base compiledMethodAt: #getOther environmentId: 0 otherwise: nil) notNil.
	self deny: (self base instVarNames includes: #count)
]
