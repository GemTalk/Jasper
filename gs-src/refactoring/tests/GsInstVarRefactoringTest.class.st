"
Correctness of the add / remove / move instance-variable refactoring (catalog V1 + V4):

  - #add appends the variable to the class definition, versions the whole subtree, and declines a
    duplicate/inherited name, an invalid name, or a name that would shadow a class variable;
  - #remove drops the variable and reports every method (defining class and descendants) that will
    no longer recompile because it accessed the variable;
  - #move relocates the variable from a source class to a target class, declines when the target
    already has it (own or inherited) or when source == target, and reports the methods that lose
    the variable -- none when the target is the source's superclass (the push-up case);
  - class options are preserved across the new version (the earlier engines dropped them) and can be
    replaced with a user-edited set for the acted-on class;
  - applying (with neither migrate nor delete-history) never commits, and a method that references a
    removed variable is dropped and reported.

setUp builds a throwaway hierarchy (GsIVBase -> GsIVSub -> GsIVLeaf) plus an unrelated GsIVOther in
UserGlobals; tearDown removes them. Applying an operation creates new, uncommitted class versions;
nothing here commits (migrate / delete-history, which do commit, are exercised by a separate probe).
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
GsInstVarRefactoringTest >> other [
	^UserGlobals at: #GsIVOther
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

{ #category : 'fixture' }
GsInstVarRefactoringTest >> move: aName from: srcClass to: dstClass [
	^GsInstVarRefactoring class: srcClass moveInstVar: aName toClass: dstClass
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
	Object
		subclass: 'GsIVOther'
		instVarNames: #('kept')
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
	#('GsIVLeaf' 'GsIVSub' 'GsIVBase' 'GsIVOther')
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
	"base's shape changes, so base + sub + leaf are all recompiled; the unrelated GsIVOther is not."
	| cs names |
	cs := (self add: 'tally') changeSet.
	names := cs changes collect: [:c | c className asString].
	self assert: names includesItem: 'GsIVBase'.
	self assert: names includesItem: 'GsIVSub'.
	self assert: names includesItem: 'GsIVLeaf'.
	self deny: names includesItem: 'GsIVOther'.
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
GsInstVarRefactoringTest >> testAddHasNoWillNotRecompile [
	self assert: (self add: 'tally') willNotRecompileSelectorCount equals: 0
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

{ #category : 'tests - move' }
GsInstVarRefactoringTest >> testMoveStagesEditsOnSourceAndTarget [
	| cs srcEdit dstEdit |
	cs := (self move: 'count' from: self base to: self other) changeSet.
	srcEdit := self classDefinitionEditFor: 'GsIVBase' in: cs.
	dstEdit := self classDefinitionEditFor: 'GsIVOther' in: cs.
	self assert: srcEdit notNil.
	self deny: srcEdit newSource includesSubstring: 'count'.
	self assert: dstEdit notNil.
	self assert: dstEdit newSource includesSubstring: 'count'.
	self assert: dstEdit newSource includesSubstring: 'kept'
]

{ #category : 'tests - move' }
GsInstVarRefactoringTest >> testMoveDeclinesWhenTargetAlreadyHasIvar [
	"the target already declaring the name -- own or inherited -- is a collision."
	| target |
	target := Object
		subclass: 'GsIVHasCount'
		instVarNames: #('count')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	[self assert: (self move: 'count' from: self base to: target) decline notNil]
		ensure: [UserGlobals removeKey: #GsIVHasCount ifAbsent: []].
	"moving into a subclass that inherits count is likewise a collision."
	self assert: (self move: 'count' from: self base to: self sub) decline notNil
]

{ #category : 'tests - move' }
GsInstVarRefactoringTest >> testMoveDeclinesSameClassAndNonOwnAndNilTarget [
	self assert: (self move: 'count' from: self base to: self base) decline notNil.
	self assert: (self move: 'count' from: self sub to: self other) decline notNil.
	self assert: (GsInstVarRefactoring class: self base moveInstVar: 'count' toClass: nil) decline notNil
]

{ #category : 'tests - move' }
GsInstVarRefactoringTest >> testMoveToUnrelatedClassListsBrokenMethods [
	"moving count to the unrelated GsIVOther leaves every method that read it undeclared."
	| refactoring |
	refactoring := self move: 'count' from: self base to: self other.
	refactoring decline.
	self assert: refactoring willNotRecompileSelectorCount equals: 3
]

{ #category : 'tests - move' }
GsInstVarRefactoringTest >> testMoveToSuperclassBreaksNothing [
	"Moving the subclass's own ivar UP to its immediate superclass (push up): the subclass still
	 inherits it, so no method that read it loses it -- willNotRecompile is empty."
	| refactoring |
	refactoring := self move: 'subOwn' from: self sub to: self base.
	refactoring decline.
	self assert: refactoring willNotRecompileSelectorCount equals: 0.
	"and readSubOwn is NOT reported broken."
	self deny: refactoring willNotRecompileJsonString includesSubstring: 'readSubOwn'
]

{ #category : 'tests - move' }
GsInstVarRefactoringTest >> testMoveAffectedIncludesBothSubtrees [
	| names |
	names := ((self move: 'count' from: self base to: self other) changeSet changes
		collect: [:c | c className asString]) asArray.
	self assert: names includesItem: 'GsIVBase'.
	self assert: names includesItem: 'GsIVSub'.
	self assert: names includesItem: 'GsIVLeaf'.
	self assert: names includesItem: 'GsIVOther'
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
GsInstVarRefactoringTest >> testOutOfScopeJsonCarriesOptionsAndCommitNote [
	| refactoring json |
	refactoring := self remove: 'count'.
	json := refactoring outOfScopeJsonString.
	self assert: json includesSubstring: '"willNotRecompile":'.
	self assert: json includesSubstring: '"currentOptions":'.
	self assert: json includesSubstring: '"optionVocabulary":'.
	self assert: json includesSubstring: 'instancesInvariant'.
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

{ #category : 'tests - no commit' }
GsInstVarRefactoringTest >> testBuildingChangeSetDoesNotCommit [
	| before |
	before := System needsCommit.
	self add: 'tally'.
	self remove: 'count'.
	self move: 'count' from: self base to: self other.
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

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyMoveRelocatesIvar [
	| refactoring |
	refactoring := self move: 'count' from: self base to: self other.
	refactoring applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self deny: (self base instVarNames includes: #count).
	self assert: (self other instVarNames includes: #count).
	self assert: (self other instVarNames includes: #kept)
]
