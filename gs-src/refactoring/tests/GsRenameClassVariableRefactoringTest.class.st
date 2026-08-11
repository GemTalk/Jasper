"
Correctness of the rename-class-variable refactoring (R4). A class variable
differs from an instance variable in three ways this suite pins down:

  - it is referenced from BOTH instance-side and class-side methods, in the
    defining class AND every subclass (both sides), because a class variable is
    shared across the whole hierarchy;

  - it is a single shared BINDING with a VALUE, so a rename must carry that value
    across -- a naive class-definition recompile drops it (this suite asserts the
    value survives the apply);

  - the class definition carries it in the classVars: clause, not instVarNames:.

Detection is bytecode-precise: a method references the class variable iff its
literal frame holds the variable's exact association object, so a same-named
global (a different association) and a shadowing block argument (no association
literal) are both correctly excluded -- the same guarantees R1 gives for an
instance variable, proven here for a class variable.

Building the change set compiles nothing and commits nothing; the server-side
apply recompiles in the stone but never commits. setUp builds a throwaway
two-class hierarchy in UserGlobals and tearDown removes it. The block-argument
fixtures shadow the class variable on purpose, which the compiler warns about;
the warning is resumed so the fixture still installs.
"
Class {
	#name : 'GsRenameClassVariableRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsRenameClassVariableRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'fixture' }
GsRenameClassVariableRefactoringTest >> baseFixture [
	^UserGlobals at: #GsRCVBase
]

{ #category : 'fixture' }
GsRenameClassVariableRefactoringTest >> classDefinitionChangeIn: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #classDefinitionEdit]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsRenameClassVariableRefactoringTest >> compile: aSource in: aClass [
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
GsRenameClassVariableRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsRenameClassVariableRefactoringTest >> methodChangeFor: aSelector in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodRecompile and: [c selector = aSelector]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsRenameClassVariableRefactoringTest >> refactoringRenameCounterTo: aNewName [
	"The refactoring object for renaming the 'Counter' class variable of the
	 fixture base class to aNewName (for apply and precondition tests)."
	^GsRenameClassVariableRefactoring
		class: self baseFixture
		renameClassVar: 'Counter'
		to: aNewName
]

{ #category : 'fixture' }
GsRenameClassVariableRefactoringTest >> renameCounterTo: aNewName [
	"The staged, non-committing change set for renaming the 'Counter' class
	 variable of the fixture base class to aNewName."
	^(self refactoringRenameCounterTo: aNewName) changeSet
]

{ #category : 'running' }
GsRenameClassVariableRefactoringTest >> setUp [
	"A base class with class variables 'Counter' and 'Other', and a subclass. The
	 methods exercise: a plain read (getIt), an assignment (bump), a read of a sibling
	 class variable (readOther), a genuine read alongside a shadowing block argument
	 (mixed), a fully shadowing block argument (blockOnly), a method that touches
	 neither class variable (noTouch), a selector spelled like the variable (Counter),
	 a class-side assignment (reset), and subclass reads on both sides (doubled
	 instance-side, peek class-side). Fixture selectors deliberately avoid embedding
	 the substring 'Counter' so a 'no longer mentions Counter' assertion is not tripped
	 by the method name itself."
	| base sub |
	super setUp.
	base := Object
		subclass: 'GsRCVBase'
		instVarNames: #()
		classVars: #('Counter' 'Other')
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsRCVSub'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'getIt ^Counter' in: base.
	self compile: 'bump Counter := (Counter ifNil: [0]) + 1' in: base.
	self compile: 'readOther ^Other' in: base.
	self compile: 'mixed | s | s := Counter. ^[:Counter | Counter + 1] value: s' in: base.
	self compile: 'blockOnly ^[:Counter | Counter * Counter] value: 3' in: base.
	self compile: 'noTouch ^42' in: base.
	self compile: 'Counter ^Counter' in: base.
	self compile: 'reset Counter := 0' in: base class.
	self compile: 'doubled ^Counter * 2' in: sub.
	self compile: 'peek ^Counter' in: sub class
]

{ #category : 'fixture' }
GsRenameClassVariableRefactoringTest >> subFixture [
	^UserGlobals at: #GsRCVSub
]

{ #category : 'running' }
GsRenameClassVariableRefactoringTest >> tearDown [
	#('GsRCVSub' 'GsRCVBase' 'GsRCVGone')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testRenamesReadInBaseInstanceMethod [
	| change |
	change := self methodChangeFor: #getIt in: (self renameCounterTo: 'Tally').

	self assert: change notNil.
	self deny: change isMeta.
	self assert: change newSource includesSubstring: 'Tally'.
	self deny: change newSource includesSubstring: 'Counter'
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testRenamesAssignmentInBaseInstanceMethod [
	| change |
	change := self methodChangeFor: #bump in: (self renameCounterTo: 'Tally').

	self assert: change newSource includesSubstring: 'Tally := (Tally'.
	self deny: change newSource includesSubstring: 'Counter'.
	"The method's category travels with the change so the client can address it."
	self assert: change category equals: 'fixture'
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testRenamesReferenceInBaseClassMethod [
	"reset is a CLASS-side method (reset Counter := 0); a class variable is shared
	 with the metaclass side, so it is renamed there too."
	| change |
	change := self methodChangeFor: #reset in: (self renameCounterTo: 'Tally').

	self assert: change notNil.
	self assert: change isMeta.
	self assert: change className equals: #GsRCVBase.
	self assert: change newSource includesSubstring: 'Tally := 0'.
	self deny: change newSource includesSubstring: 'Counter'
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testRenamesReferenceInSubclassInstanceMethod [
	| change |
	change := self methodChangeFor: #doubled in: (self renameCounterTo: 'Tally').

	self assert: change notNil.
	self deny: change isMeta.
	self assert: change className equals: #GsRCVSub.
	self assert: change newSource includesSubstring: 'Tally * 2'.
	self deny: change newSource includesSubstring: 'Counter'
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testRenamesReferenceInSubclassClassMethod [
	"peek is a class-side method on the subclass; the inherited class variable is
	 visible there and is renamed."
	| change |
	change := self methodChangeFor: #peek in: (self renameCounterTo: 'Tally').

	self assert: change notNil.
	self assert: change isMeta.
	self assert: change className equals: #GsRCVSub.
	self assert: change newSource includesSubstring: 'Tally'.
	self deny: change newSource includesSubstring: 'Counter'
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testLeavesSiblingClassVariableUntouched [
	"readOther touches only the sibling class variable 'Other'."
	self assert: (self methodChangeFor: #readOther in: (self renameCounterTo: 'Tally')) isNil
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testFullyShadowedMethodProducesNoChange [
	"blockOnly's only occurrence of 'Counter' is captured by a same-named block
	 argument, so the method does not access the class variable at all."
	self assert: (self methodChangeFor: #blockOnly in: (self renameCounterTo: 'Tally')) isNil
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testShadowingBlockArgumentAndItsReferencesAreNotRenamed [
	"mixed reads the class variable (s := Counter) and separately has a block whose
	 argument is also named Counter. Only the genuine reference is renamed; the block
	 argument declaration and the reference it captures stay 'Counter'."
	| change |
	change := self methodChangeFor: #mixed in: (self renameCounterTo: 'Tally').

	self assert: change notNil.
	self assert: change newSource includesSubstring: 's := Tally'.
	self assert: change newSource includesSubstring: ':Counter'.
	self assert: change newSource includesSubstring: 'Counter + 1'
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testNonAccessingMethodProducesNoChange [
	"noTouch references neither class variable."
	self assert: (self methodChangeFor: #noTouch in: (self renameCounterTo: 'Tally')) isNil
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testMethodSelectorSpelledLikeTheVariableIsNotRenamed [
	"The 'Counter' method reads 'Counter'; only the variable reference is renamed --
	 the selector stays 'Counter'."
	| change |
	change := self methodChangeFor: #Counter in: (self renameCounterTo: 'Tally').

	self assert: change selector equals: #Counter.
	self assert: change newSource includesSubstring: '^Tally'
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testStagesClassDefinitionEditWithRenamedClassVar [
	| change |
	change := self classDefinitionChangeIn: (self renameCounterTo: 'Tally').

	self assert: change notNil.
	self assert: change className equals: #GsRCVBase.
	self assert: change oldSource includesSubstring: 'Counter'.
	self assert: change newSource includesSubstring: 'Tally'.
	"The sibling class variable is left in the classVars: clause."
	self assert: change newSource includesSubstring: 'Other'.
	self deny: change newSource includesSubstring: 'Counter'
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testStagesOneChangePerAffectedMethodPlusClassDefinition [
	"getIt, bump, mixed, Counter (base instance), reset (base class), doubled
	 (subclass instance) and peek (subclass class) are the seven accessing methods;
	 readOther, blockOnly and noTouch are excluded; plus the one class-definition edit."
	| cs recompiles |
	cs := self renameCounterTo: 'Tally'.
	recompiles := cs changes select: [:c | c kind = #methodRecompile].

	self assert: recompiles size equals: 7.
	self assert: (self classDefinitionChangeIn: cs) notNil
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testPreviewJsonStringSerializesTheChangeSet [
	| json |
	json := (self refactoringRenameCounterTo: 'Tally') previewJsonString.

	self assert: (json isKindOf: String).
	self assert: json includesSubstring: 'methodRecompile'.
	self assert: json includesSubstring: 'classDefinitionEdit'
]

{ #category : 'tests - staging' }
GsRenameClassVariableRefactoringTest >> testBuildingTheChangeSetChangesNoSourceAndDoesNotCommit [
	| before |
	before := System needsCommit.
	self renameCounterTo: 'Tally'.

	"The defining class still declares 'Counter' and its methods are unchanged:
	 building the preview recompiles nothing."
	self assert: (self baseFixture classVarNames includes: #Counter).
	self assert: (self baseFixture compiledMethodAt: #getIt) sourceString
		includesSubstring: 'Counter'.
	"...and it never commits: the transaction's dirty state is unchanged."
	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsRenameClassVariableRefactoringTest >> testApplyRenamesTheClassVariable [
	(self refactoringRenameCounterTo: 'Tally') applyDeselected: #().

	self assert: (self baseFixture classVarNames includes: #Tally).
	self deny: (self baseFixture classVarNames includes: #Counter).
	"The sibling class variable is untouched."
	self assert: (self baseFixture classVarNames includes: #Other).
	"Referencing methods now name the new variable."
	self assert: (self baseFixture compiledMethodAt: #getIt) sourceString
		includesSubstring: 'Tally'.
	self deny: (self baseFixture compiledMethodAt: #getIt) sourceString
		includesSubstring: 'Counter'
]

{ #category : 'tests - apply' }
GsRenameClassVariableRefactoringTest >> testApplyPreservesClassVariableValue [
	"The central R4 guarantee: the shared value survives the rename (a naive
	 class-definition recompile would drop it)."
	((self baseFixture) _classVars associationAt: #Counter) value: 42.
	(self refactoringRenameCounterTo: 'Tally') applyDeselected: #().

	self assert: ((self baseFixture) _classVars associationAt: #Tally) value equals: 42
]

{ #category : 'tests - apply' }
GsRenameClassVariableRefactoringTest >> testApplyDoesNotBumpClassVersion [
	"A class-variable change does not alter instance format, so GemStone updates the
	 class in place -- no new class version, so the Explorer's Foo[n] tag is unchanged."
	| before |
	before := self baseFixture classHistory size.
	(self refactoringRenameCounterTo: 'Tally') applyDeselected: #().

	self assert: self baseFixture classHistory size equals: before
]

{ #category : 'tests - apply' }
GsRenameClassVariableRefactoringTest >> testApplyDoesNotCommit [
	| before |
	before := System needsCommit.
	(self refactoringRenameCounterTo: 'Tally') applyDeselected: #().
	self assert: System needsCommit equals: before
]

{ #category : 'tests - preconditions' }
GsRenameClassVariableRefactoringTest >> testNewNameCollisionWithExistingClassVarDetected [
	"Renaming Counter to Other, an existing class variable of the same class, is a
	 collision: it is reported, not applied."
	self assert: (self refactoringRenameCounterTo: 'Other') newNameCollision notNil
]

{ #category : 'tests - preconditions' }
GsRenameClassVariableRefactoringTest >> testFreeNewNameHasNoCollision [
	self assert: (self refactoringRenameCounterTo: 'Tally') newNameCollision isNil
]

{ #category : 'tests - environment' }
GsRenameClassVariableRefactoringTest >> testMethodsAccessingClassVarFindsBothSidesAcrossHierarchy [
	"The environment query returns exactly the methods (instance AND class side, base
	 AND subclass) that reference the class variable's association."
	| assoc methods selectors |
	assoc := (self baseFixture) _classVars associationAt: #Counter.
	methods := GsRefactoringEnvironment new
		methodsAccessingClassVar: assoc
		inHierarchyOf: self baseFixture.
	selectors := (methods collect: [:m | m selector]) asIdentitySet.

	self assert: (selectors includes: #getIt).
	self assert: (selectors includes: #reset).
	self assert: (selectors includes: #doubled).
	self assert: (selectors includes: #peek)
]

{ #category : 'tests - environment' }
GsRenameClassVariableRefactoringTest >> testMethodsAccessingClassVarExcludesShadowingAndNonAccessing [
	| assoc methods selectors |
	assoc := (self baseFixture) _classVars associationAt: #Counter.
	methods := GsRefactoringEnvironment new
		methodsAccessingClassVar: assoc
		inHierarchyOf: self baseFixture.
	selectors := (methods collect: [:m | m selector]) asIdentitySet.

	self deny: (selectors includes: #blockOnly).
	self deny: (selectors includes: #noTouch).
	self deny: (selectors includes: #readOther)
]

{ #category : 'tests - environment' }
GsRenameClassVariableRefactoringTest >> testMethodsAccessingClassVarIsReadOnly [
	| before assoc |
	before := System needsCommit.
	assoc := (self baseFixture) _classVars associationAt: #Counter.
	GsRefactoringEnvironment new
		methodsAccessingClassVar: assoc
		inHierarchyOf: self baseFixture.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - environment' }
GsRenameClassVariableRefactoringTest >> testMethodsAccessingClassVarDiscriminatesByAssociationNotName [
	"The association-identity match, isolated: the SAME hierarchy scan, asked for a
	 DIFFERENT class variable's association (Other), returns the methods that reference
	 THAT association (readOther) and excludes those referencing Counter (getIt, bump,
	 reset). Both Counter and Other are same-styled capitalised class-var names on the
	 same class, so the only thing that separates the two result sets is which
	 association each method holds in its literal frame -- i.e. the == check, not the
	 name."
	| assoc methods selectors |
	assoc := self baseFixture _classVars associationAt: #Other.
	methods := GsRefactoringEnvironment new
		methodsAccessingClassVar: assoc
		inHierarchyOf: self baseFixture.
	selectors := (methods collect: [:m | m selector]) asIdentitySet.

	self assert: (selectors includes: #readOther).
	self deny: (selectors includes: #getIt).
	self deny: (selectors includes: #bump).
	self deny: (selectors includes: #reset)
]

{ #category : 'tests - skipped' }
GsRenameClassVariableRefactoringTest >> testSkippedMethodBookkeeping [
	"Exercise the skipped-method machinery. No method in this fixture naturally fails to
	 rewrite (a skip requires a method whose reparse/rewrite raises, which is
	 version-fragile to construct), so drive it directly: a clean rename records no skips
	 (empty JSON, skipped count 0 in the preview payload), and a recorded skip serialises
	 to well-formed JSON naming the class and selector."
	| ref |
	ref := self refactoringRenameCounterTo: 'Tally'.
	ref changeSet.

	self assert: ref skippedMethodsJsonString equals: '[]'.
	self assert: ref outOfScopeJsonString includesSubstring: '"skipped":0'.

	ref recordSkipped: (self baseFixture compiledMethodAt: #getIt).
	self assert: ref skippedMethodsJsonString includesSubstring: 'getIt'.
	self assert: ref skippedMethodsJsonString includesSubstring: 'GsRCVBase'
]

{ #category : 'tests - identity' }
GsRenameClassVariableRefactoringTest >> testSameNamedGlobalIsNotRenamed [
	"A global that merely shares the class variable's spelling must survive the rename,
	 as must a method that uses it. NOTE: this proves the OUTCOME + hierarchy scope, not
	 the association-identity == path in isolation -- GsRCVOutsider is out of the
	 hierarchy, so the scan never looks at it (an IN-hierarchy method cannot name the
	 global anyway, since the class variable shadows it, so a distinct-but-same-named
	 association cannot be constructed in scope). The == discriminator itself is isolated
	 by testMethodsAccessingClassVarDiscriminatesByAssociationNotName."
	| outsider globalAssoc classVarAssoc |
	[UserGlobals at: #Counter put: 99.
	 globalAssoc := UserGlobals associationAt: #Counter.
	 classVarAssoc := self baseFixture _classVars associationAt: #Counter.
	 "The global binding and the class-variable binding are distinct objects."
	 self deny: globalAssoc == classVarAssoc.
	 outsider := Object
		subclass: 'GsRCVOutsider'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	 self compile: 'sees ^Counter' in: outsider.
	 "The outsider's reference to the global is not in the affected set..."
	 self assert: (self methodChangeFor: #sees in: (self renameCounterTo: 'Tally')) isNil.
	 "...and applying the rename leaves the global and its user untouched."
	 (self refactoringRenameCounterTo: 'Tally') applyDeselected: #().
	 self assert: (UserGlobals at: #Counter) equals: 99.
	 self assert: (outsider compiledMethodAt: #sees) sourceString includesSubstring: 'Counter']
		ensure: [
			UserGlobals removeKey: #GsRCVOutsider ifAbsent: [].
			UserGlobals removeKey: #Counter ifAbsent: []]
]

{ #category : 'tests - apply' }
GsRenameClassVariableRefactoringTest >> testApplyIsAllOrNothingIgnoringDeselection [
	"Option A: a class-variable rename is all-or-nothing. Passing a deselected reference
	 recompile id does NOT skip it -- the method is still renamed -- so the removed
	 variable can never be left dangling in a method that still names it."
	| ref change |
	ref := self refactoringRenameCounterTo: 'Tally'.
	change := self methodChangeFor: #getIt in: ref changeSet.
	ref applyDeselected: (Array with: change id).

	self assert: (self baseFixture compiledMethodAt: #getIt) sourceString
		includesSubstring: 'Tally'.
	self deny: (self baseFixture compiledMethodAt: #getIt) sourceString
		includesSubstring: 'Counter'
]

{ #category : 'tests - apply' }
GsRenameClassVariableRefactoringTest >> testApplyReturnsAppliedCountAndNoFailures [
	"The apply envelope reports every change applied (1 class-definition edit + 7 method
	 recompiles = 8) and no failures."
	| json |
	json := (self refactoringRenameCounterTo: 'Tally') applyDeselected: #().

	self assert: json includesSubstring: '"applied":8'.
	self assert: json includesSubstring: '"failed":[]'
]

{ #category : 'tests - apply' }
GsRenameClassVariableRefactoringTest >> testApplyReportsAMethodThatCannotRecompile [
	"compileMethod: ANSWERS its errors instead of raising, so an apply that ignored the
	 return value counted a method that never recompiled as APPLIED and reported clean
	 success -- leaving that method bound to the OLD, now-detached association. Compile a
	 reference method against a scaffold global, remove the global so its source no longer
	 compiles, and assert the apply reports the failure instead of swallowing it."
	| json |
	UserGlobals at: #GsRCVGone put: 7.
	self compile: 'broken ^Counter + GsRCVGone' in: self baseFixture.
	UserGlobals removeKey: #GsRCVGone.

	json := (self refactoringRenameCounterTo: 'Tally') applyDeselected: #().

	self deny: json includesSubstring: '"failed":[]'.
	self assert: json includesSubstring: 'did not recompile'.
	"The other eight changes still applied -- one bad method does not stop the rename."
	self assert: json includesSubstring: '"applied":8'
]

{ #category : 'tests - preview' }
GsRenameClassVariableRefactoringTest >> testStartPreviewCarriesTotalsAndNamesAndFirstPage [
	"The token/session entry point the client calls: it stashes the refactoring under the
	 token and returns the totals, the old/new names, and the first page of changes."
	| json cls |
	cls := GsRenameClassVariableRefactoring.
	json := (self refactoringRenameCounterTo: 'Tally')
		startPreviewToken: 'r4Tok' maxBytes: 100000.
	[self assert: json includesSubstring: '"oldName":"Counter"'.
	 self assert: json includesSubstring: '"newName":"Tally"'.
	 self assert: json includesSubstring: '"total":8'.
	 self assert: json includesSubstring: '"changes":']
		ensure: [cls clearToken: 'r4Tok']
]

{ #category : 'tests - preview' }
GsRenameClassVariableRefactoringTest >> testCollisionSurfacedInPreviewPayload [
	"The collision precondition is surfaced through the outOfScope payload the client
	 actually reads, not only via newNameCollision directly."
	| collided free |
	collided := (self refactoringRenameCounterTo: 'Other') outOfScopeJsonString.
	free := (self refactoringRenameCounterTo: 'Tally') outOfScopeJsonString.

	self deny: collided includesSubstring: '"collision":null'.
	self assert: collided includesSubstring: '"collision":"'.
	self assert: free includesSubstring: '"collision":null'
]
