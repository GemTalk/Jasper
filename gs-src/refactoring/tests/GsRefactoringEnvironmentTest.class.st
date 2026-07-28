"
Correctness of the read-only all-dictionaries environment: class resolution
and enumeration span every dictionary (not just UserGlobals); instance-variable
access is found for reads and writes across a class hierarchy and excludes
methods that never touch the variable; the instance-variable name argument
accepts a String or a Symbol; and the queries never dirty the transaction.

setUp builds a throwaway three-class hierarchy in UserGlobals and tearDown
removes it, so the assertions have known, self-contained answers.
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
	 writer and a non-accessing method; a subclass that reads the inherited
	 'alpha'; and a sibling subclass that never touches it."
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
		instVarNames: #()
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
GsRefactoringEnvironmentTest >> testClassNamedResolvesClassesFromAnyDictionary [
	| env |
	env := GsRefactoringEnvironment new.

	self assert: (env classNamed: #Object) == Object.
	self assert: (env classNamed: #GsRefEnvFixtureSuper) == self superFixture
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
GsRefactoringEnvironmentTest >> testReadOnlyQueriesDoNotChangeCommitState [
	| env before |
	env := GsRefactoringEnvironment new.
	before := System needsCommit.

	env allClasses.
	env classNamed: #Object.
	env instanceMethodsAccessing: #alpha inClass: self superFixture.
	env classesAndSelectorsAccessing: #alpha inHierarchyOf: self superFixture.

	self assert: System needsCommit equals: before
]

{ #category : 'tests' }
GsRefactoringEnvironmentTest >> testUnknownClassNameResolvesToNil [
	self assert: (GsRefactoringEnvironment new classNamed: #GsNoSuchClass_ZZZ) isNil
]
