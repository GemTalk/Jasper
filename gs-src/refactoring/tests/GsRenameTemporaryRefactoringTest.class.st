"
Correctness of the rename-temporary/argument refactoring (R5). A temporary or
argument is METHOD-LOCAL: every reference lives in one method's source, so R5 is
the lightest engine refactoring -- one method changes, staged as a single
methodRecompile, with NO class-definition edit and NO cross-method scan.

This suite pins down:

  - every occurrence of a method ARGUMENT (keyword and binary patterns), a method
    TEMPORARY (including an assignment target), and a BLOCK PARAMETER is renamed,
    and only within the binding's scope;

  - INNER SHADOWING is respected both ways: renaming an outer method temporary
    leaves a same-named block parameter (and the references it captures) alone,
    and renaming the inner block parameter leaves the outer temporary alone -- the
    caller says which by the source OFFSET of the occurrence they clicked;

  - an identifier that is not a local (an instance variable, a global, self) is
    DECLINED, not renamed (that is R1/R4's job);

  - a message selector spelled like the variable is left alone;

  - the new name is refused when it would COLLIDE: with another argument or
    temporary anywhere in the method (an arg must not collide with a temp, or vice
    versa), with an own OR INHERITED instance variable, with an own or inherited
    class variable, or with a pseudo-variable;

  - building the change set recompiles nothing and commits nothing; the
    server-side apply recompiles the one method in the stone but never commits.

The refactoring is addressed by class + selector + isMeta + old name + new name +
a 1-based source OFFSET into the method that identifies the clicked occurrence
(this disambiguates a name declared in more than one scope of the same method).

setUp builds a throwaway two-class hierarchy in UserGlobals and tearDown removes
it. The shadowing fixture shadows a temporary with a block parameter on purpose,
which the compiler warns about; the warning is resumed so the fixture installs.

The `tests - shadowed class name` category is expected to FAIL until #396 is fixed. This refactoring
reshapes no class, so it is not the `dictObjectFor:` half of that defect; it is the wider one, where
a staged change records its class by NAME and the apply re-resolves it through
`environment classNamed:` (documented first-match across the symbol list). Each test also asserts
`"failed":[]`, so a fix that redirects the write but leaves the refactoring half-applied does not
satisfy it.
"
Class {
	#name : 'GsRenameTemporaryRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsRenameTemporaryRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'fixture' }
GsRenameTemporaryRefactoringTest >> baseFixture [
	^UserGlobals at: #GsRTBase
]

{ #category : 'fixture' }
GsRenameTemporaryRefactoringTest >> classDefinitionChangeIn: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #classDefinitionEdit]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsRenameTemporaryRefactoringTest >> compile: aSource in: aClass [
	"Install aSource on aClass, resuming the shadow warning the shadowing fixture
	 raises so it still compiles."
	[aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture']
		on: CompileWarning
		do: [:ex | ex resume: nil]
]

{ #category : 'asserting' }
GsRenameTemporaryRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsRenameTemporaryRefactoringTest >> methodChangeFor: aSelector in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodRecompile and: [c selector = aSelector]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsRenameTemporaryRefactoringTest >> methodChangeIn: aChangeSet [
	"R5 stages exactly one method recompile; this is it (or nil when the rename was
	 declined or produced no change)."
	^aChangeSet changes
		detect: [:c | c kind = #methodRecompile]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsRenameTemporaryRefactoringTest >> offsetIn: aClass selector: aSelector at: aSubstring [
	"The 1-based character offset of aSubstring in the stored source of aClass's
	 aSelector -- how the tests point the refactoring at a specific occurrence."
	^(aClass compiledMethodAt: aSelector) sourceString indexOfSubCollection: aSubstring
]

{ #category : 'fixture' }
GsRenameTemporaryRefactoringTest >> renameComputeTempTo: aNewName [
	"The common case: rename the 't' temporary of the base fixture's #computeTemp."
	^self
		renamingIn: self baseFixture
		selector: #computeTemp
		from: 't'
		to: aNewName
		at: 't := 1'
]

{ #category : 'fixture' }
GsRenameTemporaryRefactoringTest >> renamingIn: aClass selector: aSelector from: oldName to: newName at: aSubstring [
	"A refactoring object renaming oldName to newName in aClass>>aSelector, pointed
	 at the occurrence of oldName that aSubstring locates."
	^GsRenameTemporaryRefactoring
		class: aClass
		selector: aSelector
		meta: false
		renameTemp: oldName
		to: newName
		atOffset: (self offsetIn: aClass selector: aSelector at: aSubstring)
]

{ #category : 'running' }
GsRenameTemporaryRefactoringTest >> setUp [
	"A base class with instance variables 'count' and 'total' and class variable
	 'Registry', and a subclass. The methods exercise a keyword argument (withArg:),
	 a binary argument alongside an instance-variable read (+), a temporary with an
	 assignment (computeTemp), a second method reusing the same temporary name
	 (otherTemp), a block parameter (overBlock), a temporary shadowed by a same-named
	 block parameter (shadowTemp), a temporary spelled like a message it sends
	 (withSizeTemp), an instance-variable read with no local (readsIvar), an argument
	 and temporary together for the arg/temp collision tests (argAndTemp:), a
	 temporary alongside a nested block parameter (blockCollide), and a subclass
	 temporary for the inherited-instance-variable collision test (subTemp)."
	| base sub |
	super setUp.
	base := Object
		subclass: 'GsRTBase'
		instVarNames: #('count' 'total')
		classVars: #('Registry')
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsRTSub'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'withArg: anArg ^anArg * anArg' in: base.
	self compile: '+ aNumber ^aNumber + count' in: base.
	self compile: 'computeTemp | t | t := 1. t := t + 1. ^t' in: base.
	self compile: 'otherTemp | t | ^t' in: base.
	self compile: 'overBlock ^#(1 2 3) inject: 0 into: [:acc :each | acc + each]' in: base.
	self compile: 'shadowTemp | x | x := 1. ^[:x | x + 1] value: x + x' in: base.
	self compile: 'withSizeTemp | size | size := 3. ^(Array new: size) size + size' in: base.
	self compile: 'readsIvar ^count' in: base.
	self compile: 'commentMentions: anArg
	"renames anArg in this comment but only the real reference is renamed"
	^anArg' in: base.
	self compile: 'argAndTemp: anArg | aTemp | aTemp := anArg. ^aTemp' in: base.
	self compile: 'blockCollide | m | m := 0. ^#(1 2) do: [:each | m := m + each]' in: base.
	self compile: 'subTemp | temp | temp := 1. ^temp' in: sub
]

{ #category : 'fixture' }
GsRenameTemporaryRefactoringTest >> subFixture [
	^UserGlobals at: #GsRTSub
]

{ #category : 'running' }
GsRenameTemporaryRefactoringTest >> tearDown [
	#('GsRTSub' 'GsRTBase')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests - staging' }
GsRenameTemporaryRefactoringTest >> testRenamesKeywordArgument [
	| change |
	change := self methodChangeIn: (self
		renamingIn: self baseFixture selector: #withArg: from: 'anArg' to: 'factor' at: 'anArg *')
		changeSet.

	self assert: change notNil.
	self assert: change selector equals: #withArg:.
	self assert: change newSource includesSubstring: 'factor * factor'.
	self deny: change newSource includesSubstring: 'anArg'
]

{ #category : 'tests - staging' }
GsRenameTemporaryRefactoringTest >> testRenamesBinaryArgumentLeavingInstanceVariableUntouched [
	"+ takes a binary argument aNumber and also reads the instance variable count;
	 only the argument is renamed, count stays."
	| change |
	change := self methodChangeIn: (self
		renamingIn: self baseFixture selector: #+ from: 'aNumber' to: 'addend' at: 'aNumber +')
		changeSet.

	self assert: change newSource includesSubstring: 'addend + count'.
	self deny: change newSource includesSubstring: 'aNumber'
]

{ #category : 'tests - staging' }
GsRenameTemporaryRefactoringTest >> testRenamesTemporaryIncludingAssignment [
	| change |
	change := self methodChangeIn: (self renameComputeTempTo: 'sum') changeSet.

	self assert: change newSource includesSubstring: 'sum := 1'.
	self assert: change newSource includesSubstring: 'sum := sum + 1'.
	self assert: change newSource includesSubstring: '^sum'.
	self deny: change newSource includesSubstring: 't :='.
	"The method's category travels with the change so the client can address it."
	self assert: change category equals: 'fixture'
]

{ #category : 'tests - staging' }
GsRenameTemporaryRefactoringTest >> testRenamesBlockParameterWithinItsBlock [
	| change |
	change := self methodChangeIn: (self
		renamingIn: self baseFixture selector: #overBlock from: 'each' to: 'elem' at: 'each]')
		changeSet.

	self assert: change newSource includesSubstring: ':acc :elem'.
	self assert: change newSource includesSubstring: 'acc + elem'.
	self deny: change newSource includesSubstring: 'each'
]

{ #category : 'tests - staging' }
GsRenameTemporaryRefactoringTest >> testSelectorSpelledLikeTheTemporaryIsNotRenamed [
	"withSizeTemp has a temporary 'size' AND sends the unary message #size; only the
	 temporary is renamed, the message send stays."
	| change |
	change := self methodChangeIn: (self
		renamingIn: self baseFixture selector: #withSizeTemp from: 'size' to: 'capacity' at: 'size := 3')
		changeSet.

	self assert: change newSource includesSubstring: 'capacity := 3'.
	self assert: change newSource includesSubstring: 'new: capacity'.
	"The unary #size message survives."
	self assert: change newSource includesSubstring: ') size'.
	self deny: change newSource includesSubstring: 'size :='
]

{ #category : 'tests - staging' }
GsRenameTemporaryRefactoringTest >> testStagesExactlyOneMethodRecompileAndNoClassDefinitionEdit [
	"R5 is method-local: exactly one method recompile, and (unlike R1/R4) NO class
	 definition edit."
	| cs recompiles |
	cs := (self renameComputeTempTo: 'sum') changeSet.
	recompiles := cs changes select: [:c | c kind = #methodRecompile].

	self assert: recompiles size equals: 1.
	self assert: (self classDefinitionChangeIn: cs) isNil
]

{ #category : 'tests - staging' }
GsRenameTemporaryRefactoringTest >> testRenamesOnlyTheTargetMethodNotAnotherWithTheSameTemporaryName [
	"otherTemp also has a temporary 't', but a temp rename is confined to the one
	 method the user is in."
	| cs |
	cs := (self renameComputeTempTo: 'sum') changeSet.

	self assert: (self methodChangeFor: #computeTemp in: cs) notNil.
	self assert: (self methodChangeFor: #otherTemp in: cs) isNil
]

{ #category : 'tests - staging' }
GsRenameTemporaryRefactoringTest >> testBuildingTheChangeSetChangesNoSourceAndDoesNotCommit [
	| before |
	before := System needsCommit.
	(self renameComputeTempTo: 'sum') changeSet.

	"The stored method is unchanged: building the preview recompiles nothing."
	self assert: (self baseFixture compiledMethodAt: #computeTemp) sourceString
		includesSubstring: 't := 1'.
	"...and it never commits."
	self assert: System needsCommit equals: before
]

{ #category : 'tests - shadowing' }
GsRenameTemporaryRefactoringTest >> testRenamingOuterTemporaryLeavesShadowingBlockParameterAlone [
	"shadowTemp: | x | x := 1. ^[:x | x + 1] value: x + x. Renaming the outer
	 temporary renames its own occurrences (x := 1, value: x + x) but not the block
	 parameter x nor the reference it captures (x + 1)."
	| change |
	change := self methodChangeIn: (self
		renamingIn: self baseFixture selector: #shadowTemp from: 'x' to: 'y' at: 'x := 1')
		changeSet.

	self assert: change newSource includesSubstring: 'y := 1'.
	self assert: change newSource includesSubstring: 'value: y + y'.
	"The shadowing block parameter and its captured reference stay 'x'."
	self assert: change newSource includesSubstring: ':x |'.
	self assert: change newSource includesSubstring: 'x + 1'
]

{ #category : 'tests - shadowing' }
GsRenameTemporaryRefactoringTest >> testRenamingInnerBlockParameterLeavesOuterTemporaryAlone [
	"The mirror image: renaming the inner block parameter (pointed at by 'x + 1')
	 touches only inside the block; the outer temporary stays 'x'."
	| change |
	change := self methodChangeIn: (self
		renamingIn: self baseFixture selector: #shadowTemp from: 'x' to: 'y' at: 'x + 1')
		changeSet.

	self assert: change newSource includesSubstring: ':y |'.
	self assert: change newSource includesSubstring: 'y + 1'.
	"The outer temporary and its occurrences stay 'x'."
	self assert: change newSource includesSubstring: 'x := 1'.
	self assert: change newSource includesSubstring: 'value: x + x'
]

{ #category : 'tests - decline' }
GsRenameTemporaryRefactoringTest >> testRenamingAnInstanceVariableIsDeclined [
	"readsIvar's ^count is an instance variable, not a local; R5 declines (that is
	 R1's job) -- no change staged, and a reason is given."
	| ref |
	ref := self
		renamingIn: self baseFixture selector: #readsIvar from: 'count' to: 'tally' at: 'count'.

	self deny: ref renamable.
	self assert: ref declineReason notNil.
	self assert: (self methodChangeIn: ref changeSet) isNil
]

{ #category : 'tests - decline' }
GsRenameTemporaryRefactoringTest >> testALocalTemporaryIsRenamable [
	self assert: (self renameComputeTempTo: 'sum') renamable
]

{ #category : 'tests - decline' }
GsRenameTemporaryRefactoringTest >> testCursorNotOnAVariableIsDeclined [
	"Pointing at a message selector (not a variable occurrence) is declined with a
	 place-the-cursor reason and stages no change -- the offset must land on an actual
	 variable, not merely a spot whose scope declares the name (e.g. inside a comment)."
	| ref |
	ref := self
		renamingIn: self baseFixture selector: #overBlock from: 'inject' to: 'x' at: 'inject'.

	self deny: ref renamable.
	self assert: ref declineReason notNil.
	self assert: ref declineReason includesSubstring: 'not a variable'.
	self assert: (self methodChangeIn: ref changeSet) isNil
]

{ #category : 'tests - decline' }
GsRenameTemporaryRefactoringTest >> testCursorInsideACommentNamingARealArgumentIsDeclined [
	"The offset must land on an actual variable OCCURRENCE, not merely a position whose
	 scope declares the name: commentMentions: has an argument anArg AND names 'anArg'
	 in its comment. A click INSIDE the comment (where anArg is not a variable node)
	 must be declined and stage no change -- otherwise a comment click would silently
	 rename the real argument. (This fails against pre-occurrenceNode code, which would
	 resolve the enclosing method scope and rename.)"
	| ref |
	ref := self
		renamingIn: self baseFixture selector: #commentMentions: from: 'anArg' to: 'x'
		at: 'anArg in this'.

	self deny: ref renamable.
	self assert: ref declineReason includesSubstring: 'not a variable'.
	self assert: (self methodChangeIn: ref changeSet) isNil
]

{ #category : 'tests - preconditions' }
GsRenameTemporaryRefactoringTest >> testRenamingArgumentToAnExistingTemporaryNameIsCollision [
	"argAndTemp: has argument anArg and temporary aTemp. Renaming the argument to the
	 temporary's name would duplicate a declaration -- an arg must not collide with a
	 temp."
	self assert: (self
		renamingIn: self baseFixture selector: #argAndTemp: from: 'anArg' to: 'aTemp' at: 'anArg.')
		newNameCollision notNil
]

{ #category : 'tests - preconditions' }
GsRenameTemporaryRefactoringTest >> testRenamingTemporaryToAnExistingArgumentNameIsCollision [
	"...and the mirror image: a temp must not collide with an arg."
	self assert: (self
		renamingIn: self baseFixture selector: #argAndTemp: from: 'aTemp' to: 'anArg' at: 'aTemp :=')
		newNameCollision notNil
]

{ #category : 'tests - preconditions' }
GsRenameTemporaryRefactoringTest >> testRenamingToANestedBlockParameterNameIsCollision [
	"blockCollide: | m | m := 0. ^#(1 2) do: [:each | m := m + each]. Renaming the
	 temporary m to 'each' would silently shadow the block parameter -- rejected."
	self assert: (self
		renamingIn: self baseFixture selector: #blockCollide from: 'm' to: 'each' at: 'm := 0')
		newNameCollision notNil
]

{ #category : 'tests - preconditions' }
GsRenameTemporaryRefactoringTest >> testNewNameCollidingWithOwnInstanceVariableIsCollision [
	self assert: (self renameComputeTempTo: 'count') newNameCollision notNil
]

{ #category : 'tests - preconditions' }
GsRenameTemporaryRefactoringTest >> testNewNameCollidingWithInheritedInstanceVariableIsCollision [
	"subTemp is on the subclass; 'count' is an instance variable INHERITED from the
	 base. The collision check must walk the superclass chain (allInstVarNames), not
	 just the subclass's own (empty) instance variables."
	self assert: (self
		renamingIn: self subFixture selector: #subTemp from: 'temp' to: 'count' at: 'temp := 1')
		newNameCollision notNil
]

{ #category : 'tests - preconditions' }
GsRenameTemporaryRefactoringTest >> testNewNameCollidingWithClassVariableIsCollision [
	self assert: (self renameComputeTempTo: 'Registry') newNameCollision notNil
]

{ #category : 'tests - preconditions' }
GsRenameTemporaryRefactoringTest >> testNewNameCollidingWithPseudoVariableIsCollision [
	self assert: (self renameComputeTempTo: 'self') newNameCollision notNil
]

{ #category : 'tests - preconditions' }
GsRenameTemporaryRefactoringTest >> testFreeNewNameHasNoCollision [
	self assert: (self renameComputeTempTo: 'sum') newNameCollision isNil
]

{ #category : 'tests - preview' }
GsRenameTemporaryRefactoringTest >> testPreviewJsonStringSerializesTheSingleMethodRecompile [
	| json |
	json := (self renameComputeTempTo: 'sum') previewJsonString.

	self assert: (json isKindOf: String).
	self assert: json includesSubstring: 'methodRecompile'.
	"R5 has no class-definition edit."
	self deny: json includesSubstring: 'classDefinitionEdit'
]

{ #category : 'tests - preview' }
GsRenameTemporaryRefactoringTest >> testStartPreviewCarriesTotalsAndNamesAndFirstPage [
	| json |
	json := (self renameComputeTempTo: 'sum') startPreviewToken: 'r5Tok' maxBytes: 100000.
	[self assert: json includesSubstring: '"oldName":"t"'.
	 self assert: json includesSubstring: '"newName":"sum"'.
	 self assert: json includesSubstring: '"total":1'.
	 self assert: json includesSubstring: '"changes":']
		ensure: [GsRenameTemporaryRefactoring clearToken: 'r5Tok']
]

{ #category : 'tests - apply' }
GsRenameTemporaryRefactoringTest >> testApplyRenamesTheTemporary [
	(self renameComputeTempTo: 'sum') applyDeselected: #().

	self assert: (self baseFixture compiledMethodAt: #computeTemp) sourceString
		includesSubstring: 'sum'.
	self deny: (self baseFixture compiledMethodAt: #computeTemp) sourceString
		includesSubstring: 't :='
]

{ #category : 'tests - apply' }
GsRenameTemporaryRefactoringTest >> testApplyLeavesOtherMethodsUntouched [
	"otherTemp's own temporary 't' is not touched by renaming computeTemp's."
	(self renameComputeTempTo: 'sum') applyDeselected: #().

	self assert: (self baseFixture compiledMethodAt: #otherTemp) sourceString
		includesSubstring: '^t'
]

{ #category : 'tests - apply' }
GsRenameTemporaryRefactoringTest >> testApplyReturnsAppliedCountAndNoFailures [
	| json |
	json := (self renameComputeTempTo: 'sum') applyDeselected: #().

	self assert: json includesSubstring: '"applied":1'.
	self assert: json includesSubstring: '"failed":[]'
]

{ #category : 'tests - apply' }
GsRenameTemporaryRefactoringTest >> testApplyDoesNotCommit [
	| before |
	before := System needsCommit.
	(self renameComputeTempTo: 'sum') applyDeselected: #().
	self assert: System needsCommit equals: before
]
</content>

{ #category : 'tests - shadowed class name' }
GsRenameTemporaryRefactoringTest >> testRenameTemporaryRecompilesTheActedOnClassNotAGlobalFirstMatch [
	"A temporary rename touches exactly one method, recompiled through a change that records its
	 class by NAME and is re-resolved at apply time with `environment classNamed:`. A decoy binding
	 GsRTBase ahead of UserGlobals takes the recompile. See #396."
	| decoy decoyClass json |
	decoy := SymbolDictionary new name: #GsRTShadowDict; yourself.
	System myUserProfile insertDictionary: decoy at: 1.
	[decoyClass := Object
		subclass: 'GsRTBase'
		instVarNames: #('count' 'total')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: decoy.
	 json := (self renameComputeTempTo: 'sum') applyDeselected: #().

	 self assert: json includesSubstring: '"failed":[]'.
	 self assert: (self baseFixture compiledMethodAt: #computeTemp) sourceString
		includesSubstring: 'sum'.
	 self assert: (decoyClass compiledMethodAt: #computeTemp environmentId: 0 otherwise: nil) isNil]
		ensure: [System myUserProfile removeDictionaryAt: 1]
]
