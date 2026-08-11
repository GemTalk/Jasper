"
A read-only wrapper over the whole symbol list -- ALL dictionaries, not just
UserGlobals -- that answers the structural questions a refactoring asks before
it changes anything: which classes exist and where, and which methods read or
write a given instance variable across a class hierarchy.

Instance-variable access is found with bytecode-level reflection
(GsNMethod>>instVarsAccessed), so it needs no source parse and finds accesses
the source text alone might miss. Every query here is read-only: nothing in
this class compiles a method or commits the transaction.
"
Class {
	#name : 'GsRefactoringEnvironment',
	#superclass : 'Object',
	#instVars : [
		'symbolList'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsRefactoringEnvironment class >> new [
	"An environment over the current session's whole symbol list (all
	 dictionaries), which is the rename scope this engine operates in."
	^self onSymbolList: System myUserProfile symbolList
]

{ #category : 'instance creation' }
GsRefactoringEnvironment class >> onSymbolList: aSymbolList [
	^self basicNew setSymbolList: aSymbolList
]

{ #category : 'enumerating' }
GsRefactoringEnvironment >> allClasses [
	"Every class reachable in any dictionary of the symbol list, de-duplicated by
	 identity. Walks ALL dictionaries, not just UserGlobals."
	| set |
	set := IdentitySet new.
	self dictionariesDo: [:dict |
		dict do: [:value | (value isKindOf: Class) ifTrue: [set add: value]]].
	^set
]

{ #category : 'instance variables' }
GsRefactoringEnvironment >> classesAndSelectorsAccessing: anInstVarName inHierarchyOf: aClass [
	"The rename-instVar affected set: for aClass and every subclass, an
	 Association class -> sorted selectors of the instance methods that access
	 the named instance variable. Classes with no accessing method are omitted.
	 Read-only; computes nothing on the persistent store."
	| sym result classesToScan |
	sym := anInstVarName asSymbol.
	result := OrderedCollection new.
	classesToScan := OrderedCollection new.
	classesToScan add: aClass.
	classesToScan addAll: aClass allSubclasses.
	classesToScan do: [:cls | | sels |
		sels := self instanceMethodsAccessing: sym inClass: cls.
		sels isEmpty ifFalse: [result add: cls -> sels]].
	^result
]

{ #category : 'class variables' }
GsRefactoringEnvironment >> methodsAccessingClassVar: anAssociation inHierarchyOf: aClass [
	"The rename-classVar affected set: every method -- instance AND class side, in
	 aClass and every subclass -- whose compiled code references the class variable
	 whose binding is anAssociation, as an Array of GsNMethod (each answers its own
	 inClass and selector). Detection is bytecode-precise: a method references the class
	 variable iff its literal frame holds the exact association object, so a same-named
	 GLOBAL (a different association) and a shadowing temporary/argument (no association
	 literal) are both excluded. Read-only; computes nothing on the persistent store."
	| result classesToScan |
	result := OrderedCollection new.
	classesToScan := OrderedCollection new.
	classesToScan add: aClass.
	classesToScan addAll: aClass allSubclasses.
	classesToScan do: [:cls |
		self addMethodsAccessing: anAssociation inBehavior: cls to: result.
		self addMethodsAccessing: anAssociation inBehavior: cls class to: result].
	^result asArray
]

{ #category : 'class variables' }
GsRefactoringEnvironment >> addMethodsAccessing: anAssociation inBehavior: aBehavior to: aCollection [
	"Add to aCollection each of aBehavior's OWN methods (environment 0) whose literal
	 frame holds anAssociation by identity -- i.e. that reference the class variable
	 bound to it. aBehavior is a class or a metaclass (for the class side)."
	aBehavior selectors do: [:sel | | m |
		m := aBehavior compiledMethodAt: sel environmentId: 0 otherwise: nil.
		(m notNil and: [m literals anySatisfy: [:e | e == anAssociation]])
			ifTrue: [aCollection add: m]]
]

{ #category : 'selectors' }
GsRefactoringEnvironment >> implementorsOf: aSelector [
	"Every method that implements aSelector anywhere in the image, as an Array of
	 GsNMethod (instance- and class-side both; each answers its own inClass). Uses
	 the same ClassOrganizer reflection the client's implementorsOf query uses, so
	 the engine and the client agree on the affected set. Read-only."
	^(ClassOrganizer new implementorsOf: aSelector asSymbol) asArray
]

{ #category : 'selectors' }
GsRefactoringEnvironment >> sendersOf: aSelector [
	"Every method that sends aSelector anywhere in the image, as an Array of
	 GsNMethod. Uses the same ClassOrganizer reflection the client's sendersOf
	 query uses. Read-only; compiles and commits nothing."
	^(ClassOrganizer new sendersOf: aSelector asSymbol) at: 1
]

{ #category : 'selectors' }
GsRefactoringEnvironment >> referencesToClassNamed: aName [
	"Every method whose compiled code references the class currently bound to aName
	 (across all dictionaries), as an Array of GsNMethod. These are the method bodies
	 whose source names the class as a global -- exactly the references a rename must
	 rewrite. Uses the same ClassOrganizer reflection the client's referencesToObject
	 query uses. Read-only; returns an empty Array if the name is unbound."
	| obj |
	obj := self classNamed: aName.
	obj isNil ifTrue: [^Array new].
	^(ClassOrganizer new referencesToObject: obj) asArray
]

{ #category : 'enumerating' }
GsRefactoringEnvironment >> descendantsOf: aClass [
	"aClass's subclasses, ordered top-down (a superclass always precedes its own
	 subclasses), de-duplicated by identity. A rename re-parents the whole descendant
	 subtree, and it must recompile a parent before its children so each child
	 re-points at the freshly created parent version. Read-only."
	| ordered seen frontier |
	ordered := OrderedCollection new.
	seen := IdentitySet new.
	frontier := OrderedCollection new.
	frontier addAll: (aClass subclasses ifNil: [#()]).
	[frontier isEmpty] whileFalse: [
		| cls |
		cls := frontier removeFirst.
		(seen includes: cls) ifFalse: [
			seen add: cls.
			ordered add: cls.
			frontier addAll: (cls subclasses ifNil: [#()])]].
	^ordered asArray
]

{ #category : 'accessing' }
GsRefactoringEnvironment >> classNamed: aName [
	"The first class bound to aName across all dictionaries (symbol-list order),
	 or nil. Mirrors objectNamed: shadowing so it agrees with the running image."
	| sym |
	sym := aName asSymbol.
	self dictionariesDo: [:dict |
		(dict at: sym ifAbsent: [nil]) ifNotNil: [:v |
			(v isKindOf: Class) ifTrue: [^v]]].
	^nil
]

{ #category : 'accessing' }
GsRefactoringEnvironment >> dictionariesDefiningClassNamed: aName [
	"Every dictionary in which aName is bound to a class. More than one means the
	 name is shadowed; the result documents the all-dictionaries coverage a
	 rename must reckon with."
	| sym result |
	sym := aName asSymbol.
	result := OrderedCollection new.
	self dictionariesDo: [:dict |
		(dict at: sym ifAbsent: [nil]) ifNotNil: [:v |
			(v isKindOf: Class) ifTrue: [result add: dict]]].
	^result
]

{ #category : 'enumerating' }
GsRefactoringEnvironment >> dictionariesDo: aBlock [
	"Evaluate aBlock with each SymbolDictionary on the symbol list, in order."
	symbolList do: aBlock
]

{ #category : 'instance variables' }
GsRefactoringEnvironment >> instanceMethodsAccessing: anInstVarName inClass: aClass [
	"Selectors of aClass's OWN instance methods (environment 0) that read or write
	 the named instance variable, sorted. Uses bytecode-level reflection
	 (GsNMethod>>instVarsAccessed), so it needs no source parse and finds
	 accesses the source text alone could miss. The name is normalised to a
	 Symbol so a String or Symbol argument both work (and compare correctly on a
	 Unicode-comparison stone)."
	| sym result |
	sym := anInstVarName asSymbol.
	result := OrderedCollection new.
	aClass selectors do: [:sel | | m |
		m := aClass compiledMethodAt: sel environmentId: 0 otherwise: nil.
		(m notNil and: [m instVarsAccessed includes: sym])
			ifTrue: [result add: sel]].
	^result asSortedCollection asArray
]

{ #category : 'instance variables' }
GsRefactoringEnvironment >> classesAndSelectorsShadowing: anInstVarName inHierarchyOf: aClass [
	"The add-instVar collision set: for aClass and every subclass, an Association
	 class -> sorted selectors of the OWN instance methods that already declare a
	 method-level TEMPORARY or a method ARGUMENT of that name. Classes with no such
	 method are omitted.

	 Those methods stop compiling the moment an instance variable of the name becomes
	 visible to them. Verified against live 3.6.2 and 3.7.5 stones: a method temporary
	 or argument that shadows an instance variable is REFUSED (compileMethod: answers an
	 error Array instead of raising, and the method is not installed), while a BLOCK
	 argument or a block-level temporary of the same name is accepted at any nesting --
	 hence only the method's own arguments and its top-level temporaries count here.

	 Source-based: a compiled method keeps no temporary/argument NAMES (there is no
	 #temporaryNames on GsNMethod), so each method's source is parsed. A method whose
	 source does not parse is skipped rather than guessed at. Read-only."
	| sym result classesToScan |
	sym := anInstVarName asSymbol.
	result := OrderedCollection new.
	classesToScan := OrderedCollection new.
	classesToScan add: aClass.
	classesToScan addAll: aClass allSubclasses.
	classesToScan do: [:cls | | sels |
		sels := self instanceMethodsShadowing: sym inClass: cls.
		sels isEmpty ifFalse: [result add: cls -> sels]].
	^result
]

{ #category : 'instance variables' }
GsRefactoringEnvironment >> instanceMethodsShadowing: anInstVarName inClass: aClass [
	"Selectors of aClass's OWN instance methods (environment 0) whose source declares a
	 method argument or a method-level temporary named anInstVarName, sorted. See
	 #classesAndSelectorsShadowing:inHierarchyOf: for why only those two forms count."
	| sym name result |
	sym := anInstVarName asSymbol.
	name := anInstVarName asString.
	result := OrderedCollection new.
	aClass selectors do: [:sel | | m src tree |
		m := aClass compiledMethodAt: sel environmentId: 0 otherwise: nil.
		m isNil ifFalse: [
			src := m sourceString.
			"Cheap pre-filter: a method can only DECLARE the name if the name appears in its source
			 at all. This runs on every add-preview over the whole subtree, so it keeps the parse --
			 by far the expensive part -- off the overwhelming majority of methods."
			(src indexOfSubCollection: name) > 0 ifTrue: [
				tree := [RBParser parseMethod: src] on: Error do: [:e | nil].
				(tree notNil and: [self methodNode: tree declares: sym])
					ifTrue: [result add: sel]]]].
	^result asSortedCollection asArray
]

{ #category : 'compiling' }
GsRefactoringEnvironment >> compile: source into: aBehavior category: aCategory [
	"Compile one method onto aBehavior and RAISE when it does not compile.

	 Behavior>>compileMethod:dictionaries:category: reports a compile failure in its RETURN
	 VALUE -- nil (or an empty Array) on success, an Array of error tuples otherwise -- and
	 does NOT signal. An unchecked send therefore reads as success while the method is never
	 installed: the caller counts it as applied and the user is told nothing. Raising puts the
	 failure back onto the path every apply loop already guards with on: Error do:, so it is
	 recorded in `failed` and reported like any other."
	| result |
	result := aBehavior
		compileMethod: source
		dictionaries: System myUserProfile symbolList
		category: aCategory.
	result isNil ifTrue: [^self].
	(result isKindOf: Array)
		ifFalse: [^self error: 'did not recompile'].
	result isEmpty ifTrue: [^self].
	self error: 'did not recompile: ', (self compileErrorTextFrom: result first)
]

{ #category : 'private' }
GsRefactoringEnvironment >> compileErrorTextFrom: aTuple [
	"Readable text for one compiler error tuple -- (number, offset, message, nil, symbol) --
	 falling back to a printString when it is not shaped as expected."
	| text sym |
	(aTuple isKindOf: Array) ifFalse: [^aTuple printString].
	text := (aTuple size >= 3 and: [(aTuple at: 3) notNil])
		ifTrue: [(aTuple at: 3) asString]
		ifFalse: ['compile error'].
	sym := aTuple size >= 5 ifTrue: [aTuple at: 5] ifFalse: [nil].
	^sym isNil ifTrue: [text] ifFalse: [text, ' (', sym asString, ')']
]

{ #category : 'private' }
GsRefactoringEnvironment >> methodNode: aMethodNode declares: aSymbol [
	"Whether aMethodNode's own arguments or top-level temporaries bind aSymbol. Block
	 arguments and block temporaries are deliberately NOT consulted -- GemStone lets those
	 shadow an instance variable."
	(aMethodNode arguments anySatisfy: [:a | a name asSymbol == aSymbol]) ifTrue: [^true].
	aMethodNode body isNil ifTrue: [^false].
	^aMethodNode body temporaries anySatisfy: [:t | t name asSymbol == aSymbol]
]

{ #category : 'private' }
GsRefactoringEnvironment >> setSymbolList: aSymbolList [
	symbolList := aSymbolList
]

{ #category : 'accessing' }
GsRefactoringEnvironment >> symbolList [
	^symbolList
]
