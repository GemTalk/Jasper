"
Correctness of the instance-variable structure refactorings (V2 push up, V3 push down, V5
convert temporary to instance variable). Each edits one or more class definitions' own-instVar
lists, which -- because GemStone has no addInstVarName:/removeInstVarName: -- means creating a
new class version (empty method dictionary, subclasses not auto-reparented). So the apply, for
every affected class top-down, creates a new version with its computed own-instVar list, copies
its methods forward, and re-parents it under the new parent chain (the R3 newVersionOf:
mechanism).

This suite pins down, on a Base -> Mid -> {Leaf, Leaf2} hierarchy:

  - V5: converting a method temporary adds it as an instance variable and drops its
    declaration from the method; declines when the name is already an instance variable or is
    not a method-level temporary;
  - V2: pushing an own ivar up moves it to the immediate superclass (superclass gains it, the
    class loses it, siblings still inherit); declines when the name is not the class's own ivar
    or when a sibling already declares the same name (collision on inherit);
  - V3: pushing an own ivar down moves it into every immediate subclass and removes it from the
    class; declines when the class still uses the ivar in its own methods or has no subclasses;
  - across all three: the whole subtree's METHODS survive the reversioning, the subtree stays
    correctly parented, and building compiles/commits nothing.

setUp builds the throwaway hierarchy in UserGlobals; tearDown removes it.
"
Class {
	#name : 'GsInstVarStructureRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsInstVarStructureRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'asserting' }
GsInstVarStructureRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'asserting' }
GsInstVarStructureRefactoringTest >> assert: aCollection includes: anObject [
	self assert: (aCollection includes: anObject)
]

