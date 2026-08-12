"
Correctness of the rename-class refactoring:

  - the target class is staged as a #classRename whose new/old source is the
    class definition with the name changed;
  - every descendant is staged as a #classReparent (a direct child's definition
    has its superclass name rewritten; a deeper descendant's is unchanged but
    still staged, because its version must be recompiled to re-point at the new
    parent chain);
  - a reference to the old name in an OUTSIDE class's method body is staged as a
    #methodRecompile with the reference rewritten minimal-diff, while the same
    name inside a comment or a #Symbol literal is left untouched;
  - the renamed subtree's OWN methods are NOT staged as #methodRecompile (they are
    rewritten during copy-forward at apply);
  - scope selects which referencing methods are affected and counts the out-of-scope
    remainder, but re-parenting and the rebind are always done;
  - building the change set compiles nothing and commits nothing;
  - the server-side apply creates the new class version (bumping the class
    history), copies methods forward, re-parents descendants, rewrites external
    references, and removes the old name -- all without committing;
  - a new name already in use is reported as a collision precondition.

setUp builds a throwaway hierarchy plus an unrelated referencing class in
UserGlobals with fixture-unique names, and tearDown removes them (including the
rename target name).
"
Class {
	#name : 'GsRenameClassRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsRenameClassRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'fixture' }
GsRenameClassRefactoringTest >> baseFixture [
	^UserGlobals at: #GsRCBase
]

{ #category : 'fixture' }
GsRenameClassRefactoringTest >> changeOfKind: aKind for: aClassName in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = aKind and: [c className asString = aClassName asString]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsRenameClassRefactoringTest >> compile: aSource in: aClass [
	aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture'
]

{ #category : 'asserting' }
GsRenameClassRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsRenameClassRefactoringTest >> renameTo: aName scope: scopeSymbol [
	^GsRenameClassRefactoring
		class: self baseFixture
		renameTo: aName
		scope: scopeSymbol
]

{ #category : 'running' }
GsRenameClassRefactoringTest >> setUp [
	| base sub other |
	super setUp.
	base := Object
		subclass: 'GsRCBase'
		instVarNames: #('x')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsRCSub'
		instVarNames: #('y')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	other := Object
		subclass: 'GsRCOther'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'foo ^x' in: base.
	"A self-reference inside the subtree, with the name also in a comment."
	self compile: 'makeSelf "GsRCBase is the receiver" ^GsRCBase new' in: base.
	"A subtree reference: GsRCSub is a descendant, so its GsRCBase reference is
	 handled by copy-forward, not staged as a #methodRecompile."
	self compile: 'bar ^GsRCBase new' in: sub.
	"An external reference plus a same-spelled comment AND a #Symbol literal that
	 must both survive the rewrite."
	self compile: 'usesBase "makes a GsRCBase" ^Array with: #GsRCBase with: GsRCBase new' in: other
]

{ #category : 'fixture' }
GsRenameClassRefactoringTest >> subFixture [
	^UserGlobals at: #GsRCSub
]

{ #category : 'running' }
GsRenameClassRefactoringTest >> tearDown [
	#('GsRCSub' 'GsRCOther' 'GsRCBase' 'GsRCRenamed' 'GsRCGone')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []].
	super tearDown
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testClassRenameChangeStaged [
	| cs change |
	cs := (self renameTo: 'GsRCRenamed' scope: #wholeSystem) changeSet.
	change := self changeOfKind: #classRename for: 'GsRCBase' in: cs.

	self assert: change notNil.
	self assert: change newName asString equals: 'GsRCRenamed'.
	self assert: change newSource includesSubstring: 'subclass: ''GsRCRenamed'''.
	self assert: change oldSource includesSubstring: 'subclass: ''GsRCBase'''.
	"The instVar list is preserved across the rename."
	self assert: change newSource includesSubstring: 'x'
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testDescendantReparentStaged [
	| cs change |
	cs := (self renameTo: 'GsRCRenamed' scope: #wholeSystem) changeSet.
	change := self changeOfKind: #classReparent for: 'GsRCSub' in: cs.

	self assert: change notNil.
	"A direct child's definition names the new superclass."
	self assert: change newSource includesSubstring: 'GsRCRenamed subclass: ''GsRCSub'''.
	self deny: change newSource includesSubstring: 'GsRCBase subclass:'
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testExternalReferenceRewrittenCommentAndSymbolSafe [
	| cs change |
	cs := (self renameTo: 'GsRCRenamed' scope: #wholeSystem) changeSet.
	change := self changeOfKind: #methodRecompile for: 'GsRCOther' in: cs.

	self assert: change notNil.
	"The real reference is rewritten..."
	self assert: change newSource includesSubstring: 'GsRCRenamed new'.
	"...but the comment and the #Symbol literal keep the old spelling."
	self assert: change newSource includesSubstring: '"makes a GsRCBase"'.
	self assert: change newSource includesSubstring: '#GsRCBase'
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testSubtreeOwnMethodsNotStagedAsReferenceRecompile [
	| cs |
	cs := (self renameTo: 'GsRCRenamed' scope: #wholeSystem) changeSet.

	"GsRCSub>>bar and GsRCBase>>makeSelf reference the old name but live inside the
	 renamed subtree, so they are handled by copy-forward, not as #methodRecompile."
	self assert: (self changeOfKind: #methodRecompile for: 'GsRCSub' in: cs) isNil.
	self assert: (self changeOfKind: #methodRecompile for: 'GsRCBase' in: cs) isNil
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testBuildingChangeSetDoesNotCommit [
	| before |
	before := System needsCommit.
	(self renameTo: 'GsRCRenamed' scope: #wholeSystem) changeSet.

	self assert: (UserGlobals includesKey: #GsRCBase).
	self assert: (UserGlobals includesKey: #GsRCRenamed) not.
	self assert: System needsCommit equals: before
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testClassScopeExcludesExternalReference [
	| ref cs |
	ref := self renameTo: 'GsRCRenamed' scope: #class.
	cs := ref changeSet.

	"The external GsRCOther reference is out of #class scope and not staged..."
	self assert: (self changeOfKind: #methodRecompile for: 'GsRCOther' in: cs) isNil.
	self assert: ref outOfScopeReferenceCount >= 1.
	"...but the rename and the descendant reparent are structural and always staged."
	self assert: (self changeOfKind: #classRename for: 'GsRCBase' in: cs) notNil.
	self assert: (self changeOfKind: #classReparent for: 'GsRCSub' in: cs) notNil
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testNewNameCollisionDetected [
	| ref |
	ref := self renameTo: 'GsRCOther' scope: #wholeSystem.
	self assert: ref newNameCollision notNil.
	self assert: ref outOfScopeJsonString includesSubstring: 'already in use'
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testServerSideApplyReportsAnExternalMethodThatCannotRecompile [
	"An EXTERNAL referencing method is recompiled in place with the new class name.
	 compileMethod: answers its errors rather than raising, so an unchecked apply counted a
	 method that never recompiled as applied -- leaving it naming a class that no longer
	 exists while reporting clean success. Make the external referencer un-compilable by
	 removing a global it was compiled against and assert the apply reports it."
	| json |
	UserGlobals at: #GsRCGone put: 7.
	self compile: 'usesBase "makes a GsRCBase" ^(Array with: GsRCBase new) , GsRCGone'
		in: (UserGlobals at: #GsRCOther).
	UserGlobals removeKey: #GsRCGone.

	json := (self renameTo: 'GsRCRenamed' scope: #wholeSystem) applyDeselected: #().

	self deny: json includesSubstring: '"failed":[]'.
	self assert: json includesSubstring: 'did not recompile'.
	"Pin WHICH change failed. #wholeSystem stages a change per referencing method, so a
	 bare 'something failed' would also hold if usesBase recompiled fine and an unrelated
	 fixture method broke -- green for the wrong reason, and the negative control would not
	 catch it either."
	self assert: json includesSubstring: 'GsRCOther>>usesBase'.
	"...and that the rest of the rename still went through: only the one method failed."
	self deny: json includesSubstring: '"applied":0'
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testServerSideApplyReshapesStoneAndBumpsHistory [
	| ref renamed sub other |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem.
	ref applyDeselected: #().

	renamed := UserGlobals at: #GsRCRenamed ifAbsent: [nil].
	sub := UserGlobals at: #GsRCSub ifAbsent: [nil].
	other := UserGlobals at: #GsRCOther ifAbsent: [nil].

	"Old name gone, new name bound to a class carrying the copied-forward method."
	self assert: (UserGlobals includesKey: #GsRCBase) not.
	self assert: renamed notNil.
	self assert: (renamed includesSelector: #foo).
	"The class history records the rename: old version keeps the old name."
	self assert: renamed classHistory size >= 2.
	self assert: (renamed classHistory at: 1) name asString equals: 'GsRCBase'.
	"The descendant is re-parented onto the new version and its own reference rewritten."
	self assert: sub superclass == renamed.
	self assert: (sub compiledMethodAt: #bar environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'GsRCRenamed new'.
	"The external reference is rewritten."
	self assert: (other compiledMethodAt: #usesBase environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'GsRCRenamed new'
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testApplyDoesNotCommit [
	| before |
	before := System needsCommit.
	(self renameTo: 'GsRCRenamed' scope: #wholeSystem) applyDeselected: #().
	self assert: System needsCommit equals: before
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testApplyHonoursDeselectionOfExternalReference [
	| ref refChangeId other |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem.
	refChangeId := (self changeOfKind: #methodRecompile for: 'GsRCOther' in: ref changeSet) id.
	ref applyDeselected: (Array with: refChangeId).
	other := UserGlobals at: #GsRCOther ifAbsent: [nil].

	"The rename still happened, but the deselected external reference was left as-is."
	self assert: (UserGlobals includesKey: #GsRCRenamed).
	self assert: (other compiledMethodAt: #usesBase environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'GsRCBase new'
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testPaginatedPreviewReturnsBoundedPages [
	| ref total firstPage lastPage |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem.
	total := ref changeSet size.
	self assert: total > 1.

	firstPage := ref pageJsonFrom: 1 maxBytes: 1.
	self assert: firstPage includesSubstring: '"nextOffset":2'.
	self assert: firstPage includesSubstring: '"done":false'.

	lastPage := ref pageJsonFrom: total maxBytes: 1000000.
	self assert: lastPage includesSubstring: '"done":true'
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testRenamePreservesFormatAndInvariantOption [
	"A rename must keep the class's exact format -- including the instancesInvariant
	 option (a format bit) -- not silently reset it to the superclass's format."
	| inv renamed |
	inv := Object
		_subclass: 'GsRCInv' instVarNames: #('y') classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals newVersionOf: nil description: nil options: #(#instancesInvariant).
	[ (GsRenameClassRefactoring class: inv renameTo: 'GsRCInvR' scope: #wholeSystem) applyDeselected: #().
	 renamed := UserGlobals at: #GsRCInvR.
	 self assert: renamed format equals: inv format ]
		ensure: [ #('GsRCInv' 'GsRCInvR') do: [:n | UserGlobals removeKey: n asSymbol ifAbsent: []] ]
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testRenamePreservesIndexableFormat [
	"A rename of an indexable class must keep it indexable (format inherited from the
	 variable superclass), not turn it into a named/non-indexable class."
	| arr renamed |
	arr := Array
		subclass: 'GsRCArr' instVarNames: #('x') classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	[ (GsRenameClassRefactoring class: arr renameTo: 'GsRCArrR' scope: #wholeSystem) applyDeselected: #().
	 renamed := UserGlobals at: #GsRCArrR.
	 self assert: renamed isIndexable.
	 self assert: renamed format equals: arr format.
	 self assert: renamed instVarNames asArray equals: #(#'x') ]
		ensure: [ #('GsRCArr' 'GsRCArrR') do: [:n | UserGlobals removeKey: n asSymbol ifAbsent: []] ]
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testRenamePreservesCategoryAndClassVars [
	"A rename must keep the class category and the SHARED class-variable values (which
	 all versions of a class history reference)."
	| base renamed |
	base := Object
		subclass: 'GsRCCat' instVarNames: #() classVars: #('Tally') classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	base category: 'GsRC-Category-Test'.
	base := UserGlobals at: #GsRCCat.
	base class compileMethod: 'bump Tally := (Tally ifNil: [0]) + 5'
		dictionaries: System myUserProfile symbolList category: 'fixture'.
	base class compileMethod: 'tally ^Tally'
		dictionaries: System myUserProfile symbolList category: 'fixture'.
	base bump.
	[ (GsRenameClassRefactoring class: base renameTo: 'GsRCCatR' scope: #wholeSystem) applyDeselected: #().
	 renamed := UserGlobals at: #GsRCCatR.
	 self assert: renamed category equals: 'GsRC-Category-Test'.
	 self assert: renamed tally equals: 5 ]
		ensure: [ #('GsRCCat' 'GsRCCatR') do: [:n | UserGlobals removeKey: n asSymbol ifAbsent: []] ]
]

{ #category : 'fixture' }
GsRenameClassRefactoringTest >> renameTo: aName scope: scopeSymbol copyMethods: cm recompileSubclasses: rs [
	"A rename of the fixture with the two non-committing options set (migrate and
	 remove-from-history stay OFF so the apply never commits, as a test must not)."
	| ref |
	ref := GsRenameClassRefactoring class: self baseFixture renameTo: aName scope: scopeSymbol.
	ref copyMethods: cm recompileSubclasses: rs migrateInstances: false removeOldFromHistory: false.
	^ref
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testCopyMethodsOptionOffLeavesNewVersionBare [
	| ref renamed |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem copyMethods: false recompileSubclasses: true.
	ref applyDeselected: #().
	renamed := UserGlobals at: #GsRCRenamed.

	"With copy-methods off, the new version starts with an empty method dictionary."
	self assert: renamed selectors isEmpty.
	"...and the apply did not commit."
	self assert: System needsCommit
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testRecompileSubclassesOptionOffSkipsReparent [
	| ref cs renamed |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem copyMethods: true recompileSubclasses: false.
	cs := ref changeSet.
	"No #classReparent changes are staged when recompile-subclasses is off."
	self assert: (self changeOfKind: #classReparent for: 'GsRCSub' in: cs) isNil.

	ref applyDeselected: #().
	renamed := UserGlobals at: #GsRCRenamed.
	"The subclass is left pointing at the old (superseded) version, not re-parented."
	self deny: (self subFixture superclass == renamed)
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testPruneSupersededVersionsTrimsHistoryToCurrent [
	| ref renamed |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem copyMethods: true recompileSubclasses: true.
	ref applyDeselected: #().
	renamed := UserGlobals at: #GsRCRenamed.
	self assert: renamed classHistory size > 1.

	"Pruning (the remove-old-from-history option, exercised here without the commit)
	 trims the class history down to just the current version."
	ref pruneSupersededVersions.
	self assert: renamed classHistory size equals: 1.
	self assert: (renamed classHistory at: 1) == renamed.
	self assert: System needsCommit
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testMigrateAllInstancesNeverRaises [
	"migrateAllInstances must answer an Integer failure count and never propagate an
	 exception, even when a migration cannot run. Here the structural rename has not
	 been committed, so migrateInstancesTo: raises TransactionError (it needs a clean
	 transaction) -- the method must CATCH that and count it, not blow up. The real
	 apply commits before migrating; the full migrate+commit path is exercised via the
	 GCI/MCP round trip (which needs committed instances and so cannot run in a
	 no-commit SUnit test)."
	| ref result |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem copyMethods: true recompileSubclasses: true.
	ref applyDeselected: #().
	result := ref migrateAllInstances.

	self assert: (result isKindOf: Integer).
	self assert: result >= 0
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testStartPreviewCarriesTotalsAndNames [
	| json |
	json := (self renameTo: 'GsRCRenamed' scope: #wholeSystem)
		startPreviewToken: 'gsrc_test_tok' maxBytes: 200000.
	GsRenameClassRefactoring clearToken: 'gsrc_test_tok'.

	self assert: json includesSubstring: '"oldName":"GsRCBase"'.
	self assert: json includesSubstring: '"newName":"GsRCRenamed"'.
	self assert: json includesSubstring: 'classRename'.
	self assert: json includesSubstring: 'classReparent'
]

{ #category : 'tests' }
GsRenameClassRefactoringTest >> testDictionaryScopeExcludesSameNamedClassReferenceInAnotherDictionary [
	"Regression for issue #328 item 9, the rename-class call site. When a class name is
	 bound in two dictionaries (a shadow), renaming A's class in dictionary A's scope
	 rewrites references from IN-scope classes only; a same-named reference from a class
	 in dictionary B is counted out of scope, never rewritten (rewriting it would point
	 at the wrong class). Pins the #dictionary branch of isClassInScope: (identity helper
	 GsRefactoringEnvironment>>class:isDefinedInDictionaryNamed:) at THIS call site.
	 Self-contained: the shadow dictionaries are removed in an ensure:."
	| sl dictA dictB shadowA recompiles ref cs |
	sl := System myUserProfile symbolList.
	dictA := SymbolDictionary new name: #GsRCScopeDictA; yourself.
	dictB := SymbolDictionary new name: #GsRCScopeDictB; yourself.
	[sl add: dictA. sl add: dictB.
	 shadowA := Object subclass: 'GsRCShadowT'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: dictA.
	 Object subclass: 'GsRCShadowT'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: dictB.
	 "One referrer in EACH dictionary; both reference the shared name GsRCShadowT."
	 Object subclass: 'GsRCRefInA'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: dictA.
	 Object subclass: 'GsRCRefInB'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: dictB.
	 self compile: 'useIt ^GsRCShadowT' in: (dictA at: #GsRCRefInA).
	 self compile: 'useIt ^GsRCShadowT' in: (dictB at: #GsRCRefInB).
	 ref := GsRenameClassRefactoring
		class: shadowA renameTo: 'GsRCShadowRenamedT' dictionaryScope: 'GsRCScopeDictA'.
	 cs := ref changeSet.
	 recompiles := cs changes select: [:c | c kind == #methodRecompile].

	 "exactly ONE external reference rewritten -- dictionary A's referrer only"
	 self assert: recompiles size equals: 1.
	 self assert: recompiles first className asString equals: 'GsRCRefInA'.
	 self assert: recompiles first newSource includesSubstring: 'GsRCShadowRenamedT'.
	 "the class rename itself targets dictionary A's class"
	 self assert: (self changeOfKind: #classRename for: 'GsRCShadowT' in: cs) notNil.
	 "B's same-named referrer is counted out of scope, never rewritten"
	 self assert: ref outOfScopeReferenceCount equals: 1]
		ensure: [
			#(#GsRCRefInA #GsRCShadowT #GsRCShadowRenamedT) do: [:s | dictA removeKey: s ifAbsent: []].
			#(#GsRCRefInB #GsRCShadowT) do: [:s | dictB removeKey: s ifAbsent: []].
			sl remove: dictA ifAbsent: [].
			sl remove: dictB ifAbsent: []]
]
