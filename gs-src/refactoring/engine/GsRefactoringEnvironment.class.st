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

{ #category : 'enumerating' }
GsRefactoringEnvironment >> descendantsOf: aClass declaringInstVar: aName [
	"Every descendant of aClass that declares aName as its OWN instance variable. Once aName is
	 added to aClass each of those descendants would carry two of that name, which the
	 class-creation primitive rejects (error 2271) -- and it rejects it MID-apply, after earlier
	 classes have already been versioned. Callers decline up front and name the offenders instead.

	 Shared by every refactoring that introduces an instance variable on an existing class (V1 add,
	 V8 split), so the check and its cross-version behaviour live in one place. Read-only.

	 aName is normalised to a String because #ownInstVarNamesOf: answers Strings; a caller passing a
	 Symbol would otherwise hit the same 3.6.x Unicode-comparison trap on the argument side and get a
	 silently empty answer. Both #instVarNameArgument callers already accept either, so we match that."
	| name |
	name := aName asString.
	^(self descendantsOf: aClass)
		select: [:d | (self ownInstVarNamesOf: d) includes: name]
]

{ #category : 'enumerating' }
GsRefactoringEnvironment >> classVarNamesVisibleTo: aClass [
	"aClass's own and inherited class-variable names, as a Set of Strings. A new instance variable
	 of the same name would shadow one of these inside method bodies, so callers decline it.
	 Read-only."
	| result cls |
	result := Set new.
	cls := aClass.
	[cls isNil] whileFalse: [
		(cls classVarNames ifNil: [#()]) do: [:n | result add: n asString].
		cls := cls superclass].
	^result
]

{ #category : 'instance variables' }
GsRefactoringEnvironment >> ownInstVarNamesOf: aClass [
	"aClass's OWN instance-variable names (not inherited), as an Array of Strings, in
	 declaration order -- which is the order a class-creation change must preserve.

	 Strings, not the Symbols #instVarNames answers, because every caller compares them
	 against a name that arrived as a String from the client. Comparing a Symbol against
	 such a String can silently answer false on 3.6.x (the Unicode-comparison trap), so
	 normalising here is what makes those comparisons hold across releases.

	 Shared by every refactoring that reasons about instance-variable structure --
	 add/remove, push up/down/move, extract superclass, split class -- so the
	 normalisation lives in one place. Read-only.

	 The ifNil: guard is defensive only: a live class always answers an Array from #instVarNames, so
	 nil is not expected to be reachable here. It mirrors the guard #descendantsOf:declaringInstVar:
	 already carried and keeps the answer an empty Array rather than raising if that ever changes."
	^(aClass instVarNames ifNil: [#()]) collect: [:e | e asString]
]

{ #category : 'instance variables' }
GsRefactoringEnvironment >> allInstVarNamesOf: aClass [
	"aClass's own AND inherited instance-variable names, as an Array of Strings, inherited
	 first -- the slot order of an instance. Callers use it to ask whether a name is already
	 visible to aClass (its own or any superclass's). See #ownInstVarNamesOf: for why these
	 are Strings. Read-only."
	^(aClass allInstVarNames ifNil: [#()]) collect: [:e | e asString]
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

{ #category : 'accessing' }
GsRefactoringEnvironment >> class: aClass isDefinedInDictionaryNamed: aName [
	"True iff aClass -- BY IDENTITY -- is the class bound to its own name in a
	 dictionary named aName. Identity, not name equality: when a name is bound in
	 more than one dictionary (a shadowed class), a DIFFERENT class of the same
	 name in another dictionary is NOT in scope. Matching by name alone pulled such
	 a sibling into a single-dictionary scope, staging it as a duplicate change row
	 for the 'same' class -- the #dictionary-scope duplicate the rename preview
	 showed. Dictionary names and the class name are compared as Symbols so the
	 3.6.x Unicode-comparison trap never bites. An unnamed (anonymous) dictionary has
	 a nil name -- skip it rather than send #asSymbol to nil and abort the whole scan."
	| wanted nameSym |
	wanted := aName asSymbol.
	nameSym := aClass name asSymbol.
	self dictionariesDo: [:dict | | dn |
		dn := dict name.
		(dn notNil
			and: [dn asSymbol == wanted
				and: [(dict at: nameSym ifAbsent: [nil]) == aClass]])
				ifTrue: [^true]].
	^false
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

	 Raising puts the failure back onto the path every apply loop already guards with
	 on: Error do:, so it is recorded in `failed` and reported like any other. Use this
	 wherever a failed method should abort its own change and nothing more. Where a failure
	 must NOT abort the surrounding work -- the copy-forward loops that carry a class's whole
	 method dictionary onto a new version -- use copyMethod:from:to:source:meta:into: instead."
	| text |
	text := self compileFailureFor: source into: aBehavior category: aCategory.
	text isNil ifTrue: [^self].
	self error: 'did not recompile: ', text
]

{ #category : 'compiling' }
GsRefactoringEnvironment >> environmentId [
	"The GemStone method environment the engines compile into. Always 0 (the base Smalltalk
	 image) today.

	 This is a seam, not a setting. What will eventually go here is the environment the
	 refactoring was STARTED in, carried down from the client: a method URI already knows its
	 environment (`?env=N`), but that dimension is dropped before any engine query, so the
	 engines have nowhere to read it from -- no instance variable, no field on
	 GsRefactoringChange, nothing in the JSON protocol. Filling that in is real work, tracked
	 in https://github.com/GemTalk/Jasper/issues/492 along with the compile-selector migration
	 that has to happen first: compileMethod:dictionaries:category: takes no environment
	 argument at all, so until we move off it there is nowhere to pass this.

	 It exists now so that when both land there is ONE place to change rather than a sweep --
	 the engines' other environmentId: 0 sites (the compiledMethodAt:/categoryOfSelector: reads)
	 are deliberately left alone until there is a real environment to read."
	^0
]

{ #category : 'compiling' }
GsRefactoringEnvironment >> compileFailureFor: source into: aBehavior category: aCategory [
	"Compile one method onto aBehavior. Answer nil when it compiled, or readable error text
	 when it did not.

	 Behavior>>compileMethod:dictionaries:category: reports a compile failure in its RETURN
	 VALUE -- nil (or an empty Array) on success, an Array of error tuples otherwise -- and
	 does NOT signal. An unchecked send therefore reads as success while the method is never
	 installed: the caller counts it as applied and the user is told nothing. Every compile in
	 the engines goes through this one method, so no site can forget to look at the answer.

	 The selector used here takes no environment argument -- it hardwires environment 0 -- which
	 is why #environmentId has no sender yet. See that method."
	| result |
	result := aBehavior
		compileMethod: source
		dictionaries: System myUserProfile symbolList
		category: aCategory.
	result isNil ifTrue: [^nil].
	"An unexpected shape is exactly when whoever debugs this most needs to see what came
	 back, and compileErrorTextFrom: already falls back to a printString for it."
	(result isKindOf: Array) ifFalse: [^self compileErrorTextFrom: result].
	result isEmpty ifTrue: [^nil].
	^self compileErrorTextFrom: result first
]

{ #category : 'compiling' }
GsRefactoringEnvironment >> copyMethod: sel from: srcCls to: dstCls source: source meta: isMeta into: failures [
	"Compile `source` onto dstCls as sel, preserving sel's category on srcCls -- without that
	 the method silently lands in 'as yet unclassified'.

	 This is the copy-forward counterpart to compile:into:category:. A new class version starts
	 with an empty method dictionary, so these loops are the only thing carrying a class's
	 behaviour across, and they run inside a single per-class change: raising would abort an
	 entire rename or split over one method that will not recompile. Record the method in
	 `failures` and keep going instead, so the rest of the class still arrives and the user is
	 still told which method did not.

	 Answer whether the method compiled."
	| cat text label |
	cat := (srcCls categoryOfSelector: sel environmentId: 0) ifNil: ['as yet unclassified'].
	text := self compileFailureFor: source into: dstCls category: cat asString.
	text isNil ifTrue: [^true].
	label := isMeta
		ifTrue: [dstCls thisClass name asString, ' class>>', sel asString]
		ifFalse: [dstCls name asString, '>>', sel asString].
	failures add: (Array with: label with: label with: 'did not recompile: ', text).
	^false
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
