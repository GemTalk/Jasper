"
Correctness of the read-only all-dictionaries environment: class resolution
and enumeration span every dictionary (not just UserGlobals); instance-variable
access is found for reads and writes across a class hierarchy and excludes
methods that never touch the variable; the instance-variable name argument
accepts a String or a Symbol; the own/all instance-variable-name queries answer
Strings in declaration order and separate a class's own slots from its inherited
ones; and the queries never dirty the transaction.

setUp builds a throwaway three-class hierarchy in UserGlobals and tearDown
removes it, so the assertions have known, self-contained answers. The subclass
declares its own instance variable so own-vs-inherited is distinguishable.
"
Class {
	#name : 'GsRefactoringEnvironmentTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'private' }
GsRefactoringEnvironmentTest >> noAccessFixture [
	^UserGlobals at: #GsRefEnvFixtureSubNoAccess
]

{ #category : 'running' }
GsRefactoringEnvironmentTest >> setUp [
	"A tiny throwaway hierarchy so the instance-variable queries have known,
	 self-contained answers: a superclass defining 'alpha' with a reader, a
	 writer and a non-accessing method; a subclass declaring its own 'beta' and
	 'gamma' that reads the inherited 'alpha'; and a sibling subclass that declares
	 nothing and never touches it."
	| supr sl |
	sl := System myUserProfile symbolList.
	supr := Object
		subclass: 'GsRefEnvFixtureSuper'
		instVarNames: #('alpha')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	supr compileMethod: 'readAlpha ^alpha' dictionaries: sl category: 'tests'.
	supr compileMethod: 'writeAlpha: x alpha := x' dictionaries: sl category: 'tests'.
	supr compileMethod: 'noTouch ^42' dictionaries: sl category: 'tests'.
	(supr
		subclass: 'GsRefEnvFixtureSub'
		instVarNames: #('beta' 'gamma')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals)
		compileMethod: 'useAlpha ^alpha + 1' dictionaries: sl category: 'tests'.
	(supr
		subclass: 'GsRefEnvFixtureSubNoAccess'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals)
		compileMethod: 'other ^0' dictionaries: sl category: 'tests'
]

{ #category : 'private' }
GsRefactoringEnvironmentTest >> subFixture [
	^UserGlobals at: #GsRefEnvFixtureSub
]

{ #category : 'private' }
GsRefactoringEnvironmentTest >> superFixture [
	^UserGlobals at: #GsRefEnvFixtureSuper
]

{ #category : 'running' }
GsRefactoringEnvironmentTest >> tearDown [
	#('GsRefEnvFixtureSubNoAccess' 'GsRefEnvFixtureSub' 'GsRefEnvFixtureSuper')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testAllClassesSpansEveryDictionaryWithoutDuplicates [
	| all |
	all := GsRefactoringEnvironment new allClasses.

	self assert: (all includes: Object).
	self assert: (all includes: self superFixture).
	self assert: (all occurrencesOf: Object) equals: 1
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testAllInstVarNamesListsInheritedNamesBeforeOwnOnes [
	"Inherited first, then the class's own -- the slot order of an instance, which a
	 class-creation change has to reproduce."
	| env |
	env := GsRefactoringEnvironment new.

	self assert: (env allInstVarNamesOf: self superFixture) asArray
		equals: #('alpha').
	self assert: (env allInstVarNamesOf: self subFixture) asArray
		equals: #('alpha' 'beta' 'gamma')
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testAllInstVarNamesOfAClassWithNoInstVarsIsEmpty [
	self assert: (GsRefactoringEnvironment new allInstVarNamesOf: Object) isEmpty
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testClassNamedResolvesClassesFromAnyDictionary [
	| env |
	env := GsRefactoringEnvironment new.

	self assert: (env classNamed: #Object) == Object.
	self assert: (env classNamed: #GsRefEnvFixtureSuper) == self superFixture
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testDescendantsDeclaringInstVarFindsOnlyTheRedeclaringSubclasses [
	"The V1-add / V8-split collision check: only a descendant that declares the name as its
	 OWN instance variable counts. 'beta' is declared by the subclass; 'alpha' is declared by
	 the superclass itself and merely inherited, so no descendant answers for it."
	| env |
	env := GsRefactoringEnvironment new.

	self assert: ((env descendantsOf: self superFixture declaringInstVar: 'beta')
		collect: [:c | c name asString]) asArray equals: #('GsRefEnvFixtureSub').
	self assert: (env descendantsOf: self superFixture declaringInstVar: 'alpha') isEmpty
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testDescendantsDeclaringInstVarAcceptsAStringOrASymbol [
	"The name is compared against normalised Strings, so a Symbol argument must be normalised too
	 or it would hit the 3.6.x Unicode-comparison trap on the argument side and answer empty. Match
	 #instanceMethodsAccessing:inClass:, which already accepts either."
	| env |
	env := GsRefactoringEnvironment new.

	self assert: (env descendantsOf: self superFixture declaringInstVar: #beta)
		equals: (env descendantsOf: self superFixture declaringInstVar: 'beta')
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testDictionariesDefiningNameReflectWhereTheClassLives [
	| env |
	env := GsRefactoringEnvironment new.

	self assert: (((env dictionariesDefiningClassNamed: #Object) collect: [:d | d name])
		includes: #Globals).
	self assert: (((env dictionariesDefiningClassNamed: #GsRefEnvFixtureSuper) collect: [:d | d name])
		includes: #UserGlobals)
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testDictionaryScopeMembershipIsByIdentityNotName [
	"A class name bound in two dictionaries (a shadow) must be 'in' ONLY the
	 dictionary that holds THAT class object -- not every dictionary that happens
	 to bind the same name. Membership by name alone pulled the sibling into a
	 single-dictionary scope and produced duplicate change rows (issue #328 item 9).
	 Self-contained: builds two shadow dictionaries and removes them in an ensure:
	 so a failure never leaks fixture state into the stone."
	| sl env dictA dictB fooA fooB |
	sl := System myUserProfile symbolList.
	dictA := SymbolDictionary new name: #GsEnvScopeDictA; yourself.
	dictB := SymbolDictionary new name: #GsEnvScopeDictB; yourself.
	[sl add: dictA. sl add: dictB.
	 fooA := Object subclass: 'GsEnvScopeShadow'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: dictA.
	 fooB := Object subclass: 'GsEnvScopeShadow'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: dictB.
	 env := GsRefactoringEnvironment new.

	 "the name is genuinely shadowed -- both dictionaries define it"
	 self assert: (env dictionariesDefiningClassNamed: #GsEnvScopeShadow) size >= 2.
	 "each class is in exactly its OWN dictionary, by identity"
	 self assert: (env class: fooA isDefinedInDictionaryNamed: #GsEnvScopeDictA).
	 self deny: (env class: fooA isDefinedInDictionaryNamed: #GsEnvScopeDictB).
	 self assert: (env class: fooB isDefinedInDictionaryNamed: #GsEnvScopeDictB).
	 self deny: (env class: fooB isDefinedInDictionaryNamed: #GsEnvScopeDictA).
	 "a symbol argument or a string argument both work"
	 self assert: (env class: fooA isDefinedInDictionaryNamed: 'GsEnvScopeDictA').
	 "a dictionary that does not exist is never in scope"
	 self deny: (env class: fooA isDefinedInDictionaryNamed: #GsEnvNoSuchDict_ZZZ)]
		ensure: [
			dictA removeKey: #GsEnvScopeShadow ifAbsent: [].
			dictB removeKey: #GsEnvScopeShadow ifAbsent: [].
			sl remove: dictA ifAbsent: [].
			sl remove: dictB ifAbsent: []]
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testDictionaryScopeCheckSkipsAnAnonymousDictionary [
	"An unnamed (anonymous) SymbolDictionary on the symbol list has a nil name.
	 The dictionary-scope check must skip it, not send #asSymbol to nil and abort
	 the scan for every dictionary-scoped rename -- even when the real target lives
	 in a normal, named dictionary. Self-contained: the anonymous dictionary (and the
	 fixture class it holds) are removed in an ensure: so nothing leaks into the stone."
	| sl env anon foo |
	sl := System myUserProfile symbolList.
	anon := SymbolDictionary new.
	self assert: anon name isNil.
	[sl add: anon.
	 foo := Object subclass: 'GsEnvAnonScopeFixture'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: anon.
	 env := GsRefactoringEnvironment new.

	 "The scan completes past the nil-named dictionary rather than raising."
	 self deny: (env class: foo isDefinedInDictionaryNamed: #GsEnvAnonNoSuchDict_ZZZ).
	 "And a class in a normal named dictionary is still resolved correctly."
	 self assert: (env class: self superFixture isDefinedInDictionaryNamed: #UserGlobals)]
		ensure: [
			anon removeKey: #GsEnvAnonScopeFixture ifAbsent: [].
			sl remove: anon ifAbsent: []]
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testFindsInstanceMethodsThatReadOrWriteTheInstVar [
	| sels |
	sels := GsRefactoringEnvironment new instanceMethodsAccessing: #alpha inClass: self superFixture.

	self assert: (sels includes: #readAlpha).
	self assert: (sels includes: #writeAlpha:).
	self deny: (sels includes: #noTouch)
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testHierarchyQueryIncludesTheDefiningClassAndAccessingSubclasses [
	| classes |
	classes := (GsRefactoringEnvironment new
		classesAndSelectorsAccessing: #alpha inHierarchyOf: self superFixture)
		collect: [:assoc | assoc key].

	self assert: (classes includes: self superFixture).
	self assert: (classes includes: self subFixture)
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testHierarchyQueryOmitsClassesThatNeverAccessTheInstVar [
	| classes |
	classes := (GsRefactoringEnvironment new
		classesAndSelectorsAccessing: #alpha inHierarchyOf: self superFixture)
		collect: [:assoc | assoc key].

	self deny: (classes includes: self noAccessFixture)
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testInstVarNameArgumentAcceptsAStringOrASymbol [
	| env |
	env := GsRefactoringEnvironment new.

	self assert: (env instanceMethodsAccessing: 'alpha' inClass: self superFixture)
		equals: (env instanceMethodsAccessing: #alpha inClass: self superFixture)
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testInstVarNameQueriesAnswerStringsNotSymbols [
	"#instVarNames / #allInstVarNames answer Symbols, but every caller compares the result
	 against a name that arrived as a String from the client, and on 3.6.x that comparison
	 can silently answer false (the Unicode-comparison trap). Normalising to Strings is what
	 makes those comparisons hold, so it is asserted rather than assumed."
	| env |
	env := GsRefactoringEnvironment new.

	"Pin the precondition: the loops below prove nothing if the query ever answers empty, so
	 assert non-empty first -- otherwise a regression to #() would pass this test vacuously."
	self deny: (env ownInstVarNamesOf: self subFixture) isEmpty.
	self deny: (env allInstVarNamesOf: self subFixture) isEmpty.

	(env ownInstVarNamesOf: self subFixture) do: [:each |
		self assert: each isString.
		self deny: each isSymbol].
	(env allInstVarNamesOf: self subFixture) do: [:each |
		self assert: each isString.
		self deny: each isSymbol].
	self assert: ((env ownInstVarNamesOf: self superFixture) includes: 'alpha')
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testOwnInstVarNamesExcludesInheritedOnes [
	"Own means declared here: the subclass answers its own two and not the inherited 'alpha'."
	| own |
	own := GsRefactoringEnvironment new ownInstVarNamesOf: self subFixture.

	self assert: own asArray equals: #('beta' 'gamma').
	self deny: (own includes: 'alpha')
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testOwnInstVarNamesIsEmptyForASubclassThatDeclaresNone [
	"The sibling declares nothing of its own, yet still inherits 'alpha'."
	| env |
	env := GsRefactoringEnvironment new.

	self assert: (env ownInstVarNamesOf: self noAccessFixture) isEmpty.
	self assert: ((env allInstVarNamesOf: self noAccessFixture) includes: 'alpha')
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testReadOnlyQueriesDoNotChangeCommitState [
	| env before |
	env := GsRefactoringEnvironment new.
	before := System needsCommit.

	env allClasses.
	env classNamed: #Object.
	env instanceMethodsAccessing: #alpha inClass: self superFixture.
	env classesAndSelectorsAccessing: #alpha inHierarchyOf: self superFixture.
	env ownInstVarNamesOf: self subFixture.
	env allInstVarNamesOf: self subFixture.
	env descendantsOf: self superFixture declaringInstVar: 'beta'.

	self assert: System needsCommit equals: before
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testTheInstVarNameQueriesHaveExactlyOneImplementationEach [
	"Issue #401: these one-liners used to be copy-pasted into four engine classes, which is
	 how they could drift apart. Each now has a single implementation, on the environment --
	 assert that, so a re-introduced copy (or a revived #ownInstVarsOf: / #allInstVarsOf:)
	 fails here instead of silently diverging again.

	 #implementorsOf: asks the RUNNING stone, so this asserts the state of the INSTALLED engine,
	 not the source on this branch. A failure right after editing source usually means the stone's
	 engine is stale -- reinstall it (npm run test:server:install-plugin) before reading it as a
	 real regression.

	 The revived-copy check is scoped to the four engine classes that once held the copies, not the
	 whole image: #ownInstVarsOf: / #allInstVarsOf: are generic enough that an unrelated class
	 adopting one should not fail a test guarding THIS drift."
	| env engineClasses |
	env := GsRefactoringEnvironment new.
	engineClasses := Array
		with: GsExtractSuperclassRefactoring
		with: GsInstVarRefactoring
		with: GsInstVarStructureRefactoring
		with: GsSplitClassRefactoring.

	#(#ownInstVarNamesOf: #allInstVarNamesOf:) do: [:sel |
		self assert: ((env implementorsOf: sel) collect: [:m | m inClass])
			equals: (Array with: GsRefactoringEnvironment)].
	#(#ownInstVarsOf: #allInstVarsOf:) do: [:sel |
		| implementorClasses |
		implementorClasses := (env implementorsOf: sel) collect: [:m | m inClass].
		engineClasses do: [:cls |
			self deny: (implementorClasses includes: cls)]]
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testUnknownClassNameResolvesToNil [
	self assert: (GsRefactoringEnvironment new classNamed: #GsNoSuchClass_ZZZ) isNil
]
