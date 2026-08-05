"
Correctness of the rename-instance-variable refactoring:

  - every read and write of the variable in the defining class and in
    subclasses is renamed;
  - a same-named block argument (and the references it captures) is left alone,
    even in a method that also has a genuine reference to the variable -- the
    shadowing case that a blind text or #replace:with: rewrite gets wrong;
  - a method whose reference is entirely shadowed, and a method that never
    touches the variable, produce no change at all (no false positives);
  - the method's own selector, and other instance variables, are untouched;
  - the class definition is edited to carry the renamed instVarNames list;
  - building the change set recompiles nothing and commits nothing.

setUp builds a throwaway two-class hierarchy in UserGlobals and tearDown removes
it. The block-argument fixtures shadow the instance variable on purpose, which
the compiler warns about; the warning is resumed so the fixture still installs.
"
Class {
	#name : 'GsRenameInstanceVariableRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsRenameInstanceVariableRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'fixture' }
GsRenameInstanceVariableRefactoringTest >> baseFixture [
	^UserGlobals at: #GsRIVBase
]

{ #category : 'fixture' }
GsRenameInstanceVariableRefactoringTest >> classDefinitionChangeIn: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #classDefinitionEdit]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsRenameInstanceVariableRefactoringTest >> compile: aSource in: aClass [
	"Install aSource on aClass, resuming the shadow warning the block-argument
	 fixtures raise so they still compile."
	[aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture']
		on: CompileWarning
		do: [:ex | ex resume: nil]
]

{ #category : 'asserting' }
GsRenameInstanceVariableRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsRenameInstanceVariableRefactoringTest >> methodChangeFor: aSelector in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodRecompile and: [c selector = aSelector]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsRenameInstanceVariableRefactoringTest >> renameCountTo: aNewName [
	"The staged change set for renaming the 'count' instance variable of the
	 fixture base class to aNewName."
	^(GsRenameInstanceVariableRefactoring
		class: self baseFixture
		renameInstVar: 'count'
		to: aNewName) changeSet
]

{ #category : 'running' }
GsRenameInstanceVariableRefactoringTest >> setUp [
	"A base class with instance variables 'count' and 'other', and a subclass.
	 The methods exercise: a plain read, a read of a sibling variable, an
	 assignment, a genuine read alongside a shadowing block argument (mixed), a
	 fully shadowing block argument (blockOnly), a method that touches only the
	 sibling variable (getOther), a selector spelled like the variable (count),
	 and a subclass read (doubleCount).

	 makeOne / describe are CLASS-side and cannot touch an instance variable at
	 all, so no change set will ever mention them; they exist so the apply tests
	 can prove the class side survives the reshape. Likewise getOther and
	 subLabel are instance methods no change set mentions."
	| base sub |
	super setUp.
	base := Object
		subclass: 'GsRIVBase'
		instVarNames: #('count' 'other')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsRIVSub'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'combine ^count + other' in: base.
	self compile: 'count ^count' in: base.
	self compile: 'increment count := count + 1' in: base.
	self compile: 'mixed | s | s := count. ^[:count | count + 1] value: s' in: base.
	self compile: 'blockOnly ^[:count | count * count] value: 3' in: base.
	self compile: 'getOther ^other' in: base.
	self compile: 'doubleCount ^count * 2' in: sub.
	self compile: 'subLabel ^''sub''' in: sub.
	self compile: 'makeOne ^self new' in: base class.
	self compile: 'describe ^''base''' in: sub class
]

{ #category : 'fixture' }
GsRenameInstanceVariableRefactoringTest >> subFixture [
	^UserGlobals at: #GsRIVSub
]

{ #category : 'running' }
GsRenameInstanceVariableRefactoringTest >> tearDown [
	#('GsRIVSub' 'GsRIVBase')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests' }
GsRenameInstanceVariableRefactoringTest >> testBuildingTheChangeSetChangesNoSourceAndDoesNotCommit [
	| before |
	before := System needsCommit.
	self renameCountTo: 'tally'.

	"The defining class still declares 'count' and its methods are unchanged:
	 building the preview recompiles nothing."
	self assert: (self baseFixture instVarNames includes: #count).
	self assert: (self baseFixture compiledMethodAt: #combine) sourceString
		includesSubstring: 'count'.
	"...and it never commits: the transaction's dirty state is unchanged."
	self assert: System needsCommit equals: before
]

{ #category : 'tests' }
GsRenameInstanceVariableRefactoringTest >> testFullyShadowedMethodProducesNoChange [
	"blockOnly's only reference to 'count' is captured by a same-named block
	 argument, so the method does not access the instance variable at all."
	self assert: (self methodChangeFor: #blockOnly in: (self renameCountTo: 'tally')) isNil
]

{ #category : 'tests' }
GsRenameInstanceVariableRefactoringTest >> testLeavesOtherInstanceVariableReferencesUntouched [
	| change |
	change := self methodChangeFor: #combine in: (self renameCountTo: 'tally').

	self assert: change newSource includesSubstring: 'tally'.
	self assert: change newSource includesSubstring: 'other'.
	self deny: change newSource includesSubstring: 'count'
]

{ #category : 'tests' }
GsRenameInstanceVariableRefactoringTest >> testMethodSelectorSpelledLikeTheVariableIsNotRenamed [
	"The 'count' method reads 'count'; only the variable reference is renamed --
	 the selector stays 'count'."
	| change |
	change := self methodChangeFor: #count in: (self renameCountTo: 'tally').

	self assert: change selector equals: #count.
	self assert: change newSource includesSubstring: 'count'.
	self assert: change newSource includesSubstring: 'tally'
]

{ #category : 'tests' }
GsRenameInstanceVariableRefactoringTest >> testNonAccessingMethodProducesNoChange [
	"getOther touches only the sibling variable 'other'."
	self assert: (self methodChangeFor: #getOther in: (self renameCountTo: 'tally')) isNil
]

{ #category : 'tests' }
GsRenameInstanceVariableRefactoringTest >> testPreviewJsonStringSerializesTheChangeSet [
	| json |
	json := (GsRenameInstanceVariableRefactoring
		class: self baseFixture
		renameInstVar: 'count'
		to: 'tally') previewJsonString.

	self assert: (json isKindOf: String).
	self assert: json includesSubstring: 'methodRecompile'.
	self assert: json includesSubstring: 'classDefinitionEdit'
]

{ #category : 'tests' }
GsRenameInstanceVariableRefactoringTest >> testRenamesAssignmentInDefiningClass [
	| change |
	change := self methodChangeFor: #increment in: (self renameCountTo: 'tally').

	self assert: change newSource includesSubstring: 'tally := tally + 1'.
	self deny: change newSource includesSubstring: 'count'.
	"The method's category travels with the change so the client can address it."
	self assert: change category equals: 'fixture'
]

{ #category : 'tests' }
GsRenameInstanceVariableRefactoringTest >> testRenamesReferencesInSubclassMethods [
	| change |
	change := self methodChangeFor: #doubleCount in: (self renameCountTo: 'tally').

	self assert: change notNil.
	self assert: change className equals: #GsRIVSub.
	self assert: change newSource includesSubstring: 'tally * 2'.
	self deny: change newSource includesSubstring: 'count'
]

{ #category : 'tests' }
GsRenameInstanceVariableRefactoringTest >> testShadowingBlockArgumentAndItsReferencesAreNotRenamed [
	"mixed reads the instance variable (s := count) and separately has a block
	 whose argument is also named count. Only the genuine reference is renamed;
	 the block argument declaration and the reference it captures stay 'count'."
	| change |
	change := self methodChangeFor: #mixed in: (self renameCountTo: 'tally').

	self assert: change notNil.
	self assert: change newSource includesSubstring: 's := tally'.
	self assert: change newSource includesSubstring: ':count'.
	self assert: change newSource includesSubstring: 'count + 1'
]

{ #category : 'tests' }
GsRenameInstanceVariableRefactoringTest >> testStagesClassDefinitionEditWithRenamedInstVar [
	| change |
	change := self classDefinitionChangeIn: (self renameCountTo: 'tally').

	self assert: change notNil.
	self assert: change className equals: #GsRIVBase.
	self assert: change oldSource includesSubstring: 'count'.
	self assert: change newSource includesSubstring: 'tally'.
	self assert: change newSource includesSubstring: 'other'.
	self deny: change newSource includesSubstring: 'count'
]

{ #category : 'tests' }
GsRenameInstanceVariableRefactoringTest >> testStagesOneChangePerAffectedMethodPlusClassDefinition [
	"combine, count, increment, mixed (base) and doubleCount (subclass) are the
	 five accessing methods; blockOnly and getOther are excluded; plus the one
	 class-definition edit."
	| cs recompiles |
	cs := self renameCountTo: 'tally'.
	recompiles := cs changes select: [:c | c kind = #methodRecompile].

	self assert: recompiles size equals: 5.
	self assert: (self classDefinitionChangeIn: cs) notNil
]

{ #category : 'asserting' }
GsRenameInstanceVariableRefactoringTest >> assertSelectorsOf: aClass include: selectorArray [
	"Every selector in selectorArray is still installed on aClass. Named
	 explicitly rather than by count so a failure says WHICH method vanished."
	selectorArray do: [:sel |
		self
			assert: (aClass compiledMethodAt: sel environmentId: 0 otherwise: nil) notNil
			description: aClass name asString, '>>', sel asString, ' did not survive the apply']
]

{ #category : 'fixture' }
GsRenameInstanceVariableRefactoringTest >> applyRenameCountTo: aName deselected: idArray [
	"Run the whole refactoring -- preview then apply -- and answer the apply
	 result envelope. Nothing commits."
	| ref |
	ref := GsRenameInstanceVariableRefactoring
		class: self baseFixture
		renameInstVar: 'count'
		to: aName.
	ref changeSet.
	^ref applyDeselected: idArray
]

{ #category : 'tests - apply' }
GsRenameInstanceVariableRefactoringTest >> testApplyKeepsEveryMethodOnBothSidesOfTheDefiningClass [
	"Reshaping a class creates a new class version whose method dictionary starts
	 EMPTY, so only what is copied forward survives. The change set names just the
	 methods that access the variable -- getOther (instance) and makeOne (class
	 side) appear in no change set, and are exactly what a naive class-definition
	 recompile destroys."
	| base |
	self applyRenameCountTo: 'tally' deselected: #().
	base := self baseFixture.

	self assertSelectorsOf: base include: #(combine count increment mixed blockOnly getOther).
	self assertSelectorsOf: base class include: #(makeOne).
	self assert: (base instVarNames includesIdentical: #tally).
	self deny: (base instVarNames includesIdentical: #count)
]

{ #category : 'tests - apply' }
GsRenameInstanceVariableRefactoringTest >> testApplyKeepsEveryMethodOnBothSidesOfTheSubclass [
	"The subclass is re-versioned too when its superclass is reshaped, so it needs
	 the same survival guarantee. subLabel and describe reference nothing."
	| sub |
	self applyRenameCountTo: 'tally' deselected: #().
	sub := self subFixture.

	self assertSelectorsOf: sub include: #(doubleCount subLabel).
	self assertSelectorsOf: sub class include: #(describe)
]

{ #category : 'tests - apply' }
GsRenameInstanceVariableRefactoringTest >> testApplyRewritesTheAccessingMethodsToTheNewName [
	"Surviving is not enough -- the accessing methods must also carry the new name."
	| base |
	self applyRenameCountTo: 'tally' deselected: #().
	base := self baseFixture.

	self
		assert: (base compiledMethodAt: #combine environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'tally'.
	self
		deny: (base compiledMethodAt: #combine environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'count'
]

{ #category : 'tests - apply' }
GsRenameInstanceVariableRefactoringTest >> testApplyKeepsTheCategoryOfACarriedForwardMethod [
	"A method copied onto the new class version without its category silently
	 lands in 'as yet unclassified'. getOther is carried forward, not recompiled."
	| base |
	self applyRenameCountTo: 'tally' deselected: #().
	base := self baseFixture.

	self
		assert: (base categoryOfSelector: #getOther environmentId: 0) asString
		equals: 'fixture'
]

{ #category : 'tests - apply' }
GsRenameInstanceVariableRefactoringTest >> testApplyDropsOnlyTheDeselectedMethod [
	"Deselecting an accessing method is a deliberate choice to lose it -- but it
	 must lose ONLY that method."
	| ref combineId base |
	ref := GsRenameInstanceVariableRefactoring
		class: self baseFixture
		renameInstVar: 'count'
		to: 'tally'.
	combineId := (ref changeSet changes
		detect: [:c | c kind = #methodRecompile and: [c selector = #combine]]) id.

	ref applyDeselected: (Array with: combineId).
	base := self baseFixture.

	self assert: (base compiledMethodAt: #combine environmentId: 0 otherwise: nil) isNil.
	self assertSelectorsOf: base include: #(count increment mixed blockOnly getOther).
	self assertSelectorsOf: base class include: #(makeOne)
]