{ #category : 'asserting' }
GsInstVarStructureRefactoringTest >> deny: aCollection includes: anObject [
	self assert: (aCollection includes: anObject) not
]

{ #category : 'fixture' }
GsInstVarStructureRefactoringTest >> compile: aSource in: aClass [
	[aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture']
		on: CompileWarning
		do: [:ex | ex resume: nil]
]

{ #category : 'fixture' }
GsInstVarStructureRefactoringTest >> classNamed: aName [
	^UserGlobals at: aName asSymbol
]

{ #category : 'fixture' }
GsInstVarStructureRefactoringTest >> ownIvarsOf: aName [
	^(self classNamed: aName) instVarNames collect: [:e | e asString]
]

{ #category : 'fixture' }
GsInstVarStructureRefactoringTest >> allIvarsOf: aName [
	^(self classNamed: aName) allInstVarNames collect: [:e | e asString]
]

{ #category : 'fixture' }
GsInstVarStructureRefactoringTest >> editChangeFor: aName in: cs [
	^cs changes
		detect: [:c | c kind = #classDefinitionEdit and: [c className = aName]]
		ifNone: [nil]
]

{ #category : 'running' }
GsInstVarStructureRefactoringTest >> setUp [
	| base mid |
	base := Object
		subclass: 'GsVSBase'
		instVarNames: #('shared')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	mid := base
		subclass: 'GsVSMid'
		instVarNames: #('mid' 'pushable')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	mid
		subclass: 'GsVSLeaf'
		instVarNames: #('leaf' 'dup')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	mid
		subclass: 'GsVSLeaf2'
		instVarNames: #('dup')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'baseM ^ shared' in: base.
	self compile: 'compute | t | t := shared. ^ t' in: base.
	self compile: 'midM ^ mid' in: mid.
	self compile: 'leafM ^ leaf' in: (self classNamed: 'GsVSLeaf')
]

{ #category : 'running' }
GsInstVarStructureRefactoringTest >> tearDown [
	#('GsVSLeaf' 'GsVSLeaf2' 'GsVSMid' 'GsVSBase')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests - V5 convert temp' }
GsInstVarStructureRefactoringTest >> testConvertTempStagesIvarEditAndMethodRecompile [
	| ref cs edit recompile |
	ref := GsInstVarStructureRefactoring
		class: (self classNamed: 'GsVSBase') convertTemporary: 't' inMethod: #compute meta: false.
	cs := ref changeSet.
	edit := self editChangeFor: 'GsVSBase' in: cs.
	recompile := cs changes detect: [:c | c kind = #methodRecompile] ifNone: [nil].

	self assert: (ref decline) isNil.
	self assert: edit notNil.
	self assert: edit newSource includesSubstring: '''t'''.
	self assert: recompile notNil.
	self deny: recompile newSource includesSubstring: '| t |'
]

{ #category : 'tests - V5 convert temp' }
GsInstVarStructureRefactoringTest >> testConvertTempAppliesAddingIvarAndDroppingDecl [
	| json |
	json := (GsInstVarStructureRefactoring
		class: (self classNamed: 'GsVSBase') convertTemporary: 't' inMethod: #compute meta: false)
		applyDeselected: #().

	self deny: json includesSubstring: '"failed":[{'.
	self assert: (self ownIvarsOf: 'GsVSBase') includes: 't'.
	self deny: (((self classNamed: 'GsVSBase') compiledMethodAt: #compute environmentId: 0 otherwise: nil) sourceString) includesSubstring: '| t |'.
	"the subtree survived the reversioning"
	self assert: ((self classNamed: 'GsVSBase') includesSelector: #baseM).
	self assert: ((self classNamed: 'GsVSMid') includesSelector: #midM).
	self assert: ((self classNamed: 'GsVSLeaf') includesSelector: #leafM).
	self assert: (self allIvarsOf: 'GsVSLeaf') includes: 't'
]

{ #category : 'tests - V5 convert temp' }
GsInstVarStructureRefactoringTest >> testConvertTempDeclinesWhenAlreadyAnIvar [
	| ref |
	ref := GsInstVarStructureRefactoring
		class: (self classNamed: 'GsVSBase') convertTemporary: 'shared' inMethod: #baseM meta: false.

	self assert: ref decline notNil.
	self assert: ref decline includesSubstring: 'already an instance variable'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - V5 convert temp' }
GsInstVarStructureRefactoringTest >> testConvertTempDeclinesWhenNotATemporary [
	| ref |
	ref := GsInstVarStructureRefactoring
		class: (self classNamed: 'GsVSBase') convertTemporary: 'nope' inMethod: #compute meta: false.

	self assert: ref decline notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - V2 push up' }
GsInstVarStructureRefactoringTest >> testPushUpMovesIvarToSuperclass [
	| ref cs |
	ref := GsInstVarStructureRefactoring class: (self classNamed: 'GsVSLeaf') pushUpInstVar: 'leaf'.
	cs := ref changeSet.

	self assert: ref decline isNil.
	self assert: (self editChangeFor: 'GsVSMid' in: cs) notNil.
	self assert: (self editChangeFor: 'GsVSLeaf' in: cs) notNil
]

{ #category : 'tests - V2 push up' }
GsInstVarStructureRefactoringTest >> testPushUpAppliesMovingTheDeclaration [
	| json |
	json := (GsInstVarStructureRefactoring class: (self classNamed: 'GsVSLeaf') pushUpInstVar: 'leaf')
		applyDeselected: #().

	self deny: json includesSubstring: '"failed":[{'.
	self assert: (self ownIvarsOf: 'GsVSMid') includes: 'leaf'.
	self deny: (self ownIvarsOf: 'GsVSLeaf') includes: 'leaf'.
	self assert: (self allIvarsOf: 'GsVSLeaf') includes: 'leaf'.
	self assert: ((self classNamed: 'GsVSLeaf') includesSelector: #leafM).
	self assert: ((self classNamed: 'GsVSMid') includesSelector: #midM)
]

{ #category : 'tests - V2 push up' }
GsInstVarStructureRefactoringTest >> testPushUpDeclinesWhenNotAnOwnIvar [
	| ref |
	"shared is inherited by Leaf, not declared on it."
	ref := GsInstVarStructureRefactoring class: (self classNamed: 'GsVSLeaf') pushUpInstVar: 'shared'.

	self assert: ref decline notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - V2 push up' }
GsInstVarStructureRefactoringTest >> testPushUpDeclinesOnSiblingCollision [
	| ref |
	"Both Leaf and Leaf2 declare 'dup'; pushing Leaf's up to Mid would collide on Leaf2."
	ref := GsInstVarStructureRefactoring class: (self classNamed: 'GsVSLeaf') pushUpInstVar: 'dup'.

	self assert: ref decline notNil.
	self assert: ref decline includesSubstring: 'collide'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - V3 push down' }
GsInstVarStructureRefactoringTest >> testPushDownMovesIvarIntoEverySubclass [
	| ref cs |
	ref := GsInstVarStructureRefactoring class: (self classNamed: 'GsVSMid') pushDownInstVar: 'pushable'.
	cs := ref changeSet.

	self assert: ref decline isNil.
	self assert: (self editChangeFor: 'GsVSMid' in: cs) notNil.
	self assert: (self editChangeFor: 'GsVSLeaf' in: cs) notNil.
	self assert: (self editChangeFor: 'GsVSLeaf2' in: cs) notNil
]

{ #category : 'tests - V3 push down' }
GsInstVarStructureRefactoringTest >> testPushDownAppliesMovingTheDeclaration [
	| json |
	json := (GsInstVarStructureRefactoring class: (self classNamed: 'GsVSMid') pushDownInstVar: 'pushable')
		applyDeselected: #().

	self deny: json includesSubstring: '"failed":[{'.
	self deny: (self ownIvarsOf: 'GsVSMid') includes: 'pushable'.
	self assert: (self ownIvarsOf: 'GsVSLeaf') includes: 'pushable'.
	self assert: (self ownIvarsOf: 'GsVSLeaf2') includes: 'pushable'.
	self assert: ((self classNamed: 'GsVSMid') includesSelector: #midM).
	self assert: ((self classNamed: 'GsVSLeaf') includesSelector: #leafM)
]

{ #category : 'tests - V3 push down' }
GsInstVarStructureRefactoringTest >> testPushDownDeclinesWhenClassStillUsesIt [
	| ref |
	"midM reads 'mid', so removing it from Mid would leave that method undeclared."
	ref := GsInstVarStructureRefactoring class: (self classNamed: 'GsVSMid') pushDownInstVar: 'mid'.

	self assert: ref decline notNil.
	self assert: ref decline includesSubstring: 'still uses it'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - V3 push down' }
GsInstVarStructureRefactoringTest >> testPushDownDeclinesWhenNoSubclasses [
	| ref |
	ref := GsInstVarStructureRefactoring class: (self classNamed: 'GsVSLeaf') pushDownInstVar: 'leaf'.

	self assert: ref decline notNil.
	self assert: ref decline includesSubstring: 'no subclasses'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - staging' }
GsInstVarStructureRefactoringTest >> testBuildingCompilesNothingAndDoesNotCommit [
	| before |
	before := System needsCommit.
	(GsInstVarStructureRefactoring class: (self classNamed: 'GsVSMid') pushDownInstVar: 'pushable') changeSet.

	self deny: (self ownIvarsOf: 'GsVSLeaf') includes: 'pushable'.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - preview' }
GsInstVarStructureRefactoringTest >> testStartPreviewCarriesTotalsAndPage [
	| json |
	json := (GsInstVarStructureRefactoring class: (self classNamed: 'GsVSMid') pushDownInstVar: 'pushable')
		startPreviewToken: 'vsTok' maxBytes: 100000.
	[self assert: json includesSubstring: '"topClass":"GsVSMid"'.
	 self assert: json includesSubstring: '"changes":'.
	 self assert: json includesSubstring: 'classDefinitionEdit']
		ensure: [GsInstVarStructureRefactoring clearToken: 'vsTok']
]

{ #category : 'tests - preview' }
GsInstVarStructureRefactoringTest >> testAnalysisReportsDeclineAndTopClass [
	| ok bad |
	ok := GsInstVarStructureRefactoring analyzeClass: (self classNamed: 'GsVSMid') pushDownInstVar: 'pushable'.
	bad := GsInstVarStructureRefactoring analyzeClass: (self classNamed: 'GsVSMid') pushDownInstVar: 'mid'.

	self assert: ok includesSubstring: '"decline":null'.
	self assert: ok includesSubstring: '"topClass":"GsVSMid"'.
	self assert: bad includesSubstring: 'still uses it'
]

{ #category : 'tests - apply' }
GsInstVarStructureRefactoringTest >> testApplyDoesNotCommit [
	| before |
	before := System needsCommit.
	(GsInstVarStructureRefactoring class: (self classNamed: 'GsVSBase') convertTemporary: 't' inMethod: #compute meta: false)
		applyDeselected: #().

	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsInstVarStructureRefactoringTest >> testApplyForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsInstVarStructureRefactoring applyForToken: 'nope' deselected: #())
		includesSubstring: 'expired'
]
