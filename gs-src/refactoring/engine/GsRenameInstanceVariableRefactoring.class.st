"
Rename an instance variable across a class and all of its subclasses, over ALL
symbol-list dictionaries, without committing. This is the first refactoring the
engine ships.

It combines the environment and change-set with the vendored AST substrate:

  - GsRefactoringEnvironment finds the affected methods reflectively
    (GsNMethod>>instVarsAccessed), so the candidate set is exactly the methods
    that really read or write the variable -- a method whose own temp or
    argument shadows the variable is never a candidate, because at the bytecode
    level it does not access the instance variable at all.

  - RBParser parses each affected method and a scope-aware walk renames only the
    RBVariableNode occurrences that resolve to the instance variable, leaving a
    same-named block argument or temporary alone (the mixed case: a method that
    both accesses the ivar AND has a block temp of the same name). The rewriter's
    own #replace:with: is deliberately NOT used here -- it is scope-blind and
    would rename a shadowing argument's references while leaving its declaration,
    producing broken source.

  - The class definition itself is edited to carry the new instVarNames list.

Everything is staged into a GsRefactoringChangeSet: nothing here compiles a
method or commits the transaction. The client previews the change set (per-change
before/after), the user selects which changes to keep, and the client recompiles
only those -- still without committing.
"
Class {
	#name : 'GsRenameInstanceVariableRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'definingClass',
		'oldName',
		'newName',
		'oldNameSym',
		'changeSet'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsRenameInstanceVariableRefactoring class >> class: aClass renameInstVar: oldNameString to: newNameString [
	"Rename in the scope of the whole current symbol list (all dictionaries)."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldName: oldNameString
		newName: newNameString
]

{ #category : 'instance creation' }
GsRenameInstanceVariableRefactoring class >> environment: anEnvironment class: aClass oldName: oldNameString newName: newNameString [
	^self new
		setEnvironment: anEnvironment
		class: aClass
		oldName: oldNameString
		newName: newNameString
]

{ #category : 'accessing' }
GsRenameInstanceVariableRefactoring >> changeSet [
	"The staged, non-committing change set for this rename, computed once and
	 cached. Building it compiles nothing and commits nothing."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'building' }
GsRenameInstanceVariableRefactoring >> buildChangeSet [
	| cs |
	cs := GsRefactoringChangeSet new.
	self stageMethodRecompilesInto: cs.
	self stageClassDefinitionEditInto: cs.
	^cs
]

{ #category : 'accessing' }
GsRenameInstanceVariableRefactoring >> definingClass [
	^definingClass
]

{ #category : 'private' }
GsRenameInstanceVariableRefactoring >> dictNameForClass: aClass [
	"The name of the dictionary that binds aClass ITSELF, for the `dictName` recorded on a staged
	 change. Resolved by identity through the environment: taking the first dictionary that binds
	 the NAME records a different class's dictionary whenever the name is shadowed, and the apply
	 then writes the change there (#396). nil when no dictionary binds the
	 class under its own name, which the apply falls back on as before."
	^(environment dictionaryDefiningClass: aClass)
		ifNil: [nil]
		ifNotNil: [:dict | dict name ifNil: [nil] ifNotNil: [:n | n asString]]
]

{ #category : 'accessing' }
GsRenameInstanceVariableRefactoring >> environment [
	^environment
]

{ #category : 'private' }
GsRenameInstanceVariableRefactoring >> node: aNode declaresName: aSymbol [
	"Does aNode introduce a scope binding (argument or temporary) for aSymbol?
	 A method or block declares its arguments; a sequence declares its
	 temporaries. Such a binding shadows the instance variable for that scope."
	(aNode isMethod or: [aNode isBlock])
		ifTrue: [^(aNode arguments
			detect: [:a | a name asSymbol == aSymbol] ifNone: [nil]) notNil].
	aNode isSequence
		ifTrue: [^(aNode temporaries
			detect: [:t | t name asSymbol == aSymbol] ifNone: [nil]) notNil].
	^false
]

{ #category : 'accessing' }
GsRenameInstanceVariableRefactoring >> newName [
	^newName
]

{ #category : 'accessing' }
GsRenameInstanceVariableRefactoring >> oldName [
	^oldName
]

{ #category : 'accessing' }
GsRenameInstanceVariableRefactoring >> previewJsonString [
	"The change-set preview the client fetches over GCI: a JSON array of staged
	 changes with per-change before/after source."
	^self changeSet jsonString
]

{ #category : 'private' }
GsRenameInstanceVariableRefactoring >> renameInSource: aString [
	"Parse aString, rename the non-shadowed references to the instance variable,
	 and return the regenerated source -- or nil if nothing was renamed (so the
	 caller stages no spurious change from mere reformatting)."
	| tree count |
	tree := RBParser parseMethod: aString.
	count := self renameNodesIn: tree shadowed: false.
	count = 0 ifTrue: [^nil].
	^tree formattedCode
]

{ #category : 'private' }
GsRenameInstanceVariableRefactoring >> renameInstVarInDefinition: defString [
	"Return defString with the old instance-variable name replaced by the new one
	 inside the instVarNames: #( ... ) clause only. Tokenises the clause on
	 whitespace and rebuilds it, so a class variable or the class name sharing the
	 old spelling is untouched. Returns defString unchanged if no clause is found."
	| start openParen closeParen listStr names separators ws |
	start := defString indexOfSubCollection: 'instVarNames:'.
	start = 0 ifTrue: [^defString].
	openParen := defString indexOf: $( startingAt: start.
	openParen = 0 ifTrue: [^defString].
	closeParen := defString indexOf: $) startingAt: openParen.
	closeParen = 0 ifTrue: [^defString].
	listStr := defString copyFrom: openParen + 1 to: closeParen - 1.
	separators := String with: $  with: Character tab with: Character lf with: Character cr.
	names := (listStr subStrings: separators) reject: [:n | n isEmpty].
	ws := WriteStream on: String new.
	ws nextPutAll: (defString copyFrom: 1 to: openParen).
	names do: [:n |
		ws nextPut: $ ;
		   nextPutAll: (n asSymbol == oldNameSym ifTrue: [newName] ifFalse: [n])].
	ws nextPutAll: (defString copyFrom: closeParen to: defString size).
	^ws contents
]

{ #category : 'private' }
GsRenameInstanceVariableRefactoring >> renameNodesIn: aNode shadowed: shadowed [
	"Recursively rename the instance-variable references at and under aNode,
	 returning how many nodes were renamed. shadowed is true when a same-named
	 argument or temporary in an enclosing scope has captured the name, in which
	 case no node here refers to the instance variable. A variable node is
	 renamed in place by setting its token value, which is what formattedCode
	 prints. Declaration nodes (arguments, temporaries) are visited as children
	 with shadowed already true for their own name, so they are never renamed."
	| count childShadowed |
	aNode isVariable ifTrue: [
		(shadowed not and: [aNode name asSymbol == oldNameSym])
			ifTrue: [aNode token value: newName. ^1].
		^0].
	count := 0.
	childShadowed := shadowed or: [self node: aNode declaresName: oldNameSym].
	aNode children do: [:child |
		count := count + (self renameNodesIn: child shadowed: childShadowed)].
	^count
]

{ #category : 'private' }
GsRenameInstanceVariableRefactoring >> setEnvironment: anEnvironment class: aClass oldName: oldNameString newName: newNameString [
	environment := anEnvironment.
	definingClass := aClass.
	oldName := oldNameString asString.
	newName := newNameString asString.
	oldNameSym := oldNameString asSymbol
]

{ #category : 'private' }
GsRenameInstanceVariableRefactoring >> stageClassDefinitionEditInto: aChangeSet [
	"Stage the edit to the defining class's own definition: the instVarNames list
	 with the variable renamed. No compile, no commit."
	| oldDef newDef |
	oldDef := definingClass definition.
	newDef := self renameInstVarInDefinition: oldDef.
	newDef = oldDef ifTrue: [^self].
	aChangeSet
		addClassDefinitionEditInDictionary: (self dictNameForClass: definingClass)
		className: definingClass name
		oldSource: oldDef
		newSource: newDef
]

{ #category : 'private' }
GsRenameInstanceVariableRefactoring >> stageMethodRecompilesInto: aChangeSet [
	"Stage a recompile for every instance method (defining class and subclasses)
	 that accesses the instance variable and whose non-shadowed references change."
	| affected |
	affected := environment
		classesAndSelectorsAccessing: oldName
		inHierarchyOf: definingClass.
	affected do: [:assoc | | cls dn |
		cls := assoc key.
		dn := self dictNameForClass: cls.
		assoc value do: [:sel | | m oldSrc newSrc cat |
			m := cls compiledMethodAt: sel environmentId: 0 otherwise: nil.
			m ifNotNil: [
				oldSrc := m sourceString.
				newSrc := self renameInSource: oldSrc.
				newSrc ifNotNil: [
					cat := ((cls categoryOfSelector: sel environmentId: 0)
						ifNil: ['as yet unclassified']) asString.
					aChangeSet
						addMethodRecompileInDictionary: dn
						className: cls name
						isMeta: false
						selector: sel
						category: cat
						oldSource: oldSrc
						newSource: newSrc]]]]
]

{ #category : 'applying' }
GsRenameInstanceVariableRefactoring class >> applyForToken: token deselected: deselectedIds [
	"Apply a previously-started preview (by token), skipping deselectedIds. No
	 commit. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'applying' }
GsRenameInstanceVariableRefactoring >> applyDeselected: deselectedIds [
	"Apply the rename in the stone WITHOUT committing (the user commits explicitly).

	 Renaming an instance variable RESHAPES the defining class, and a reshape means a
	 NEW CLASS VERSION whose method dictionary starts EMPTY. Recompiling only the
	 methods in the change set would therefore destroy every other method on the class
	 -- including class-side methods, which can never appear in the change set because
	 they cannot access an instance variable at all. So every method is COPIED FORWARD
	 onto the new version: the accessing ones with their rewritten source, the rest
	 verbatim. Same for every subclass, which is re-versioned in turn because its
	 superclass changed shape.

	 A change whose id is in deselectedIds is deliberately NOT carried forward -- the
	 user chose to drop that method rather than have it reference the new name. That is
	 the only way a method disappears here.

	 Answers {applied, failed:[..]}."
	| deselected failures applied newDefining oldToNew |
	deselected := self deselectedSelectorsFrom: deselectedIds.
	failures := OrderedCollection new.
	applied := 0.
	oldToNew := IdentityDictionary new.
	newDefining := self
		reversion: definingClass
		superclass: definingClass superclass
		instVarNames: (self renamedInstVarNamesOf: definingClass)
		deselected: deselected
		into: failures.
	oldToNew at: definingClass put: newDefining.
	applied := applied + 1.
	(environment descendantsOf: definingClass) do: [:sub | | parent |
		"Identity, never name. A grandchild's parent is the version this loop just made,
		 and looking that parent up by name lands on whichever dictionary comes first --
		 which for a shadowed name is a different class entirely, and re-parents the
		 grandchild onto it (#396)."
		parent := oldToNew at: sub superclass ifAbsent: [sub superclass].
		oldToNew at: sub put: (self
			reversion: sub
			superclass: parent
			instVarNames: (sub instVarNames collect: [:e | e asString])
			deselected: deselected
			into: failures).
		applied := applied + 1].
	^self applyEnvelopeApplied: applied failures: failures
]

{ #category : 'private - applying' }
GsRenameInstanceVariableRefactoring >> applyEnvelopeApplied: applied failures: failures [
	"The {applied, failed:[..]} envelope the client parses, matching the other
	 refactorings' apply results."
	^'{"applied":', applied printString,
	  ',"failed":[',
	  ((failures collect: [:f |
		'{"id":', (self jsonQuote: (f at: 1)),
		',"label":', (self jsonQuote: (f at: 2)),
		',"error":', (self jsonQuote: (f at: 3)), '}'])
			inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ',', s]]),
	  ']}'
]

{ #category : 'private - applying' }
GsRenameInstanceVariableRefactoring >> deselectedSelectorsFrom: deselectedIds [
	"The methods the user chose not to carry forward, as an IdentityDictionary of
	 class -> IdentitySet of selectors. Ids that name no staged change, and ids whose
	 change names a class that no longer resolves, are ignored.

	 Keyed by the CLASS, not by a 'Class>>sel' string: two dictionaries can bind the same
	 class name, and a name key deselects the other dictionary's method too -- silently
	 dropping it from its new version (#396).

	 The ids arrive from the client as literals in GCI-compiled source, which 3.6.2 can
	 promote to Unicode strings; comparing one of those to the change's own (byte)
	 String raises 'Unicode argument disallowed in String comparison' (error 2718).
	 asSymbol canonicalises both sides, so the comparison is an identity test on
	 Symbols and never touches String comparison. (Same workaround as
	 GsRenameMethodRefactoring.)"
	| ids result |
	result := IdentityDictionary new.
	ids := ((deselectedIds ifNil: [#()]) collect: [:e | e asSymbol]) asIdentitySet.
	self changeSet changes do: [:c | | cls |
		((ids includes: c id asSymbol) and: [c kind = #methodRecompile])
			ifTrue: [
				cls := environment classForChange: c.
				cls notNil ifTrue: [
					(result at: cls ifAbsentPut: [IdentitySet new]) add: c selector asSymbol]]].
	^result
]

{ #category : 'private - applying' }
GsRenameInstanceVariableRefactoring >> deselected: aMap includes: aSelector for: aClass [
	"Whether aClass's aSelector is one the user deselected. By class identity."
	^(aMap at: aClass ifAbsent: [nil])
		ifNil: [false]
		ifNotNil: [:sels | sels includes: aSelector asSymbol]
]

{ #category : 'private - applying' }
GsRenameInstanceVariableRefactoring >> newSourceFor: aClass selector: aSelector [
	"The rewritten source staged for this method, or nil when no change was staged
	 (the method does not access the variable and is carried forward verbatim).

	 The change is matched to aClass by LINEAGE, not by name. Matching on the name alone
	 compiles a same-named class's rewritten source into this one (#396). It cannot match on
	 the class object either: this runs during copy-forward, after the defining class has been
	 re-versioned, so the change's dictionary already binds the NEW version while aClass is
	 still the old one. A class history is shared by every version of one class and by no
	 other class, which is exactly the distinction wanted."
	| mine |
	mine := self lineageOf: aClass.
	^(self changeSet changes
		detect: [:c | | cls |
			c kind = #methodRecompile
				and: [c selector asString = aSelector asString
					and: [cls := environment classForChange: c.
						  mine isNil
							ifTrue: [cls == aClass]
							ifFalse: [(self lineageOf: cls) == mine]]]]
		ifNone: [nil])
			ifNil: [nil]
			ifNotNil: [:change | change newSource]
]

{ #category : 'private - applying' }
GsRenameInstanceVariableRefactoring >> lineageOf: aClass [
	"aClass's class history -- the one object every version of it shares, and no other class
	 does. nil for a class with no history; the caller then falls back to plain identity rather
	 than letting two history-less classes match on a shared nil."
	aClass isNil ifTrue: [^nil].
	^[aClass classHistory] on: Error do: [:e | nil]
]

{ #category : 'private - applying' }
GsRenameInstanceVariableRefactoring >> renamedInstVarNamesOf: aClass [
	"aClass's OWN instance-variable names with the renamed one substituted."
	^aClass instVarNames collect: [:n |
		n asSymbol == oldNameSym ifTrue: [newName] ifFalse: [n asString]]
]

{ #category : 'private - applying' }
GsRenameInstanceVariableRefactoring >> reversion: old superclass: sup instVarNames: ivars deselected: deselected into: failures [
	"Create the new version of `old` under `sup` with `ivars`, then carry every method
	 forward onto it. Answers the new version."
	| new |
	new := self makeNewVersionOf: old superclass: sup instVarNames: ivars.
	self copyMethodsFrom: old to: new deselected: deselected into: failures.
	^new
]

{ #category : 'private - applying' }
GsRenameInstanceVariableRefactoring >> makeNewVersionOf: old superclass: sup instVarNames: ivars [
	"A new version in `old`'s class history, under `sup`, with `ivars` as its own
	 instance variables.

	 Passes `old format` explicitly rather than using the plain newVersionOf: form,
	 which derives format from the superclass and so silently drops the class's own
	 format bits (byte vs pointer vs NSC vs indexable, and options such as
	 instancesInvariant). Threading `inClassHistory: old classHistory` keeps it a
	 version of the same class, so class-variable values and the class category carry
	 forward automatically. (Same construction as GsRenameClassRefactoring.)"
	^sup
		_subclass: old name asString
		instVarNames: ivars
		format: old format
		classVars: (old classVarNames collect: [:e | e asString])
		classInstVars: (old class instVarNames collect: [:e | e asString])
		poolDictionaries: old sharedPools
		inDictionary: (self dictObjectFor: old)
		inClassHistory: old classHistory
		description: ([old commentForFileout] on: Error do: [:e | ''])
		options: #()
]

{ #category : 'private - applying' }
GsRenameInstanceVariableRefactoring >> copyMethodsFrom: old to: new deselected: deselected into: failures [
	"Carry every method of `old` onto `new`, both sides. An accessing method compiles
	 from its staged, rewritten source; every other method compiles from its existing
	 source unchanged. A new class version starts with an empty method dictionary, so
	 this is the only thing that keeps the behaviour alive.

	 Class-side methods cannot reference an instance variable, so they are always
	 copied verbatim and are never deselectable."
	old selectors do: [:sel |
		(self deselected: deselected includes: sel for: old)
			ifFalse: [self copyMethod: sel from: old to: new meta: false into: failures]].
	old class selectors do: [:sel |
		self copyMethod: sel from: old class to: new class meta: true into: failures]
]

{ #category : 'private - applying' }
GsRenameInstanceVariableRefactoring >> copyMethod: sel from: srcCls to: dstCls meta: isMeta into: failures [
	"Carry one method onto the new version -- an accessing method from its staged, rewritten
	 source, every other method from its existing source. A method that will not recompile is
	 recorded rather than allowed to vanish unremarked. Answers whether it compiled."
	| m src |
	m := srcCls compiledMethodAt: sel environmentId: 0 otherwise: nil.
	m isNil ifTrue: [^true].
	src := isMeta
		ifTrue: [m sourceString]
		ifFalse: [(self newSourceFor: srcCls selector: sel) ifNil: [m sourceString]].
	^environment
		copyMethod: sel
		from: srcCls
		to: dstCls
		source: src
		meta: isMeta
		into: failures
]

{ #category : 'private - applying' }
GsRenameInstanceVariableRefactoring >> dictObjectFor: aClass [
	"The SymbolDictionary a new class version is bound into, for inDictionary:. Resolved by
	 IDENTITY: the dictionary that binds aClass itself, not the first one binding its name.
	 Name-first-match rebound the reshaped class into whichever dictionary the symbol list
	 reached first, replacing an unrelated same-named class with this one and leaving the
	 acted-on class unchanged (#396). UserGlobals remains the fallback for a class no
	 dictionary binds under its own name."
	^(environment dictionaryDefiningClass: aClass)
		ifNil: [environment symbolList objectNamed: #UserGlobals]
]

{ #category : 'serializing' }
GsRenameInstanceVariableRefactoring >> jsonQuote: aString [
	^GsRefactoringJson jsonQuote: aString
]

{ #category : 'serializing' }
GsRenameInstanceVariableRefactoring >> jsonEscape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'serializing' }
GsRenameInstanceVariableRefactoring >> hex2: anInteger [
	^GsRefactoringJson hex2: anInteger
]

{ #category : 'previewing' }
GsRenameInstanceVariableRefactoring class >> clearToken: token [
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: []
]

{ #category : 'previewing' }
GsRenameInstanceVariableRefactoring >> startPreviewToken: token [
	"Build the change set, stash this refactoring in SessionTemps under token, and
	 answer it. The token lets the client APPLY server-side afterwards
	 (applyForToken:deselected:) instead of replaying the changes itself -- which is
	 what keeps every untouched method alive, since only the engine knows to copy the
	 whole method dictionary onto the new class version.

	 Nothing is compiled and nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"changes":', self changeSet jsonString, '}'
]
